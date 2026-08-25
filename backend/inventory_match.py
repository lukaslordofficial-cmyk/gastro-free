"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `inventory_match`."""
from __future__ import annotations

from inventory_invoice_match import find_inventory_duplicate as _find_inventory_duplicate_impl
from pl_fuzzy_norm import food_match_key as _food_match_key
from pl_fuzzy_norm import norm_pl as _norm_pl
from rapidfuzz import fuzz
from supabase_rest import sb_get
from supabase_rest import sb_post
from typing import Optional
from warehouse_category_guess import guess_category_free as _guess_category_free_impl
import httpx
from matching_utils import _norm, _resolve_by_fuzzy



async def _resolve_category_id_cached(client: httpx.AsyncClient, cat_name: str, cache: dict) -> Optional[str]:
    """Mapuje nazwę kategorii (tekst z AI) na inventory_categories.id. Tworzy kategorię jeśli brak.
    Wersja z cache (używana przy imporcie faktur — wiele produktów naraz)."""
    name = (cat_name or "Inne").strip() or "Inne"
    if not cache.get("_loaded"):
        rows = await sb_get(client, "inventory_categories", params={"select": "id,name,sort_order"})
        cache["_rows"] = list(rows or [])
        for r in (rows or []):
            cache[_norm(r["name"])] = r["id"]
            cache[_norm_pl(r["name"])] = r["id"]
        cache["_max_sort"] = max((int(r.get("sort_order") or 0) for r in (rows or [])), default=0)
        cache["_loaded"] = True
    # 1) exact
    for key in (_norm(name), _norm_pl(name)):
        if key and key in cache and isinstance(cache[key], str):
            return cache[key]
    # 2) fuzzy do istniejących kategorii użytkownika (bez tworzenia duplikatów „Warzywa”/„Warzywa i owoce”)
    user_rows = cache.get("_rows") or []
    if user_rows:
        hit, score = _resolve_by_fuzzy(name, user_rows, key="name", threshold=72)
        if hit and hit.get("id"):
            cache[_norm(name)] = hit["id"]
            return hit["id"]
    # 3) twórz tylko gdy naprawdę nowa
    cache["_max_sort"] = int(cache.get("_max_sort", 0)) + 1
    try:
        row = await sb_post(client, "inventory_categories", {
            "name": name, "color": "#64748B", "sort_order": cache["_max_sort"],
        })
        created = row[0] if isinstance(row, list) else row
        cache[_norm(name)] = created["id"]
        cache.setdefault("_rows", []).append(created)
        return created["id"]
    except httpx.HTTPStatusError:
        return None


def _guess_category_free(
    product_name: str,
    *,
    ai_category: Optional[str] = None,
    user_categories: Optional[list[dict]] = None,
    neighbor_category: Optional[str] = None,
) -> str:
    return _guess_category_free_impl(
        product_name,
        ai_category=ai_category,
        user_categories=user_categories,
        neighbor_category=neighbor_category,
        resolve_by_fuzzy=_resolve_by_fuzzy,
    )


def _find_inventory_duplicate(
    name: str,
    inv_rows: list[dict],
    *,
    threshold: int = 88,
    for_invoice: bool = False,
) -> Optional[dict]:
    """Szuka istniejącego produktu (pomidor ≈ Pomidory świeże).

    for_invoice=True: ostrzejsze reguły — „ser mozzarella” NIE scala się z „ser”.
    """
    return _find_inventory_duplicate_impl(
        name,
        inv_rows,
        threshold=threshold,
        for_invoice=for_invoice,
        food_match_key=_food_match_key,
        norm_fn=_norm,
        norm_pl_fn=_norm_pl,
        fuzz_token_sort_ratio=fuzz.token_sort_ratio,
        resolve_by_fuzzy=_resolve_by_fuzzy,
    )


async def _load_user_inventory_categories(client: httpx.AsyncClient) -> list[dict]:
    return await sb_get(client, "inventory_categories", params={
        "select": "id,name,sort_order",
        "order": "sort_order.asc",
        "limit": "200",
    }) or []

__all__ = ['_find_inventory_duplicate', '_guess_category_free', '_load_user_inventory_categories', '_resolve_category_id_cached']
