"""Konsumpcja magazynu dla POS webhook (receptury / menu mapowanie)."""
from __future__ import annotations

from typing import Optional

import httpx

from supabase_rest import sb_get, sb_patch


async def consume_inventory_row(
    client: httpx.AsyncClient,
    *,
    inv_id: str,
    consume: float,
    fallback_unit: str,
    dish_label: str,
    warnings: list[str],
) -> Optional[dict]:
    inv_rows = await sb_get(client, "inventory_items", params={
        "select": "id,name,quantity,unit,min_quantity",
        "id": f"eq.{inv_id}",
        "limit": "1",
    })
    if not inv_rows:
        warnings.append(f"'{dish_label}': brak inventory_items id={inv_id}.")
        return None
    inv = inv_rows[0]
    before = float(inv["quantity"])
    after = round(before - consume, 4)
    try:
        await sb_patch(client, "inventory_items", {"id": f"eq.{inv['id']}"}, {"quantity": after})
    except httpx.HTTPStatusError as e:
        warnings.append(f"'{inv['name']}': nie zaktualizowano stanu ({e.response.text[:100]}).")
        return None
    min_qty = float(inv.get("min_quantity") or 0)
    status = "ok"
    if after <= 0:
        status = "out_of_stock"
    elif min_qty > 0 and after <= min_qty:
        status = "below_minimum"
    return {
        "inventory_id": inv["id"],
        "name": inv["name"],
        "unit": inv.get("unit") or fallback_unit,
        "consumed": consume,
        "quantity_before": before,
        "quantity_after": after,
        "min_quantity": min_qty,
        "status": status,
    }


async def consume_pos_recipes(
    client: httpx.AsyncClient,
    product: dict,
    qty: float,
    inventory_updates: list[dict],
    warnings: list[str],
) -> list[dict]:
    recipes = await sb_get(client, "recipes", params={
        "select": "id,warehouse_product_id,quantity_per_portion,unit",
        "pos_product_id": f"eq.{product['id']}",
    })
    item_consumed: list[dict] = []
    if not recipes:
        warnings.append(
            f"'{product['name']}': brak receptury (recipes) — magazyn nie zaktualizowany."
        )
        return item_consumed
    for r in recipes:
        upd = await consume_inventory_row(
            client,
            inv_id=r["warehouse_product_id"],
            consume=float(r["quantity_per_portion"]) * qty,
            fallback_unit=r.get("unit") or "kg",
            dish_label=product["name"],
            warnings=warnings,
        )
        if upd:
            inventory_updates.append(upd)
            item_consumed.append(upd)
    return item_consumed


async def process_via_menu_item(
    client: httpx.AsyncClient,
    *,
    pos_external_id: Optional[str],
    dish_name: Optional[str],
    quantity_sold: float,
    unit_price_pln: Optional[float],
    processed: list[dict],
    inventory_updates: list[dict],
    warnings: list[str],
) -> tuple[float, bool]:
    """Zwraca (line_total, matched). matched=False → wołający robi UPSERT unmapped."""
    key = pos_external_id or dish_name or "?"
    menu_row = None
    if pos_external_id:
        mrows = await sb_get(client, "menu_items", params={
            "select": "id,name,pos_id,price_pln",
            "pos_id": f"eq.{pos_external_id}",
            "is_active": "eq.true",
            "limit": "1",
        })
        if mrows:
            menu_row = mrows[0]
    if menu_row is None and dish_name:
        mrows = await sb_get(client, "menu_items", params={
            "select": "id,name,pos_id,price_pln",
            "name": f"ilike.{dish_name}",
            "is_active": "eq.true",
            "limit": "1",
        })
        if mrows:
            menu_row = mrows[0]

    if menu_row is None:
        warnings.append(f"Pominięto '{key}' — brak dopasowania w pos_products ani menu_items.")
        return 0.0, False

    qty = float(quantity_sold)
    unit_price = (
        float(unit_price_pln)
        if unit_price_pln is not None
        else float(menu_row.get("price_pln") or 0)
    )
    line_total = round(unit_price * qty, 2)
    ings = await sb_get(client, "recipe_ingredients", params={
        "select": "id,ingredient_name,quantity,unit,warehouse_product_id",
        "menu_item_id": f"eq.{menu_row['id']}",
    }) or []
    item_consumed: list[dict] = []
    mapped = [r for r in ings if r.get("warehouse_product_id")]
    if not mapped:
        warnings.append(
            f"'{menu_row['name']}': brak zmapowanych składników (warehouse_product_id) "
            "— magazyn nie zaktualizowany."
        )
    else:
        for r in mapped:
            upd = await consume_inventory_row(
                client,
                inv_id=r["warehouse_product_id"],
                consume=float(r.get("quantity") or 0) * qty,
                fallback_unit=r.get("unit") or "kg",
                dish_label=menu_row["name"],
                warnings=warnings,
            )
            if upd:
                inventory_updates.append(upd)
                item_consumed.append(upd)

    processed.append({
        "pos_external_id": menu_row.get("pos_id") or pos_external_id,
        "name": menu_row["name"],
        "quantity": qty,
        "unit_price_pln": unit_price,
        "line_total_pln": line_total,
        "inventory_consumed": item_consumed,
    })
    return line_total, True
