"""
GET /api/inventory/{item_id}/portions-yield — wydzielone z server.py.
Wymaga tenanta; nie zwraca pozycji magazynu z innego account_key.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException

from http_ssl import httpx_verify
from supabase_rest import sb_get

router = APIRouter(tags=["inventory-yield"])


@router.get("/api/inventory/{item_id}/portions-yield")
async def portions_yield(item_id: str):
    """Na ile porcji każdej potrawy wystarczy zapas danego surowca."""
    from server import (
        _fuzzy_match_token_only,
        _is_piece_unit,
        _norm,
        _norm_pl,
        _yield_available,
        require_tenant_account_key,
    )

    ak = require_tenant_account_key()
    iid = (item_id or "").strip()
    if not iid:
        raise HTTPException(status_code=400, detail="Brak item_id.")

    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        try:
            rows = await sb_get(
                client,
                "inventory_items",
                params={
                    "select": "id,name,quantity,unit,unit_weight_volume,weight_volume_unit",
                    "id": f"eq.{iid}",
                    "account_key": f"eq.{ak}",
                    "limit": "1",
                },
            )
        except httpx.HTTPStatusError as e:
            txt = e.response.text or ""
            if "unit_weight_volume" in txt or "weight_volume_unit" in txt:
                rows = await sb_get(
                    client,
                    "inventory_items",
                    params={
                        "select": "id,name,quantity,unit",
                        "id": f"eq.{iid}",
                        "account_key": f"eq.{ak}",
                        "limit": "1",
                    },
                )
            elif "account_key" in txt:
                rows = await sb_get(
                    client,
                    "inventory_items",
                    params={
                        "select": "id,name,quantity,unit,unit_weight_volume,weight_volume_unit",
                        "id": f"eq.{iid}",
                        "limit": "1",
                    },
                )
            else:
                raise
        if not rows:
            raise HTTPException(status_code=404, detail="Nie znaleziono produktu.")
        item = rows[0]
        item_name = item["name"]
        stock_qty = float(item["quantity"] or 0)
        stock_unit = item["unit"] or ""
        uwv = item.get("unit_weight_volume")
        wvu = item.get("weight_volume_unit")

        try:
            recipes = await sb_get(
                client,
                "recipe_ingredients",
                params={"select": "menu_item_id,ingredient_name,quantity,unit,piece_weight_g"},
            )
        except httpx.HTTPStatusError as e:
            if "piece_weight_g" in (e.response.text or ""):
                recipes = await sb_get(
                    client,
                    "recipe_ingredients",
                    params={"select": "menu_item_id,ingredient_name,quantity,unit"},
                )
            else:
                raise

        key = _norm(item_name)
        key_pl = _norm_pl(item_name)
        matched = []
        for r in recipes or []:
            ing = r.get("ingredient_name") or ""
            if (
                _norm(ing) == key
                or key in _norm(ing)
                or _norm(ing) in key
                or _norm_pl(ing) == key_pl
            ):
                matched.append(r)
                continue
            hit, _score = _fuzzy_match_token_only(key_pl, [_norm_pl(ing)], threshold=74)
            if hit is not None:
                matched.append(r)

        menu_ids = list({r["menu_item_id"] for r in matched})
        menu_map: dict = {}
        if menu_ids:
            id_filter = "in.(" + ",".join(menu_ids) + ")"
            try:
                menu_rows = await sb_get(
                    client,
                    "menu_items",
                    params={
                        "select": "id,name,is_active",
                        "id": id_filter,
                        "account_key": f"eq.{ak}",
                    },
                )
            except httpx.HTTPStatusError as e:
                if "account_key" in (e.response.text or ""):
                    menu_rows = await sb_get(
                        client,
                        "menu_items",
                        params={"select": "id,name,is_active", "id": id_filter},
                    )
                else:
                    raise
            menu_map = {m["id"]: m for m in (menu_rows or [])}

    dishes = []
    for r in matched:
        per_portion = float(r["quantity"] or 0)
        recipe_unit = r["unit"] or stock_unit
        if per_portion <= 0:
            continue
        piece_wt = r.get("piece_weight_g")
        use_uwv = uwv
        use_wvu = wvu
        try:
            if piece_wt is not None and float(piece_wt) > 0 and _is_piece_unit(recipe_unit):
                use_uwv = float(piece_wt)
                use_wvu = "g"
        except (TypeError, ValueError):
            pass
        available, convertible = _yield_available(
            stock_qty, stock_unit, use_uwv, use_wvu, recipe_unit,
        )
        portions = int(available // per_portion) if available is not None else 0
        menu = menu_map.get(r["menu_item_id"])
        dishes.append({
            "menu_item_id": r["menu_item_id"],
            "dish_name": (menu or {}).get("name") or "Danie",
            "is_active": (menu or {}).get("is_active", True),
            "per_portion_qty": per_portion,
            "unit": recipe_unit,
            "portions": max(0, portions),
            "convertible": convertible,
        })

    dishes.sort(key=lambda d: d["portions"])
    return {
        "item_id": iid,
        "item_name": item_name,
        "stock_quantity": stock_qty,
        "stock_unit": stock_unit,
        "dishes": dishes,
    }
