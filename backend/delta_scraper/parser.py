from __future__ import annotations

import re
from typing import Optional

from delta_scraper.models import ScrapedProduct

# Ceny: 12,99 zł | 12.99 PLN | 12,99
_PRICE_RE = re.compile(
    r"(?P<price>\d{1,6}[.,]\d{2})\s*(?:zł|pln|PLN)?",
    re.IGNORECASE,
)
# Nazwa + cena w jednej linii
_LINE_PRICE_RE = re.compile(
    r"^(?P<name>.{3,120}?)\s+(?P<price>\d{1,6}[.,]\d{2})\s*(?:zł|pln)?\s*$",
    re.IGNORECASE,
)
_UNIT_IN_NAME_RE = re.compile(
    r"\b(\d+[.,]?\d*\s*(?:kg|g|l|ml|szt\.?|op\.?|opak\.?))\b",
    re.IGNORECASE,
)
_UNIT_ONLY_RE = re.compile(
    r"^(?:szt\.?|sztuki?|op\.?|opak\.?|kg|g|l|ml|do\s+koszyka|kup\s+teraz|promocja)$",
    re.IGNORECASE,
)
_JUNK_NAME_RE = re.compile(
    r"^(?:"
    r"text|name|code|title|label|price|cena|katalog|catalog|pdf|download|pobierz|"
    r"plik|file|strona|page|menu|koszyk|cart|login|szukaj|search|filtr|filter|"
    r"kategoria|category|oferta|gazetka|ulotka|cennik|więcej|wiecej|czytaj|"
    r"szczegóły|szczegoly|details|add|dodaj|kup|buy|next|prev|dalej|wstecz"
    r")$",
    re.IGNORECASE,
)
_HAS_LETTER_RE = re.compile(r"[a-ząćęłńóśźż]", re.IGNORECASE)
_PACKED_NAME_RE = re.compile(r"(?:^|\|\s*)NAME:\s*(.+?)(?=\s*\||$)", re.IGNORECASE)
_PACKED_CODE_RE = re.compile(r"(?:^|\|\s*)CODE:\s*(.+?)(?=\s*\||$)", re.IGNORECASE)
_PACKED_TEXT_RE = re.compile(r"(?:^|\|\s*)TEXT:\s*(.+)$", re.IGNORECASE | re.DOTALL)
_PROMO_WORDS = ("promocja", "wyprzedaż", "wyprzedaz", "super cena", "hit tygodnia", "-%")
_OOS_WORDS = ("brak w magazynie", "niedostępny", "niedostepny", "wyprzedane", "brak na stanie")


def normalize_product_key(name: str) -> str:
    s = (name or "").lower().strip()
    s = re.sub(r"[^a-z0-9ąćęłńóśźż\s]", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def is_valid_product_name(name: str) -> bool:
    """Odrzuca jednostki, ceny i śmieci typu „szt” / „text” / „katalog”."""
    n = (name or "").strip(" ·-–—|:·")
    # Zdejmij ewentualne prefiksy z AI packed blocks
    n = re.sub(r"^(?:NAME|TEXT|CODE)\s*:\s*", "", n, flags=re.IGNORECASE).strip()
    if len(n) < 3:
        return False
    if _UNIT_ONLY_RE.match(n):
        return False
    if _JUNK_NAME_RE.match(n):
        return False
    if re.fullmatch(r"\d+[.,]\d{2}", n):
        return False
    if not _HAS_LETTER_RE.search(n):
        return False
    # Samo „szt 12,99” / „kg” na początku bez sensownej nazwy
    cleaned = re.sub(r"\b(?:szt\.?|kg|g|ml|l|op\.?|opak\.?)\b", " ", n, flags=re.IGNORECASE)
    cleaned = re.sub(r"\d+[.,]\d{2}", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 3 or not _HAS_LETTER_RE.search(cleaned):
        return False
    if _JUNK_NAME_RE.match(cleaned):
        return False
    return True


def _parse_price(raw: str) -> float:
    s = (raw or "").replace(" ", "").replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return 0.0


def _detect_status(line_lower: str) -> str:
    if any(w in line_lower for w in _OOS_WORDS):
        return "out_of_stock"
    if any(w in line_lower for w in _PROMO_WORDS):
        return "promo"
    return "available"


def _looks_like_unit_line(line: str) -> bool:
    s = (line or "").strip()
    return bool(_UNIT_ONLY_RE.match(s)) or bool(re.fullmatch(r"\d+\s*(?:szt\.?|kg|g|ml|l)", s, re.I))


def extract_products_from_text(text: str) -> list[ScrapedProduct]:
    """Heurystyczne wyciąganie produktów z widocznego tekstu strony."""
    products: list[ScrapedProduct] = []
    seen: set[str] = set()
    # Najpierw bloki packed z AI DOM (NAME: … | CODE: … | TEXT: …)
    for chunk in re.split(r"\n---\n|\n+", text or ""):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "NAME:" in chunk.upper() or "TEXT:" in chunk.upper():
            nm = _PACKED_NAME_RE.search(chunk)
            cd = _PACKED_CODE_RE.search(chunk)
            tx = _PACKED_TEXT_RE.search(chunk)
            name = (nm.group(1).strip() if nm else "")
            code = (cd.group(1).strip() if cd else "")
            body = (tx.group(1).strip() if tx else chunk)
            if not name:
                # fallback: pierwsza sensowna część przed ceną
                mprice = _PRICE_RE.search(body)
                name = body[: mprice.start()].strip() if mprice else body
            name = re.sub(r"^(?:NAME|TEXT|CODE)\s*:\s*", "", name, flags=re.IGNORECASE).strip()
            prices = list(_PRICE_RE.finditer(body))
            price = _parse_price(prices[-1].group("price")) if prices else 0.0
            if is_valid_product_name(name) and price > 0:
                key = normalize_product_key(name)
                if key and key not in seen:
                    seen.add(key)
                    products.append(ScrapedProduct(
                        name=name,
                        price_pln=price,
                        unit="szt",
                        volume_label="",
                        status=_detect_status(body.lower()),
                        raw_line=chunk[:200],
                        product_code=code[:64] if code else "",
                    ))

    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]

    def _add(name: str, price: float, line: str, *, unit: str = "szt", code: str = "") -> None:
        name = (name or "").strip(" ·-–—|:")
        name = re.sub(r"^(?:NAME|TEXT|CODE)\s*:\s*", "", name, flags=re.IGNORECASE).strip()
        if not is_valid_product_name(name) or price <= 0:
            return
        key = normalize_product_key(name)
        if not key or key in seen:
            return
        seen.add(key)
        vol_m = _UNIT_IN_NAME_RE.search(name)
        products.append(ScrapedProduct(
            name=name,
            price_pln=price,
            unit=unit or "szt",
            volume_label=vol_m.group(1) if vol_m else "",
            status=_detect_status(line.lower()),
            raw_line=line,
            product_code=code or "",
        ))

    for i, line in enumerate(lines):
        if len(line) < 3:
            continue
        if line.upper().startswith(("NAME:", "TEXT:", "CODE:")) or " | NAME:" in line.upper():
            continue

        m = _LINE_PRICE_RE.match(line)
        if m:
            _add(m.group("name"), _parse_price(m.group("price")), line)
            continue

        prices = list(_PRICE_RE.finditer(line))
        if len(prices) == 1 and len(line) < 160:
            price = _parse_price(prices[0].group("price"))
            name = line[: prices[0].start()].strip(" ·-–—|:")
            name = re.sub(r"^(?:szt\.?|op\.?|opak\.?)\s+", "", name, flags=re.IGNORECASE).strip()
            if is_valid_product_name(name):
                _add(name, price, line)
                continue

        if not prices and is_valid_product_name(line) and not _PRICE_RE.search(line):
            for j in (i + 1, i + 2):
                if j >= len(lines):
                    break
                nxt = lines[j]
                if j == i + 1 and _looks_like_unit_line(nxt):
                    continue
                if len(nxt) < 48:
                    pm = list(_PRICE_RE.finditer(nxt))
                    if len(pm) == 1 and len(nxt[: pm[0].start()].strip()) < 12:
                        unit = "szt"
                        if j == i + 2 and _looks_like_unit_line(lines[i + 1]):
                            unit = lines[i + 1].strip()[:12]
                        _add(line, _parse_price(pm[0].group("price")), f"{line} {nxt}", unit=unit)
                        break

    return products


def _attr(el, *keys: str) -> str:
    if el is None:
        return ""
    for k in keys:
        v = el.get(k)
        if v and str(v).strip():
            return str(v).strip()
    return ""


def _extract_from_product_cards(html: str, css_selector: Optional[str] = None) -> list[ScrapedProduct]:
    """Strukturalne karty: nazwa z alt/title/h*, kod z data-product-id/sku."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return []

    soup = BeautifulSoup(html or "", "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()

    selectors = []
    if css_selector:
        selectors.append(css_selector)
    selectors.extend([
        "[data-product-id]",
        "[data-product]",
        "[data-sku]",
        ".product-card",
        ".product-item",
        ".product-tile",
        ".product",
        "li.product",
        "article.product",
        "[itemtype*='Product']",
    ])

    cards = []
    for sel in selectors:
        try:
            found = soup.select(sel)
        except Exception:
            found = []
        if found and len(found) >= 2:
            cards = found
            break
        if found and not cards:
            cards = found
    if not cards:
        return []

    out: list[ScrapedProduct] = []
    seen: set[str] = set()

    for card in cards[:150]:
        code = (
            _attr(card, "data-product-id", "data-product", "data-sku", "data-id", "sku", "id")
            or ""
        )
        if code and len(code) > 64:
            code = code[:64]

        name = (
            _attr(card, "data-product-name", "data-name", "data-title", "title", "aria-label")
        )
        if not name:
            for sel in (
                ".product-name", ".product-title", ".name", "h2", "h3", "h4",
                "a.product-name", "a[title]", ".woocommerce-loop-product__title",
            ):
                node = card.select_one(sel)
                if node:
                    name = _attr(node, "title") or node.get_text(" ", strip=True)
                    if name:
                        break
        if not name:
            img = card.select_one("img[alt]")
            if img:
                name = _attr(img, "alt")
        if not name:
            a = card.select_one("a[title]")
            if a:
                name = _attr(a, "title")

        name = re.sub(r"\s+", " ", (name or "").strip())
        if not is_valid_product_name(name):
            continue

        text = card.get_text(" ", strip=True)
        price = 0.0
        pm = list(_PRICE_RE.finditer(text))
        if pm:
            price = _parse_price(pm[-1].group("price"))
        if price <= 0:
            price_el = card.select_one("[itemprop=price], .price, .product-price, [data-price]")
            if price_el:
                raw_p = _attr(price_el, "content", "data-price") or price_el.get_text(" ", strip=True)
                m = _PRICE_RE.search(raw_p)
                if m:
                    price = _parse_price(m.group("price"))
                else:
                    try:
                        price = float(str(raw_p).replace(",", ".").strip())
                    except ValueError:
                        price = 0.0

        key = normalize_product_key(name)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(ScrapedProduct(
            name=name,
            price_pln=price if price > 0 else 0.0,
            unit="szt",
            volume_label="",
            status=_detect_status(text.lower()),
            raw_line=f"{name} {price} {code}".strip(),
            product_code=code,
        ))

    return out


def extract_products_from_html(html: str, css_selector: Optional[str] = None) -> list[ScrapedProduct]:
    """JSON-LD → karty DOM (nazwa+id) → bloki tekstowe → heurystyka."""
    ld = _extract_from_json_ld(html)
    if ld:
        return ld

    cards = _extract_from_product_cards(html, css_selector)
    if cards and sum(1 for p in cards if is_valid_product_name(p.name)) >= 2:
        return cards

    try:
        from delta_scraper.ai_interpreter import extract_potential_product_blocks
        blocks = extract_potential_product_blocks(html, css_selector)
        products = extract_products_from_text(blocks.replace("---", "\n"))
        if products:
            # Dołącz kody z kart jeśli mamy
            if cards:
                by_key = {normalize_product_key(c.name): c for c in cards}
                for p in products:
                    c = by_key.get(normalize_product_key(p.name))
                    if c and c.product_code and not p.product_code:
                        p.product_code = c.product_code
            return products
        if cards:
            return cards
    except Exception:
        if cards:
            return cards

    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return extract_products_from_text(html)

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()

    if css_selector:
        nodes = soup.select(css_selector)
        if nodes:
            chunks = "\n".join(n.get_text("\n", strip=True) for n in nodes)
            return extract_products_from_text(chunks)

    text = soup.get_text("\n", strip=True)
    return extract_products_from_text(text)


def _extract_from_json_ld(html: str) -> list[ScrapedProduct]:
    """Wyciąga Product/Offer z application/ld+json."""
    if not html or "ld+json" not in html.lower():
        return []
    try:
        from bs4 import BeautifulSoup
        import json
    except ImportError:
        return []

    soup = BeautifulSoup(html, "html.parser")
    out: list[ScrapedProduct] = []
    seen: set[str] = set()

    def _price_from(obj: dict) -> float:
        offers = obj.get("offers")
        if isinstance(offers, list) and offers:
            offers = offers[0]
        if isinstance(offers, dict):
            p = offers.get("price") or offers.get("lowPrice")
            if p is not None:
                try:
                    return float(str(p).replace(",", "."))
                except ValueError:
                    return 0.0
        p = obj.get("price")
        if p is not None:
            try:
                return float(str(p).replace(",", "."))
            except ValueError:
                return 0.0
        return 0.0

    def _walk(node) -> None:
        if isinstance(node, list):
            for x in node:
                _walk(x)
            return
        if not isinstance(node, dict):
            return
        t = node.get("@type") or node.get("type") or ""
        types = t if isinstance(t, list) else [t]
        types_l = [str(x).lower() for x in types]
        if any("product" in x for x in types_l):
            name = str(node.get("name") or "").strip()
            price = _price_from(node)
            code = str(node.get("sku") or node.get("productID") or node.get("mpn") or "").strip()
            if is_valid_product_name(name):
                key = normalize_product_key(name)
                if key and key not in seen:
                    seen.add(key)
                    out.append(ScrapedProduct(
                        name=name,
                        price_pln=price if price > 0 else 0.0,
                        volume_label="",
                        status="available",
                        raw_line=f"{name} {price}",
                        product_code=code,
                    ))
        for v in node.values():
            if isinstance(v, (dict, list)):
                _walk(v)

    for script in soup.find_all("script", attrs={"type": lambda v: v and "ld+json" in v.lower()}):
        raw = (script.string or script.get_text() or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        _walk(data)

    return out
