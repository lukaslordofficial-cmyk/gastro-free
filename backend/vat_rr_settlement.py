"""
VAT RR: po opłaceniu zamówienia (nie po wysyłce) wystaw dokument
(wystawca = restauracja, dostawca = rolnik, zwrot 7%) i powiadom rolnika.

Najpierw WWW (panel ma pełny PDF + e-mail), potem lokalny generator.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from html import escape
from typing import Any, Optional

import httpx

logger = logging.getLogger("lp.vat_rr")

PANEL_URL = (os.getenv("GASTRO_WWW_URL") or os.getenv("NEXT_PUBLIC_SITE_URL") or "https://www.gastromanager.org").rstrip("/")


class ProducerBillingFlags:
    def __init__(
        self,
        settlement_document_type: Optional[str] = None,
        billing_type: Optional[str] = None,
    ):
        self.settlement_document_type = settlement_document_type
        self.billing_type = billing_type

    @property
    def is_vat_rr(self) -> bool:
        return (
            self.settlement_document_type == "vat_rr"
            or self.billing_type == "vat_rr"
        )


def _www_secret() -> str:
    """Tylko INTERNAL_API_SECRET — service_role nie może być bearerem do panelu WWW."""
    return (os.getenv("INTERNAL_API_SECRET") or "").strip()


async def _insert_notification(
    client,
    *,
    producer_id: Any,
    order_id: str,
    title: str,
    message: str,
    kind: str,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    payloads = [
        {
            "producer_id": producer_id,
            "order_id": order_id,
            "title": title,
            "message": message,
            "kind": kind,
            "read": False,
            "created_at": now,
        },
        {
            "producer_id": producer_id,
            "order_id": order_id,
            "title": title,
            "body": message,
            "type": kind,
            "read": False,
            "created_at": now,
        },
        {
            "producer_id": producer_id,
            "order_id": order_id,
            "title": title,
            "message": message,
            "read": False,
            "created_at": now,
        },
    ]
    try:
        from supabase_rest import sb_post
    except Exception:
        return
    for payload in payloads:
        try:
            await sb_post(client, "producer_notifications", payload)
            return
        except Exception:
            continue
    logger.info("VAT RR notification insert skipped", exc_info=True)


async def _email_farmer(
    *,
    producer: dict[str, Any],
    restaurant: str,
    document_number: str,
    order_id: str,
    download_url: Optional[str],
) -> None:
    if producer.get("notify_email") is False:
        return
    to = ""
    for key in ("invoice_email", "email"):
        val = str(producer.get(key) or "").strip()
        if val and "@" in val:
            to = val
            break
    if not to:
        return
    farmer = (
        str(producer.get("billing_first_name") or producer.get("owner_name") or producer.get("company_name") or "")
        .strip()
        or "Rolniku"
    )
    panel = f"{PANEL_URL}/producent/zamowienia?order={order_id}"
    number = document_number or "VAT RR"
    subject = f"Faktura VAT RR {number} — {restaurant}"
    text = (
        f"Cześć {farmer},\n\n"
        f"Restauracja {restaurant} wystawiła fakturę VAT RR ({number}) za zakup Twoich produktów.\n"
        "Dokument wystawia nabywca (restauracja) — Ty jesteś dostawcą.\n\n"
        + (f"Pobierz PDF: {download_url}\n" if download_url else "")
        + f"Panel: {panel}\n"
    )
    download_btn = (
        f'<p style="margin:0 0 12px;"><a href="{escape(download_url)}" '
        'style="display:inline-block;background:#7dce8a;color:#0b0f0c;text-decoration:none;'
        'font-weight:700;font-size:13px;padding:12px 20px;border-radius:999px;">'
        "Pobierz fakturę VAT RR</a></p>"
        if download_url
        else ""
    )
    html = (
        f'<p style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;line-height:1.55;font-size:15px">'
        f"Cześć {escape(farmer)},<br><br>"
        f"Restauracja <strong>{escape(restaurant)}</strong> wystawiła fakturę VAT RR "
        f"<strong>{escape(number)}</strong>.</p>"
        f"{download_btn}"
        f'<p><a href="{escape(panel)}">Otwórz w panelu</a></p>'
    )
    try:
        from notify_resend import send_email

        await send_email(to=to, subject=subject, html=html, text=text)
    except Exception:
        logger.exception("VAT RR e-mail failed")


async def _try_www_issue(client: httpx.AsyncClient, order_id: str) -> Optional[dict[str, Any]]:
    secret = _www_secret()
    if not secret:
        return None
    url = f"{PANEL_URL}/api/internal/issue-vat-rr"
    try:
        r = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            },
            json={"orderId": order_id},
            timeout=60.0,
        )
    except Exception as e:
        logger.warning("VAT RR WWW call failed: %s", e)
        return None
    try:
        data = r.json() if r.content else {}
    except Exception:
        data = {}
    if r.status_code >= 400:
        logger.warning("VAT RR WWW HTTP %s: %s", r.status_code, (data or {}).get("error") or r.text[:160])
        return None
    if isinstance(data, dict) and data.get("ok"):
        return data
    return None


async def _issue_local(
    client,
    *,
    producer: dict[str, Any],
    order: dict[str, Any],
    sb_patch,
) -> dict[str, Any]:
    order_id = str(order.get("id") or "").strip()
    try:
        from lp_invoice_pdf import (
            build_invoice_pdf,
            invoice_filename,
            load_order_invoice_items,
            settlement_type_of,
        )
        from lp_invoice_url import DEFAULT_DOCS_BUCKET, create_storage_signed_url, parse_invoice_storage_ref, upload_private_bytes
    except Exception as e:
        logger.exception("VAT RR imports failed")
        return {"ok": False, "error": str(e)[:240]}

    producer_rr = dict(producer)
    producer_rr["settlement_document_type"] = "vat_rr"
    restaurant = str(order.get("restaurant_name") or order.get("delivery_name") or "Restauracja").strip() or "Restauracja"

    try:
        items = await load_order_invoice_items(client, order_id)
        order_row = dict(order)
        order_row["payment_status"] = "paid"
        pdf = build_invoice_pdf(producer=producer_rr, order=order_row, items=items)
        auth_uid = str(producer.get("auth_user_id") or producer.get("id") or "producer")
        path = f"{auth_uid}/invoices/{order_id}-{int(datetime.now().timestamp())}.pdf"
        ref = await upload_private_bytes(
            bucket=DEFAULT_DOCS_BUCKET,
            path=path,
            content=pdf,
            content_type="application/pdf",
            client=client,
        )
        year = datetime.now().year
        short = order_id[:8].upper()
        doc_no = f"RR/{year}/{short}"
        await sb_patch(
            client,
            "producer_orders",
            {"id": f"eq.{order_id}"},
            {
                "invoice_url": ref,
                "invoice_status": "issued",
                "invoice_number": doc_no,
            },
        )
        download_url = None
        try:
            parsed = parse_invoice_storage_ref(ref)
            if parsed and parsed.get("kind") == "http":
                download_url = parsed.get("url")
            elif parsed and parsed.get("kind") == "storage":
                download_url = await create_storage_signed_url(
                    bucket=parsed["bucket"],
                    path=parsed["path"],
                    expires_in=60 * 60 * 24 * 7,
                    client=client,
                )
        except Exception:
            logger.info("VAT RR signed URL skipped", exc_info=True)

        await _insert_notification(
            client,
            producer_id=producer.get("id"),
            order_id=order_id,
            title="Wystawiono fakturę VAT RR",
            message=(
                f"Restauracja {restaurant} wystawiła fakturę VAT RR za zakup Twoich produktów. "
                "Otwórz zamówienie, aby pobrać PDF."
            ),
            kind="vat_rr_issued",
        )
        await _email_farmer(
            producer=producer,
            restaurant=restaurant,
            document_number=doc_no,
            order_id=order_id,
            download_url=download_url,
        )
        return {
            "ok": True,
            "invoice_url": ref,
            "filename": invoice_filename(settlement_type_of(producer_rr), order_id),
        }
    except Exception as e:
        logger.exception("VAT RR generate failed")
        await _insert_notification(
            client,
            producer_id=producer.get("id"),
            order_id=order_id,
            title="Błąd generowania faktury VAT RR",
            message=f"Nie udało się wystawić faktury VAT RR: {str(e)[:180]}",
            kind="vat_rr_error",
        )
        return {"ok": False, "error": str(e)[:300]}


async def maybe_issue_vat_rr_after_pay(
    client,
    *,
    producer: dict[str, Any],
    order: dict[str, Any],
    sb_get=None,
    sb_patch=None,
) -> dict[str, Any]:
    flags = ProducerBillingFlags(
        settlement_document_type=producer.get("settlement_document_type"),
        billing_type=producer.get("billing_type"),
    )
    if not flags.is_vat_rr:
        return {"ok": True, "skipped": True, "reason": "not_vat_rr"}

    order_id = str(order.get("id") or "").strip()
    if not order_id:
        return {"ok": False, "error": "Brak order id"}

    if str(order.get("invoice_url") or "").strip():
        return {"ok": True, "skipped": True, "reason": "invoice_url already set"}

    www = await _try_www_issue(client, order_id)
    if www:
        return {"ok": True, "via": "www", **www}

    if sb_patch is None:
        return {"ok": False, "error": "Brak sb_patch do zapisu faktury lokalnie"}

    return await _issue_local(
        client,
        producer=producer,
        order=order,
        sb_patch=sb_patch,
    )


async def maybe_issue_vat_rr_after_ship(
    client,
    *,
    producer: dict[str, Any],
    order: dict[str, Any],
    sb_get=None,
    sb_patch=None,
) -> dict[str, Any]:
    """Alias — VAT RR idzie po płatności; tu tylko dociągamy gdy brak PDF."""
    return await maybe_issue_vat_rr_after_pay(
        client,
        producer=producer,
        order=order,
        sb_get=sb_get,
        sb_patch=sb_patch,
    )
