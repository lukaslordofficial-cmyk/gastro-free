"""
Marketplace Lokalni Przetwórcy — Stripe Checkout (BLIK + karta) + InPost ShipX.
Bez nowych zależności: httpx + istniejący billing_stripe.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

from billing_stripe import (
    _secret,
    _ssl_verify,
    _stripe_post,
    retrieve_checkout_session,
    stripe_configured,
)

logger = logging.getLogger("local_producers.commerce")

INPOST_SANDBOX = "https://sandbox-api-shipx-pl.easypack24.net"
INPOST_PROD = "https://api-shipx-pl.easypack24.net"


def inpost_configured() -> bool:
    return bool(
        (os.getenv("INPOST_API_TOKEN") or "").strip()
        and (os.getenv("INPOST_ORGANIZATION_ID") or "").strip()
    )


def _inpost_base() -> str:
    custom = (os.getenv("INPOST_API_URL") or "").strip().rstrip("/")
    if custom:
        return custom
    if (os.getenv("INPOST_SANDBOX") or "").strip().lower() in ("1", "true", "yes"):
        return INPOST_SANDBOX
    return INPOST_PROD


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
    """Stripe Checkout Session — payment mode, card + BLIK, kwota z zamówienia."""
    if not stripe_configured():
        raise RuntimeError("Brak STRIPE_SECRET_KEY")

    total = float(order.get("total_price") or 0)
    if total <= 0:
        raise ValueError("Kwota zamówienia musi być > 0")

    amount_grosze = int(round(total * 100))
    order_id = str(order["id"])
    producer_id = str(order.get("producer_id") or producer.get("id") or "")
    company = (producer.get("company_name") or "Lokalny producent").strip()[:120]
    with_courier = "1" if float(order.get("delivery_cost") or order.get("shipping_cost") or 0) > 0 else "0"
    # Heurystyka: notes zawierają „kuriersk” albo delivery > 0
    notes = (order.get("notes") or "").lower()
    if "kurier" in notes:
        with_courier = "1"

    meta = {
        "kind": "local_producer_order",
        "order_id": order_id,
        "account_key": account_key,
        "producer_id": producer_id,
        "with_courier": with_courier,
        "producer_amount": str(order.get("producer_amount") or 0),
        "platform_fee": str(order.get("platform_fee") or 0),
        "delivery_cost": str(order.get("delivery_cost") or order.get("shipping_cost") or 0),
    }

    payload: dict[str, Any] = {
        "mode": "payment",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": account_key[:200],
        "payment_method_types": ["card", "blik"],
        "line_items": [
            {
                "quantity": 1,
                "price_data": {
                    "currency": "pln",
                    "unit_amount": amount_grosze,
                    "product_data": {
                        "name": f"Zamówienie od {company}",
                        "description": f"Lokalni Przetwórcy · {order_id[:8]}",
                    },
                },
            }
        ],
        "metadata": meta,
        "payment_intent_data": {"metadata": meta},
        "locale": "pl",
    }
    if customer_email:
        payload["customer_email"] = customer_email

    session = await _stripe_post("/checkout/sessions", payload, idempotency_key=idempotency_key)
    return {
        "id": session["id"],
        "url": session["url"],
        "amount_total": amount_grosze,
        "metadata": meta,
        "order_id": order_id,
    }


async def mark_producer_order_paid(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order_id: str,
    payment_intent_id: Optional[str] = None,
    checkout_session_id: Optional[str] = None,
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

    patch: dict[str, Any] = {
        "payment_status": "paid",
        "order_status": "paid",
        "shipment_status": "confirmed",
        "settlement_status": "pending",
    }
    if payment_intent_id:
        patch["payment_intent"] = payment_intent_id
    # Kolumny / CHECK mogą różnić się między migracjami WWW — degraduj payload
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

    # Transfer Connect (opcjonalnie)
    transfer_id = None
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
        params={"select": "id,stripe_account_id,payouts_enabled,stripe_onboarding_complete", "id": f"eq.{producer_id}", "limit": "1"},
    )
    if not rows:
        return None
    p = rows[0]
    acct = (p.get("stripe_account_id") or "").strip()
    if not acct:
        return None
    if p.get("payouts_enabled") is False:
        return None

    amount = float(order.get("producer_amount") or 0)
    if amount <= 0:
        # fallback: total - fee - delivery
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


async def create_inpost_shipment(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order: dict[str, Any],
    producer: dict[str, Any],
    receiver: dict[str, Any],
) -> dict[str, Any]:
    """
    Tworzy przesyłkę InPost ShipX (kurier).
    receiver: name, email, phone, address{street, building_number, city, post_code}
    """
    if not inpost_configured():
        # Soft stub — zamówienie zostaje paid, status preparing
        try:
            await sb_patch(
                client,
                "producer_orders",
                {"id": f"eq.{order['id']}"},
                {
                    "shipment_status": "preparing",
                    "order_status": "processing",
                    "notes": ((order.get("notes") or "") + " | InPost: brak tokenu — etykieta później").strip(" |"),
                },
            )
        except Exception:
            pass
        return {
            "ok": True,
            "stub": True,
            "message": "INPOST_API_TOKEN / INPOST_ORGANIZATION_ID nie ustawione — przesyłka oznaczona jako preparing (stub).",
        }

    token = (os.getenv("INPOST_API_TOKEN") or "").strip()
    org_id = (os.getenv("INPOST_ORGANIZATION_ID") or "").strip()
    service = (os.getenv("INPOST_SERVICE") or "inpost_courier_standard").strip()

    addr = receiver.get("address") or {}
    body = {
        "receiver": {
            "name": receiver.get("name") or "Restauracja",
            "email": receiver.get("email") or "orders@example.com",
            "phone": receiver.get("phone") or "500600700",
            "address": {
                "street": addr.get("street") or producer.get("address") or "ul. Przykładowa",
                "building_number": addr.get("building_number") or "1",
                "city": addr.get("city") or producer.get("city") or "Warszawa",
                "post_code": addr.get("post_code") or producer.get("postal_code") or "00-001",
                "country_code": "PL",
            },
        },
        "sender": {
            "name": producer.get("company_name") or "Producent",
            "email": producer.get("email") or "producer@example.com",
            "phone": producer.get("phone") or "500600700",
            "address": {
                "street": (producer.get("address") or "ul. Producenta")[:60],
                "building_number": "1",
                "city": producer.get("city") or "Warszawa",
                "post_code": producer.get("postal_code") or "00-001",
                "country_code": "PL",
            },
        },
        "parcels": [
            {
                "dimensions": {
                    "length": "30",
                    "width": "20",
                    "height": "20",
                    "unit": "cm",
                },
                "weight": {"amount": "2", "unit": "kg"},
            }
        ],
        "service": service,
        "reference": str(order.get("id"))[:40],
        "comments": f"Gastro LP {str(order.get('id'))[:8]}",
    }

    url = f"{_inpost_base()}/v1/organizations/{org_id}/shipments"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=45.0, verify=_ssl_verify()) as http:
        r = await http.post(url, json=body, headers=headers)
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            msg = data.get("message") or data.get("error") or r.text[:300]
            raise RuntimeError(f"InPost {r.status_code}: {msg}")

    tracking = None
    if isinstance(data, dict):
        tracking = data.get("tracking_number")
        parcels = data.get("parcels")
        if not tracking and isinstance(parcels, list) and parcels:
            tracking = parcels[0].get("tracking_number")
        if not tracking:
            tracking = data.get("id")

    patch = {
        "shipment_status": "shipped" if tracking else "preparing",
        "order_status": "processing",
    }
    # opcjonalne kolumny delivery_*
    if tracking:
        patch["delivery_tracking"] = str(tracking)
    try:
        await sb_patch(client, "producer_orders", {"id": f"eq.{order['id']}"}, patch)
    except Exception:
        await sb_patch(
            client,
            "producer_orders",
            {"id": f"eq.{order['id']}"},
            {"shipment_status": patch["shipment_status"]},
        )

    return {
        "ok": True,
        "stub": False,
        "shipment": data,
        "tracking_number": tracking,
        "label_hint": "Producent pobiera etykietę w panelu WWW / API InPost.",
    }


async def apply_paid_producer_checkout_session(
    session: dict[str, Any],
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    sb_post=None,
) -> dict[str, Any]:
    """Obsługa opłaconej sesji Checkout (confirm-session lub webhook)."""
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

    paid = await mark_producer_order_paid(
        client=client,
        sb_get=sb_get,
        sb_patch=sb_patch,
        order_id=order_id,
        payment_intent_id=str(pi) if pi else None,
        checkout_session_id=session.get("id"),
    )

    shipment = None
    if meta.get("with_courier") == "1" and not paid.get("already_paid"):
        order = paid.get("order") or {}
        prod_rows = await sb_get(
            client,
            "local_producers",
            params={"select": "*", "id": f"eq.{order.get('producer_id')}", "limit": "1"},
        )
        producer = (prod_rows or [{}])[0]
        # Odbiorca — minimalny z profilu restauracji (account_key)
        account_key = meta.get("account_key") or order.get("restaurant_account_key")
        receiver = {
            "name": "Restauracja",
            "email": "orders@gastromanager.app",
            "phone": "500600700",
            "address": {
                "street": "ul. Restauracyjna",
                "building_number": "1",
                "city": "Warszawa",
                "post_code": "00-001",
            },
        }
        if account_key:
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
                    receiver["name"] = profiles[0].get("restaurant_name") or receiver["name"]
                    if profiles[0].get("email"):
                        receiver["email"] = profiles[0]["email"]
            except Exception:
                pass
        try:
            shipment = await create_inpost_shipment(
                client=client,
                sb_get=sb_get,
                sb_patch=sb_patch,
                order=order,
                producer=producer,
                receiver=receiver,
            )
        except Exception as e:
            logger.exception("InPost after pay failed")
            shipment = {"ok": False, "error": str(e)[:300]}

    return {
        "ok": True,
        "paid": True,
        "kind": "local_producer_order",
        **paid,
        "shipment": shipment,
    }
