"""Zejście stanu produktów dystrybutora po wysyłce zamówienia LP."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("lp.stock")

STOCK_TAG = "stock_applied:1"


def _already_applied(order: dict[str, Any]) -> bool:
    if order.get("stock_decremented_at"):
        return True
    return STOCK_TAG in str(order.get("notes") or "")


async def decrement_stock_for_shipped_order(
    *,
    client,
    sb_get,
    sb_patch,
    order_id: str,
    producer_id: str | None = None,
) -> dict[str, Any]:
    """Odejmij quantity z producer_products.stock. Idempotentne."""
    oid = (order_id or "").strip()
    if not oid:
        return {"ok": False, "decremented": 0, "error": "Brak order_id"}

    rows = await sb_get(client, "producer_orders", params={
        "select": "id,producer_id,notes,stock_decremented_at,shipment_status,order_status",
        "id": f"eq.{oid}",
        "limit": "1",
    })
    if not rows:
        rows = await sb_get(client, "producer_orders", params={
            "select": "id,producer_id,notes,shipment_status,order_status",
            "id": f"eq.{oid}",
            "limit": "1",
        })
    if not rows:
        return {"ok": False, "decremented": 0, "error": "Brak zamówienia"}

    order = rows[0]
    pid = str(producer_id or order.get("producer_id") or "").strip()
    if _already_applied(order):
        return {"ok": True, "already": True, "decremented": 0}

    items = await sb_get(client, "producer_order_items", params={
        "select": "product_id,quantity",
        "order_id": f"eq.{oid}",
    }) or []

    decremented = 0
    for item in items:
        product_id = str(item.get("product_id") or "").strip()
        try:
            qty = float(item.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        if not product_id or qty <= 0:
            continue
        prods = await sb_get(client, "producer_products", params={
            "select": "id,stock,available,producer_id",
            "id": f"eq.{product_id}",
            "limit": "1",
        })
        if not prods:
            continue
        prod = prods[0]
        if pid and str(prod.get("producer_id") or "") != pid:
            continue
        try:
            current = float(prod.get("stock") or 0)
        except (TypeError, ValueError):
            current = 0.0
        nxt = round(max(0.0, current - qty), 3)
        patch = {
            "stock": nxt,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if nxt <= 0:
            patch["available"] = False
        try:
            await sb_patch(client, "producer_products", {"id": f"eq.{product_id}"}, patch)
            decremented += 1
        except Exception as e:
            logger.warning("LP stock decrement failed for %s: %s", product_id, e)

    notes = str(order.get("notes") or "").strip()
    next_notes = notes if STOCK_TAG in notes else " | ".join(x for x in (notes, STOCK_TAG) if x)
    now = datetime.now(timezone.utc).isoformat()
    try:
        await sb_patch(client, "producer_orders", {"id": f"eq.{oid}"}, {
            "stock_decremented_at": now,
            "notes": next_notes,
        })
    except Exception:
        try:
            await sb_patch(client, "producer_orders", {"id": f"eq.{oid}"}, {"notes": next_notes})
        except Exception as e:
            logger.warning("LP stock mark applied failed: %s", e)

    return {"ok": True, "decremented": decremented}
