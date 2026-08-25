from __future__ import annotations

from datetime import datetime
from datetime import timezone
from typing import Any
from ._p0 import RECEIVED_TAG, _already_received, _map_lp_category_hint, logger, order_paid_total_pln, producer_category_name
from ._p2 import apply_lp_inventory_and_cost



async def receive_producer_order_into_warehouse(
    *,
    client,
    sb_get,
    sb_patch,
    order_id: str,
    mark_delivered: bool = True,
    source: str = "auto",
    sb_post=None,
) -> dict[str, Any]:
    """
    Dodaje produkty zamówienia do inventory_items restauracji
    i zapisuje koszt zmienny (materials) ze szczegółami pozycji.
    Zamówienie oznaczane jest jako przyjęte dopiero po udanym zapisie.
    """
    oid = (order_id or "").strip()
    if not oid:
        return {"ok": False, "error": "Brak order_id"}

    rows = await sb_get(client, "producer_orders", params={
        "select": (
            "id,producer_id,restaurant_account_key,notes,warehouse_received_at,"
            "shipment_status,order_status,payment_status,total_price,"
            "producer_amount,delivery_cost,shipping_cost,platform_fee"
        ),
        "id": f"eq.{oid}",
        "limit": "1",
    })
    if not rows:
        rows = await sb_get(client, "producer_orders", params={
            "select": (
                "id,producer_id,restaurant_account_key,notes,"
                "shipment_status,order_status,payment_status,total_price,"
                "producer_amount,delivery_cost,shipping_cost,platform_fee"
            ),
            "id": f"eq.{oid}",
            "limit": "1",
        })
    if not rows:
        return {"ok": False, "error": "Zamówienie nie istnieje"}

    order = rows[0]
    already = _already_received(order)

    account_key = str(order.get("restaurant_account_key") or "").strip()
    if not account_key or account_key == "default":
        return {"ok": False, "error": "Brak restaurant_account_key na zamówieniu"}

    producers = await sb_get(client, "local_producers", params={
        "select": "id,company_name",
        "id": f"eq.{order.get('producer_id')}",
        "limit": "1",
    }) or []
    company = (producers[0].get("company_name") if producers else None) or "Lokalny przetwórca"

    items = await sb_get(client, "producer_order_items", params={
        "select": "product_id,quantity,unit_price",
        "order_id": f"eq.{oid}",
    }) or []
    if not items:
        return {"ok": False, "error": "Zamówienie nie ma pozycji"}

    product_ids = [str(i.get("product_id")) for i in items if i.get("product_id")]
    products_by_id: dict[str, dict[str, Any]] = {}
    if product_ids:
        joined = ",".join(dict.fromkeys(product_ids))
        try:
            prows = await sb_get(client, "producer_products", params={
                "select": "id,title,unit,category_id,producer_categories(name)",
                "id": f"in.({joined})",
            }) or []
        except Exception:
            prows = await sb_get(client, "producer_products", params={
                "select": "id,title,unit,category_id",
                "id": f"in.({joined})",
            }) or []
        for p in prows:
            products_by_id[str(p.get("id"))] = p

    invoice_products: list[dict[str, Any]] = []
    materials_total = 0.0
    for item in items:
        pid = str(item.get("product_id") or "")
        prod = products_by_id.get(pid) or {}
        title = str(prod.get("title") or "Produkt LP").strip() or "Produkt LP"
        try:
            qty = float(item.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        try:
            price = float(item.get("unit_price") or 0)
        except (TypeError, ValueError):
            price = 0.0
        if qty <= 0:
            continue
        unit = str(prod.get("unit") or "szt").strip() or "szt"
        cat_name = producer_category_name(prod.get("producer_categories"))
        hint = _map_lp_category_hint(cat_name, title)
        invoice_products.append({
            "product_name": title,
            "quantity": qty,
            "unit": unit,
            "price_netto": price,
            "category": hint,
        })
        materials_total += qty * price

    if not invoice_products:
        return {"ok": False, "error": "Brak poprawnych pozycji do przyjęcia"}

    try:
        delivery_cost = float(order.get("delivery_cost") or order.get("shipping_cost") or 0)
    except (TypeError, ValueError):
        delivery_cost = 0.0
    try:
        platform_fee = float(order.get("platform_fee") or 0)
    except (TypeError, ValueError):
        platform_fee = 0.0
    try:
        producer_amount = float(order.get("producer_amount") or 0)
    except (TypeError, ValueError):
        producer_amount = 0.0

    total = order_paid_total_pln(order, materials_total)

    from supabase_rest import push_account_key, reset_account_key
    if sb_post is None:
        from supabase_rest import sb_post as _sb_post
        sb_post = _sb_post

    token = push_account_key(account_key)
    try:
        saved = await apply_lp_inventory_and_cost(
            client=client,
            sb_get=sb_get,
            sb_post=sb_post,
            sb_patch=sb_patch,
            invoice_products=invoice_products,
            company=str(company),
            total=float(total),
            order_id=oid,
            source=source,
            producer_amount=producer_amount,
            materials_total=materials_total,
            delivery_cost=delivery_cost,
            platform_fee=platform_fee,
            add_qty_to_existing=not already,
        )
    except Exception as e:
        logger.exception("LP warehouse receive failed for %s", oid)
        return {"ok": False, "error": str(e)[:280]}
    finally:
        reset_account_key(token)

    if not saved.get("ok") and not saved.get("stock_ok"):
        return {
            "ok": False,
            "already": already,
            "error": saved.get("error") or "Nie udało się przyjąć paczki do magazynu",
            "warnings": saved.get("warnings") or [],
            "created": saved.get("created") or [],
            "updated": saved.get("updated") or [],
            "cost_id": saved.get("cost_id"),
        }

    now = datetime.now(timezone.utc).isoformat()
    notes = str(order.get("notes") or "").strip()
    next_notes = notes if RECEIVED_TAG in notes else " | ".join(x for x in (notes, RECEIVED_TAG) if x)
    patch: dict[str, Any] = {"notes": next_notes}
    if mark_delivered:
        patch["shipment_status"] = "delivered"
        patch["order_status"] = "delivered"
        patch["tracking_state"] = "delivered"
    patch["warehouse_received_at"] = now
    try:
        await sb_patch(client, "producer_orders", {"id": f"eq.{oid}"}, patch)
    except Exception:
        soft = {k: v for k, v in patch.items() if k != "warehouse_received_at"}
        try:
            await sb_patch(client, "producer_orders", {"id": f"eq.{oid}"}, soft)
        except Exception as e:
            logger.warning("LP receive mark order failed: %s", e)

    created = saved.get("created") or []
    updated = saved.get("updated") or []
    restored = saved.get("restored") or []
    if not saved.get("ok"):
        return {
            "ok": False,
            "already": already,
            "error": saved.get("error") or "Nie udało się dopisać kosztu zmiennego",
            "warnings": saved.get("warnings") or [],
            "created": created,
            "updated": updated,
            "cost_id": saved.get("cost_id"),
        }

    applied = len(created) + len(updated)
    if applied <= 0:
        applied = len(restored) or len(invoice_products)
    cost_id = saved.get("cost_id")
    repaired = already and not saved.get("noop")
    if already and saved.get("noop"):
        message = "Paczka już była przyjęta wcześniej — magazyn i koszt są uzupełnione."
    elif repaired:
        message = (
            f"Uzupełniono magazyn ({applied} poz.) "
            f"i koszt zmienny ({total:.2f} zł)."
        )
    else:
        message = (
            f"Przyjęto {applied} poz. do magazynu "
            f"i dopisano koszt zmienny ({total:.2f} zł)."
        )

    return {
        "ok": True,
        "already": bool(already and saved.get("noop")),
        "repaired": repaired,
        "received": applied,
        "updated": updated,
        "created": created,
        "cost_id": cost_id,
        "total_pln": total,
        "company": company,
        "source": source,
        "warnings": saved.get("warnings") or [],
        "message": message,
    }

__all__ = ['receive_producer_order_into_warehouse']
