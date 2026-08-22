"""
GET katalogu dostawcy + refresh is_visible — wydzielone z server.py.
Wymaga require_tenant_account_key().
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException

from http_ssl import httpx_verify
from supabase_rest import sb_get

router = APIRouter(tags=["supplier-catalog"])
logger = logging.getLogger("server")


@router.get("/api/suppliers/{supplier_id}/catalog")
async def get_supplier_catalog(supplier_id: str):
    """Pełny katalog dostawcy dla Łowcy (W menu + poza menu)."""
    from server import _norm_pl, require_tenant_account_key

    require_tenant_account_key()
    sid = (supplier_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="Brak supplier_id.")
    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as client:
        sup_rows = await sb_get(
            client,
            "suppliers",
            params={"select": "id,name,email,min_order_value", "id": f"eq.{sid}", "limit": "1"},
        ) or []
        if not sup_rows:
            raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")
        sup = sup_rows[0]
        try:
            rows = await sb_get(
                client,
                "supplier_catalog",
                params={
                    "select": "id,name,variant,unit,price_pln,is_visible,volume_label,sort_order",
                    "supplier_id": f"eq.{sid}",
                    "order": "name.asc",
                    "limit": "2000",
                },
            ) or []
        except httpx.HTTPStatusError:
            rows = await sb_get(
                client,
                "supplier_catalog",
                params={
                    "select": "id,name,variant,unit,price_pln,volume_label,sort_order",
                    "supplier_id": f"eq.{sid}",
                    "order": "name.asc",
                    "limit": "2000",
                },
            ) or []

        menu_ings: list[str] = []
        try:
            menu_items = await sb_get(
                client,
                "menu_items",
                params={"select": "id", "is_active": "eq.true", "limit": "500"},
            ) or []
            menu_ids = [m["id"] for m in menu_items if m.get("id")]
            if menu_ids:
                chunk = menu_ids[:80]
                ing_rows = await sb_get(
                    client,
                    "recipe_ingredients",
                    params={
                        "select": "ingredient_name",
                        "menu_item_id": f"in.({','.join(chunk)})",
                        "limit": "3000",
                    },
                ) or []
                menu_ings = [
                    str(r.get("ingredient_name") or "").strip()
                    for r in ing_rows
                    if str(r.get("ingredient_name") or "").strip()
                ]
        except Exception as e:  # noqa: BLE001
            logger.warning("get_supplier_catalog menu ingredients: %s", e)

        products = []
        for r in rows:
            name = (r.get("name") or "").strip()
            if not name:
                continue
            try:
                price = float(r.get("price_pln") or 0)
            except (TypeError, ValueError):
                price = 0.0
            visible = r.get("is_visible")
            in_menu = visible is not False
            if visible is False and menu_ings:
                try:
                    from rapidfuzz import fuzz as _rf

                    nn = _norm_pl(name)
                    in_menu = any(
                        _rf.token_set_ratio(nn, _norm_pl(ing)) >= 72 for ing in menu_ings
                    )
                except Exception:
                    in_menu = False
            elif visible is None:
                in_menu = True
            products.append({
                "id": r.get("id"),
                "name": name,
                "variant": r.get("variant"),
                "unit": r.get("unit") or "szt",
                "price_pln": price,
                "volume_label": r.get("volume_label"),
                "is_visible": visible if visible is not None else True,
                "in_menu": bool(in_menu),
            })
        products.sort(key=lambda p: (0 if p["in_menu"] else 1, _norm_pl(p["name"])))
        return {
            "ok": True,
            "supplier_id": sid,
            "supplier_name": (sup.get("name") or "").strip() or "Dostawca",
            "supplier_email": (sup.get("email") or "").strip() or None,
            "min_order_value": float(sup.get("min_order_value") or 0),
            "products": products,
            "count": len(products),
            "in_menu_count": sum(1 for p in products if p["in_menu"]),
            "extra_count": sum(1 for p in products if not p["in_menu"]),
        }


@router.post("/api/suppliers/{supplier_id}/refresh-catalog-visibility")
async def refresh_catalog_visibility(supplier_id: str):
    """Ponownie przelicza is_visible wg MENU/receptur (bez magazynu)."""
    from server import _process_offer, require_tenant_account_key

    require_tenant_account_key()
    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as client:
        rows = await sb_get(
            client,
            "supplier_catalog",
            params={
                "select": "id,name,price_pln,unit,volume_label,variant",
                "supplier_id": f"eq.{supplier_id}",
            },
        )
        if not rows:
            return {"ok": True, "updated": 0, "message": "Pusty katalog."}
        products = [
            {
                "product_name": r["name"],
                "price_netto": float(r.get("price_pln") or 0),
                "unit": r.get("unit") or "szt",
                "volume_label": r.get("volume_label") or "",
            }
            for r in rows
        ]
        result = await _process_offer(client, supplier_id, {"products": products})
        return {"ok": True, "updated": len(rows), **result}
