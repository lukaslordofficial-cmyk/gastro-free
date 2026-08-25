from __future__ import annotations

from billing_stripe import _ssl_verify
from lp_packaging import estimate_order_weight_kg
from lp_packaging import furgonetka_parcels_payload
from lp_packaging import parcels_for_weight_kg
from lp_tracking import order_status_for_state
from lp_tracking import shipment_status_for_state
from pl_phone import assign_courier_phones
from pl_phone import courier_requires_mobile_message
from pl_phone import is_pl_mobile
from typing import Any
import httpx
import os
import uuid
from ._p0 import ACCEPT_V1, ACCEPT_V2, _api, _use_mock, _use_sandbox, api_base, furgonetka_configured, logger, resolve_inpost_service_id
from ._p1 import _missing_party_fields, _parse_lp_courier, _parse_lp_ship, _party, _patch_order, _save_shipping_error, _split_street
from ._p2 import _ensure_regulations, _extract_tracking, _poll_command, _schedule_pickup, _store_label_pdf



async def _load_order_products(
    client: httpx.AsyncClient,
    sb_get,
    order_id: str,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    items = await sb_get(client, "producer_order_items", params={
        "select": "id,product_id,quantity,unit_price",
        "order_id": f"eq.{order_id}",
    }) or []
    ids = [str(i.get("product_id")) for i in items if i.get("product_id")]
    products: dict[str, dict[str, Any]] = {}
    if ids:
        # PostgREST: id=in.(a,b)
        joined = ",".join(ids)
        rows = await sb_get(client, "producer_products", params={
            "select": "id,title,unit,weight_g",
            "id": f"in.({joined})",
        }) or []
        for p in rows:
            products[str(p.get("id"))] = p
    return items, products


async def _finish_existing_package(
    *,
    client: httpx.AsyncClient,
    sb_patch,
    order: dict[str, Any],
    package_id: str,
) -> dict[str, Any]:
    """Idempotencja: dokończ order/etykietę/podjazd jeśli coś zostało w połowie."""
    oid = str(order.get("id"))
    details = await _api("GET", f"/packages/{package_id}", accept=ACCEPT_V2)
    state = str((details or {}).get("state") or "").lower()
    tracking = _extract_tracking(details)
    ordered = state not in ("", "waiting")
    page = (os.getenv("FURGONETKA_LABEL_PAGE") or "a6").lower()

    if not ordered:
        await _ensure_regulations()
        cmd = str(uuid.uuid4())
        await _api(
            "PUT",
            f"/order-commands/{cmd}",
            json_body={
                "packages": [{"id": package_id}],
                "label": {"file_format": "pdf", "page_format": page},
            },
            accept=ACCEPT_V1,
        )
        await _poll_command("order-commands", cmd)
        ordered = True
        details = await _api("GET", f"/packages/{package_id}", accept=ACCEPT_V2)
        tracking = _extract_tracking(details) or tracking
        state = str((details or {}).get("state") or state)

    pickup = {}
    if not order.get("pickup_date"):
        try:
            pickup = await _schedule_pickup(package_id)
        except Exception as e:
            logger.warning("pickup retry failed: %s", e)
            pickup = {"pickup_error": str(e)[:300]}

    label_ref = order.get("label_storage_path")
    if ordered and not label_ref:
        label_ref = await _store_label_pdf(oid, str(order.get("producer_id") or ""), package_id)

    patch = {
        "furgonetka_package_id": package_id,
        "broker_package_id": package_id,
        "broker_name": "furgonetka",
        "broker_label_ready": bool(ordered),
        "shipment_status": shipment_status_for_state(state, fallback="preparing"),
        "order_status": order_status_for_state(state, fallback="awaiting_courier" if ordered else "preparing"),
        "tracking_state": state,
    }
    if tracking:
        patch["delivery_tracking"] = tracking
    if (details or {}).get("service"):
        patch["courier_name"] = details.get("service")
    if label_ref:
        patch["label_storage_path"] = label_ref
    if pickup.get("pickup_date"):
        patch["pickup_date"] = pickup["pickup_date"]
        patch["pickup_min_time"] = pickup.get("pickup_min_time")
        patch["pickup_max_time"] = pickup.get("pickup_max_time")
        patch["shipping_error"] = None
    elif pickup.get("pickup_error"):
        patch["shipping_error"] = f"Przesyłka zamówiona, podjazd: {pickup['pickup_error']}"[:500]
    await _patch_order(client, sb_patch, oid, patch)
    return {
        "ok": True,
        "already": True,
        "furgonetka_package_id": package_id,
        "package_id": package_id,
        "tracking": tracking,
        "ordered": ordered,
        "pickup": pickup,
        "label_storage_path": label_ref,
    }


async def create_furgonetka_shipment(
    order_id: str,
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
) -> dict[str, Any]:
    """
    Po opłaceniu: paczka z wagą zamówienia → InPost Kurier → etykieta → podjazd.
    Idempotentne względem order_id (istniejący package_id = dokończenie, nie duplikat).
    """
    oid = (order_id or "").strip()
    if not oid:
        raise ValueError("Brak order_id")

    if not furgonetka_configured() and not _use_mock():
        await _save_shipping_error(
            client, sb_patch, oid,
            "Furgonetka nie skonfigurowana (CLIENT_ID/SECRET + EMAIL/PASSWORD na Railway) "
            "albo ustaw FURGONETKA_SANDBOX=1 i FURGONETKA_MOCK=1 do testów.",
        )
        return {
            "ok": False,
            "stub": True,
            "error": "Furgonetka nie skonfigurowana — sandbox: FURGONETKA_SANDBOX=1 FURGONETKA_MOCK=1.",
        }

    rows = await sb_get(
        client,
        "producer_orders",
        params={"select": "*", "id": f"eq.{oid}", "limit": "1"},
    )
    if not rows:
        raise RuntimeError(f"Nie znaleziono zamówienia {oid}")
    order = rows[0]

    if str(order.get("payment_status") or "").lower() != "paid":
        raise RuntimeError("Zamówienie nie jest opłacone — najpierw Stripe paid")

    existing = (
        (order.get("furgonetka_package_id") or order.get("broker_package_id") or "")
    ).strip()
    if existing:
        try:
            return await _finish_existing_package(
                client=client, sb_patch=sb_patch, order=order, package_id=existing,
            )
        except Exception as e:
            logger.exception("finish existing package failed")
            await _save_shipping_error(client, sb_patch, oid, str(e)[:500])
            return {"ok": False, "already": True, "package_id": existing, "error": str(e)[:300]}

    try:
        if _use_mock():
            return await _create_mock_shipment(
                client=client, sb_get=sb_get, sb_patch=sb_patch, order=order,
            )
        return await _create_new_shipment(
            client=client, sb_get=sb_get, sb_patch=sb_patch, order=order,
        )
    except Exception as e:
        logger.exception("create_furgonetka_shipment failed")
        await _save_shipping_error(client, sb_patch, oid, str(e)[:500])
        return {"ok": False, "error": str(e)[:400]}


async def _create_mock_shipment(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order: dict[str, Any],
) -> dict[str, Any]:
    """Pełny flow bez konta firmowego Furgonetka — etykieta + tracking testowy."""
    from datetime import datetime, timezone, timedelta

    oid = str(order.get("id"))
    items, products = await _load_order_products(client, sb_get, oid)
    weight_kg = estimate_order_weight_kg(items, products)
    parcels_full = parcels_for_weight_kg(weight_kg)
    package_id = f"mock-{oid[:8]}-{uuid.uuid4().hex[:8]}"
    tracking = f"MOCK{oid[:8].upper()}PL"
    pickup_day = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
    label_ref = None
    try:
        from lp_invoice_url import DEFAULT_DOCS_BUCKET, upload_private_bytes

        pdf = (
            b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n"
            b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
            b"0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\n"
            b"startxref\n190\n%%EOF\n"
        )
        path = f"labels/{order.get('producer_id') or 'unknown'}/{oid}.pdf"
        label_ref = await upload_private_bytes(
            bucket=DEFAULT_DOCS_BUCKET,
            path=path,
            content=pdf,
            content_type="application/pdf",
            verify=_ssl_verify(),
        )
    except Exception as e:
        logger.info("mock label upload skipped: %s", e)

    patch = {
        "furgonetka_package_id": package_id,
        "broker_package_id": package_id,
        "broker_name": "furgonetka-sandbox",
        "broker_label_ready": True,
        "shipment_status": "preparing",
        "order_status": "awaiting_courier",
        "tracking_state": "ordered",
        "parcel_weight_kg": weight_kg,
        "courier_name": order.get("courier_name") or "inpost",
        "delivery_tracking": tracking,
        "pickup_date": pickup_day,
        "pickup_min_time": "10:00",
        "pickup_max_time": "18:00",
        "shipping_error": None,
    }
    if label_ref:
        patch["label_storage_path"] = label_ref
    await _patch_order(client, sb_patch, oid, patch)
    return {
        "ok": True,
        "stub": False,
        "mock": True,
        "sandbox": True,
        "furgonetka_package_id": package_id,
        "package_id": package_id,
        "tracking": tracking,
        "ordered": True,
        "weight_kg": weight_kg,
        "parcels": parcels_full,
        "pickup": {
            "pickup_date": pickup_day,
            "pickup_min_time": "10:00",
            "pickup_max_time": "18:00",
        },
        "label_storage_path": label_ref,
        "courier_name": order.get("courier_name") or "inpost",
        "prepaid_note": "Tryb testowy (FURGONETKA_MOCK / SANDBOX) — kurier nie jedzie na serio.",
    }


async def _create_new_shipment(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order: dict[str, Any],
) -> dict[str, Any]:
    oid = str(order.get("id"))
    prod_rows = await sb_get(
        client,
        "local_producers",
        params={"select": "*", "id": f"eq.{order.get('producer_id')}", "limit": "1"},
    )
    producer = (prod_rows or [None])[0]
    if not producer:
        raise RuntimeError("Brak dystrybutora (local_producers) dla zamówienia")

    ship = _parse_lp_ship(order.get("notes")) or {}
    restaurant_name = (
        ship.get("name")
        or order.get("delivery_name")
        or order.get("restaurant_name")
        or "Restauracja"
    )
    restaurant_email = ship.get("email") or order.get("delivery_email")
    profile_phone = ""
    account_key = order.get("restaurant_account_key")
    if account_key:
        try:
            profiles = await sb_get(
                client,
                "profiles",
                params={
                    "select": "restaurant_name,email,phone",
                    "account_key": f"eq.{account_key}",
                    "limit": "1",
                },
            )
            if profiles:
                restaurant_name = ship.get("name") or profiles[0].get("restaurant_name") or restaurant_name
                restaurant_email = ship.get("email") or profiles[0].get("email") or restaurant_email
                profile_phone = str(profiles[0].get("phone") or "")
        except Exception:
            try:
                profiles = await sb_get(
                    client,
                    "profiles",
                    params={
                        "select": "restaurant_name,email",
                        "account_key": f"eq.{account_key}",
                        "limit": "1",
                    },
                )
                if profiles:
                    restaurant_name = ship.get("name") or profiles[0].get("restaurant_name") or restaurant_name
                    restaurant_email = ship.get("email") or profiles[0].get("email") or restaurant_email
            except Exception:
                pass

    s_street, s_building = _split_street(producer.get("address"))
    sender_street = " ".join(x for x in (s_street, s_building) if x).strip()
    recv_street = " ".join(
        x for x in (
            ship.get("street") or order.get("delivery_address"),
            ship.get("building_number"),
        ) if x
    ).strip()

    pickup_phone, receiver_phone = assign_courier_phones(
        str(producer.get("phone") or ""),
        str(ship.get("phone") or order.get("delivery_phone") or ""),
        extra_phones=[
            profile_phone,
            ship.get("phone"),
            order.get("delivery_phone"),
            producer.get("phone"),
        ],
    )
    pickup = _party(
        name=str(producer.get("owner_name") or producer.get("company_name") or ""),
        company=str(producer.get("company_name") or ""),
        email=str(producer.get("email") or producer.get("invoice_email") or ""),
        phone=pickup_phone,
        street=sender_street,
        city=str(producer.get("city") or ""),
        postcode=str(producer.get("postal_code") or ""),
    )
    receiver = _party(
        name=str(restaurant_name),
        company=str(restaurant_name),
        email=str(restaurant_email or ""),
        phone=receiver_phone,
        street=recv_street,
        city=str(ship.get("city") or order.get("delivery_city") or ""),
        postcode=str(ship.get("post_code") or order.get("delivery_postal_code") or ""),
    )

    missing = _missing_party_fields(pickup, who="nadawca (dystrybutor)") + _missing_party_fields(
        receiver, who="odbiorca (restauracja)",
    )
    if missing:
        raise RuntimeError("Niekompletny adres: " + "; ".join(missing))

    if not is_pl_mobile(pickup.get("phone")) and not is_pl_mobile(receiver.get("phone")):
        raise RuntimeError(
            courier_requires_mobile_message(receiver.get("phone") or pickup.get("phone"))
        )

    items, products = await _load_order_products(client, sb_get, oid)
    weight_kg = estimate_order_weight_kg(items, products)
    parcels_full = parcels_for_weight_kg(weight_kg)
    courier_sel = _parse_lp_courier(order.get("notes")) or {}
    try:
        w = int(courier_sel.get("width") or 0)
        h = int(courier_sel.get("height") or 0)
        d = int(courier_sel.get("depth") or 0)
    except (TypeError, ValueError):
        w = h = d = 0
    if w > 0 and h > 0 and d > 0 and parcels_full:
        parcels_full[0]["width"] = w
        parcels_full[0]["height"] = h
        parcels_full[0]["depth"] = d
    parcels = furgonetka_parcels_payload(parcels_full)

    service_id = courier_sel.get("service_id")
    if service_id in (None, "", 0, "0"):
        service_id = await resolve_inpost_service_id()
    else:
        try:
            service_id = int(service_id)
        except (TypeError, ValueError):
            pass
    payload = {
        "pickup": pickup,
        "receiver": receiver,
        "service_id": service_id,
        "parcels": parcels,
        "user_reference_number": f"LP-{oid[:8]}",
        "additional_services": {},
    }

    await _ensure_regulations()
    await _api("POST", "/packages/validate", json_body=payload, accept=ACCEPT_V2)

    created = await _api("POST", "/packages", json_body=payload, accept=ACCEPT_V2)
    package_id = str((created or {}).get("package_id") or (created or {}).get("id") or "")
    if not package_id:
        raise RuntimeError("Furgonetka nie zwróciła package_id")

    await _patch_order(client, sb_patch, oid, {
        "furgonetka_package_id": package_id,
        "broker_package_id": package_id,
        "broker_name": "furgonetka",
        "shipment_status": "preparing",
        "order_status": "preparing",
        "parcel_weight_kg": weight_kg,
        "shipping_error": None,
    })

    page = (os.getenv("FURGONETKA_LABEL_PAGE") or "a6").lower()
    cmd = str(uuid.uuid4())
    await _api(
        "PUT",
        f"/order-commands/{cmd}",
        json_body={
            "packages": [{"id": package_id}],
            "label": {"file_format": "pdf", "page_format": page},
        },
        accept=ACCEPT_V1,
    )
    await _poll_command("order-commands", cmd)

    details = {}
    try:
        details = await _api("GET", f"/packages/{package_id}", accept=ACCEPT_V2) or {}
    except Exception:
        details = {}
    tracking = _extract_tracking(details)
    courier = details.get("service") or "inpost"
    state = str(details.get("state") or "ordered")

    label_ref = await _store_label_pdf(oid, str(order.get("producer_id") or ""), package_id)

    pickup_info: dict[str, Any] = {}
    pickup_error = None
    try:
        pickup_info = await _schedule_pickup(package_id)
    except Exception as e:
        pickup_error = str(e)[:300]
        logger.warning("pickup schedule failed: %s", e)

    patch = {
        "furgonetka_package_id": package_id,
        "broker_package_id": package_id,
        "broker_name": "furgonetka",
        "broker_label_ready": True,
        "shipment_status": shipment_status_for_state(state, fallback="preparing"),
        "order_status": order_status_for_state(state, fallback="awaiting_courier"),
        "tracking_state": state,
        "parcel_weight_kg": weight_kg,
        "courier_name": courier,
    }
    if tracking:
        patch["delivery_tracking"] = tracking
    if label_ref:
        patch["label_storage_path"] = label_ref
    if pickup_info.get("pickup_date"):
        patch["pickup_date"] = pickup_info["pickup_date"]
        patch["pickup_min_time"] = pickup_info.get("pickup_min_time")
        patch["pickup_max_time"] = pickup_info.get("pickup_max_time")
        patch["shipping_error"] = None
    if pickup_error:
        patch["shipping_error"] = f"Przesyłka zamówiona, podjazd: {pickup_error}"[:500]
    await _patch_order(client, sb_patch, oid, patch)

    return {
        "ok": True,
        "stub": False,
        "furgonetka_package_id": package_id,
        "package_id": package_id,
        "tracking": tracking,
        "ordered": True,
        "weight_kg": weight_kg,
        "parcels": parcels_full,
        "pickup": pickup_info,
        "pickup_error": pickup_error,
        "label_storage_path": label_ref,
        "courier_name": courier,
        "sandbox": _use_sandbox(),
        "api_base": api_base(),
        "prepaid_note": "Koszt etykiety ze skarbonki prepaid Furgonetka (konto platformy).",
    }

__all__ = ['_create_mock_shipment', '_create_new_shipment', '_finish_existing_package', '_load_order_products', 'create_furgonetka_shipment']
