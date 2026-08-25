from __future__ import annotations

from billing_stripe import _stripe_post
from typing import Any
from typing import Optional
import httpx
from ._p0 import logger




async def mark_producer_order_paid(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order_id: str,
    payment_intent_id: Optional[str] = None,
    checkout_session_id: Optional[str] = None,
    split_mode: Optional[str] = None,
) -> dict[str, Any]:
    """Ustaw payment_status=paid po udanym Checkout / webhooku."""
    rows = await sb_get(
        client,
        "producer_orders",
        params={"select": "*", "id": f"eq.{order_id}", "limit": "1"},
    )
    if not rows:
        raise RuntimeError(f"Nie znaleziono zamówienia {order_id}")
    order = rows[0]
    if str(order.get("payment_status") or "").lower() == "paid":
        return {"ok": True, "already_paid": True, "order": order}

    # destination = Connect już rozbił; transfer = zrobimy ręcznie poniżej
    settlement = "transferred" if split_mode == "destination" else "pending"
    patch: dict[str, Any] = {
        "payment_status": "paid",
        "order_status": "paid",
        "shipment_status": "confirmed",
        "settlement_status": settlement,
    }
    if payment_intent_id:
        patch["payment_intent"] = payment_intent_id
    try:
        await sb_patch(client, "producer_orders", {"id": f"eq.{order_id}"}, patch)
    except Exception as e:
        msg = str(e).lower()
        if "column" in msg or "schema" in msg or "check" in msg or "order_status" in msg:
            for candidate in (
                {"payment_status": "paid", "order_status": "confirmed", "shipment_status": "confirmed"},
                {"payment_status": "paid", "shipment_status": "confirmed"},
                {"payment_status": "paid"},
            ):
                try:
                    await sb_patch(client, "producer_orders", {"id": f"eq.{order_id}"}, candidate)
                    break
                except Exception:
                    continue
        else:
            raise
    refreshed = await sb_get(
        client,
        "producer_orders",
        params={"select": "*", "id": f"eq.{order_id}", "limit": "1"},
    )
    order = (refreshed or [order])[0]

    transfer_id = None
    # Tylko gdy NIE było destination charge — unikamy podwójnej wypłaty
    if split_mode != "destination":
        try:
            transfer_id = await _maybe_transfer_to_producer(
                client=client,
                sb_get=sb_get,
                sb_patch=sb_patch,
                order=order,
            )
        except Exception as e:
            logger.warning("Connect transfer skipped: %s", e)

    return {
        "ok": True,
        "already_paid": False,
        "order": order,
        "stripe_transfer_id": transfer_id,
        "checkout_session_id": checkout_session_id,
        "split_mode": split_mode,
    }


async def _maybe_transfer_to_producer(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order: dict[str, Any],
) -> Optional[str]:
    producer_id = order.get("producer_id")
    if not producer_id:
        return None
    rows = await sb_get(
        client,
        "local_producers",
        params={
            "select": "id,stripe_connect_id,stripe_account_id,payouts_enabled,stripe_onboarding_complete",
            "id": f"eq.{producer_id}",
            "limit": "1",
        },
    )
    if not rows:
        return None
    p = rows[0]
    from stripe_connect import producer_connect_id
    acct = producer_connect_id(p)
    if not acct:
        return None
    if p.get("payouts_enabled") is False:
        return None

    amount = float(order.get("producer_amount") or 0)
    if amount <= 0:
        amount = (
            float(order.get("total_price") or 0)
            - float(order.get("platform_fee") or 0)
            - float(order.get("delivery_cost") or order.get("shipping_cost") or 0)
        )
    grosze = int(round(max(amount, 0) * 100))
    if grosze <= 0:
        return None

    transfer = await _stripe_post(
        "/transfers",
        {
            "amount": grosze,
            "currency": "pln",
            "destination": acct,
            "transfer_group": str(order.get("id")),
            "metadata": {
                "order_id": str(order.get("id")),
                "kind": "local_producer_payout",
            },
        },
        idempotency_key=f"lp_transfer_{order.get('id')}",
    )
    tid = transfer.get("id")
    if tid:
        try:
            await sb_patch(
                client,
                "producer_orders",
                {"id": f"eq.{order['id']}"},
                {"stripe_transfer_id": tid, "settlement_status": "transferred"},
            )
        except Exception as e:
            logger.warning("patch stripe_transfer_id failed: %s", e)
    return tid

__all__ = ['_maybe_transfer_to_producer', 'mark_producer_order_paid']
