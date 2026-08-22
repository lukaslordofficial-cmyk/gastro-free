"""
Odbiór paczki LP w restauracji → magazyn + koszt zmienny (idempotentne).

Wywoływane gdy:
  - Furgonetka zgłosi tracking_state=delivered (sync_order_tracking),
  - restauracja kliknie „Odebrałem paczkę”.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from inventory_name_match import find_inventory_match

logger = logging.getLogger("lp.receive")

RECEIVED_TAG = "warehouse_received:1"
LP_ORDER_PREFIX = "LP_ORDER:"

_INV_OPTIONAL_KEYS = (
    "default_alert_days",
    "safety_buffer_percent",
    "is_combo_polprodukt",
    "min_quantity",
    "category_id",
    "unit_cost",
    "is_active",
)

_CAT_COLORS = {
    "Mięso i wędliny": "#DC2626",
    "Warzywa i owoce": "#16A34A",
    "Nabiał": "#F59E0B",
    "Pieczywo": "#78716C",
    "Napoje": "#0891B2",
    "Alkohole": "#7C3AED",
    "Przyprawy": "#D97706",
    "Inne": "#94A3B8",
}


def _already_received(order: dict[str, Any]) -> bool:
    if order.get("warehouse_received_at"):
        return True
    return RECEIVED_TAG in str(order.get("notes") or "")


def _norm_name(s: str) -> str:
    return " ".join((s or "").lower().split())


def producer_category_name(raw: Any) -> Optional[str]:
    """PostgREST embed: obiekt, lista obiektów albo zwykły string."""
    if isinstance(raw, dict):
        name = raw.get("name")
        return str(name).strip() if name else None
    if isinstance(raw, list) and raw:
        return producer_category_name(raw[0])
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


def _map_lp_category_hint(raw: Optional[str], title: str) -> str:
    """Hint kategorii magazynu — nazwy jak w Magazynie (WAREHOUSE_CATEGORIES)."""
    blob = f"{raw or ''} {title or ''}".lower()
    rules = [
        ("Warzywa i owoce", (
            "warzyw", "owoc", "sałat", "salat", "pomidor", "ogórek", "ogorek",
            "ziemniak", "cebula", "marchew", "kapust",
        )),
        ("Mięso i wędliny", (
            "mięs", "mies", "woł", "wol", "wieprz", "kurczak", "indyk", "wołow",
            "schab", "kiełbas", "kielbas", "drób", "drob",
        )),
        ("Nabiał", (
            "nabiał", "nabial", "ser ", "mleko", "śmiet", "smiet", "jogurt",
            "masło", "maslo", "jajka", "jajko",
        )),
        ("Pieczywo", ("pieczyw", "chleb", "bułk", "bulk", "bagiet")),
        ("Napoje", ("napoj", "sok", "woda", "lemoniad")),
        ("Alkohole", ("piwo", "wino", "alkohol")),
        ("Przyprawy", ("przypraw", "sól", "sol ", "pieprz", "zioła", "ziola", "oliwa", "ocet")),
        ("Inne", ("przetwór", "przetwor", "konserw", "dżem", "dzem", "miód", "miod", "pasztet", "smalec")),
    ]
    for cat, keys in rules:
        if any(k in blob for k in keys):
            return cat
    return "Inne"


def order_paid_total_pln(order: dict[str, Any], materials_total: float = 0.0) -> float:
    """Cała kwota zapłacona przez restaurację (produkty + kurier + opłata platformy)."""
    try:
        total_paid = float(order.get("total_price") or 0)
    except (TypeError, ValueError):
        total_paid = 0.0
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

    total = round(total_paid, 2)
    if total <= 0 and producer_amount > 0:
        total = round(producer_amount + delivery_cost + platform_fee, 2)
    if total <= 0:
        total = round(materials_total + delivery_cost + platform_fee, 2)
    if total <= 0:
        total = round(materials_total, 2)
    return total


def lp_order_note_tag(order_id: str) -> str:
    return f"{LP_ORDER_PREFIX}{(order_id or '').strip()}"


def _row_id(row: Any) -> Optional[str]:
    if not row:
        return None
    obj = row[0] if isinstance(row, list) else row
    if isinstance(obj, dict) and obj.get("id"):
        return str(obj["id"])
    return None


def _http_body(exc: BaseException) -> str:
    resp = getattr(exc, "response", None)
    return str(getattr(resp, "text", None) or exc)


async def _post_dropping_optional(sb_post, client, table: str, payload: dict[str, Any], optional_keys: tuple[str, ...]):
    """Insert z retry: zrzuca kolumny wymienione w błędzie PostgREST, potem minimalny zestaw."""
    try:
        return await sb_post(client, table, payload)
    except httpx.HTTPStatusError as e:
        body = _http_body(e)
        nxt = dict(payload)
        dropped = False
        for key in optional_keys:
            if key in nxt and key in body:
                nxt.pop(key, None)
                dropped = True
        if dropped:
            try:
                return await sb_post(client, table, nxt)
            except httpx.HTTPStatusError as e2:
                body = _http_body(e2)
        core_keep = {"name", "quantity", "unit", "year_month", "type", "amount_pln", "note", "is_active"}
        minimal = {k: v for k, v in payload.items() if k in core_keep or k not in optional_keys}
        if "is_active" in payload:
            minimal["is_active"] = payload["is_active"]
        try:
            return await sb_post(client, table, minimal)
        except httpx.HTTPStatusError:
            logger.warning("LP post %s failed: %s", table, body[:240])
            raise


async def _resolve_category_id(client, sb_get, sb_post, cat_name: str, cache: dict[str, Any]) -> Optional[str]:
    name = (cat_name or "Inne").strip() or "Inne"
    key = _norm_name(name)
    if key in cache:
        return cache[key]
    rows = cache.get("_rows")
    if rows is None:
        try:
            rows = await sb_get(client, "inventory_categories", params={
                "select": "id,name,sort_order",
                "limit": "200",
            }) or []
        except Exception:
            rows = []
        cache["_rows"] = rows
        for r in rows:
            cache[_norm_name(str(r.get("name") or ""))] = r.get("id")
    if key in cache and cache[key]:
        return cache[key]
    max_sort = max((int(r.get("sort_order") or 0) for r in (cache.get("_rows") or [])), default=0) + 1
    try:
        created = await sb_post(client, "inventory_categories", {
            "name": name,
            "color": _CAT_COLORS.get(name, "#94A3B8"),
            "sort_order": max_sort,
        })
        cid = _row_id(created)
        if cid:
            cache[key] = cid
            cache.setdefault("_rows", []).append({"id": cid, "name": name, "sort_order": max_sort})
            return cid
    except Exception:
        logger.debug("LP category create skipped for %s", name, exc_info=True)
    return cache.get(_norm_name("Inne"))


async def _find_existing_lp_cost(
    client,
    sb_get,
    *,
    order_id: str,
    company: str,
    total: float,
) -> Optional[dict[str, Any]]:
    tag = lp_order_note_tag(order_id)
    try:
        tagged = await sb_get(client, "variable_cost_entries", params={
            "select": "id,note,name,amount_pln",
            "note": f"ilike.*{tag}*",
            "limit": "5",
        }) or []
        if tagged:
            return tagged[0]
    except Exception:
        logger.debug("LP cost lookup by tag skipped", exc_info=True)
    cost_name = f"Zakup LP — {company}"[:120]
    try:
        named = await sb_get(client, "variable_cost_entries", params={
            "select": "id,note,name,amount_pln",
            "name": f"eq.{cost_name}",
            "year_month": f"eq.{datetime.now(timezone.utc).strftime('%Y-%m')}",
            "limit": "10",
        }) or []
        for row in named:
            try:
                amt = round(float(row.get("amount_pln") or 0), 2)
            except (TypeError, ValueError):
                amt = 0.0
            if abs(amt - round(float(total), 2)) <= 0.05:
                return row
            note = str(row.get("note") or "")
            if tag in note:
                return row
    except Exception:
        logger.debug("LP cost lookup by name skipped", exc_info=True)
    return None


def _cost_note(
    *,
    source: str,
    company: str,
    total: float,
    producer_amount: float,
    materials_total: float,
    delivery_cost: float,
    platform_fee: float,
    invoice_products: list[dict[str, Any]],
    order_id: str,
) -> str:
    prefix = (
        f"Dostawa LP ({source}) · {company} · zapłacono łącznie {total:.2f} zł "
        f"(produkty {round(producer_amount or materials_total, 2):.2f} zł"
        + (f" + kurier {delivery_cost:.2f} zł" if delivery_cost > 0 else "")
        + (f" + opłata platformy {platform_fee:.2f} zł" if platform_fee > 0 else "")
        + f") · {lp_order_note_tag(order_id)}"
    )
    lines = [
        {
            "name": p["product_name"],
            "qty": p["quantity"],
            "unit": p["unit"],
            "price_netto": p["price_netto"],
        }
        for p in invoice_products
    ]
    if delivery_cost > 0:
        lines.append({
            "name": "Kurier / dostawa",
            "qty": 1,
            "unit": "szt",
            "price_netto": round(delivery_cost, 2),
        })
    if platform_fee > 0:
        lines.append({
            "name": "Opłata serwisu platformy (5%)",
            "qty": 1,
            "unit": "szt",
            "price_netto": round(platform_fee, 2),
        })
    payload = {
        "v": 1,
        "kind": "invoice_lines",
        "supplier_id": "",
        "supplier_name": str(company),
        "total": float(total),
        "order_id": order_id,
        "lines": lines,
    }
    return f"{prefix}\nGM_INVOICE_LINES:{json.dumps(payload, ensure_ascii=False)}"


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
