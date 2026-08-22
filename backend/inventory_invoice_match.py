"""Dopasowanie pozycji faktury do magazynu — bez połykania wariantów (ser ≠ mozzarella)."""
from __future__ import annotations

import re
from typing import Any, Optional

# Rodzajowe słowa — same nie mogą „zjeść” wariantu (ser ↛ ser mozzarella).
GENERIC_FOOD_ONE_TOKEN = frozenset({
    "ser", "mleko", "mieso", "ryba", "ryby", "woda", "chleb", "makaron", "ryz",
    "olej", "cukier", "sol", "maka", "jajko", "jaja", "maslo", "smietana",
    "jogurt", "sos", "bulion", "wywar", "napoj", "piwo", "wino", "kawa", "herbata",
    "warzyw", "owoc", "przypraw", "cukierki", "czekolada",
})

# Deskryptory, które rozróżniają towary (różne = osobne pozycje magazynu).
DISTINCTIVE_FOOD_TOKENS = frozenset({
    "mozzarella", "mozzarell", "mozarella", "feta", "parmezan", "parmesan",
    "gouda", "cheddar", "brie", "camembert", "ricotta", "mascarpone",
    "halloumi", "halloum", "kozi", "kozia", "owczy", "owca", "bursztyn",
    "tylzyck", "edam", "emmental", "gruyere", "pecorino", "gorgonzola",
    "plesniow", "wędzon", "wedzon", "kokos", "kokosow", "migdal", "migdalow",
    "sojow", "ryzow", "owsian", "wolow", "wieprz", "kurczak", "indyk",
    "jagnie", "cielęc", "cielec", "łosoś", "losos", "tuńczyk", "tunczyk",
    "buffalo", "fior", "latte", "burrata", "scamorza",
})


def normalize_invoice_line_name(name: str) -> str:
    """Rozwiń skróty z faktur (Mozz. → mozzarella), żeby OCR nie skracał do „Ser”."""
    s = (name or "").strip()
    if not s:
        return s
    s = re.sub(r"(?i)\bmozz\.?\b", "mozzarella", s)
    s = re.sub(r"(?i)\bmoz+arel+a\b", "mozzarella", s)
    s = re.sub(r"(?i)\bparm\.?\b", "parmezan", s)
    return " ".join(s.split())


def _distinctive(tokens: set[str]) -> set[str]:
    out: set[str] = set()
    for t in tokens:
        if t in DISTINCTIVE_FOOD_TOKENS:
            out.add(t)
            continue
        for d in DISTINCTIVE_FOOD_TOKENS:
            if len(d) >= 4 and (t.startswith(d) or d.startswith(t)):
                out.add(d)
                break
    return out


def inventory_names_same_product(
    invoice_name: str,
    stock_name: str,
    *,
    food_match_key,
    norm_fn,
) -> bool:
    """Czy pozycja z faktury to TEN SAM towar co w magazynie."""
    a = (invoice_name or "").strip()
    b = (stock_name or "").strip()
    if not a or not b:
        return False
    if norm_fn(a) == norm_fn(b):
        return True
    ka, kb = food_match_key(a), food_match_key(b)
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    ta, tb = set(ka.split()), set(kb.split())
    if not ta or not tb:
        return False

    dist_a, dist_b = _distinctive(ta), _distinctive(tb)
    if dist_a != dist_b and (dist_a or dist_b):
        # Wspólny wariant OK (mozzarella ∩ mozzarella); różne odmiany / tylko jedna strona → NIE
        if not (dist_a & dist_b):
            return False
        # Obie mają distinctive, część wspólna, ale też ekstra po obu? np. kozi vs mozzarella — już False wyżej
        if (dist_a - dist_b) and (dist_b - dist_a):
            return False

    if ta.issubset(tb) or tb.issubset(ta):
        shorter, longer = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
        if shorter == longer:
            return True
        if len(shorter) == 1 and next(iter(shorter)) in GENERIC_FOOD_ONE_TOKEN:
            return False
        extra = longer - shorter
        if extra and all(re.match(r"^\d+[.]?\d*$", t) for t in extra):
            return True
        if extra and all(t in GENERIC_FOOD_ONE_TOKEN for t in extra):
            return True
        if extra:
            return False
        return True

    shared = ta & tb
    if not shared:
        return False
    if not any(len(t) >= 4 for t in shared):
        return False
    only_a = ta - tb
    only_b = tb - ta
    meaningful_a = {t for t in only_a if len(t) >= 4 or t in GENERIC_FOOD_ONE_TOKEN}
    meaningful_b = {t for t in only_b if len(t) >= 4 or t in GENERIC_FOOD_ONE_TOKEN}
    if meaningful_a and meaningful_b:
        return False
    if (meaningful_a or meaningful_b) and (
        len(shared) == 1 and next(iter(shared)) in GENERIC_FOOD_ONE_TOKEN
    ):
        return False
    return True


def find_inventory_duplicate(
    name: str,
    inv_rows: list[dict[str, Any]],
    *,
    threshold: int = 88,
    for_invoice: bool = False,
    food_match_key,
    norm_fn,
    norm_pl_fn,
    fuzz_token_sort_ratio,
    resolve_by_fuzzy=None,
) -> Optional[dict[str, Any]]:
    """Szuka istniejącego produktu; for_invoice=True blokuje ser↔mozzarella."""
    if not name or not inv_rows:
        return None

    def same(a: str, b: str) -> bool:
        return inventory_names_same_product(
            a, b, food_match_key=food_match_key, norm_fn=norm_fn,
        )

    n = norm_fn(name)
    npl = norm_pl_fn(name)
    for r in inv_rows:
        rn = r.get("name") or ""
        if norm_fn(rn) == n or (norm_pl_fn(rn) and norm_pl_fn(rn) == npl):
            if for_invoice and not same(name, str(rn)):
                continue
            return r

    fk = food_match_key(name)
    if fk:
        stem_hits = [r for r in inv_rows if food_match_key(r.get("name") or "") == fk]
        if for_invoice:
            stem_hits = [r for r in stem_hits if same(name, str(r.get("name") or ""))]
        if len(stem_hits) == 1:
            return stem_hits[0]
        if len(stem_hits) > 1:
            return min(stem_hits, key=lambda r: len(r.get("name") or ""))

    compat_hits = [
        r for r in inv_rows
        if same(name, str(r.get("name") or ""))
    ]
    if len(compat_hits) == 1:
        return compat_hits[0]
    if len(compat_hits) > 1:
        return min(compat_hits, key=lambda r: len(r.get("name") or ""))

    thr = max(threshold, 88) if for_invoice else threshold
    best_row: Optional[dict] = None
    best_score = 0.0
    q = norm_pl_fn(name)
    for r in inv_rows:
        cand_name = str(r.get("name") or "")
        cand = norm_pl_fn(cand_name)
        if not cand:
            continue
        if for_invoice and not same(name, cand_name):
            if food_match_key(name) != food_match_key(cand_name):
                continue
        s = float(fuzz_token_sort_ratio(q, cand))
        if s > best_score:
            best_score = s
            best_row = r
    if best_row and best_score >= thr:
        if for_invoice and not same(name, str(best_row.get("name") or "")):
            return None
        return best_row

    if not for_invoice and resolve_by_fuzzy and len(norm_pl_fn(name).split()) <= 2:
        hit2, score2 = resolve_by_fuzzy(name, inv_rows, key="name", threshold=74)
        if hit2 and score2 >= 74 and same(name, str(hit2.get("name") or "")):
            return hit2
    return None
