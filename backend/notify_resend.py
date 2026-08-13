"""
Wysyłka e-mail przez Resend API (jak lib/email/resend.ts w gastro-manager-landing).
Bez SDK — httpx. Brak klucza = skipped, bez wyjątku.
Zawsze własny klient HTTP (nie współdziel z Supabase — SSL/proxy).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger("notify.resend")

RESEND_API = "https://api.resend.com/emails"


def is_resend_configured() -> bool:
    return bool((os.getenv("RESEND_API_KEY") or "").strip())


def resend_from_header() -> str:
    raw = (os.getenv("RESEND_FROM_EMAIL") or "").strip()
    name = (os.getenv("RESEND_FROM_NAME") or "Gastro Manager").strip()
    fallback = "asystent.dostaw@gastromanager.org"
    # Resend odrzuca Gmail/Outlook jako From, jeśli domena nie jest zweryfikowana.
    blocked = ("gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com")
    host = raw.rsplit("@", 1)[-1].lower() if "@" in raw else ""
    if not raw or raw.lower() == "onboarding@resend.dev" or host in blocked:
        raw = fallback
    if "<" in raw:
        return raw
    return f"{name} <{raw}>"


async def send_email(
    *,
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> dict[str, Any]:
    key = (os.getenv("RESEND_API_KEY") or "").strip()
    if not key:
        logger.warning("[email] RESEND_API_KEY brak — pomijam: %s | %s", to, subject)
        return {"ok": False, "error": "Brak RESEND_API_KEY", "skipped": True}

    payload: dict[str, Any] = {
        "from": resend_from_header(),
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text

    # Własny klient — nie używaj klienta Supabase (inny SSL / keep-alive).
    http = httpx.AsyncClient(timeout=30.0)
    try:
        r = await http.post(
            RESEND_API,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            err = data.get("message") or data.get("error") or r.text[:240]
            logger.error(
                "[email] Resend HTTP %s: %s | from=%s to=%s",
                r.status_code,
                err,
                payload["from"],
                to,
            )
            return {"ok": False, "error": str(err)}
        logger.info("[email] Resend OK id=%s to=%s", data.get("id"), to)
        return {"ok": True, "id": data.get("id")}
    except Exception as e:
        logger.exception("[email] Resend exception")
        return {"ok": False, "error": str(e)[:300]}
    finally:
        await http.aclose()
