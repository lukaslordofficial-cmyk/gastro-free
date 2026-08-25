from __future__ import annotations

from typing import Any
import httpx
from ._p0 import logger
from ._p2 import mark_producer_order_paid



async def apply_paid_producer_checkout_session(
    session: dict[str, Any],
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    sb_post=None,
    defer_fulfillment: bool = False,
) -> dict[str, Any]:
    """Obsługa opłaconej sesji Checkout (confirm-session lub webhook).

    ``defer_fulfillment=True`` — po oznaczeniu paid od razu wraca do apki;
    Furgonetka + e-mail/SMS lecą w tle (szybszy komunikat „Opłacono”).
    """
    meta = dict(session.get("metadata") or {})
    if meta.get("kind") != "local_producer_order":
        return {"ok": False, "paid": False, "reason": "not_lp_order"}

    payment_status = (session.get("payment_status") or "").lower()
    if payment_status not in ("paid", "no_payment_required"):
        return {"ok": False, "paid": False, "reason": "not_paid", "payment_status": payment_status}

    order_id = meta.get("order_id")
    if not order_id:
        return {"ok": False, "paid": False, "reason": "missing_order_id"}

    pi = session.get("payment_intent")
    if isinstance(pi, dict):
        pi = pi.get("id")

    split_mode = meta.get("split_mode") or "platform_hold"

    paid = await mark_producer_order_paid(
        client=client,
        sb_get=sb_get,
        sb_patch=sb_patch,
        order_id=order_id,
        payment_intent_id=str(pi) if pi else None,
        checkout_session_id=session.get("id"),
        split_mode=split_mode,
    )

    shipment = None
    notify = None
    order = paid.get("order") or {}
    prod_rows = await sb_get(
        client,
        "local_producers",
        params={"select": "*", "id": f"eq.{order.get('producer_id')}", "limit": "1"},
    )
    producer = (prod_rows or [{}])[0]
    account_key = meta.get("account_key") or order.get("restaurant_account_key")

    async def _run_notify(http: httpx.AsyncClient) -> Any:
        try:
            from lp_paid_notifications import notify_distributor_order_paid

            return await notify_distributor_order_paid(
                client=http,
                sb_get=sb_get,
                sb_patch=sb_patch,
                sb_post=sb_post,
                order=order,
                producer=producer,
            )
        except Exception as e:
            logger.exception("LP paid notify failed")
            return {"ok": False, "error": str(e)[:300]}

    async def _run_fulfillment(http: httpx.AsyncClient) -> tuple[Any, Any]:
        # Kurier dopiero gdy przetwórca kliknie „gotowe” w panelu WWW.
        notify_res = await _run_notify(http)
        return {"ok": True, "deferred_until_ready": True}, notify_res

    # Powiadom dystrybutora po paid; przesyłkę zleca panel („Oznacz jako gotowe”).
    if not paid.get("already_paid"):
        if defer_fulfillment:
            import asyncio

            async def _bg() -> None:
                try:
                    async with httpx.AsyncClient(timeout=90.0) as bg_client:
                        await _run_fulfillment(bg_client)
                except Exception:
                    logger.exception("LP deferred fulfillment crashed")

            asyncio.create_task(_bg())
            shipment = {"ok": True, "deferred": True}
            notify = {"ok": True, "deferred": True}
        else:
            shipment, notify = await _run_fulfillment(client)
    else:
        # Webhook / drugie confirm — dociągnij e-mail jeśli jeszcze nie poszedł.
        if defer_fulfillment:
            import asyncio

            async def _bg_notify() -> None:
                try:
                    async with httpx.AsyncClient(timeout=45.0) as bg_client:
                        await _run_notify(bg_client)
                except Exception:
                    logger.exception("LP deferred notify crashed")

            asyncio.create_task(_bg_notify())
            notify = {"ok": True, "deferred": True}
        else:
            notify = await _run_notify(client)

    vat_rr = None
    try:
        from vat_rr_settlement import maybe_issue_vat_rr_after_pay

        vat_rr = await maybe_issue_vat_rr_after_pay(
            client,
            producer=producer,
            order=order,
            sb_get=sb_get,
            sb_patch=sb_patch,
        )
    except Exception as e:
        logger.exception("VAT RR after pay failed")
        vat_rr = {"ok": False, "error": str(e)[:300]}

    return {
        "ok": True,
        "paid": True,
        "kind": "local_producer_order",
        **paid,
        "shipment": shipment,
        "notify": notify,
        "vat_rr": vat_rr,
        "settlement": {
            "producer": meta.get("producer_amount"),
            "platform_fee_5pct": meta.get("platform_fee"),
            "courier_broker": meta.get("delivery_cost"),
            "split_mode": split_mode,
        },
    }

__all__ = ['apply_paid_producer_checkout_session']
