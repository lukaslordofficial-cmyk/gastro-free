from __future__ import annotations

from billing_stripe import _stripe_post
from billing_stripe import stripe_configured
from typing import Any
from typing import Optional
from ._p0 import _pln_to_grosze, courier_line_item_name, logger



async def create_producer_order_checkout(
    *,
    order: dict[str, Any],
    producer: dict[str, Any],
    account_key: str,
    customer_email: Optional[str],
    success_url: str,
    cancel_url: str,
    idempotency_key: Optional[str] = None,
) -> dict[str, Any]:
    """
    Stripe Checkout — 3 pozycje: produkty, wybrany kurier, opłata serwisu 5%.
    Przy Connect: destination charge → producent dostaje produkty,
    platforma application_fee = 5% + kurier (kurier na InPost przez ShipX).
    """
    if not stripe_configured():
        raise RuntimeError("Brak STRIPE_SECRET_KEY")

    total = float(order.get("total_price") or 0)
    if total <= 0:
        raise ValueError("Kwota zamówienia musi być > 0")

    order_id = str(order["id"])
    producer_id = str(order.get("producer_id") or producer.get("id") or "")
    company = (producer.get("company_name") or "Lokalny producent").strip()[:120]

    producer_amount = float(order.get("producer_amount") or 0)
    platform_fee = float(order.get("platform_fee") or 0)
    delivery_cost = float(order.get("delivery_cost") or order.get("shipping_cost") or 0)

    # Fallback gdy brak kolumn WWW
    if producer_amount <= 0:
        producer_amount = max(total - platform_fee - delivery_cost, 0)
    if platform_fee <= 0 and producer_amount > 0:
        platform_fee = round(producer_amount * 0.05, 2)

    prod_g = _pln_to_grosze(producer_amount)
    fee_g = _pln_to_grosze(platform_fee)
    del_g = _pln_to_grosze(delivery_cost)
    # Upewnij się, że suma line_items = total (korekta groszy na produktach)
    total_g = _pln_to_grosze(total)
    parts_sum = prod_g + fee_g + del_g
    if parts_sum != total_g and prod_g > 0:
        prod_g = max(total_g - fee_g - del_g, 0)

    if prod_g + fee_g + del_g <= 0:
        raise ValueError("Kwota zamówienia musi być > 0")

    line_items: list[dict[str, Any]] = []
    if prod_g > 0:
        line_items.append({
            "quantity": 1,
            "price_data": {
                "currency": "pln",
                "unit_amount": prod_g,
                "product_data": {
                    "name": f"Produkty — {company}",
                    "description": f"Lokalni Przetwórcy · zamówienie {order_id[:8]}",
                },
            },
        })
    if del_g > 0:
        line_items.append({
            "quantity": 1,
            "price_data": {
                "currency": "pln",
                "unit_amount": del_g,
                "product_data": {
                    "name": courier_line_item_name(order),
                    "description": "Dostawa od producenta do restauracji",
                },
            },
        })
    if fee_g > 0:
        line_items.append({
            "quantity": 1,
            "price_data": {
                "currency": "pln",
                "unit_amount": fee_g,
                "product_data": {
                    "name": "Opłata serwisu platformy (5%)",
                    "description": "Prowizja Gastro Manager",
                },
            },
        })
    # Edge: samo total bez rozbicia
    if not line_items:
        line_items.append({
            "quantity": 1,
            "price_data": {
                "currency": "pln",
                "unit_amount": total_g,
                "product_data": {"name": f"Zamówienie od {company}"},
            },
        })

    # Marketplace: Destination Charges — cała kwota Checkout trafia na platformę,
    # transfer_data.destination od razu zasila saldo Connect dystrybutora (produkty),
    # application_fee_amount = 5% + kurier zostaje na platformie.
    # Dystrybutor NIE klika wypłaty: settings.payouts.schedule.interval=daily.
    from stripe_connect import (
        assert_destination_charge_ready,
        distributor_inactive_message,
        is_insufficient_capabilities_error,
        producer_connect_id,
    )

    connect_acct = producer_connect_id(producer)
    if not connect_acct.startswith("acct_"):
        raise ValueError(
            "Dystrybutor nie połączył konta Stripe Connect. "
            "Onboarding: POST /api/stripe/connect (panel WWW)."
        )
    if prod_g <= 0:
        raise ValueError("Kwota produktów musi być > 0")

    try:
        ready = await assert_destination_charge_ready(connect_acct)
    except ValueError:
        raise
    except Exception as e:
        if is_insufficient_capabilities_error(e):
            raise ValueError(
                distributor_inactive_message(account_id=connect_acct, detail=str(e)[:120])
            ) from e
        raise

    logger.info(
        "LP checkout Connect ready acct=%s transfers=%s card_payments=%s",
        ready.get("account_id"),
        ready.get("transfers"),
        ready.get("card_payments"),
    )

    split_mode = "destination"
    # Destination charge: connected account dostaje (charge − application_fee) = produkty.
    application_fee = fee_g + del_g

    meta = {
        "kind": "local_producer_order",
        "order_id": order_id,
        "account_key": account_key,
        "producer_id": producer_id,
        "with_courier": "1",
        "producer_amount": str(producer_amount),
        "platform_fee": str(platform_fee),
        "delivery_cost": str(delivery_cost),
        "split_mode": split_mode,
        "stripe_connect_id": connect_acct,
        "payout_schedule": "daily",
    }

    payment_intent_data: dict[str, Any] = {
        "metadata": meta,
        # Bez transfer_data.amount → Stripe przekazuje całość minus application_fee.
        "transfer_data": {"destination": connect_acct},
    }
    if application_fee > 0:
        payment_intent_data["application_fee_amount"] = application_fee

    payment_methods = ["card", "blik"]
    payload: dict[str, Any] = {
        "mode": "payment",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": account_key[:200],
        "payment_method_types": payment_methods,
        "line_items": line_items,
        "metadata": meta,
        "payment_intent_data": payment_intent_data,
        "locale": "pl",
    }
    if customer_email:
        payload["customer_email"] = customer_email

    try:
        session = await _stripe_post(
            "/checkout/sessions", payload, idempotency_key=idempotency_key,
        )
    except RuntimeError as e:
        if is_insufficient_capabilities_error(e):
            raise ValueError(
                distributor_inactive_message(account_id=connect_acct, detail=str(e)[:120])
            ) from e
        msg = str(e)
        blik_related = "blik" in msg.lower() or "payment_method_types" in msg.lower()
        if blik_related and "blik" in payment_methods:
            logger.warning("LP Checkout retry card-only after Stripe error: %s", msg[:240])
            payload = dict(payload)
            payload["payment_method_types"] = ["card"]
            retry_key = f"{idempotency_key}_card" if idempotency_key else None
            try:
                session = await _stripe_post(
                    "/checkout/sessions", payload, idempotency_key=retry_key,
                )
            except RuntimeError as e2:
                if is_insufficient_capabilities_error(e2):
                    raise ValueError(
                        distributor_inactive_message(
                            account_id=connect_acct, detail=str(e2)[:120],
                        )
                    ) from e2
                raise
        else:
            raise
    return {
        "id": session["id"],
        "url": session["url"],
        "amount_total": total_g,
        "metadata": meta,
        "order_id": order_id,
        "split_mode": split_mode,
        "stripe_connect_id": connect_acct,
        "line_breakdown": {
            "products_grosze": prod_g,
            "courier_grosze": del_g,
            "platform_fee_grosze": fee_g,
            "application_fee_grosze": application_fee,
            "transfer_to_distributor_grosze": prod_g,
        },
        "connect_ready": ready,
    }

__all__ = ['create_producer_order_checkout']
