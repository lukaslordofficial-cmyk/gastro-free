"""
Marketplace Lokalni Przetwórcy — Stripe Checkout (BLIK + karta) + InPost ShipX.

Jedna ścieżka: Zamów i zapłać = produkty + kurier + opłata serwisu 5%.
Po płatności:
  - dystrybutor: producer_amount (Connect destination charge lub Transfer),
  - platforma: 5% (application_fee / saldo platformy),
  - InPost: opłata kuriera zatrzymana na platformie + utworzenie przesyłki ShipX
    (pickup u producenta → dostawa do restauracji).
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

import httpx

from billing_stripe import (
    _ssl_verify,
    _stripe_post,
    stripe_configured,
)

logger = logging.getLogger("local_producers.commerce")

INPOST_SANDBOX = "https://sandbox-api-shipx-pl.easypack24.net"
INPOST_PROD = "https://api-shipx-pl.easypack24.net"
LP_SHIP_PREFIX = "lp_ship:"


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


def _pln_to_grosze(value: Any) -> int:
    try:
        return int(round(float(value or 0) * 100))
    except (TypeError, ValueError):
        return 0


def parse_lp_ship_from_notes(notes: Optional[str]) -> Optional[dict[str, Any]]:
    """Wyciąga adres dostawy zapisany w notes jako lp_ship:{json}."""
    if not notes:
        return None
    idx = notes.find(LP_SHIP_PREFIX)
    if idx < 0:
        return None
    raw = notes[idx + len(LP_SHIP_PREFIX) :].strip()
    # JSON kończy się przed ' | ' albo na końcu
    if " |" in raw:
        raw = raw.split(" |", 1)[0].strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def encode_lp_ship_note(delivery: dict[str, Any], extra: str = "") -> str:
    payload = json.dumps(delivery, ensure_ascii=False, separators=(",", ":"))
    base = f"{LP_SHIP_PREFIX}{payload}"
    extra = (extra or "").strip()
    return f"{extra} | {base}".strip(" |") if extra else base


def _split_street(address: Optional[str]) -> tuple[str, str]:
    """Prosta próba wydzielenia numeru budynku z linii adresu."""
    text = (address or "").strip() or "ul. Producenta"
    m = re.search(r"^(.*?)[\s,]+(\d+[A-Za-z]?(?:/\d+[A-Za-z]?)?)\s*$", text)
    if m:
        return m.group(1).strip()[:60] or "ul. Producenta", m.group(2)[:10]
    return text[:60], "1"


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
    Stripe Checkout — 3 pozycje: produkty, kurier InPost, opłata serwisu 5%.
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
                    "name": "Kurier InPost",
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
    sender = producent (pickup), receiver = restauracja (dostawa).
    Opłata kuriera jest już w Stripe (zatrzymana na platformie) — ShipX rozlicza InPost w org.
    """
    sender_street, sender_building = _split_street(producer.get("address"))
    recv_addr = receiver.get("address") or {}
    recv_street = (recv_addr.get("street") or "").strip() or "ul. Restauracyjna"
    recv_building = (recv_addr.get("building_number") or "").strip() or "1"
    recv_city = (recv_addr.get("city") or "").strip() or "Warszawa"
    recv_post = (recv_addr.get("post_code") or "").strip() or "00-001"

    comment = (
        f"Gastro LP {str(order.get('id'))[:8]} | "
        f"ODBIÓR: {producer.get('company_name') or 'Producent'}, "
        f"{sender_street} {sender_building}, {producer.get('city') or ''} {producer.get('postal_code') or ''} | "
        f"DOSTAWA: {receiver.get('name') or 'Restauracja'}, "
        f"{recv_street} {recv_building}, {recv_city} {recv_post}"
    )[:500]

    if not inpost_configured():
        try:
            await sb_patch(
                client,
                "producer_orders",
                {"id": f"eq.{order['id']}"},
                {
                    "shipment_status": "preparing",
                    "order_status": "processing",
                    "notes": (
                        (order.get("notes") or "")
                        + " | InPost: brak tokenu — etykieta później | "
                        + comment
                    ).strip(" |")[:2000],
                },
            )
        except Exception:
            pass
        return {
            "ok": True,
            "stub": True,
            "message": (
                "INPOST_API_TOKEN / INPOST_ORGANIZATION_ID nie ustawione — "
                "przesyłka oznaczona jako preparing (stub). "
                "Opłata kuriera jest na koncie platformy pod rozliczenie InPost."
            ),
            "pickup_hint": comment,
        }

    token = (os.getenv("INPOST_API_TOKEN") or "").strip()
    org_id = (os.getenv("INPOST_ORGANIZATION_ID") or "").strip()
    service = (os.getenv("INPOST_SERVICE") or "inpost_courier_standard").strip()

    body = {
        "receiver": {
            "name": receiver.get("name") or "Restauracja",
            "email": receiver.get("email") or "orders@gastromanager.app",
            "phone": receiver.get("phone") or "500600700",
            "address": {
                "street": recv_street[:60],
                "building_number": recv_building[:10],
                "city": recv_city[:40],
                "post_code": recv_post[:10],
                "country_code": "PL",
            },
        },
        "sender": {
            "name": producer.get("company_name") or "Producent",
            "email": producer.get("email") or "producer@example.com",
            "phone": producer.get("phone") or "500600700",
            "address": {
                "street": sender_street,
                "building_number": sender_building,
                "city": (producer.get("city") or "Warszawa")[:40],
                "post_code": (producer.get("postal_code") or "00-001")[:10],
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
        "comments": comment,
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
        "pickup_hint": comment,
        "courier_settlement": (
            "Opłata kuriera z Checkout jest na koncie platformy; "
            "InPost rozlicza przesyłkę w organizacji ShipX."
        ),
    }


async def _resolve_receiver(
    *,
    client: httpx.AsyncClient,
    sb_get,
    order: dict[str, Any],
    account_key: Optional[str],
) -> dict[str, Any]:
    ship = parse_lp_ship_from_notes(order.get("notes"))
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
    if ship:
        receiver["name"] = ship.get("name") or receiver["name"]
        if ship.get("email"):
            receiver["email"] = ship["email"]
        if ship.get("phone"):
            receiver["phone"] = str(ship["phone"])
        receiver["address"] = {
            "street": ship.get("street") or receiver["address"]["street"],
            "building_number": ship.get("building_number") or "1",
            "city": ship.get("city") or receiver["address"]["city"],
            "post_code": ship.get("post_code") or receiver["address"]["post_code"],
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
                if not ship or not ship.get("name"):
                    receiver["name"] = profiles[0].get("restaurant_name") or receiver["name"]
                if profiles[0].get("email") and (not ship or not ship.get("email")):
                    receiver["email"] = profiles[0]["email"]
        except Exception:
            pass
    return receiver


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
        receiver = await _resolve_receiver(
            client=http,
            sb_get=sb_get,
            order=order,
            account_key=account_key,
        )
        ship_res = None
        try:
            from furgonetka_broker import create_furgonetka_shipment, furgonetka_configured

            if furgonetka_configured():
                ship_res = await create_furgonetka_shipment(
                    str(order.get("id") or order_id),
                    client=http,
                    sb_get=sb_get,
                    sb_patch=sb_patch,
                )
            else:
                ship_res = await create_inpost_shipment(
                    client=http,
                    sb_get=sb_get,
                    sb_patch=sb_patch,
                    order=order,
                    producer=producer,
                    receiver=receiver,
                )
        except Exception as e:
            logger.exception("Courier broker after pay failed")
            ship_res = {"ok": False, "error": str(e)[:300]}

        notify_res = await _run_notify(http)
        return ship_res, notify_res

    # Jedna ścieżka: kurier po pierwszym paid; notify zawsze (idempotentny).
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

    return {
        "ok": True,
        "paid": True,
        "kind": "local_producer_order",
        **paid,
        "shipment": shipment,
        "notify": notify,
        "settlement": {
            "producer": meta.get("producer_amount"),
            "platform_fee_5pct": meta.get("platform_fee"),
            "courier_broker": meta.get("delivery_cost"),
            "split_mode": split_mode,
        },
    }
