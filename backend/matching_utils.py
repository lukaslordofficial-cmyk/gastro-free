"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `matching_utils`."""
from __future__ import annotations

from ingredient_name_norm import norm_name as _norm_name
from inventory_invoice_match import GENERIC_FOOD_ONE_TOKEN as _GENERIC_FOOD_ONE_TOKEN
from inventory_invoice_match import inventory_names_same_product as _inventory_names_same_product_impl
from pl_fuzzy_norm import FUZZY_MATCH_THRESHOLD
from pl_fuzzy_norm import food_match_key as _food_match_key
from pl_fuzzy_norm import norm_pl as _norm_pl
from rapidfuzz import fuzz
from rapidfuzz import process as rf_process
from recipe_ingredient_units import is_porcja_row as _is_porcja_row_impl
from typing import Optional
from voice_fuzzy_resolve import VOICE_FUZZY_THRESHOLD
from voice_fuzzy_resolve import resolve_by_fuzzy as _resolve_by_fuzzy_impl
import httpx
import re
import unicodedata
from constants import LOCAL_CATALOG_MATCH_MIN, _UNIT_MAP



def _resolve_by_fuzzy(
    query: Optional[str],
    rows: list[dict],
    key: str = "name",
    threshold: int = VOICE_FUZZY_THRESHOLD,
    *,
    strict_food: bool = False,
) -> tuple[Optional[dict], float]:
    """Dopasowuje `query` do rekordów `rows`. Zob. voice_fuzzy_resolve.resolve_by_fuzzy."""
    return _resolve_by_fuzzy_impl(
        query,
        rows,
        key=key,
        threshold=threshold,
        norm_pl=_norm_pl,
        food_names_compatible=_food_names_compatible,
        strict_food=strict_food,
    )


def _is_porcja_row(name: str) -> bool:
    return _is_porcja_row_impl(name, norm_name_fn=_norm_name)


def _norm(s: str) -> str:
    return " ".join((s or "").lower().split())


def _fuzzy_match(query: str, choices: list[str], threshold: int = FUZZY_MATCH_THRESHOLD
                 ) -> tuple[Optional[str], float]:
    """Zwraca (najlepsze_dopasowanie_znormalizowane, score) lub (None, score),
    jeśli poniżej progu. `choices` już znormalizowane przez `_norm_pl`."""
    if not query or not choices:
        return None, 0.0
    # token_set_ratio dobrze radzi sobie z "filet z kurczaka" ↔ "kurczak filet"
    # i różnymi kolejnościami słów.
    best = rf_process.extractOne(
        query, choices, scorer=fuzz.token_set_ratio, score_cutoff=threshold
    )
    if best is None:
        # Spróbujmy jeszcze "partial ratio" jako fallback (np. "filet drobiowy"
        # w bazie recept: "filet z indyka" — częściowe pokrycie).
        best2 = rf_process.extractOne(
            query, choices, scorer=fuzz.partial_ratio, score_cutoff=max(threshold - 5, 62)
        )
        if best2 is None:
            return None, 0.0
        return best2[0], float(best2[1])
    return best[0], float(best[1])


def _inventory_names_same_product(invoice_name: str, stock_name: str) -> bool:
    """Czy pozycja z faktury to TEN SAM towar co w magazynie (do zwiększenia stanu)."""
    return _inventory_names_same_product_impl(
        invoice_name,
        stock_name,
        food_match_key=_food_match_key,
        norm_fn=_norm,
    )


def _fuzzy_match_token_only(
    query: str, choices: list[str], threshold: int = 82
) -> tuple[Optional[str], float]:
    """Ścisłe fuzzy (bez partial_ratio) — do weryfikacji „występuje w menu”."""
    if not query or not choices:
        return None, 0.0
    best = rf_process.extractOne(
        query, choices, scorer=fuzz.token_set_ratio, score_cutoff=threshold
    )
    if best is None:
        return None, 0.0
    return best[0], float(best[1])


def _norm_unit(u: str):
    """Zwraca (base_dim, factor). Domyślnie traktujemy jak 'szt'."""
    key = (u or "").strip().lower().rstrip(".")
    return _UNIT_MAP.get(key, ("szt", 1.0))


def _slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9 ]", " ", s.lower())


def _tokens(s: str):
    """Tokeny do matchingu katalogu — bez form opakowania (rolka/kostka…)."""
    pack_noise = {
        "rolka", "rolki", "rolke", "kostka", "kostki", "blok", "bloki",
        "plastry", "plaster", "krazek", "krazki", "kreg", "kregi",
        "tacka", "tacki", "luz", "luzem", "porcja", "porcje", "paczka",
        "paczk", "opak", "opakowanie", "szt", "sztuka", "sztuki",
        "premium", "bio", "eko", "fresh", "swiezy", "swieze",
    }
    return [
        t for t in _slug(s).split()
        if len(t) > 2 and t not in pack_noise
    ]


def _match_score(req_name: str, cand_name: str) -> float:
    """Ułamek istotnych tokenów zapytania obecnych w nazwie z katalogu (0..1).

    Bonus: krótsze zapytanie w pełni zawarte w dłuższej ofercie
    („ser kozi” ⊂ „ser kozi rolka” → ~1.0).
    """
    rt = set(_tokens(req_name))
    ct = set(_tokens(cand_name))
    if not rt or not ct:
        # fallback: znormalizowane klucze (_norm_pl też stripuje opakowania)
        kn = _norm_pl(req_name)
        cn = _norm_pl(cand_name)
        if kn and cn and (kn == cn or kn in cn or cn in kn):
            return 0.92 if kn != cn else 1.0
        return 0.0
    inter = rt & ct
    if not inter:
        return 0.0
    cover = len(inter) / len(rt)
    # Wszystkie tokeny zapytania w ofercie + oferta nieco dłuższa → near-exact
    if cover >= 0.999 and len(ct) >= len(rt):
        return 1.0
    if cover >= 0.8 and len(inter) >= 2:
        return max(cover, 0.85)
    return cover


def _food_names_compatible(req_name: str, cand_name: str) -> bool:
    """Czy nazwy mogą być tym samym towarem (stem / kolejność słów / prefiks).

    Przykłady OK: batat↔bataty, filet z kurczaka↔kurczak filet, pomidor↔pomidory.
    Blokuje ser↔ser mozzarella oraz luźne literówki (grzanek ↛ granulat).
    """
    if _inventory_names_same_product(req_name or "", cand_name or ""):
        return True
    ka = _food_match_key(req_name or "")
    kb = _food_match_key(cand_name or "")
    if not ka or not kb:
        return False
    ta, tb = set(ka.split()), set(kb.split())
    # Prefiks jednego tokenu: batat↔bataty (bez rodzajowych „ser”/„mleko”)
    if len(ta) == 1 and len(tb) == 1:
        a, b = next(iter(ta)), next(iter(tb))
        if (
            len(a) >= 4 and len(b) >= 4
            and (a.startswith(b) or b.startswith(a))
            and a not in _GENERIC_FOOD_ONE_TOKEN
            and b not in _GENERIC_FOOD_ONE_TOKEN
        ):
            return True
    return False


def _local_catalog_match_score(req_name: str, cand_name: str) -> float:
    """Lokalne dopasowanie oferty katalogowej (0..1) — bez agresywnego partial_ratio.

    „ser kozi” ↔ „ser kozi rolka”: token coverage + token_set + ostrożne zawieranie.
    Krótkie / przypadkowe podobieństwa literowe NIE dostają wysokiego score.
    """
    a = _norm_pl(req_name or "")
    b = _norm_pl(cand_name or "")
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    token_cov = _match_score(req_name, cand_name)
    # Zawieranie tylko gdy wspólne tokeny (nie „grz” w środku losowego słowa)
    if len(a) >= 5 and len(b) >= 5 and (a in b or b in a) and token_cov >= 0.5:
        shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
        # Granica tokenowa: krótsza jako pełny zestaw tokenów w dłuższej
        st, lt = set(_tokens(shorter) or shorter.split()), set(_tokens(longer) or longer.split())
        if st and st.issubset(lt):
            ratio = len(shorter) / max(len(longer), 1)
            return max(0.9, min(0.99, 0.8 + 0.2 * ratio))
    try:
        # NIE używamy partial_ratio jako głównego sygnału — generował FP na krótkich nazwach.
        fuzz_sc = float(fuzz.token_set_ratio(a, b)) / 100.0
    except Exception:
        fuzz_sc = 0.0
    combined = max(token_cov, fuzz_sc * 0.92)
    if token_cov >= 0.8 and fuzz_sc >= 0.78:
        combined = max(combined, 0.9)
    food_ok = _food_names_compatible(req_name, cand_name)
    if food_ok and fuzz_sc >= 0.78:
        # batat↔bataty / pomidor↔pomidory — podnieś do auto-accept
        combined = max(combined, 0.9)
    if not food_ok:
        # Bez wspólnego rdzenia — mocno obetnij (AI może jeszcze potwierdzić)
        combined = min(combined, 0.45)
    return combined


def _strict_local_catalog_accept(primary_names: list[str], cand_name: str) -> bool:
    """Auto-accept bez AI tylko dla prawie pewnych trafień w katalogu dostawcy."""
    if not primary_names or not (cand_name or "").strip():
        return False
    score = max(
        (_local_catalog_match_score(n, cand_name) for n in primary_names if n),
        default=0.0,
    )
    if score < LOCAL_CATALOG_MATCH_MIN:
        return False
    # Musi być kompatybilne z PRIMARną nazwą zamówienia (nie tylko ze złym synonimem)
    primary = next((n for n in primary_names if n and str(n).strip()), "")
    if not primary:
        return False
    if not _food_names_compatible(primary, cand_name):
        return False
    # Wysoki token cover ALBO exact/near-exact ALBO odmiana PL (batat↔bataty)
    if _norm_pl(primary) == _norm_pl(cand_name):
        return True
    if _match_score(primary, cand_name) >= 0.8:
        return True
    if _food_match_key(primary) == _food_match_key(cand_name):
        return True
    return score >= 0.95


def _food_keys_same_product(ka: str, kb: str, name_a: str, name_b: str) -> bool:
    """Czy dwa food_key wskazują ten sam produkt (rukola ≈ sałata rukola).

    Krótkie 1-tokenowe stem'y (np. „ser”) NIE łączą różnych serów.
    """
    ka, kb = (ka or "").strip(), (kb or "").strip()
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    ta, tb = set(ka.split()), set(kb.split())
    if not ta or not tb:
        return False
    if ta <= tb or tb <= ta:
        smaller = ta if len(ta) <= len(tb) else tb
        if len(smaller) >= 2:
            return True
        only = next(iter(smaller))
        if len(only) >= 5 and float(fuzz.token_set_ratio(_norm_pl(name_a), _norm_pl(name_b))) >= 80:
            return True
    return float(fuzz.token_set_ratio(_norm_pl(name_a), _norm_pl(name_b))) >= 92


# CRUD głosowy: backend/voice_crud_routes.py (include_router)
# Supplier intents: backend/supplier_intent_routes.py (include_router)
# check-minimum-order: backend/supplier_min_order_routes.py (include_router)


# ─────────────────────────────────────────────────────────────────────────────
# Soft-delete helpers (shared) + Voice CRUD DISPATCH
# Voice CRUD v2 exec: backend/voice_crud_v2_routes.py
# ─────────────────────────────────────────────────────────────────────────────

def _is_missing_column_error(exc: httpx.HTTPStatusError) -> bool:
    body = (exc.response.text or "").lower()
    return "is_active" in body or "pgrst204" in body or (
        "column" in body and ("does not exist" in body or "not found" in body))


def _cat_matches(row_cat: str, wanted: str, threshold: int = 72) -> bool:
    """Czy kategoria wiersza pasuje (fuzzy) do żądanej. Pusty `wanted` = pasują wszystkie."""
    if not wanted:
        return True
    a, b = _norm_pl(row_cat or ""), _norm_pl(wanted)
    if not a:
        return False
    return a == b or b in a or a in b or fuzz.WRatio(a, b) >= threshold


def _norm_name_key(s: str) -> str:
    t = (s or "").lower().strip()
    for a, b in (("ą", "a"), ("ć", "c"), ("ę", "e"), ("ł", "l"), ("ń", "n"),
                 ("ó", "o"), ("ś", "s"), ("ź", "z"), ("ż", "z")):
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t)

__all__ = ['_cat_matches', '_food_keys_same_product', '_food_names_compatible', '_fuzzy_match', '_fuzzy_match_token_only', '_inventory_names_same_product', '_is_missing_column_error', '_is_porcja_row', '_local_catalog_match_score', '_match_score', '_norm', '_norm_name_key', '_norm_unit', '_resolve_by_fuzzy', '_slug', '_strict_local_catalog_accept', '_tokens']
