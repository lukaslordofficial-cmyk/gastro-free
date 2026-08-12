from __future__ import annotations

import logging
import re
from typing import Optional

import httpx

logger = logging.getLogger("delta_scraper.fetcher")

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


async def fetch_httpx(url: str, *, timeout: float = 45.0, verify=True) -> str:
    from url_safety import assert_safe_outbound_url
    url = assert_safe_outbound_url(url)
    headers = {"User-Agent": DEFAULT_UA, "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8"}
    async with httpx.AsyncClient(timeout=timeout, verify=verify, follow_redirects=True) as client:
        r = await client.get(url, headers=headers)
        r.raise_for_status()
        return r.text


async def fetch_playwright_page(url: str, *, timeout_ms: int = 45_000) -> tuple[str, str]:
    """Zwraca (widoczny_tekst, html) — HTML potrzebny do odkrywania podstron."""
    from playwright.async_api import async_playwright
    from url_safety import assert_safe_outbound_url
    url = assert_safe_outbound_url(url)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(user_agent=DEFAULT_UA)
            page = await context.new_page()
            await page.goto(url, wait_until="networkidle", timeout=timeout_ms)
            # Daj SPA chwilę na dociągnięcie menu / listingów
            try:
                await page.wait_for_timeout(800)
            except Exception:
                pass
            text = await page.evaluate("() => document.body ? document.body.innerText : ''")
            html = await page.content()
            return (text or ""), (html or "")
        finally:
            await browser.close()


async def fetch_playwright_visible_text(url: str, *, timeout_ms: int = 45_000) -> str:
    text, _html = await fetch_playwright_page(url, timeout_ms=timeout_ms)
    return text


async def fetch_page(
    url: str,
    *,
    mode: str = "auto",
    verify=True,
    css_selector: Optional[str] = None,
) -> tuple[str, str]:
    """
    Zwraca (content_for_hash, parse_input).
    parse_input preferuje HTML (linki + produkty); hash liczony z tekstu / fingerprintu.
    """
    mode = (mode or "auto").lower()
    force_pw = mode == "playwright"

    if force_pw:
        try:
            text, html = await fetch_playwright_page(url)
            # HTML do crawla linków; tekst do hash/fallback parse
            return text, html or text
        except Exception as e:
            logger.warning("Playwright failed for %s: %s — fallback httpx", url, e)

    html = await fetch_httpx(url, verify=verify)

    use_pw = False
    if mode in ("auto", "httpx") and not force_pw:
        use_pw = _looks_like_spa(html)

    if use_pw:
        try:
            text, pw_html = await fetch_playwright_page(url)
            logger.info("Auto-switched to Playwright for %s", url)
            return text, pw_html or text
        except Exception as e:
            logger.warning("Auto Playwright failed for %s: %s", url, e)

    if css_selector:
        return html, html
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        text = soup.get_text("\n", strip=True)
        if mode == "auto" and len(text) < 180:
            try:
                pw_text, pw_html = await fetch_playwright_page(url)
                if len(pw_text) > len(text):
                    return pw_text, pw_html or pw_text
            except Exception:
                pass
        return text, html
    except ImportError:
        return html, html


def _looks_like_spa(html: str) -> bool:
    """Heurystyka: mało treści widocznej + dużo JavaScriptu = strona wymaga Playwright."""
    if not html or len(html) < 80:
        return True
    low = html.lower()
    script_count = low.count("<script")
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript", "svg"]):
            tag.decompose()
        text_len = len(soup.get_text(" ", strip=True) or "")
    except Exception:
        text_len = len(re.sub(r"<[^>]+>", " ", html))
    if text_len < 220 and script_count >= 3:
        return True
    if "id=\"root\"" in low or "id='root'" in low or "id=\"app\"" in low:
        if text_len < 400:
            return True
    return False
