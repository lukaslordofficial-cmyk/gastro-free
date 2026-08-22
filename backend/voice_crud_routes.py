"""
Voice CRUD mutators — set-price / set-ingredient / set-thresholds + recompute.
Wydzielone z server.py; wszystkie endpointy wymagają require_tenant_account_key().
"""
from __future__ import annotations

from typing import Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get, sb_patch, sb_post

router = APIRouter(tags=["voice-crud"])


def _tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


def _fuzzy(query, rows, *, key: str = "name", threshold: int = 55):
    from server import _resolve_by_fuzzy

    return _resolve_by_fuzzy(query, rows, key=key, threshold=threshold)


async def _recompute(client: httpx.AsyncClient, **kwargs):
    from server import _recompute_menu_availability

    return await _recompute_menu_availability(client, **kwargs)


@router.post("/api/menu/recompute-availability")
async def menu_recompute_availability():
    """Ręczne przeliczenie POS Bottleneck Engine (blokowanie dań po brakach składników)."""
    _tenant()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        return await _recompute(client)


class SetMenuPriceRequest(BaseModel):
    dish_name: Optional[str] = None
    dish_id: Optional[str] = None
    new_price: float


@router.post("/api/menu/set-price")
async def set_menu_price(req: SetMenuPriceRequest):
    """Zmienia cenę dania. Wymagany dish_id LUB dish_name (fuzzy)."""
    _tenant()
    if req.new_price is None or req.new_price < 0:
        raise HTTPException(status_code=400, detail="Nieprawidłowa cena.")
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        dish_id = req.dish_id
        matched_name: Optional[str] = None
        matched_score = 0.0
        if not dish_id and req.dish_name:
            rows = await sb_get(
                client,
                "menu_items",
                params={"select": "id,name", "is_active": "eq.true", "limit": "1000"},
            ) or []
            hit, score = _fuzzy(req.dish_name, rows)
            if hit:
                dish_id = hit["id"]
                matched_name = hit["name"]
                matched_score = score
        if not dish_id:
            raise HTTPException(status_code=404, detail="Nie znaleziono dania (brak dish_id i fuzzy).")
        try:
            row = await sb_patch(
                client,
                "menu_items",
                {"id": f"eq.{dish_id}"},
                {"price_pln": float(req.new_price)},
            )
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Supabase: {e.response.text[:120]}") from e
        return {
            "ok": True,
            "dish_id": dish_id,
            "new_price": float(req.new_price),
            "matched_name": matched_name,
            "matched_score": round(matched_score, 1),
            "row": row[0] if isinstance(row, list) and row else row,
        }


class SetRecipeIngredientRequest(BaseModel):
    dish_name: Optional[str] = None
    dish_id: Optional[str] = None
    ingredient_name: str
    quantity: float
    unit: Optional[str] = None
    mode: Literal["upsert", "edit_qty"] = "upsert"


@router.post("/api/recipes/set-ingredient")
async def set_recipe_ingredient(req: SetRecipeIngredientRequest):
    """Dodaje lub aktualizuje składnik receptury dania."""
    _tenant()
    if req.quantity is None or req.quantity < 0:
        raise HTTPException(status_code=400, detail="Nieprawidłowa ilość.")
    if not (req.ingredient_name or "").strip():
        raise HTTPException(status_code=400, detail="Brak nazwy składnika.")
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        dish_id = req.dish_id
        matched_dish: Optional[str] = None
        if not dish_id and req.dish_name:
            rows = await sb_get(
                client,
                "menu_items",
                params={"select": "id,name", "is_active": "eq.true", "limit": "1000"},
            ) or []
            hit, _ = _fuzzy(req.dish_name, rows)
            if hit:
                dish_id = hit["id"]
                matched_dish = hit["name"]
        if not dish_id:
            raise HTTPException(status_code=404, detail="Nie znaleziono dania.")

        existing = await sb_get(
            client,
            "recipe_ingredients",
            params={
                "select": "id,ingredient_name,quantity,unit",
                "menu_item_id": f"eq.{dish_id}",
            },
        ) or []
        hit, _score = _fuzzy(req.ingredient_name, existing, key="ingredient_name", threshold=70)
        unit = (req.unit or (hit or {}).get("unit") or "g").strip()

        try:
            if hit:
                await sb_patch(
                    client,
                    "recipe_ingredients",
                    {"id": f"eq.{hit['id']}"},
                    {"quantity": float(req.quantity), "unit": unit},
                )
                action = "updated"
            else:
                if req.mode == "edit_qty":
                    raise HTTPException(
                        status_code=404,
                        detail=f"Składnik '{req.ingredient_name}' nie występuje w recepturze.",
                    )
                await sb_post(
                    client,
                    "recipe_ingredients",
                    {
                        "menu_item_id": dish_id,
                        "ingredient_name": req.ingredient_name.strip(),
                        "quantity": float(req.quantity),
                        "unit": unit,
                    },
                )
                action = "created"
        except HTTPException:
            raise
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Supabase: {e.response.text[:120]}") from e

        avail = await _recompute(client)
        return {
            "ok": True,
            "action": action,
            "dish_id": dish_id,
            "matched_dish": matched_dish,
            "matched_ingredient": (hit or {}).get("ingredient_name"),
            "quantity": float(req.quantity),
            "unit": unit,
            "menu_availability": avail,
        }


class SetInventoryThresholdsRequest(BaseModel):
    item_name: Optional[str] = None
    inventory_id: Optional[str] = None
    min_quantity: Optional[float] = None
    current_quantity: Optional[float] = None
    safety_buffer_percent: Optional[float] = None


@router.post("/api/inventory/set-thresholds")
async def set_inventory_thresholds(req: SetInventoryThresholdsRequest):
    """Zmienia parametry produktu w magazynie (min / qty / safety buffer)."""
    _tenant()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        inv_id = req.inventory_id
        matched: Optional[str] = None
        if not inv_id and req.item_name:
            rows = await sb_get(
                client, "inventory_items", params={"select": "id,name", "limit": "5000"},
            ) or []
            hit, _ = _fuzzy(req.item_name, rows)
            if hit:
                inv_id = hit["id"]
                matched = hit["name"]
        if not inv_id:
            raise HTTPException(status_code=404, detail="Nie znaleziono produktu w magazynie.")

        updates: dict = {}
        if req.min_quantity is not None:
            updates["min_quantity"] = float(req.min_quantity)
        if req.current_quantity is not None:
            updates["quantity"] = float(req.current_quantity)
        if req.safety_buffer_percent is not None:
            updates["safety_buffer_percent"] = float(req.safety_buffer_percent)
        if not updates:
            raise HTTPException(status_code=400, detail="Brak parametrów do aktualizacji.")

        try:
            row = await sb_patch(client, "inventory_items", {"id": f"eq.{inv_id}"}, updates)
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Supabase: {e.response.text[:120]}") from e

        avail = None
        if "quantity" in updates:
            avail = await _recompute(client, changed_inventory_ids={inv_id})

        return {
            "ok": True,
            "inventory_id": inv_id,
            "matched_name": matched,
            "updates": updates,
            "row": row[0] if isinstance(row, list) and row else row,
            "menu_availability": avail,
        }
