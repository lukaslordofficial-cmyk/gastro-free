"""
POST /api/suppliers/check-minimum-order — wydzielone z server.py.
Wymaga require_tenant_account_key() + deal hunter.
"""
from __future__ import annotations

from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get

router = APIRouter(tags=["supplier-intents"])


class CheckMinOrderRequest(BaseModel):
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    current_cart_total: float = 0.0
    category: Optional[str] = None


@router.post("/api/suppliers/check-minimum-order")
async def supplier_check_min_order(req: CheckMinOrderRequest):
    """Sprawdza minimum dostawy i sugeruje produkty do dorzucenia."""
    from server import (
        _check_ai_access,
        _resolve_by_fuzzy,
        require_tenant_account_key,
    )

    require_tenant_account_key()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        await _check_ai_access(client, needs_credits=False, needs_deal_hunter=True)
        has_min_col = True
        select_cols = "id,name,min_order_value"
        try:
            await sb_get(client, "suppliers", params={"select": "min_order_value", "limit": "1"})
        except Exception:
            has_min_col = False
            select_cols = "id,name"

        supplier = None
        if req.supplier_id:
            rows = await sb_get(
                client,
                "suppliers",
                params={"select": select_cols, "id": f"eq.{req.supplier_id}", "limit": "1"},
            ) or []
            if rows:
                supplier = rows[0]
        if not supplier and req.supplier_name:
            all_sup = await sb_get(
                client, "suppliers", params={"select": select_cols, "limit": "500"},
            ) or []
            hit, _ = _resolve_by_fuzzy(req.supplier_name, all_sup)
            supplier = hit
        if not supplier:
            raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")

        min_val = float(supplier.get("min_order_value") or 0) if has_min_col else 0.0
        gap = round(max(0.0, min_val - float(req.current_cart_total or 0)), 2)

        suggestions = []
        if gap > 0:
            catalog = await sb_get(
                client,
                "supplier_catalog",
                params={
                    "select": "id,name,price_pln,variant,unit,volume_label,is_visible",
                    "supplier_id": f"eq.{supplier['id']}",
                },
            ) or []
            keywords = [
                "ryż", "mąka", "sól", "cukier", "olej", "woda", "napój", "sok",
                "makaron", "ocet", "cola", "sprite", "pepsi",
            ]

            def score(name: str) -> int:
                nl = (name or "").lower()
                return sum(1 for k in keywords if k in nl)

            candidates = sorted(
                [
                    c
                    for c in catalog
                    if c.get("is_visible") is not False and float(c.get("price_pln") or 0) > 0
                ],
                key=lambda c: (-score(c["name"]), float(c["price_pln"] or 0)),
            )
            running = 0.0
            for c in candidates:
                price = float(c.get("price_pln") or 0)
                if running >= gap:
                    break
                suggestions.append({
                    "id": c["id"],
                    "name": c["name"],
                    "price_pln": price,
                    "unit": c.get("unit"),
                    "variant": c.get("variant"),
                })
                running += price

        warnings: list[str] = []
        if not has_min_col:
            warnings.append(
                "Kolumna suppliers.min_order_value nie istnieje — "
                "uruchom migrację ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql. "
                "Zwracam min_order_value=0."
            )

        return {
            "supplier": {
                "id": supplier["id"],
                "name": supplier["name"],
                "min_order_value": min_val,
            },
            "current_cart_total": float(req.current_cart_total or 0),
            "gap_to_min": gap,
            "meets_minimum": gap == 0,
            "suggestions": suggestions,
            "warnings": warnings,
        }
