"""
AI Interpreter dla scrapera katalogów dostawców.

1) extract_potential_product_blocks — filtr DOM (cena / zdjęcie / e-commerce)
2) interpret_culinary_products — OpenAI Structured Outputs → produkty kulinarne
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

from pydantic import BaseModel, Field

from delta_scraper.models import ScrapedProduct

logger = logging.getLogger("delta_scraper.ai")

# Selektorzy e-commerce — od najbardziej „produktowych”
_PRODUCT_SELECTORS = [
    '[itemtype*="schema.org/Product"]',
    '[itemtype*="Product"]',
    "[data-product-id]",
    "[data-product]",
    ".product-item",
    ".product-card",
    ".product-block",
    ".product-tile",
    ".product-box",
    ".product",
    ".offer-item",
    ".offer-box",
    ".item-box",
    ".goods-item",
    "li.product",
    "article.product",
    ".category-products .item",
    ".products-grid .item",
    ".product-list-item",
    "[class*='ProductCard']",
    "[class*='product-card']",
    ".woocommerce ul.products li.product",
]

_PRICE_HINT = re.compile(r"(zł|pln|€|eur|\d+[.,]\d{2})", re.IGNORECASE)


class CulinaryProduct(BaseModel):
    name: str = Field(description="Czysta nazwa produktu spożywczego do kuchni (NIE jednostka typu szt/kg)")
    price: Optional[float] = Field(default=None, description="Cena jako liczba")
    currency: Optional[str] = Field(default="PLN")
    unit: Optional[str] = Field(default="szt")
    product_code: Optional[str] = Field(default=None, description="SKU / data-product-id ze strony jeśli widoczny")
    is_culinary_ingredient: bool = Field(
        description="True tylko jeśli produkt nadaje się do gotowania w gastronomii"
    )
    confidence_score: float = Field(description="0.0–1.0 pewność, że to poprawny produkt")


class ProductCatalog(BaseModel):
    products: list[CulinaryProduct] = Field(default_factory=list)


def extract_potential_product_blocks(html_content: str, css_selector: Optional[str] = None) -> str:
    """Zwraca skondensowany tekst tylko z bloków wyglądających na oferty produktowe."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return (html_content or "")[:50000]

    soup = BeautifulSoup(html_content or "", "html.parser")
    for element in soup(["script", "style", "noscript", "meta", "svg", "iframe"]):
        element.decompose()

    blocks = []
    if css_selector:
        try:
            blocks = list(soup.select(css_selector))
        except Exception:
            blocks = []

    if not blocks:
        for selector in _PRODUCT_SELECTORS:
            try:
                found = soup.select(selector)
            except Exception:
                found = []
            if found and len(found) >= 2:
                blocks = found
                break
            if found and not blocks:
                blocks = found

    if not blocks:
        # Fallback: rodzice fragmentów z ceną
        for node in soup.find_all(string=_PRICE_HINT):
            parent = getattr(node, "find_parent", lambda *_: None)(["div", "li", "article", "section"])
            if parent is not None and parent not in blocks:
                blocks.append(parent)
            if len(blocks) >= 80:
                break

    extracted: list[str] = []
    seen: set[str] = set()
    for block in blocks[:120]:
        for element in block(["script", "style", "noscript"]):
            element.decompose()

        name_hint = (
            block.get("data-product-name")
            or block.get("data-name")
            or block.get("data-title")
            or block.get("title")
            or block.get("aria-label")
            or ""
        )
        code_hint = (
            block.get("data-product-id")
            or block.get("data-sku")
            or block.get("data-product")
            or block.get("sku")
            or ""
        )
        if not name_hint:
            for sel in (".product-name", ".product-title", "h2", "h3", "a[title]", "img[alt]"):
                node = block.select_one(sel)
                if not node:
                    continue
                name_hint = (node.get("title") or node.get("alt") or node.get_text(" ", strip=True) or "").strip()
                if name_hint:
                    break

        text = block.get_text(separator=" ", strip=True)
        text = re.sub(r"\s+", " ", text).strip()
        parts = []
        if name_hint:
            parts.append(f"NAME: {name_hint}")
        if code_hint:
            parts.append(f"CODE: {code_hint}")
        if text:
            parts.append(f"TEXT: {text}")
        packed = " | ".join(parts)
        if len(packed) < 8 or len(packed) > 600:
            continue
        key = packed[:100].lower()
        if key in seen:
            continue
        seen.add(key)
        extracted.append(packed)

    if not extracted:
        # Ostateczny fallback — skrócony tekst całej strony
        full = soup.get_text("\n", strip=True)
        return full[:30000]

    return "\n---\n".join(extracted)


def _heuristic_from_blocks(blocks_text: str) -> list[ScrapedProduct]:
    from delta_scraper.parser import extract_products_from_text
    return extract_products_from_text(blocks_text.replace("---", "\n"))


async def interpret_culinary_products(
    raw_scraped_text: str,
    *,
    openai_client: Any = None,
    model: Optional[str] = None,
) -> tuple[list[ScrapedProduct], dict]:
    """
    OpenAI Structured Outputs → lista ScrapedProduct (tylko kulinarne).
    Zwraca (products, billing_meta).
    """
    text = (raw_scraped_text or "").strip()
    if not text:
        return [], {"ai_used": False, "reason": "empty"}

    # Limit tokenów — trzymaj się rozsądnego okna
    if len(text) > 24000:
        text = text[:24000]

    model_name = model or os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")
    client = openai_client
    if client is None:
        from openai import AsyncOpenAI
        key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not key:
            return _heuristic_from_blocks(text), {"ai_used": False, "reason": "no_api_key"}
        client = AsyncOpenAI(api_key=key)

    prompt = f"""Jesteś ekspertem ds. gastronomii i zaopatrzenia kuchni.
Przeanalizuj surowy tekst ze scrapingu strony e-commerce / hurtowni.

Wyciągnij TYLKO produkty spożywcze używane w kuchni (warzywa, owoce, mięso, ryby,
nabiał, mąki, przyprawy, oleje, zioła, grzyby, napoje spożywcze do gotowania).

ODRZUĆ:
- opakowania (kartony, folie, skrzynki, torby)
- chemię, sprzęt, usługi, linki, koszyk, dostawę
- przypadkowe liczby bez kontekstu produktu

Surowy tekst:
\"\"\"
{text}
\"\"\"
"""

    try:
        completion = await client.beta.chat.completions.parse(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": "Jesteś precyzyjnym parserem danych e-commerce. Odpowiadasz wyłącznie strukturą JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            response_format=ProductCatalog,
        )
        parsed: ProductCatalog | None = completion.choices[0].message.parsed
        usage = getattr(completion, "usage", None)
        billing = {
            "ai_used": True,
            "model": model_name,
            "prompt_tokens": getattr(usage, "prompt_tokens", 0) if usage else 0,
            "completion_tokens": getattr(usage, "completion_tokens", 0) if usage else 0,
        }
        if not parsed:
            return _heuristic_from_blocks(text), {**billing, "fallback": "empty_parse"}

        products: list[ScrapedProduct] = []
        from delta_scraper.parser import is_valid_product_name
        for p in parsed.products:
            if not p.is_culinary_ingredient:
                continue
            if (p.confidence_score or 0) < 0.45:
                continue
            name = (p.name or "").strip()
            if not is_valid_product_name(name):
                continue
            price = float(p.price or 0)
            products.append(
                ScrapedProduct(
                    name=name,
                    price_pln=price if price > 0 else 0.0,
                    unit=(p.unit or "szt").strip() or "szt",
                    volume_label="",
                    status="available",
                    raw_line=f"{name} {price} {p.currency or 'PLN'}".strip(),
                    product_code=(p.product_code or "").strip(),
                )
            )
        if not products:
            # AI nic nie znalazło — heurystyka z bloków
            return _heuristic_from_blocks(text), {**billing, "fallback": "no_culinary"}
        return products, billing
    except Exception as e:
        logger.warning("AI interpret failed: %s — fallback heurystyka", e)
        return _heuristic_from_blocks(text), {"ai_used": False, "error": str(e)[:200]}


def culinary_products_to_json(products: list[ScrapedProduct]) -> str:
    return json.dumps([p.to_dict() for p in products], ensure_ascii=False, indent=2)
