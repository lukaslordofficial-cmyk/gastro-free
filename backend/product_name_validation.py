"""Walidacja nazw produktów z ofert dostawców (wcześniej w delta_scraper.parser)."""
from __future__ import annotations

import re

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


def is_valid_product_name(name: str) -> bool:
    """Odrzuca jednostki, ceny i śmieci typu „szt” / „text” / „katalog”."""
    n = (name or "").strip(" ·-–—|:·")
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
    cleaned = re.sub(r"\b(?:szt\.?|kg|g|ml|l|op\.?|opak\.?)\b", " ", n, flags=re.IGNORECASE)
    cleaned = re.sub(r"\d+[.,]\d{2}", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 3 or not _HAS_LETTER_RE.search(cleaned):
        return False
    if _JUNK_NAME_RE.match(cleaned):
        return False
    return True
