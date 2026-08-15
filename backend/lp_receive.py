"""
Odbiór paczki LP w restauracji → magazyn + koszt zmienny (idempotentne).

Wywoływane gdy:
  - Furgonetka zgłosi tracking_state=delivered (sync_order_tracking),
  - restauracja kliknie „Odebrałem paczkę”.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("lp.receive")

RECEIVED_TAG = "warehouse_received:1"


def _already_received(order: dict[str, Any]) -> bool:
    if order.get("warehouse_received_at"):
        return True
    return RECEIVED_TAG in str(order.get("notes") or "")


def _map_lp_category_hint(raw: Optional[str], title: str) -> str:
    """Hint kategorii magazynu z kategorii dystrybutora / nazwy produktu."""
    blob = f"{raw or ''} {title or ''}".lower()
    rules = [
        ("Warzywa", ("warzyw", "owoc", "sałat", "salat", "pomidor", "ogórek", "ogorek", "ziemniak", "cebula", "marchew", "kapust")),
        ("Mięso", ("mięs", "mies", "woł", "wol", "wieprz", "kurczak", "indyk", "wołow", "schab", "kiełbas", "kielbas", "drób", "drob")),
        ("Nabiał", ("nabiał", "nabial", "ser ", "mleko", "śmiet", "smiet", "jogurt", "masło", "maslo", "jajka", "jajko")),
        ("Pieczywo", ("pieczyw", "chleb", "bułk", "bulk", "bagiet")),
        ("Napoje/Alkohole", ("napoj", "sok", "woda", "piwo", "wino", "alkohol", "lemoniad")),
        ("Przyprawy", ("przypraw", "sól", "sol ", "pieprz", "zioła", "ziola", "oliwa", "ocet")),
        ("Inne", ("przetwór", "przetwor", "konserw", "dżem", "dzem", "miód", "miod", "pasztet", "smalec")),
    ]
    for cat, keys in rules:
        if any(k in blob for k in keys):
            return cat
    return "Inne"


async def receive_producer_order_into_warehouse(
    *,
    client,
    sb_get,
    sb_patch,
    order_id: str,
    mark_delivered: bool = True,
    source: str = "auto",
) -> dict[str, Any]:
    """
    Dodaje produkty zamówienia do inventory_items restauracji
    i zapisuje koszt zmienny (materials) ze szczegółami pozycji.
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
        # Kolumna warehouse_received_at może jeszcze nie istnieć
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
    if _already_received(order):
        return {"ok": True, "already": True, "received": 0}

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
        cat_obj = prod.get("producer_categories") or {}
        cat_name = cat_obj.get("name") if isinstance(cat_obj, dict) else None
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

    # Preferuj producer_amount (bez prowizji/kuriera), inaczej suma linii
    try:
        producer_amount = float(order.get("producer_amount") or 0)
    except (TypeError, ValueError):
        producer_amount = 0.0
    total = producer_amount if producer_amount > 0 else round(materials_total, 2)
    if total <= 0:
        total = round(materials_total, 2)

    from supabase_rest import push_account_key, reset_account_key

    token = push_account_key(account_key)
    try:
        # Lazy import — unikamy cyklu przy starcie
        from server import _save_invoice

        saved = await _save_invoice(
            client,
            "",
            str(company),
            invoice_products,
            float(total),
            destination="inventory",
        )
    except Exception as e:
        logger.exception("LP warehouse receive failed for %s", oid)
        return {"ok": False, "error": str(e)[:280]}
    finally:
        reset_account_key(token)

    # Popraw notatkę kosztu — oznacz źródło LP (best-effort)
    cost_id = (saved or {}).get("cost_id")
    if cost_id:
        token2 = push_account_key(account_key)
        try:
            note_rows = await sb_get(client, "variable_cost_entries", params={
                "select": "id,note,name",
                "id": f"eq.{cost_id}",
                "limit": "1",
            })
            if note_rows:
                old_note = str(note_rows[0].get("note") or "")
                prefix = f"Dostawa LP ({source}) · {company}"
                if "GM_INVOICE_LINES:" in old_note:
                    _, _, rest = old_note.partition("GM_INVOICE_LINES:")
                    new_note = f"{prefix}\nGM_INVOICE_LINES:{rest}"
                else:
                    new_note = f"{prefix}\n{old_note}".strip()
                await sb_patch(client, "variable_cost_entries", {"id": f"eq.{cost_id}"}, {
                    "name": f"Zakup LP — {company}"[:120],
                    "note": new_note,
                })
        except Exception:
            logger.debug("LP cost note tweak skipped", exc_info=True)
        finally:
            reset_account_key(token2)

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

    return {
        "ok": True,
        "already": False,
        "received": len(invoice_products),
        "updated": (saved or {}).get("updated") or [],
        "created": (saved or {}).get("created") or [],
        "cost_id": cost_id,
        "total_pln": total,
        "company": company,
        "source": source,
    }
