"""Odkrywanie podstron produktowych ze strony głównej hurtowni."""
from __future__ import annotations

import logging
import re
from collections import deque
from typing import Callable, Optional
from urllib.parse import urljoin, urldefrag, urlparse

logger = logging.getLogger("delta_scraper.crawler")

# Domyślne limity — więcej stron, nadal bezpieczne dla cronu
DEFAULT_MAX_PAGES = 60
DEFAULT_MAX_DEPTH = 3

# Ścieżki wyglądające na listę / kartę produktu w sklepie e-commerce
_PRODUCTISH = re.compile(
    r"("
    r"produkt|product|towar|artykul|artykuł|item|sku|"
    r"sklep|shop|store|listing|search|szukaj|"
    r"kategoria|category|categories|collections?|collection|"
    r"asortyment|assortment|"
    r"selgros|eurocash|makro|metro|"
    r"hurt|grocery|food|gastro|b2b|"
    r"napoj|napój|mieso|mięso|warzyw|owoc|nabial|nabiał|pieczyw|"
    r"/p/\d|/pl/|/en/|page=|strona="
    r")",
    re.I,
)

# PDF / gazetki / pliki — unikamy (to nie karty e-commerce)
_SKIP = re.compile(
    r"("
    r"login|logowanie|register|rejestr|konto|account|cart|koszyk|checkout|"
    r"privacy|polityka|cookie|regulamin|terms|rodo|gdpr|"
    r"kontakt|contact|about|o-nas|blog|news|aktualnos|career|praca|"
    r"facebook|instagram|linkedin|youtube|twitter|tiktok|"
    r"mailto:|tel:|javascript:|whatsapp|"
    r"gazetka|ulotka|download|pobierz|pliki|/files/|/media/|"
    r"cennik\.pdf|katalog\.pdf|"
    r"\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|docx?|xlsx?|css|js)(\?|$)"
    r")",
    re.I,
)

_SHOP_HOST_BOOST = re.compile(
    r"(selgros|eurocash|makro|metro-cash|auchan|carrefour|tesco|makro\.pl)",
    re.I,
)


def normalize_url(url: str) -> str:
    url, _ = urldefrag((url or "").strip())
    if url.endswith("/") and url.count("/") > 3:
        url = url.rstrip("/")
    return url


def same_registrable_host(a: str, b: str) -> bool:
    try:
        ha = urlparse(a).hostname or ""
        hb = urlparse(b).hostname or ""
    except Exception:
        return False
    ha = ha.lower().removeprefix("www.")
    hb = hb.lower().removeprefix("www.")
    return bool(ha) and ha == hb


def score_product_url(url: str) -> int:
    """Wyższy wynik = bardziej prawdopodobna podstrona sklepu e-commerce z kartami produktów."""
    parsed = urlparse(url)
    path = (parsed.path or "/").lower()
    query = (parsed.query or "").lower()
    host = (parsed.hostname or "").lower()
    full = path + "?" + query
    if _SKIP.search(full):
        return -100
    # Twarde PDF / gazetki nawet bez rozszerzenia w query
    if ".pdf" in full or "gazetka" in full or "ulotka" in full:
        return -100
    score = 0
    if _SHOP_HOST_BOOST.search(host):
        score += 10
    if _PRODUCTISH.search(full):
        score += 14
    # Klasyczne ścieżki sklepowe
    if any(x in full for x in ("/sklep", "/shop", "/product", "/produkt", "/kategoria", "/category")):
        score += 8
    # „katalog” HTML OK, ale nie plik
    if re.search(r"/katalog|/catalog", full) and ".pdf" not in full:
        score += 4
    parts = [p for p in path.split("/") if p]
    if 1 <= len(parts) <= 5:
        score += 4
    if any(x in full for x in ("page=", "strona=", "p=", "limit=", "page/", "/page/")):
        score += 3
    if 1 <= len(parts) <= 2 and score >= 0:
        score += 2
    if path in ("", "/"):
        score -= 5
    return score


def extract_same_domain_links(html: str, base_url: str) -> list[str]:
    if not html or "<" not in html[:500] and "<a" not in html.lower():
        # plaintext — brak linków
        return []
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return _extract_links_regex(html, base_url)

    soup = BeautifulSoup(html, "html.parser")
    out: list[str] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if not href or href.startswith("#"):
            continue
        abs_url = normalize_url(urljoin(base_url, href))
        if not abs_url.startswith("http"):
            continue
        if not same_registrable_host(base_url, abs_url):
            continue
        if abs_url in seen:
            continue
        seen.add(abs_url)
        out.append(abs_url)
    return out


def _extract_links_regex(html: str, base_url: str) -> list[str]:
    found = re.findall(r'href=["\']([^"\']+)["\']', html, flags=re.I)
    out: list[str] = []
    seen: set[str] = set()
    for href in found:
        abs_url = normalize_url(urljoin(base_url, href.strip()))
        if not abs_url.startswith("http"):
            continue
        if not same_registrable_host(base_url, abs_url):
            continue
        if abs_url in seen:
            continue
        seen.add(abs_url)
        out.append(abs_url)
    return out


def pick_crawl_targets(
    seed_url: str,
    discovered: list[str],
    *,
    max_pages: int = DEFAULT_MAX_PAGES,
) -> list[str]:
    """Wybiera listę URL do odwiedzenia (seed + najlepsze podstrony)."""
    seed = normalize_url(seed_url)
    scored: list[tuple[int, str]] = []
    for u in discovered:
        u = normalize_url(u)
        if u == seed:
            continue
        if not same_registrable_host(seed, u):
            continue
        sc = score_product_url(u)
        if sc <= 0:
            continue
        scored.append((sc, u))
    scored.sort(key=lambda x: (-x[0], x[1]))
    # zostaw room na seed
    limit = max(0, max_pages - 1)
    return [u for _, u in scored[:limit]]


async def crawl_supplier_site(
    seed_url: str,
    *,
    fetch_html: Callable,
    parse_products: Callable,
    max_pages: int = DEFAULT_MAX_PAGES,
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> tuple[list, list[str], dict]:
    """
    BFS od strony głównej / seed.
    fetch_html(url) -> (hash_input, parse_input)  — jak fetch_page
    parse_products(parse_input) -> list[ScrapedProduct]

    Zwraca (products, visited_urls, meta).
    """
    from delta_scraper.models import ScrapedProduct
    from delta_scraper.parser import normalize_product_key

    seed = normalize_url(seed_url)
    queue: deque[tuple[str, int]] = deque([(seed, 0)])
    visited: set[str] = set()
    visited_order: list[str] = []
    by_key: dict[str, ScrapedProduct] = {}
    pages_with_products = 0
    errors = 0
    text_samples: list[str] = []

    while queue and len(visited) < max_pages:
        url, depth = queue.popleft()
        url = normalize_url(url)
        if url in visited:
            continue
        visited.add(url)
        visited_order.append(url)

        try:
            hash_input, parse_input = await fetch_html(url)
        except Exception as e:
            logger.warning("crawl fetch failed %s: %s", url, e)
            errors += 1
            continue

        # Próbka tekstu strony → AI gdy heurystyka nic nie wyciągnie
        if len(text_samples) < 4 and parse_input:
            sample = parse_input
            if "<" in sample[:800]:
                try:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(sample, "html.parser")
                    for tag in soup(["script", "style", "noscript", "svg"]):
                        tag.decompose()
                    sample = soup.get_text("\n", strip=True)
                except Exception:
                    pass
            sample = (sample or "").strip()
            if len(sample) > 40:
                text_samples.append(sample[:9000])

        try:
            products = parse_products(parse_input) or []
        except Exception as e:
            logger.warning("crawl parse failed %s: %s", url, e)
            products = []

        if products:
            pages_with_products += 1
        for p in products:
            if not p.name:
                continue
            key = normalize_product_key(p.name) or p.name.lower().strip()
            prev = by_key.get(key)
            if prev is None:
                by_key[key] = p
            elif p.price_pln > 0 and (prev.price_pln <= 0 or p.price_pln < prev.price_pln):
                by_key[key] = p

        # Odkrywaj linki z HTML (Playwright też zwraca HTML)
        if depth < max_depth and parse_input and ("<" in parse_input[:2000] or "href=" in parse_input.lower()):
            links = extract_same_domain_links(parse_input, url)
            ranked = sorted(
                (l for l in links if l not in visited),
                key=lambda u: score_product_url(u),
                reverse=True,
            )
            for link in ranked:
                sc = score_product_url(link)
                # Bierz też „zwykłe” ścieżki katalogowe (score > 0), nie tylko mocne trafienia
                if sc <= 0:
                    continue
                if len(visited) + len(queue) >= max_pages:
                    break
                queue.append((link, depth + 1))
            # Jeśli mało kandydatów produktowych — dołóż kilka płytkich ścieżek (score >= -5 nie-skip)
            if len(queue) < 8:
                extras = [
                    l for l in links
                    if l not in visited and score_product_url(l) > -50
                    and len((urlparse(l).path or "/").strip("/").split("/")) <= 3
                ]
                for link in extras[:15]:
                    if len(visited) + len(queue) >= max_pages:
                        break
                    if link not in visited and all(link != q[0] for q in queue):
                        queue.append((link, depth + 1))

    products_out = sorted(by_key.values(), key=lambda p: (p.name or "").lower())
    meta = {
        "pages_crawled": len(visited_order),
        "pages_with_products": pages_with_products,
        "products_merged": len(products_out),
        "fetch_errors": errors,
        "seed_url": seed,
        "text_sample": "\n---\n".join(text_samples)[:28000],
    }
    logger.info(
        "Crawl %s → %s stron, %s produktów (błędy: %s)",
        seed, meta["pages_crawled"], meta["products_merged"], errors,
    )
    return products_out, visited_order, meta
