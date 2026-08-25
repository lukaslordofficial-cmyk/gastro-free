"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `pos_availability`."""
from __future__ import annotations

from culinary_units import yield_available as _yield_available
from pl_fuzzy_norm import norm_pl as _norm_pl
from supabase_rest import sb_get
from supabase_rest import sb_patch
from typing import Optional
import httpx
from app_core import logger
from matching_utils import _fuzzy_match



# =============================================================================
# VOICE CRUD — endpointy wykonawcze (edycja menu, receptur, magazynu, dostawców)
# =============================================================================

# ─────────────────────────────────────────────────────────────────────────────
# POS Bottleneck Engine — automatyczne blokowanie dań gdy braki w składnikach.
# ─────────────────────────────────────────────────────────────────────────────

_menu_is_available_col: Optional[bool] = None


async def _has_menu_is_available(client: httpx.AsyncClient) -> bool:
    """True jeśli menu_items ma kolumnę is_available (POS Bottleneck flag)."""
    global _menu_is_available_col
    if _menu_is_available_col is not None:
        return _menu_is_available_col
    try:
        await sb_get(client, "menu_items", params={"select": "is_available", "limit": "1"})
        _menu_is_available_col = True
    except Exception:
        _menu_is_available_col = False
        logger.warning("menu_items.is_available NIE istnieje — uruchom migrację "
                       "ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql, żeby włączyć POS Bottleneck Engine.")
    return _menu_is_available_col


async def _recompute_menu_availability(client: httpx.AsyncClient,
                                       changed_inventory_ids: Optional[set[str]] = None
                                       ) -> dict:
    """Przelicza is_available dla dań, których receptury używają zmienionych składników.

    Reguła: danie jest niedostępne, jeśli JAKIKOLWIEK jego składnik ma
    stan magazynowy (`quantity`) < wymagana ilość dla 1 porcji.
    Fuzzy-match po nazwie (recipe_ingredients.ingredient_name ↔ inventory_items.name).
    """
    has_col = await _has_menu_is_available(client)
    if not has_col:
        return {"skipped": True, "reason": "menu_items.is_available nie istnieje — uruchom migrację."}

    inv_all = await sb_get(client, "inventory_items",
                           params={"select": "id,name,quantity,unit", "limit": "5000"}) or []
    inv_by_id = {r["id"]: r for r in inv_all}
    inv_norm_to_id: dict[str, str] = {}
    for r in inv_all:
        k = _norm_pl(r.get("name") or "")
        if k:
            inv_norm_to_id.setdefault(k, r["id"])

    ri = await sb_get(client, "recipe_ingredients",
                      params={"select": "menu_item_id,ingredient_name,quantity,unit", "limit": "20000"}) or []
    by_menu: dict[str, list[dict]] = {}
    for r in ri:
        by_menu.setdefault(r["menu_item_id"], []).append(r)

    menu_rows = await sb_get(client, "menu_items",
                             params={"select": "id,name,is_available,is_active", "limit": "5000"}) or []

    updates: list[dict] = []
    changed = 0
    inv_keys = list(inv_norm_to_id.keys())

    for m in menu_rows:
        mid = m["id"]
        if not m.get("is_active", True):
            continue  # nieaktywne dania: pomijamy (POS ich nie widzi)
        ingredients = by_menu.get(mid, [])
        available = True
        blocker: Optional[str] = None
        for ing in ingredients:
            iname = ing.get("ingredient_name") or ""
            req_qty = float(ing.get("quantity") or 0)
            req_unit = ing.get("unit") or ""
            # Fuzzy match do inventory_items
            hit, score = _fuzzy_match(_norm_pl(iname), inv_keys, threshold=75)
            if not hit:
                # nie umiemy zweryfikować → uznajemy jako blocker (bezpieczna strona)
                available = False
                blocker = f"{iname} (brak w magazynie)"
                break
            inv_id = inv_norm_to_id[hit]
            inv = inv_by_id.get(inv_id, {})
            stock_qty = float(inv.get("quantity") or 0)
            stock_unit = inv.get("unit") or req_unit
            # Konwersja jednostek
            usable, ok = _yield_available(stock_qty, stock_unit, None, None, req_unit)
            if not ok or usable is None:
                usable = stock_qty  # fallback bez konwersji (np. jednostki zgodne)
            if usable < req_qty:
                available = False
                blocker = f"{inv.get('name') or iname}: {usable:.2f}{req_unit} < {req_qty}{req_unit}"
                break

        current = bool(m.get("is_available", True))
        if current != available:
            try:
                await sb_patch(client, "menu_items", {"id": f"eq.{mid}"},
                               {"is_available": available})
                changed += 1
                updates.append({
                    "menu_item_id": mid, "name": m.get("name"),
                    "is_available": available, "blocker": blocker,
                })
            except Exception as e:
                logger.warning(f"is_available update failed for {mid}: {e}")

    return {"scanned": len(menu_rows), "changed": changed, "updates": updates}


def _availability_changed_count(result) -> int:
    """Pełne _recompute_menu_availability zwraca dict; stare call-site'y oczekują int."""
    if isinstance(result, dict):
        if result.get("skipped"):
            return 0
        return int(result.get("changed") or 0)
    try:
        return int(result or 0)
    except (TypeError, ValueError):
        return 0

__all__ = ['_availability_changed_count', '_has_menu_is_available', '_menu_is_available_col', '_recompute_menu_availability']
