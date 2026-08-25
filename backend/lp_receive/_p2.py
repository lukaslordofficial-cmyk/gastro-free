from __future__ import annotations

from datetime import datetime
from datetime import timezone
from inventory_name_match import find_inventory_match
from typing import Any
import httpx
from ._p0 import _INV_OPTIONAL_KEYS, _find_existing_lp_cost, _http_body, _post_dropping_optional, _resolve_category_id, _row_id, logger
from ._p1 import _cost_note



async def apply_lp_inventory_and_cost(
    *,
    client,
    sb_get,
    sb_post,
    sb_patch,
    invoice_products: list[dict[str, Any]],
    company: str,
    total: float,
    order_id: str,
    source: str,
    producer_amount: float,
    materials_total: float,
    delivery_cost: float,
    platform_fee: float,
    add_qty_to_existing: bool,
) -> dict[str, Any]:
    """Zapisuje pozycje do inventory_items i koszt zmienny. Nie oznacza zamówienia."""
    warnings: list[str] = []
    created: list[dict[str, Any]] = []
    updated: list[dict[str, Any]] = []
    restored: list[str] = []

    try:
        inv_rows = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,unit,unit_cost,category_id,is_active",
            "limit": "5000",
        }) or []
    except httpx.HTTPStatusError as e:
        if "is_active" in _http_body(e):
            inv_rows = await sb_get(client, "inventory_items", params={
                "select": "id,name,quantity,unit,unit_cost,category_id",
                "limit": "5000",
            }) or []
        else:
            return {"ok": False, "error": f"Nie udało się odczytać magazynu: {_http_body(e)[:180]}", "warnings": warnings}

    cat_cache: dict[str, Any] = {}

    for p in invoice_products:
        name = str(p.get("product_name") or "").strip()
        if not name:
            continue
        try:
            qty = float(p.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        if qty <= 0:
            continue
        unit = str(p.get("unit") or "szt").strip() or "szt"
        try:
            price = float(p.get("price_netto") or 0)
        except (TypeError, ValueError):
            price = 0.0
        category = str(p.get("category") or "Inne").strip() or "Inne"
        cat_id = await _resolve_category_id(client, sb_get, sb_post, category, cat_cache)
        match = find_inventory_match(name, inv_rows, for_invoice=True)

        if match and match.get("id"):
            item_id = str(match["id"])
            inactive = match.get("is_active") is False
            if not add_qty_to_existing and not inactive:
                continue
            try:
                old_qty = float(match.get("quantity") or 0)
            except (TypeError, ValueError):
                old_qty = 0.0
            patch: dict[str, Any] = {"is_active": True}
            if add_qty_to_existing:
                patch["quantity"] = old_qty + qty
                if price > 0:
                    patch["unit_cost"] = price
            if cat_id and not match.get("category_id"):
                patch["category_id"] = cat_id
            try:
                await sb_patch(client, "inventory_items", {"id": f"eq.{item_id}"}, patch)
            except httpx.HTTPStatusError:
                soft = {k: v for k, v in patch.items() if k in ("quantity", "unit_cost", "is_active")}
                try:
                    await sb_patch(client, "inventory_items", {"id": f"eq.{item_id}"}, soft)
                except httpx.HTTPStatusError as e:
                    warnings.append(f"{name}: nie zaktualizowano stanu ({_http_body(e)[:80]}).")
                    continue
            new_qty = float(patch.get("quantity", old_qty))
            match["quantity"] = new_qty
            match["is_active"] = True
            if add_qty_to_existing:
                updated.append({
                    "name": match.get("name") or name,
                    "added": qty,
                    "unit": match.get("unit") or unit,
                    "new_quantity": new_qty,
                })
            else:
                restored.append(name)
            continue

        payload = {
            "name": name,
            "quantity": qty,
            "unit": unit,
            "min_quantity": 0,
            "unit_cost": price,
            "category_id": cat_id,
            "is_combo_polprodukt": False,
            "safety_buffer_percent": 20,
            "is_active": True,
        }
        try:
            row = await _post_dropping_optional(sb_post, client, "inventory_items", payload, _INV_OPTIONAL_KEYS)
        except httpx.HTTPStatusError as e:
            warnings.append(f"{name}: nie dodano do magazynu ({_http_body(e)[:120]}).")
            continue
        item_id = _row_id(row)
        if not item_id:
            warnings.append(f"{name}: magazyn nie zwrócił id nowej pozycji.")
            continue
        created.append({"name": name, "quantity": qty, "unit": unit, "category": category})
        inv_rows.append({
            "id": item_id, "name": name, "quantity": qty, "unit": unit,
            "category_id": cat_id, "unit_cost": price, "is_active": True,
        })

    cost_id = None
    existing_cost = await _find_existing_lp_cost(
        client, sb_get, order_id=order_id, company=company, total=total,
    )
    note_body = _cost_note(
        source=source,
        company=company,
        total=total,
        producer_amount=producer_amount,
        materials_total=materials_total,
        delivery_cost=delivery_cost,
        platform_fee=platform_fee,
        invoice_products=invoice_products,
        order_id=order_id,
    )
    cost_name = f"Zakup LP — {company}"[:120]
    if existing_cost and existing_cost.get("id"):
        cost_id = str(existing_cost["id"])
        try:
            await sb_patch(client, "variable_cost_entries", {"id": f"eq.{cost_id}"}, {
                "name": cost_name,
                "amount_pln": float(total),
                "note": note_body,
            })
        except Exception:
            logger.debug("LP existing cost note tweak skipped", exc_info=True)
    elif total > 0:
        cost_payload = {
            "year_month": datetime.now(timezone.utc).strftime("%Y-%m"),
            "type": "materials",
            "name": cost_name,
            "amount_pln": float(total),
            "note": note_body,
        }
        try:
            cost_row = await _post_dropping_optional(
                sb_post, client, "variable_cost_entries", cost_payload,
                ("note", "type"),
            )
            cost_id = _row_id(cost_row)
        except httpx.HTTPStatusError as e:
            # type=materials może nie przejść checka — spróbuj other, potem bez notatki
            for fallback in (
                {**cost_payload, "type": "other"},
                {"year_month": cost_payload["year_month"], "type": "other",
                 "name": cost_name, "amount_pln": float(total)},
            ):
                try:
                    cost_row = await sb_post(client, "variable_cost_entries", fallback)
                    cost_id = _row_id(cost_row)
                    if cost_id:
                        break
                except httpx.HTTPStatusError:
                    cost_id = None
            if not cost_id:
                warnings.append(f"Nie udało się dopisać kosztu zmiennego: {_http_body(e)[:120]}")

    found_all = all(
        find_inventory_match(str(p.get("product_name") or ""), inv_rows, for_invoice=True)
        for p in invoice_products
        if str(p.get("product_name") or "").strip()
    )
    wrote_stock = bool(created or updated or restored or found_all)
    wrote_cost = bool(cost_id) or total <= 0
    if not wrote_stock:
        return {
            "ok": False,
            "stock_ok": False,
            "error": "Nie dodano żadnej pozycji do magazynu. " + ("; ".join(warnings) if warnings else "Sprawdź Magazyn i spróbuj ponownie."),
            "created": created,
            "updated": updated,
            "restored": restored,
            "cost_id": cost_id,
            "warnings": warnings,
        }
    if not wrote_cost:
        return {
            "ok": False,
            "stock_ok": True,
            "error": "Produkty zapisano, ale nie dopisano kosztu zmiennego. " + ("; ".join(warnings) if warnings else "Spróbuj ponownie z listy Doręczone."),
            "created": created,
            "updated": updated,
            "restored": restored,
            "cost_id": None,
            "warnings": warnings,
        }
    return {
        "ok": True,
        "stock_ok": True,
        "created": created,
        "updated": updated,
        "restored": restored,
        "cost_id": cost_id,
        "warnings": warnings,
        "noop": (not created and not updated and not restored and bool(existing_cost) and found_all),
    }

__all__ = ['apply_lp_inventory_and_cost']
