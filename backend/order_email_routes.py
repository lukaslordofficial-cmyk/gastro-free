"""
POST /api/orders/generate-messages + /api/orders/send-email
— wydzielone z server.py.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from http_ssl import httpx_verify
from order_email_format import (
    build_supplier_order_message,
    resolve_restaurant_label,
)
from restaurant_profile import (
    account_login_email,
    get_restaurant_profile,
    order_footer,
)
from supabase_rest import sb_get

logger = logging.getLogger(__name__)

router = APIRouter(tags=["order-email"])


def _require_tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


class MessageSupplierGroup(BaseModel):
    supplier_id: Optional[str] = None
    supplier_name: str
    supplier_email: Optional[str] = None
    subtotal_pln: float = 0.0
    items: list[dict] = Field(default_factory=list)


class GenerateMessagesRequest(BaseModel):
    suppliers: list[MessageSupplierGroup]
    restaurant_name: Optional[str] = None
    notes: Optional[str] = None


class EmailAttachment(BaseModel):
    filename: str
    content_base64: str
    content_type: Optional[str] = "application/pdf"


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    html: Optional[str] = None
    body_text: Optional[str] = None
    supplier_name: Optional[str] = None
    api_key: Optional[str] = None
    from_email: Optional[str] = None
    attachments: Optional[list[EmailAttachment]] = None


@router.post("/api/orders/generate-messages")
async def generate_messages(req: GenerateMessagesRequest):
    _require_tenant()
    if not req.suppliers:
        raise HTTPException(status_code=400, detail="Brak dostawców do wygenerowania wiadomości.")
    today = datetime.now(timezone.utc).strftime("%d.%m.%Y")
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as _c:
        profile = await get_restaurant_profile(_c)
        login_email = await account_login_email(_c)
        resolved_suppliers: dict[str, dict] = {}
        for g in req.suppliers:
            sid = (g.supplier_id or "").strip()
            if not sid or sid in resolved_suppliers:
                continue
            try:
                rows = await sb_get(
                    _c,
                    "suppliers",
                    params={
                        "select": "id,name,email,contact_person,min_order_value",
                        "id": f"eq.{sid}",
                        "limit": "1",
                    },
                ) or []
                if rows:
                    resolved_suppliers[sid] = rows[0]
            except Exception as e:  # noqa: BLE001
                try:
                    rows = await sb_get(
                        _c,
                        "suppliers",
                        params={
                            "select": "id,name,email,contact_person",
                            "id": f"eq.{sid}",
                            "limit": "1",
                        },
                    ) or []
                    if rows:
                        resolved_suppliers[sid] = rows[0]
                except Exception as e2:  # noqa: BLE001
                    logger.warning("generate-messages resolve supplier %s: %s / %s", sid, e, e2)

    restaurant = resolve_restaurant_label(
        profile=profile, req_restaurant_name=req.restaurant_name,
    )
    delivery = (profile.get("delivery_address") or "").strip()
    contact_email = (profile.get("contact_email") or "").strip() or login_email
    contact_phone = (profile.get("contact_phone") or "").strip()
    footer = order_footer(profile, fallback_email=login_email)
    contact_block = ""
    if contact_email or contact_phone:
        parts = []
        if contact_email:
            parts.append(f"e-mail: {contact_email}")
        if contact_phone:
            parts.append(f"tel.: {contact_phone}")
        contact_block = "W razie pytań prosimy o kontakt: " + ", ".join(parts) + "."

    messages = []
    for g in req.suppliers:
        items = g.items or []
        subtotal = g.subtotal_pln or round(
            sum(float(i.get("line_total") or 0) for i in items), 2,
        )
        sid = (g.supplier_id or "").strip()
        db_sup = resolved_suppliers.get(sid) if sid else None
        min_val = 0.0
        try:
            min_val = float((db_sup or {}).get("min_order_value") or 0)
        except (TypeError, ValueError):
            min_val = 0.0
        if min_val > 0 and subtotal + 1e-6 < min_val:
            gap = round(min_val - subtotal, 2)
            name = (
                ((db_sup or {}).get("name") or "").strip()
                or (g.supplier_name or "").strip()
                or "dostawcy"
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Minimalne zamówienie u „{name}” to {min_val:.2f} zł. "
                    f"Brakuje {gap:.2f} zł. Dodaj produkty i zamów ponownie."
                ),
            )
        supplier_hello = (
            ((db_sup or {}).get("name") or "").strip()
            or (g.supplier_name or "").strip()
            or "Państwa firmę"
        )
        if supplier_hello == "Dostawca" and (db_sup or {}).get("name"):
            supplier_hello = str(db_sup.get("name")).strip()
        supplier_email = (
            ((db_sup or {}).get("email") or "").strip()
            or (g.supplier_email or "").strip()
            or None
        )
        messages.append(
            build_supplier_order_message(
                supplier_hello=supplier_hello,
                supplier_email=supplier_email,
                supplier_id=g.supplier_id or sid or None,
                restaurant=restaurant,
                today=today,
                delivery=delivery,
                items=items,
                subtotal=subtotal,
                notes=req.notes,
                contact_block=contact_block,
                contact_phone=contact_phone,
                footer=footer,
            )
        )

    return {
        "messages": messages,
        "profile": profile,
        "profile_complete": bool(contact_email and contact_phone),
    }


@router.post("/api/orders/send-email")
async def send_order_email(req: SendEmailRequest):
    _require_tenant()
    from server import _resend_api_key, _resend_from_email

    api_key = (req.api_key or _resend_api_key() or "").strip()
    from_email = (req.from_email or _resend_from_email() or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Brak klucza Resend (RESEND_API_KEY). "
                "Dodaj go w backend/.env i zrestartuj uvicorn "
                "(zmiana .env wymaga pełnego restartu)."
            ),
        )
    if not req.to:
        raise HTTPException(status_code=400, detail="Brak adresu odbiorcy (supplier email).")

    html = req.html
    if req.body_text:
        safe = (
            req.body_text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        html = (
            '<div style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;'
            'white-space:pre-wrap;line-height:1.5">'
            + safe.replace("\n", "<br>")
            + "</div>"
        )
    if not html:
        raise HTTPException(status_code=400, detail="Brak treści wiadomości.")

    resend_attachments: list[dict] = []
    for att in req.attachments or []:
        fname = (att.filename or "").strip() or "zalacznik.pdf"
        raw_b64 = (att.content_base64 or "").strip()
        if not raw_b64:
            continue
        # Limit ~7 MB base64 ≈ ~5 MB pliku — ochrona przed ogromnymi payloadami.
        if len(raw_b64) > 10_000_000:
            raise HTTPException(
                status_code=413,
                detail=f"Załącznik „{fname}” jest za duży.",
            )
        item: dict = {"filename": fname, "content": raw_b64}
        ctype = (att.content_type or "").strip()
        if ctype:
            item["content_type"] = ctype
        resend_attachments.append(item)
    if len(resend_attachments) > 40:
        raise HTTPException(status_code=400, detail="Maksymalnie 40 załączników.")

    async with httpx.AsyncClient(timeout=90.0, verify=httpx_verify()) as client:
        profile = await get_restaurant_profile(client)
        login_email = await account_login_email(client)
        payload = {
            "from": f"Gastro Manager <{from_email}>",
            "to": [req.to],
            "subject": req.subject,
            "html": html,
        }
        if resend_attachments:
            payload["attachments"] = resend_attachments
        reply_to = (profile.get("contact_email") or "").strip() or login_email
        if reply_to:
            payload["reply_to"] = reply_to
        try:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Błąd połączenia z Resend: {e}") from e

    if r.status_code >= 400:
        detail = r.text
        try:
            detail = r.json().get("message", detail)
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=f"Resend odrzucił wysyłkę: {detail}")

    data = r.json() if r.text else {}
    return {
        "ok": True,
        "id": data.get("id"),
        "to": req.to,
        "attachments_count": len(resend_attachments),
    }
