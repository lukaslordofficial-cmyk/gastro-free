"""
Łowca Okazji — dopasowanie po ODMIANIE / WARIANCIE produktu.

Rozszerzenie kompatybilne wstecz: gdy produkt nie ma odmiany, moduł nie robi nic
(wyszukiwanie po nazwie podstawowej działa jak dotychczas).

Zasady (zgodnie z wymaganiami):
  • "ziemniak" (produkt podstawowy) + "Irys" (odmiana) → najpierw szukaj DOKŁADNIE
    ziemniaka odmiany Irys.
  • Rozumie język ofert: "Jabłka Jonagold 70+", "Jabłko Jonagold kl. I",
    "JABŁKO JONAGOLD 65/70" → to nadal odmiana Jonagold.
  • Nie uznaje dowolnego jabłka za Jonagold — inna odmiana = zamiennik, nigdy exact.
  • Nie podmienia preferencji automatycznie — exact ma bezwzględne pierwszeństwo,
    zamiennik jest tylko propozycją.

Czyste funkcje (bez I/O) — łatwe do testów jednostkowych.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

from pl_fuzzy_norm import food_match_key, norm_pl

# Słowa opisujące GABARYT / KLASĘ / OPAKOWANIE — nie są tożsamością odmiany.
# (żeby "Jabłko Jonagold 70+ kl. I" ≡ "Jonagold")
_VARIANT_NOISE = frozenset({
    "kl", "klasa", "klasy", "klasie", "kal", "kaliber", "gat", "gatunek",
    "luz", "luzem", "paczka", "paczk", "opak", "opakowanie", "opakowaniu",
    "szt", "sztuka", "sztuki", "sztuk", "tacka", "tacki", "worek", "worku",
    "karton", "kartonie", "kg", "kilogram", "g", "gram", "dag", "mg",
    "l", "litr", "ml", "cl", "dl", "mm", "cm", "plus", "kalibr",
})


def _strip_accents(s: str) -> str:
    s = (s or "").replace("ł", "l").replace("Ł", "L")
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def variant_tokens(text: str) -> list[str]:
    """Tokeny odmiany/nazwy — ZACHOWUJE opisowe słowa (bio, premium, bezglutenowy).

    W przeciwieństwie do `norm_pl` nie wycina "premium/bio/eko", bo dla Łowcy
    to bywają właśnie odmiany/warianty wpisane przez restauratora.
    """
    s = _strip_accents(str(text or "")).lower()
    s = s.replace("+", " ").replace("/", " ").replace("%", " ")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    out: list[str] = []
    for t in s.split():
        if t in _VARIANT_NOISE:
            continue
        if len(t) < 2:
            continue
        out.append(t)
    return out


def normalize_variant(text: Optional[str]) -> str:
    """Kanoniczna postać odmiany do porównań/wyświetlania (np. 'jonagold')."""
    return " ".join(variant_tokens(text or ""))


def _token_akin(a: str, b: str) -> bool:
    """Zgodność tokenów z tolerancją odmiany PL (jonagold≈jonagolda, gala≈gale)."""
    if a == b:
        return True
    if len(a) >= 4 and len(b) >= 4 and (a.startswith(b) or b.startswith(a)):
        return True
    return False


def _stem_tokens(text: str) -> set[str]:
    """Rdzenie produktu (liczba mnoga → pojedyncza): jablka→jablk, ziemniaki→ziemniak."""
    return {t for t in food_match_key(text or "").split() if t}


def base_matches_offer(base_name: str, offer_name: str) -> bool:
    """Czy oferta dotyczy TEGO SAMEGO produktu podstawowego (bez względu na odmianę).

    "ziemniak" ⊂ "ziemniak Gala 5kg"  → True
    "jabłko"   ⊂ "Jabłka Jonagold 70+" → True (plural stem)
    "ziemniak" vs "marchew"            → False
    """
    bt = _stem_tokens(base_name)
    ot = _stem_tokens(offer_name)
    if not bt or not ot:
        return False
    for t in bt:
        if t in ot or any(_token_akin(t, o) for o in ot):
            continue
        return False
    return True


def variant_matches_offer(variant: str, offer_name: str) -> bool:
    """Czy oferta zawiera ŻĄDANĄ odmianę (wszystkie tokeny odmiany obecne w ofercie).

    "Jonagold" w "Jabłka Jonagold 70+"     → True
    "Jonagold" w "Jabłko Gala"             → False
    "Irys"     w "Ziemniak Irys jadalny"   → True
    """
    vt = variant_tokens(variant)
    if not vt:
        return False
    ot = set(variant_tokens(offer_name))
    if not ot:
        return False
    for t in vt:
        if t in ot or any(_token_akin(t, o) for o in ot):
            continue
        return False
    return True


def offer_variant_label(base_name: str, offer_name: str) -> str:
    """Etykieta odmiany oferty względem produktu podstawowego (do prezentacji).

    base "ziemniak", oferta "Ziemniak Gala 5kg"     → "Gala"
    base "jabłko",   oferta "Jabłka Jonagold 70+"    → "Jonagold"
    Gdy nic nie zostaje (sama nazwa podstawowa)      → ""
    """
    base_stems = _stem_tokens(base_name)
    base_norm = set(variant_tokens(base_name))
    labels: list[str] = []
    for raw in variant_tokens(offer_name):
        # Pomiń gabaryt/klasę (70, 5kg, 500g, 65) — to nie odmiana.
        if re.match(r"^\d", raw):
            continue
        if raw in base_norm:
            continue
        stem = next(iter(_stem_tokens(raw)), raw)
        if stem in base_stems or any(_token_akin(stem, b) for b in base_stems):
            continue
        labels.append(raw)
    return " ".join(w.capitalize() for w in labels).strip()


def classify_offer(requested_variant: Optional[str], base_name: str, offer_name: str) -> str:
    """Klasyfikacja oferty względem preferencji użytkownika.

    Zwraca: "exact" | "substitute" | "none"
      exact      → ten sam produkt + żądana odmiana (lub brak żądanej odmiany)
      substitute → ten sam produkt, ale INNA odmiana
      none       → inny produkt
    """
    if not base_matches_offer(base_name, offer_name):
        return "none"
    if not (requested_variant or "").strip():
        return "exact"
    return "exact" if variant_matches_offer(requested_variant, offer_name) else "substitute"


__all__ = [
    "variant_tokens",
    "normalize_variant",
    "base_matches_offer",
    "variant_matches_offer",
    "offer_variant_label",
    "classify_offer",
]
