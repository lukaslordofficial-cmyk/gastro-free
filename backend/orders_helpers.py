"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `orders_helpers`."""
from __future__ import annotations

from pl_fuzzy_norm import norm_pl as _norm_pl
from rapidfuzz import fuzz
from typing import Optional
from constants import WAREHOUSE_CATEGORIES, _CATEGORY_STOPWORDS, _CATEGORY_SYNONYMS



def _category_syn_index() -> dict[str, str]:
    syn_index: dict[str, str] = {}
    for canon, syns in _CATEGORY_SYNONYMS.items():
        for x in syns:
            syn_index[_norm_pl(x)] = canon
        syn_index[_norm_pl(canon)] = canon
    return syn_index


def _resolve_warehouse_categories(raw: list[str]) -> tuple[list[str], list[str]]:
    """Zwraca (matched_canonical, unmatched_raw) — dopasowuje potoczne nazwy do
    sztywnych kategorii z `WAREHOUSE_CATEGORIES`.

    Tylko exact / token-exact / fuzzy do nazwy kategorii — BEZ substring
    („ser" ∈ „ser kozi" NIE może stać się Nabiałem).

    Gdy w jednym stringu jest kategoria + nazwy produktów
    („warzywa oraz ser kozi i borowiki"), kategoria trafia do matched,
    a reszta tokenów do unmatched (później → named products).
    """
    matched: list[str] = []
    unmatched: list[str] = []
    canonical_norm = {_norm_pl(c): c for c in WAREHOUSE_CATEGORIES}
    syn_index = _category_syn_index()

    def _cat_tokens_for(canon: str) -> set[str]:
        toks = {_norm_pl(canon)}
        for syn in _CATEGORY_SYNONYMS.get(canon, []):
            toks.add(_norm_pl(syn))
            for part in _norm_pl(syn).split():
                if part:
                    toks.add(part)
        for part in _norm_pl(canon).split():
            if part:
                toks.add(part)
        return toks

    for r in raw or []:
        s = (r or "").strip()
        if not s:
            continue
        if s.lower() == "all":
            return ["all"], []
        key = _norm_pl(s)
        # 1) exact canonical
        if key in canonical_norm:
            if canonical_norm[key] not in matched:
                matched.append(canonical_norm[key])
            continue
        # 2) exact synonym (cały string)
        if key in syn_index:
            canon = syn_index[key]
            if canon not in matched:
                matched.append(canon)
            continue
        # 3) token-exact: WSZYSTKIE kategorie w frazie
        #    „mieso i nabial" → Mięso + Nabiał (nie tylko pierwsza!)
        #    „warzywa oraz ser kozi" → Warzywa + unmatched „ser kozi"
        tokens = [
            t for t in key.replace(",", " ").replace("+", " ").split()
            if t and t not in _CATEGORY_STOPWORDS
        ]
        found_cats: list[str] = []
        for t in tokens:
            hit = syn_index.get(t) or canonical_norm.get(t)
            if hit and hit not in found_cats:
                found_cats.append(hit)
        if found_cats:
            for found in found_cats:
                if found not in matched:
                    matched.append(found)
            cat_toks: set[str] = set()
            for found in found_cats:
                cat_toks |= _cat_tokens_for(found)
            leftover = [t for t in tokens if t not in cat_toks]
            if leftover:
                unmatched.append(" ".join(leftover))
            continue
        # 4) rapidfuzz tylko do pełnych nazw kategorii (wysoki próg)
        best = None
        best_score = 0.0
        for canon_norm, canon in canonical_norm.items():
            score = float(fuzz.token_set_ratio(key, canon_norm))
            if score > best_score:
                best_score, best = score, canon
        if best and best_score >= 82:
            if best not in matched:
                matched.append(best)
        else:
            unmatched.append(s)
    return matched, unmatched


def _product_in_wanted_categories(
    effective_cat: str,
    category_id: Optional[str],
    wanted_set: set[str],
    wanted_ids: set[str],
) -> bool:
    """True gdy produkt należy do wybranej kategorii — bez fuzzy bleed.

    Matching: category_id ∈ wanted_ids LUB nazwa kategorii ∈ wanted_set
    (po resolve synonimów). Gdy użytkownik WYBRAŁ „Inne" — produkty z „Inne"
    wchodzą. Gdy nie wybrał — „Inne"/pusta nie bleedują do Mięso/Nabiał itd.
    """
    if not wanted_set and not wanted_ids:
        return False
    cid = str(category_id) if category_id else ""
    if wanted_ids and cid and cid in wanted_ids:
        return True
    ec = (effective_cat or "").strip() or "Inne"
    ec_norm = _norm_pl(ec)
    # Najpierw positive match (także gdy wybrano „Inne")
    if ec_norm in wanted_set:
        return True
    resolved, _ = _resolve_warehouse_categories([ec])
    for r in resolved:
        if r == "all":
            continue
        if _norm_pl(r) in wanted_set:
            return True
    # Bez wyboru „Inne": puste / Inne nie wchodzą do innych kategorii
    if ec_norm in {"inne", "pozostale", "pozostałe", ""}:
        return False
    return False


def _dedupe_critical_products(critical: list[dict]) -> list[dict]:
    """Jedna pozycja na inventory_id / znormalizowaną nazwę (max deficit)."""
    by_key: dict[str, dict] = {}
    order: list[str] = []
    for c in critical:
        iid = str(c.get("id") or "").strip()
        nk = _norm_pl(c.get("name") or "")
        key = f"id:{iid}" if iid else f"n:{nk}"
        if not nk and not iid:
            continue
        prev = by_key.get(key)
        if prev is None:
            by_key[key] = c
            order.append(key)
            continue
        if float(c.get("deficit") or 0) > float(prev.get("deficit") or 0):
            by_key[key] = {**c, "source": c.get("source") or prev.get("source")}
        else:
            # zachowaj silniejsze source (named > category)
            if c.get("source") in ("named", "named+category") and prev.get("source") == "category_shortage":
                by_key[key] = {**prev, "source": c.get("source")}
    return [by_key[k] for k in order]

__all__ = ['_category_syn_index', '_dedupe_critical_products', '_product_in_wanted_categories', '_resolve_warehouse_categories']
