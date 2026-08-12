"""
SMSAPI.pl (+ opcjonalnie Twilio) — jak lib/sms/send.ts w landing.
Wszystkie błędy (brak środków, zły numer) zwracane jako dict — nie rzucają.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("notify.sms")


def normalize_pl_phone(raw: str) -> str:
    digits = re.sub(r"[^\d+]", "", raw or "")
    if digits.startswith("+"):
        return digits
    if digits.startswith("48") and len(digits) >= 11:
        return f"+{digits}"
    if len(digits) == 9:
        return f"+48{digits}"
    if digits.startswith("00"):
        return f"+{digits[2:]}"
    return digits


def is_sms_configured() -> bool:
    has_twilio = bool(
        (os.getenv("TWILIO_ACCOUNT_SID") or "").strip()
        and (os.getenv("TWILIO_AUTH_TOKEN") or "").strip()
        and (os.getenv("TWILIO_FROM_NUMBER") or "").strip()
    )
    has_smsapi = bool((os.getenv("SMSAPI_TOKEN") or "").strip())
    return has_twilio or has_smsapi


async def _send_smsapi(to: str, body: str, client: httpx.AsyncClient) -> dict[str, Any]:
    token = (os.getenv("SMSAPI_TOKEN") or "").strip()
    sender = (os.getenv("SMSAPI_FROM") or "GastroMgr").strip()
    if not token:
        return {
            "ok": False,
            "provider": "smsapi",
            "skipped": True,
            "error": "Brak SMSAPI_TOKEN.",
        }
    phone = to.lstrip("+")
    qs = urlencode({"to": phone, "message": body, "from": sender, "format": "json"})
    r = await client.get(
        f"https://api.smsapi.pl/sms.do?{qs}",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = r.json() if r.content else {}
    if r.status_code >= 400 or data.get("error"):
        return {
            "ok": False,
            "provider": "smsapi",
            "error": data.get("message") or f"SMSAPI error {data.get('error') or r.status_code}",
        }
    lst = data.get("list") or []
    sid = (lst[0].get("id") if lst and isinstance(lst[0], dict) else None)
    return {"ok": True, "provider": "smsapi", "id": sid}


async def _send_twilio(to: str, body: str, client: httpx.AsyncClient) -> dict[str, Any]:
    sid = (os.getenv("TWILIO_ACCOUNT_SID") or "").strip()
    token = (os.getenv("TWILIO_AUTH_TOKEN") or "").strip()
    from_n = (os.getenv("TWILIO_FROM_NUMBER") or "").strip()
    if not sid or not token or not from_n:
        return {
            "ok": False,
            "provider": "twilio",
            "skipped": True,
            "error": "Brak TWILIO_*",
        }
    r = await client.post(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
        data={"To": to, "From": from_n, "Body": body},
        auth=(sid, token),
    )
    data = r.json() if r.content else {}
    if r.status_code >= 400:
        return {
            "ok": False,
            "provider": "twilio",
            "error": data.get("message") or data.get("error_message") or f"Twilio HTTP {r.status_code}",
        }
    return {"ok": True, "provider": "twilio", "id": data.get("sid")}


async def send_sms(
    *,
    to: str,
    body: str,
    client: Optional[httpx.AsyncClient] = None,
) -> dict[str, Any]:
    """Nigdy nie rzuca — brak środków / błąd API = ok:False."""
    try:
        phone = normalize_pl_phone(to)
        if not phone or len(phone) < 9:
            return {"ok": False, "provider": "none", "error": "Nieprawidłowy numer telefonu."}

        preferred = (os.getenv("SMS_PROVIDER") or "").strip().lower()
        has_twilio = bool(
            (os.getenv("TWILIO_ACCOUNT_SID") or "").strip()
            and (os.getenv("TWILIO_AUTH_TOKEN") or "").strip()
            and (os.getenv("TWILIO_FROM_NUMBER") or "").strip()
        )
        has_smsapi = bool((os.getenv("SMSAPI_TOKEN") or "").strip())

        own = client is None
        http = client or httpx.AsyncClient(timeout=30.0)
        try:
            if preferred == "smsapi" or (not has_twilio and has_smsapi):
                return await _send_smsapi(phone, body, http)
            if has_twilio:
                return await _send_twilio(phone, body, http)
            if has_smsapi:
                return await _send_smsapi(phone, body, http)
            return {
                "ok": False,
                "provider": "none",
                "skipped": True,
                "error": "SMS nie skonfigurowany — ustaw SMSAPI_TOKEN lub TWILIO_*.",
            }
        finally:
            if own:
                await http.aclose()
    except Exception as e:
        logger.exception("[sms] exception (kontynuuję)")
        return {"ok": False, "provider": "none", "error": str(e)[:300]}
