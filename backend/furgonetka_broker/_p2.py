from __future__ import annotations

from billing_stripe import _ssl_verify
from lp_tracking import latest_tracking_state
from lp_tracking import order_status_for_state
from lp_tracking import shipment_status_for_state
from lp_tracking import tracking_events_public
from pl_phone import humanize_courier_phone_error
from typing import Any
from typing import Optional
import asyncio
import httpx
import uuid
from ._p0 import ACCEPT_V1, ACCEPT_V2, _api, logger
from ._p1 import _patch_order, download_label_pdf



async def _poll_command(kind: str, cmd: str, *, rounds: int = 16) -> dict[str, Any]:
    last: dict[str, Any] = {}
    for _ in range(rounds):
        await asyncio.sleep(1.4)
        last = await _api("GET", f"/{kind}/{cmd}", accept=ACCEPT_V1) or {}
        st = str(last.get("status") or "")
        if st in ("successful", "partial_success"):
            return last
        if st == "error":
            errs = last.get("errors") or []
            err0 = errs[0] if errs else {}
            if isinstance(err0, dict):
                raise RuntimeError(
                    humanize_courier_phone_error(
                        str(err0.get("details") or err0.get("message") or f"{kind} error")
                    )
                )
            raise RuntimeError(humanize_courier_phone_error(f"{kind} error"))
    raise RuntimeError(f"{kind} timeout (status={last.get('status')})")


async def _ensure_regulations() -> None:
    try:
        data = await _api("GET", "/regulations", accept=ACCEPT_V1)
    except Exception as e:
        logger.info("GET /regulations: %s", e)
        return
    regs = (data or {}).get("regulations") if isinstance(data, dict) else data
    if not isinstance(regs, list):
        return
    pending = []
    for r in regs:
        if not isinstance(r, dict) or r.get("accepted"):
            continue
        pending.append({
            "service": r.get("service"),
            "version": r.get("version"),
            "datetime": r.get("datetime"),
            "accepted": True,
        })
    if not pending:
        return
    try:
        await _api("POST", "/regulations", json_body={"regulations": pending}, accept=ACCEPT_V1)
    except Exception:
        try:
            await _api("POST", "/regulations", json_body=pending, accept=ACCEPT_V1)
        except Exception as e:
            logger.warning("POST /regulations failed: %s", e)


def _extract_tracking(details: Optional[dict[str, Any]]) -> Optional[str]:
    if not details:
        return None
    tracking = details.get("tracking_number")
    if tracking:
        return str(tracking)
    parcels = details.get("parcels") or []
    if parcels and isinstance(parcels[0], dict):
        t = parcels[0].get("tracking_number")
        if t:
            return str(t)
    return None


async def _store_label_pdf(order_id: str, producer_id: str, package_id: str) -> Optional[str]:
    try:
        pdf = await download_label_pdf(package_id)
    except Exception as e:
        logger.info("label download skipped: %s", e)
        return None
    try:
        from lp_invoice_url import DEFAULT_DOCS_BUCKET, upload_private_bytes

        path = f"labels/{producer_id or 'unknown'}/{order_id}.pdf"
        return await upload_private_bytes(
            bucket=DEFAULT_DOCS_BUCKET,
            path=path,
            content=pdf,
            content_type="application/pdf",
            verify=_ssl_verify(),
        )
    except Exception as e:
        logger.info("label storage upload skipped: %s", e)
        return None


async def _schedule_pickup(package_id: str) -> dict[str, Any]:
    proposals_raw = await _api(
        "POST",
        "/packages/pickup-date-proposals",
        json_body={"packages": [{"id": package_id}]},
        accept=ACCEPT_V1,
    )
    packages = (proposals_raw or {}).get("packages") or []
    first = packages[0] if packages else {}
    proposals = first.get("proposals") or []
    chosen = next(
        (p for p in proposals if isinstance(p, dict) and p.get("available") is not False),
        None,
    )
    if not chosen:
        raise RuntimeError("Brak dostępnego terminu podjazdu kuriera")

    pickup_date = {
        "date": chosen.get("date"),
        "min_time": chosen.get("min_time"),
        "max_time": chosen.get("max_time"),
    }
    cmd = str(uuid.uuid4())
    await _api(
        "PUT",
        f"/pickup-commands/{cmd}",
        json_body={
            "packages": [{"id": package_id}],
            "pickup_date": pickup_date,
        },
        accept=ACCEPT_V1,
    )
    result = await _poll_command("pickup-commands", cmd)
    pickup_id = None
    details = result.get("pickup_details") or []
    if details and isinstance(details[0], dict):
        pickup_id = details[0].get("pickup_id")
    return {
        "pickup_date": pickup_date.get("date"),
        "pickup_min_time": pickup_date.get("min_time"),
        "pickup_max_time": pickup_date.get("max_time"),
        "pickup_id": pickup_id,
        "pickup_command": cmd,
    }


async def fetch_package_tracking(package_id: str) -> dict[str, Any]:
    payload = await _api("GET", f"/packages/{package_id}/tracking", accept=ACCEPT_V1)
    state = latest_tracking_state(payload)
    events = tracking_events_public(payload)
    return {"raw": payload, "state": state, "events": events}


async def sync_order_tracking(
    order_id: str,
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    package_id: Optional[str] = None,
) -> dict[str, Any]:
    oid = (order_id or "").strip()
    rows = await sb_get(client, "producer_orders", params={
        "select": "*", "id": f"eq.{oid}", "limit": "1",
    })
    if not rows:
        raise RuntimeError("Zamówienie nie istnieje")
    order = rows[0]
    pid = (package_id or order.get("furgonetka_package_id") or order.get("broker_package_id") or "").strip()
    if not pid:
        return {"ok": False, "error": "Brak przesyłki Furgonetka", "order": order}

    tracking = await fetch_package_tracking(pid)
    state = tracking.get("state")
    details = None
    tracking_no = order.get("delivery_tracking")
    courier = order.get("courier_name")
    try:
        details = await _api("GET", f"/packages/{pid}", accept=ACCEPT_V2)
        tracking_no = _extract_tracking(details) or tracking_no
        courier = (details or {}).get("service") or courier
        if not state:
            state = (details or {}).get("state")
    except Exception:
        pass

    from datetime import datetime, timezone

    patch = {
        "tracking_state": state,
        "tracking_synced_at": datetime.now(timezone.utc).isoformat(),
        "shipment_status": shipment_status_for_state(state, fallback=str(order.get("shipment_status") or "preparing")),
        "order_status": order_status_for_state(state, fallback=str(order.get("order_status") or "preparing")),
        "broker_name": "furgonetka",
    }
    if tracking_no:
        patch["delivery_tracking"] = str(tracking_no)
    if courier:
        patch["courier_name"] = str(courier)
    if state == "delivery-problem":
        patch["shipping_error"] = "Problem z doręczeniem — sprawdź tracking kuriera"
    elif state in ("delivered", "collected", "transit", "delivery", "ordered"):
        patch["shipping_error"] = None

    await _patch_order(client, sb_patch, oid, patch)
    new_ship = str(patch.get("shipment_status") or "")
    old_ship = str(order.get("shipment_status") or "")
    if new_ship == "shipped" and old_ship != "shipped":
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
            logger.exception("LP stock decrement on tracking shipped failed")
    warehouse = None
    if new_ship == "delivered" and old_ship != "delivered":
        try:
            from lp_receive import receive_producer_order_into_warehouse
            warehouse = await receive_producer_order_into_warehouse(
                client=client,
                sb_get=sb_get,
                sb_patch=sb_patch,
                order_id=oid,
                mark_delivered=True,
                source="furgonetka",
            )
        except Exception:
            logger.exception("LP warehouse receive on tracking delivered failed")
    return {
        "ok": True,
        "package_id": pid,
        "state": state,
        "shipment_status": patch["shipment_status"],
        "tracking": tracking_no,
        "courier_name": courier,
        "events": tracking.get("events") or [],
        "pickup_date": order.get("pickup_date"),
        "pickup_min_time": order.get("pickup_min_time"),
        "pickup_max_time": order.get("pickup_max_time"),
        "warehouse": warehouse,
    }

__all__ = ['_ensure_regulations', '_extract_tracking', '_poll_command', '_schedule_pickup', '_store_label_pdf', 'fetch_package_tracking', 'sync_order_tracking']
