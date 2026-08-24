"""
Fuzzy resolve nazw głosowych → rekordy magazynu/menu/dostawców.

Wydzielone z server.py. Przy `strict_food=True` wymaga kompatybilności
kulinarnej (bataty≠bakłażan) i nie używa agresywnego partial_ratio
dla krótkich zapytań.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from rapidfuzz import fuzz

VOICE_FUZZY_THRESHOLD = 65


def resolve_by_fuzzy(
    query: Optional[str],
    rows: list[dict],
    key: str = "name",
    threshold: int = VOICE_FUZZY_THRESHOLD,
    *,
    norm_pl: Callable[[str], str],
    food_names_compatible: Optional[Callable[[str, str], bool]] = None,
    strict_food: bool = False,
) -> tuple[Optional[dict], float]:
    """Dopasowuje `query` do rekordów `rows` po polu `key`.

    Zwraca (rekord, score) lub (None, best_score).
    """
    if not query or not rows:
        return None, 0.0
    q = norm_pl(query)
    if not q:
        return None, 0.0
    best_row: Optional[dict] = None
    best_score = 0.0
    for row in rows:
        cand_raw = row.get(key, "") or ""
        cand = norm_pl(cand_raw)
        if not cand:
            continue
        food_ok = True
        if food_names_compatible is not None:
            food_ok = bool(food_names_compatible(query, cand_raw))
        if strict_food and not food_ok:
            continue
        s1 = float(fuzz.token_set_ratio(q, cand))
        # partial_ratio pomaga przy uciętych nazwach Whisper („pana kota”),
        # ale na krótkich PL (bataty/bakłażan) generuje FP — wyłączamy przy strict
        # oraz gdy zapytanie jest krótkie.
        use_partial = (not strict_food) and len(q) >= 7
        if not food_ok:
            # Bez wspólnego rdzenia: tylko near-exact token_set (bez partial)
            if s1 < 88:
                continue
            s = s1
        else:
            s2 = float(fuzz.partial_ratio(q, cand)) if use_partial else 0.0
            s = max(s1, s2)
        if s > best_score:
            best_score = s
            best_row = row
    if best_score >= threshold:
        return best_row, best_score
    return None, best_score


def verify_related_name(
    item_name: str,
    related_row: Optional[dict[str, Any]],
    *,
    food_names_compatible: Callable[[str, str], bool],
    name_key: str = "name",
) -> bool:
    """Czy related_id wskazuje na towar zgodny z podaną nazwą."""
    if not related_row:
        return False
    if not (item_name or "").strip():
        return True
    return bool(food_names_compatible(item_name, str(related_row.get(name_key) or "")))
