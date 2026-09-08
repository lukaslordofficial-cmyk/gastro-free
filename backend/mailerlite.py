"""
Mailerlite — zapis subskrybenta (newsletter) po rejestracji w aplikacji.
Best-effort: błąd API nie blokuje utworzenia konta.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

from http_ssl import httpx_verify

logger = logging.getLogger("mailerlite")

MAILERLITE_API = "https://connect.mailerlite.com/api/subscribers"


def mailerlite_configured() -> bool:
    return bool((os.getenv("MAILERLITE_API_TOKEN") or "").strip())


def _group_ids() -> list[str]:
    raw = (os.getenv("MAILERLITE_GROUP_ID") or "").strip()
    if not raw:
        return []
    # Jedno ID albo lista oddzielona przecinkami
    return [g.strip() for g in raw.split(",") if g.strip()]


async def subscribe_subscriber(
    *,
    email: str,
    name: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> dict[str, Any]:
    token = (os.getenv("MAILERLITE_API_TOKEN") or "").strip()
    if not token:
        return {"ok": False, "skipped": True, "error": "Brak MAILERLITE_API_TOKEN"}

    email_n = (email or "").strip().lower()
    if not email_n or "@" not in email_n:
        return {"ok": False, "error": "Nieprawidłowy e-mail"}

    payload: dict[str, Any] = {
        "email": email_n,
        "status": "active",
    }
    groups = _group_ids()
    if groups:
        payload["groups"] = groups
    if (name or "").strip():
        payload["fields"] = {"name": (name or "").strip()[:120]}

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    own = client is None
    http = client or httpx.AsyncClient(timeout=25.0, verify=httpx_verify())
    try:
        r = await http.post(MAILERLITE_API, headers=headers, json=payload)
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            err = (
                (data.get("message") if isinstance(data, dict) else None)
                or (data.get("error") if isinstance(data, dict) else None)
                or r.text[:240]
            )
            logger.warning("[mailerlite] HTTP %s: %s", r.status_code, err)
            return {"ok": False, "error": str(err), "status": r.status_code}
        logger.info("[mailerlite] subscribed %s", email_n)
        return {"ok": True, "data": data}
    except Exception as e:  # noqa: BLE001
        logger.exception("[mailerlite] exception")
        return {"ok": False, "error": str(e)[:300]}
    finally:
        if own:
            await http.aclose()
