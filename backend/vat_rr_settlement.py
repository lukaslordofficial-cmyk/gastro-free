"""
VAT-RR: po wysyłce zamówienia generuj dokument i zapisz invoice_url.
billing_type/settlement_document_type == vat_rr.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("lp.vat_rr")


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


async def maybe_issue_vat_rr_after_ship(
    client,
    *,
    producer: dict[str, Any],
    order: dict[str, Any],
    sb_get,
    sb_patch,
) -> dict[str, Any]:
    flags = ProducerBillingFlags(
        settlement_document_type=producer.get("settlement_document_type"),
        billing_type=producer.get("billing_type"),
    )
    if not flags.is_vat_rr:
        return {"ok": True, "skipped": True}

    order_id = str(order.get("id") or "").strip()
    if not order_id:
        return {"ok": False, "error": "Brak order id"}

    # Już jest dokument?
    if str(order.get("invoice_url") or "").strip():
        return {"ok": True, "skipped": True, "reason": "invoice_url already set"}

    try:
        from lp_invoice_pdf import (
            build_invoice_pdf,
            invoice_filename,
            load_order_invoice_items,
            settlement_type_of,
        )
        from lp_invoice_url import DEFAULT_DOCS_BUCKET, upload_private_bytes
    except Exception as e:
        logger.exception("VAT-RR imports failed")
        return {"ok": False, "error": str(e)[:240]}

    # Wymuś typ vat_rr na profilu przekazanym do generatora
    producer_rr = dict(producer)
    producer_rr["settlement_document_type"] = "vat_rr"

    try:
        items = await load_order_invoice_items(client, order_id)
        order_row = dict(order)
        order_row.setdefault("courier_pickup_at", datetime.now(timezone.utc).isoformat())
        order_row.setdefault("order_status", "shipped")
        order_row.setdefault("payment_status", "paid")
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
        # best-effort panel notification
        try:
            from supabase_rest import sb_post

            await sb_post(
                client,
                "producer_notifications",
                {
                    "producer_id": producer.get("id"),
                    "order_id": order_id,
                    "type": "vat_rr_issued",
                    "title": "Wygenerowano fakturę VAT-RR",
                    "body": (
                        "Dokument VAT-RR (wystawca: restauracja) jest dostępny. "
                        "Nie wystawiaj faktury ręcznie."
                    ),
                    "read": False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception:
            logger.info("VAT-RR notification insert skipped", exc_info=True)

        return {
            "ok": True,
            "invoice_url": ref,
            "filename": invoice_filename(settlement_type_of(producer_rr), order_id),
        }
    except Exception as e:
        logger.exception("VAT-RR generate failed")
        return {"ok": False, "error": str(e)[:300]}
