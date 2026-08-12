"""
Po opłaceniu zamówienia LP — e-mail (Resend) + SMS (SMSAPI) do dystrybutora.
Port logiki z gastro-manager-landing lib/producers/order-fulfillment.ts (bez Furgonetki —
przesyłkę tworzy już local_producers_commerce / furgonetka_broker).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from html import escape
from typing import Any, Optional

import httpx

from local_producers_commerce import parse_lp_ship_from_notes
from notify_resend import is_resend_configured, send_email
from notify_smsapi import is_sms_configured, send_sms

logger = logging.getLogger("lp.paid_notify")


def _restaurant_name(order: dict[str, Any]) -> str:
    ship = parse_lp_ship_from_notes(order.get("notes")) or {}
    name = (ship.get("name") or order.get("restaurant_name") or order.get("delivery_name") or "").strip()
    return name or "Restauracja"


def _producer_email(prod: dict[str, Any]) -> str:
    return str(
        prod.get("invoice_email")
        or prod.get("email")
        or ""
    ).strip()


def _email_copy(restaurant: str) -> dict[str, str]:
    name = (restaurant or "Restauracja").strip() or "Restauracja"
    text = (
        f"Cześć! Restauracja {name} właśnie opłaciła zamówienie na Twoje produkty. "
        "Zaloguj się do swojego panelu dystrybutora, aby pobrać etykietę przewozową Furgonetka. "
        "Spakuj paczkę, naklej etykietę i przekaż ją kurierowi. "
        "Zabezpiecz dobrze przesyłkę, by przetrwała podróż"
    )
    subject = f"Nowe zamówienie w Gastro Manager - {name}"
    html = (
        f'<p style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;'
        f'line-height:1.55;font-size:15px">{escape(text)}</p>'
    )
    return {"subject": subject, "text": text, "html": html}


def _sms_body(restaurant: str) -> str:
    name = (restaurant or "Restauracja").strip() or "Restauracja"
    return (
        f"Gastro Manager: restauracja {name} opłaciła zamówienie. "
        "Zaloguj się do panelu dystrybutora, pobierz etykietę Furgonetka, "
        "spakuj paczkę i przekaż kurierowi."
    )[:600]


async def notify_distributor_order_paid(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    sb_post=None,
    order: dict[str, Any],
    producer: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Wysyła e-mail + SMS do lokalnego przetwórcy po paid.
    Idempotentne względem sms_notified_at / email_notified_at (jeśli kolumny istnieją).
    SMS zawsze w try/except — brak środków nie crashuje webhooka.
    """
    order_id = str(order.get("id") or "")
    result: dict[str, Any] = {
        "ok": True,
        "order_id": order_id,
        "email_sent": False,
        "sms_sent": False,
        "resend_configured": is_resend_configured(),
    }
    if not order_id:
        return {"ok": False, "error": "missing_order_id"}

    producer_id = order.get("producer_id")
    prod = producer
    if not prod and producer_id:
        rows = await sb_get(
            client,
            "local_producers",
            params={
                "select": "id,company_name,owner_name,email,invoice_email,phone,notify_sms,notify_email",
                "id": f"eq.{producer_id}",
                "limit": "1",
            },
        )
        prod = (rows or [None])[0]
    if not prod and producer_id:
        # Fallback bez invoice_email (stary schemat)
        rows = await sb_get(
            client,
            "local_producers",
            params={
                "select": "id,company_name,owner_name,email,phone,notify_sms,notify_email",
                "id": f"eq.{producer_id}",
                "limit": "1",
            },
        )
        prod = (rows or [None])[0]
    if not prod:
        return {"ok": False, "order_id": order_id, "error": "producer_not_found"}

    # Odśwież flagi powiadomień z DB (gdy już paid przez webhook)
    try:
        fresh = await sb_get(
            client,
            "producer_orders",
            params={
                "select": "id,email_notified_at,sms_notified_at,notes,restaurant_name,delivery_name",
                "id": f"eq.{order_id}",
                "limit": "1",
            },
        )
        if fresh:
            order = {**order, **fresh[0]}
    except Exception:
        pass

    restaurant = _restaurant_name(order)
    email_copy = _email_copy(restaurant)
    sms_body = _sms_body(restaurant)
    to_email = _producer_email(prod)

    # --- E-mail (główny kanał) ---
    if prod.get("notify_email") is not False and to_email:
        if order.get("email_notified_at"):
            result["email_skipped"] = "already_notified"
        else:
            try:
                mail = await send_email(
                    to=to_email,
                    subject=email_copy["subject"],
                    html=email_copy["html"],
                    text=email_copy["text"],
                )
                result["email"] = mail
                if mail.get("ok"):
                    result["email_sent"] = True
                    try:
                        await sb_patch(
                            client,
                            "producer_orders",
                            {"id": f"eq.{order_id}"},
                            {
                                "email_notified_at": datetime.now(timezone.utc).isoformat(),
                            },
                        )
                    except Exception:
                        pass
                elif not mail.get("skipped"):
                    logger.error("[fulfill] e-mail nieudany: %s", mail.get("error"))
            except Exception:
                logger.exception("[fulfill] e-mail exception")
    else:
        result["email_skipped"] = "no_email_or_disabled"
        logger.warning(
            "[fulfill] brak e-mail dystrybutora / notify_email=false (producer=%s)",
            prod.get("id"),
        )

    # --- SMS (opcjonalny; nigdy nie crashuje) ---
    want_sms = prod.get("notify_sms") is not False and bool((prod.get("phone") or "").strip())
    if want_sms and is_sms_configured() and not order.get("sms_notified_at"):
        try:
            sms = await send_sms(to=str(prod["phone"]).strip(), body=sms_body)
            result["sms"] = sms
            if sms.get("ok"):
                result["sms_sent"] = True
                try:
                    await sb_patch(
                        client,
                        "producer_orders",
                        {"id": f"eq.{order_id}"},
                        {
                            "sms_notified_at": datetime.now(timezone.utc).isoformat(),
                        },
                    )
                except Exception:
                    pass
            elif not sms.get("skipped"):
                logger.error("[fulfill] SMS nieudany: %s", sms.get("error"))
        except Exception:
            logger.exception("[fulfill] SMS exception (kontynuuję)")

    # --- Powiadomienie w panelu dystrybutora ---
    if sb_post:
        try:
            await sb_post(
                client,
                "producer_notifications",
                {
                    "producer_id": prod.get("id"),
                    "title": "Nowe opłacone zamówienie",
                    "body": (
                        "Zamówiono u Ciebie produkty. Wydrukuj etykietę i spakuj paczkę "
                        "— kurier już jedzie."
                    ),
                    "read": False,
                    "order_id": order_id,
                    "kind": "order_paid_courier",
                },
            )
        except Exception:
            logger.debug("producer_notifications insert skipped", exc_info=True)

    return result
