"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `lp_shipping`."""
from __future__ import annotations

from fastapi import HTTPException
from fastapi import Request
from http_ssl import httpx_verify as _httpx_verify
from supabase_rest import sb_get
from supabase_rest import sb_patch
import httpx
import io
from app_core import SUPABASE_URL, get_account_key, logger, require_tenant_account_key
from lp_orders import _auth_user_id_from_request
from models import LpShipmentRequest



async def local_producers_mark_handed_to_courier(order_id: str, request: Request):
    """
    Panel dystrybutora: paczka przekazana kurierowi → shipment_status=shipped + push do restauracji.
    """
    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")
    uid = await _auth_user_id_from_request(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Wymagane logowanie dystrybutora")

    async with httpx.AsyncClient(timeout=45.0, verify=_httpx_verify()) as client:
        orders = await sb_get(client, "producer_orders", params={
            "select": "id,producer_id,restaurant_id,restaurant_account_key,payment_status,shipment_status,delivery_tracking",
            "id": f"eq.{oid}",
            "limit": "1",
        })
        if not orders:
            raise HTTPException(status_code=404, detail="Zamówienie nie istnieje")
        order = orders[0]
        producers = await sb_get(client, "local_producers", params={
            "select": "id,auth_user_id,company_name",
            "id": f"eq.{order.get('producer_id')}",
            "limit": "1",
        })
        if not producers:
            raise HTTPException(status_code=404, detail="Producent nie istnieje")
        producer = producers[0]
        if str(producer.get("auth_user_id") or "") != str(uid):
            raise HTTPException(status_code=403, detail="Tylko właściciel profilu dystrybutora")

        if str(order.get("payment_status") or "").lower() != "paid":
            raise HTTPException(status_code=400, detail="Zamówienie nie jest opłacone")

        already = str(order.get("shipment_status") or "").lower() == "shipped"
        if not already:
            await sb_patch(client, "producer_orders", {"id": f"eq.{oid}"}, {
                "shipment_status": "shipped",
                "order_status": "shipped",
            })
            try:
                from lp_stock import decrement_stock_for_shipped_order
                await decrement_stock_for_shipped_order(
                    client=client,
                    sb_get=sb_get,
                    sb_patch=sb_patch,
                    order_id=oid,
                    producer_id=str(order.get("producer_id") or ""),
                )
            except Exception:
                logger.exception("LP stock decrement on mark-handed failed")

            # VAT-RR auto document for flat-rate farmers
            try:
                producers_full = await sb_get(client, "local_producers", params={
                    "select": "id,auth_user_id,company_name,settlement_document_type,billing_type,tax_identifier,bank_account,address,city,postal_code,billing_city,billing_address,billing_zip,billing_first_name,billing_last_name,owner_name",
                    "id": f"eq.{order.get('producer_id')}",
                    "limit": "1",
                })
                prod_full = (producers_full or [producer])[0]
                orders_full = await sb_get(client, "producer_orders", params={
                    "select": "*",
                    "id": f"eq.{oid}",
                    "limit": "1",
                })
                order_full = (orders_full or [order])[0]
                from vat_rr_settlement import maybe_issue_vat_rr_after_ship
                vat_rr_result = await maybe_issue_vat_rr_after_ship(
                    client,
                    producer=prod_full,
                    order=order_full,
                    sb_get=sb_get,
                    sb_patch=sb_patch,
                )
                if not vat_rr_result.get("ok") and not vat_rr_result.get("skipped"):
                    logger.warning("VAT-RR after ship: %s", vat_rr_result.get("error"))
            except Exception:
                logger.exception("VAT-RR after mark-handed failed")

        tracking = (order.get("delivery_tracking") or "").strip()
        company = (producer.get("company_name") or "Lokalny przetwórca").strip()
        eta = "Zwykle doręczenie w 1–2 dni robocze."
        body = (
            f"{company}: kurier jest już w drodze. {eta}"
            + (f" Numer przesyłki: {tracking}." if tracking else "")
        )
        pushed = 0
        restaurant_id = (order.get("restaurant_id") or "").strip()
        if restaurant_id:
            try:
                tokens = await sb_get(client, "device_push_tokens", params={
                    "select": "token",
                    "user_id": f"eq.{restaurant_id}",
                    "limit": "50",
                }) or []
                msgs = []
                for t in tokens:
                    tok = str(t.get("token") or "").strip()
                    if tok:
                        msgs.append({
                            "to": tok,
                            "title": "Kurier w drodze",
                            "body": body[:180],
                            "sound": "default",
                            "data": {"type": "lp_shipment", "order_id": oid},
                        })
                for i in range(0, len(msgs), 80):
                    chunk = msgs[i:i + 80]
                    if not chunk:
                        continue
                    await client.post(
                        "https://exp.host/--/api/v2/push/send",
                        json=chunk,
                        headers={"Accept": "application/json", "Content-Type": "application/json"},
                        timeout=30.0,
                    )
                    pushed += len(chunk)
            except Exception:
                logger.exception("LP mark-handed push failed")

    return {
        "ok": True,
        "shipment_status": "shipped",
        "already": already,
        "pushed": pushed,
        "message": body,
    }


async def local_producers_mark_received(order_id: str):
    """
    Restauracja: „Odebrałem paczkę” → delivered + produkty do magazynu + koszt zmienny.
    Idempotentne (warehouse_received_at / tag w notes).
    """
    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")
    account_key = require_tenant_account_key()

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        orders = await sb_get(client, "producer_orders", params={
            "select": (
                "id,restaurant_account_key,payment_status,shipment_status,"
                "notes,warehouse_received_at"
            ),
            "id": f"eq.{oid}",
            "limit": "1",
        })
        if not orders:
            orders = await sb_get(client, "producer_orders", params={
                "select": "id,restaurant_account_key,payment_status,shipment_status,notes",
                "id": f"eq.{oid}",
                "limit": "1",
            })
        if not orders:
            raise HTTPException(status_code=404, detail="Zamówienie nie istnieje")
        order = orders[0]
        if str(order.get("restaurant_account_key") or "") != account_key:
            raise HTTPException(status_code=403, detail="To zamówienie należy do innego konta")
        if str(order.get("payment_status") or "").lower() != "paid":
            raise HTTPException(status_code=400, detail="Zamówienie nie jest opłacone")

        from lp_receive import receive_producer_order_into_warehouse

        result = await receive_producer_order_into_warehouse(
            client=client,
            sb_get=sb_get,
            sb_patch=sb_patch,
            order_id=oid,
            mark_delivered=True,
            source="manual",
        )
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("error") or "Nie udało się przyjąć paczki")
        return {
            **result,
            "message": result.get("message") or (
                "Paczka już była przyjęta wcześniej."
                if result.get("already")
                else (
                    f"Przyjęto {result.get('received', 0)} poz. do magazynu "
                    f"i dopisano koszt zmienny ({result.get('total_pln', 0)} zł)."
                )
            ),
        }


async def local_producers_create_shipment(req: LpShipmentRequest):
    """Ręczne utworzenie przesyłki przez Furgonetkę (InPost Kurier) po paid."""
    from furgonetka_broker import create_furgonetka_shipment, furgonetka_configured
    from local_producers_commerce import create_inpost_shipment, parse_lp_ship_from_notes

    order_id = (req.order_id or "").strip()
    if not order_id:
        raise HTTPException(status_code=400, detail="Brak order_id")
    account_key = require_tenant_account_key()

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        orders = await sb_get(client, "producer_orders", params={
            "select": "*", "id": f"eq.{order_id}", "limit": "1",
        })
        if not orders:
            raise HTTPException(status_code=404, detail="Zamówienie nie istnieje")
        order = orders[0]
        if order.get("restaurant_account_key") and order.get("restaurant_account_key") != account_key:
            raise HTTPException(status_code=403, detail="To zamówienie należy do innego konta")
        if str(order.get("payment_status") or "").lower() != "paid":
            raise HTTPException(status_code=400, detail="Najpierw opłać zamówienie")

        producers = await sb_get(client, "local_producers", params={
            "select": "*", "id": f"eq.{order.get('producer_id')}", "limit": "1",
        })
        producer = (producers or [{}])[0]
        ship = parse_lp_ship_from_notes(order.get("notes")) or {}
        receiver = {
            "name": req.receiver_name or ship.get("name") or "Restauracja",
            "email": req.receiver_email or ship.get("email") or "orders@gastromanager.app",
            "phone": req.receiver_phone or ship.get("phone") or "500600700",
            "address": {
                "street": req.street or ship.get("street") or "ul. Restauracyjna",
                "building_number": req.building_number or ship.get("building_number") or "1",
                "city": req.city or ship.get("city") or "Warszawa",
                "post_code": req.post_code or ship.get("post_code") or "00-001",
            },
        }
        try:
            if furgonetka_configured():
                result = await create_furgonetka_shipment(
                    order_id,
                    client=client,
                    sb_get=sb_get,
                    sb_patch=sb_patch,
                )
            else:
                result = await create_inpost_shipment(
                    client=client,
                    sb_get=sb_get,
                    sb_patch=sb_patch,
                    order=order,
                    producer=producer,
                    receiver=receiver,
                )
        except Exception as e:
            logger.exception("LP create-shipment failed")
            raise HTTPException(status_code=502, detail=str(e)[:300])
    return result


async def _lp_order_for_actor(client, order_id: str, request: Request) -> dict:
    """Zamówienie LP + flaga is_owner / is_restaurant. 403 gdy brak dostępu."""
    uid = await _auth_user_id_from_request(request)
    account_key = get_account_key()
    orders = await sb_get(client, "producer_orders", params={
        "select": "*", "id": f"eq.{order_id}", "limit": "1",
    })
    if not orders:
        raise HTTPException(status_code=404, detail="Zamówienie nie istnieje")
    order = orders[0]
    producers = await sb_get(client, "local_producers", params={
        "select": "id,auth_user_id",
        "id": f"eq.{order.get('producer_id')}",
        "limit": "1",
    })
    owner = ((producers or [{}])[0].get("auth_user_id") or "").strip()
    is_owner = bool(uid and owner and uid == owner)
    is_restaurant = bool(
        order.get("restaurant_account_key")
        and order.get("restaurant_account_key") == account_key
        and account_key != "default"
    )
    if not (is_owner or is_restaurant):
        raise HTTPException(status_code=403, detail="Brak dostępu do tego zamówienia")
    return {"order": order, "is_owner": is_owner, "is_restaurant": is_restaurant}


async def producer_order_shipping(order_id: str, request: Request):
    """Status kuriera + opcjonalne odświeżenie trackingu Furgonetka."""
    from datetime import datetime, timezone, timedelta
    from furgonetka_broker import furgonetka_configured, sync_order_tracking
    from lp_tracking import timeline_index

    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")

    refresh = request.method == "POST" or (request.query_params.get("refresh") or "").lower() in (
        "1", "true", "yes",
    )

    async with httpx.AsyncClient(timeout=45.0, verify=_httpx_verify()) as client:
        acc = await _lp_order_for_actor(client, oid, request)
        order = acc["order"]
        synced = None
        pid = (order.get("furgonetka_package_id") or order.get("broker_package_id") or "").strip()
        last = order.get("tracking_synced_at")
        stale = True
        if last:
            try:
                ts = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                stale = datetime.now(timezone.utc) - ts > timedelta(minutes=12)
            except Exception:
                stale = True
        if refresh or (pid and furgonetka_configured() and stale):
            try:
                synced = await sync_order_tracking(
                    oid, client=client, sb_get=sb_get, sb_patch=sb_patch, package_id=pid or None,
                )
                if synced.get("ok"):
                    order = {**order, **{
                        k: synced[k] for k in (
                            "shipment_status", "tracking", "courier_name",
                        ) if k in synced
                    }}
                    order["delivery_tracking"] = synced.get("tracking") or order.get("delivery_tracking")
                    order["tracking_state"] = synced.get("state") or order.get("tracking_state")
            except Exception as e:
                logger.warning("LP tracking sync: %s", e)

    pickup_date = order.get("pickup_date")
    pickup_min = order.get("pickup_min_time")
    pickup_max = order.get("pickup_max_time")
    pickup_label = None
    if pickup_date:
        window = "–".join(x for x in (pickup_min, pickup_max) if x)
        pickup_label = f"{pickup_date}" + (f" {window}" if window else "")

    return {
        "ok": True,
        "order_id": oid,
        "package_id": pid or None,
        "courier_name": order.get("courier_name") or "inpost",
        "tracking": order.get("delivery_tracking"),
        "tracking_state": order.get("tracking_state"),
        "shipment_status": order.get("shipment_status"),
        "order_status": order.get("order_status"),
        "pickup_date": pickup_date,
        "pickup_min_time": pickup_min,
        "pickup_max_time": pickup_max,
        "pickup_label": pickup_label,
        "parcel_weight_kg": order.get("parcel_weight_kg"),
        "shipping_error": order.get("shipping_error"),
        "label_ready": bool(order.get("broker_label_ready") or order.get("label_storage_path")),
        "timeline_index": timeline_index(
            order.get("tracking_state"),
            has_pickup=bool(pickup_date),
        ),
        "events": (synced or {}).get("events") or [],
        "refreshed": bool(synced and synced.get("ok")),
    }


async def producer_order_retry_shipment(order_id: str, request: Request):
    """Ponów utworzenie / dokończenie przesyłki (bez duplikatu gdy package_id już jest)."""
    from furgonetka_broker import create_furgonetka_shipment, furgonetka_configured

    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")
    if not furgonetka_configured():
        raise HTTPException(status_code=503, detail="Furgonetka nie skonfigurowana")

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        acc = await _lp_order_for_actor(client, oid, request)
        order = acc["order"]
        if str(order.get("payment_status") or "").lower() != "paid":
            raise HTTPException(status_code=400, detail="Zamówienie nie jest opłacone")
        result = await create_furgonetka_shipment(
            oid, client=client, sb_get=sb_get, sb_patch=sb_patch,
        )
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error") or "Nie udało się zlecić przesyłki")
    return result


async def producer_order_invoice_url(order_id: str, request: Request):
    """
    Podpisany HTTPS URL do faktury.
    WWW zapisuje invoice_url jako ``producer-documents:path`` (prywatny Storage).
    """
    from lp_invoice_url import resolve_order_invoice_url

    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")

    uid = await _auth_user_id_from_request(request)
    account_key = get_account_key()

    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        order = None
        last_err = None
        for select in (
            "id,producer_id,restaurant_account_key,restaurant_id,invoice_url,settlement_invoice_url,invoice_file_url",
            "id,producer_id,restaurant_account_key,restaurant_id,invoice_url",
            "id,producer_id,restaurant_account_key,invoice_url",
            "*",
        ):
            try:
                orders = await sb_get(client, "producer_orders", params={
                    "select": select,
                    "id": f"eq.{oid}",
                    "limit": "1",
                })
                if orders:
                    order = orders[0]
                    break
            except Exception as e:
                last_err = e
                continue
        if not order:
            logger.warning("LP invoice order fetch failed: %s", last_err)
            raise HTTPException(status_code=404, detail="Zamówienie nie istnieje")

        producers = []
        try:
            producers = await sb_get(client, "local_producers", params={
                "select": "id,auth_user_id",
                "id": f"eq.{order.get('producer_id')}",
                "limit": "1",
            })
        except Exception:
            producers = []
        owner = ((producers or [{}])[0].get("auth_user_id") or "").strip()
        is_owner = bool(uid and owner and uid == owner)
        is_restaurant = bool(
            (
                order.get("restaurant_account_key")
                and order.get("restaurant_account_key") == account_key
                and account_key != "default"
            )
            or (uid and order.get("restaurant_id") and str(order.get("restaurant_id")) == str(uid))
        )
        if not (is_owner or is_restaurant):
            raise HTTPException(status_code=403, detail="Brak dostępu do faktury tego zamówienia")

        try:
            url = await resolve_order_invoice_url(
                order, client=client, verify=_httpx_verify(), expires_in=3600,
            )
        except Exception as e:
            logger.exception("LP invoice signed URL failed")
            raise HTTPException(
                status_code=502,
                detail=f"Nie udało się otworzyć faktury: {str(e)[:240]}",
            ) from e

    if not url:
        raise HTTPException(status_code=404, detail="Brak faktury dla tego zamówienia")
    return {"ok": True, "url": url, "expires_in": 3600}


async def producer_order_invoice_file(order_id: str, request: Request):
    """
    Rachunek / faktura PDF — tylko dokument wgrany przez dystrybutora.
    """
    from fastapi.responses import StreamingResponse
    from lp_invoice_pdf import fetch_stored_invoice_bytes

    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        acc = await _lp_order_for_actor(client, oid, request)
        order = acc["order"]

        stored = await fetch_stored_invoice_bytes(
            order, client=client, verify=_httpx_verify(),
        )
        if stored:
            body, ctype = stored
            ext = "pdf"
            if ctype == "application/pdf" or body[:4] == b"%PDF":
                ext = "pdf"
                ctype = "application/pdf"
            elif "jpeg" in ctype or "jpg" in ctype:
                ext = "jpg"
            elif "png" in ctype:
                ext = "png"
            filename = f"rachunek-{oid[:8]}.{ext}"
            return StreamingResponse(
                io.BytesIO(body),
                media_type=ctype,
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Cache-Control": "no-store",
                },
            )

        raise HTTPException(
            status_code=404,
            detail="Dystrybutor nie wgrał jeszcze rachunku dla tego zamówienia.",
        )


async def producer_order_furgonetka_label(order_id: str, request: Request):
    """
    Etykieta PDF — najpierw prywatny Storage, potem Furgonetka API.
    """
    import io
    from fastapi.responses import StreamingResponse
    from furgonetka_broker import download_label_pdf, furgonetka_configured
    from lp_invoice_url import parse_invoice_storage_ref

    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        acc = await _lp_order_for_actor(client, oid, request)
        order = acc["order"]
        package_id = (
            (order.get("furgonetka_package_id") or order.get("broker_package_id") or "")
        ).strip()
        label_ref = (order.get("label_storage_path") or "").strip()

        pdf = None
        if label_ref:
            parsed = parse_invoice_storage_ref(label_ref)
            if parsed and parsed.get("kind") == "storage":
                try:
                    from lp_invoice_url import create_storage_signed_url
                    signed = await create_storage_signed_url(
                        bucket=parsed["bucket"],
                        path=parsed["path"],
                        expires_in=120,
                        client=client,
                        verify=_httpx_verify(),
                    )
                    from url_safety import assert_supabase_fetch_url
                    signed = assert_supabase_fetch_url(signed, SUPABASE_URL)
                    r = await client.get(signed)
                    if r.status_code < 400 and r.content:
                        pdf = r.content
                except Exception as e:
                    logger.info("label from storage failed: %s", e)

        if pdf is None:
            if not package_id:
                raise HTTPException(
                    status_code=404,
                    detail="Etykieta jeszcze niegotowa — poczekaj na zlecenie kuriera po płatności.",
                )
            if not furgonetka_configured():
                raise HTTPException(status_code=503, detail="Furgonetka nie skonfigurowana")
            try:
                pdf = await download_label_pdf(package_id)
            except Exception as e:
                raise HTTPException(status_code=502, detail=str(e)[:300])

        try:
            await sb_patch(client, "producer_orders", {"id": f"eq.{oid}"}, {
                "broker_label_ready": True,
            })
        except Exception:
            pass

    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="etykieta-{oid[:8]}.pdf"',
        },
    )

__all__ = ['_lp_order_for_actor', 'local_producers_create_shipment', 'local_producers_mark_handed_to_courier', 'local_producers_mark_received', 'producer_order_furgonetka_label', 'producer_order_invoice_file', 'producer_order_invoice_url', 'producer_order_retry_shipment', 'producer_order_shipping']
