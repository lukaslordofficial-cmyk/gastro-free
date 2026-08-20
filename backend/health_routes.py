"""Liveness / deep health + opcjonalny auto-confirm e-maila (closed beta)."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from http_ssl import httpx_verify
from rate_limit import allow_auto_confirm
from supabase_rest import require_supabase
from url_safety import build_supabase_auth_admin_url

logger = logging.getLogger("health")

router = APIRouter(tags=["health"])

# Tylko świeżo utworzone konta — zamyka atak „potwierdź cudzy stary UUID”.
_AUTO_CONFIRM_MAX_AGE_S = 15 * 60


def _supabase_creds() -> tuple[str, str]:
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        or os.environ.get("SUPABASE_ANON_KEY", "").strip()
    )
    return url, key


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def parse_iso_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def auto_confirm_denied_reason(
    user: dict[str, Any],
    email: str,
    *,
    now: datetime | None = None,
    max_age_s: int = _AUTO_CONFIRM_MAX_AGE_S,
) -> str | None:
    """
    None = wolno potwierdzić. Każdy inny kod mapujemy na ten sam komunikat 400,
    żeby nie dało się enumerować kont.
    """
    expected = normalize_email(email)
    got = normalize_email(str(user.get("email") or ""))
    if not expected or expected != got:
        return "email"
    created = parse_iso_dt(user.get("created_at") if isinstance(user.get("created_at"), str) else None)
    if created is None:
        return "created_at"
    stamp = now or datetime.now(timezone.utc)
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    age = (stamp - created).total_seconds()
    if age < 0 or age > max_age_s:
        return "too_old"
    return None


@router.get("/api/")
async def root():
    return {"service": "gastro-voice", "status": "ok"}


@router.get("/")
@router.get("/health")
@router.get("/api/health")
async def health():
    """Lightweight liveness for Railway — no outbound calls (must stay fast)."""
    supabase_url, supabase_key = _supabase_creds()
    return {
        "status": "ok",
        "service": "gastro-voice",
        "supabase_configured": bool(supabase_url and supabase_key),
        "openai_configured": bool((os.environ.get("OPENAI_API_KEY") or "").strip()),
    }


class AutoConfirmBody(BaseModel):
    user_id: str = Field(..., min_length=8, max_length=80)
    email: str = Field(..., min_length=3, max_length=254)


@router.post("/api/auth/auto-confirm")
async def auth_auto_confirm(body: AutoConfirmBody, request: Request):
    """
    Closed beta only: potwierdza e-mail przez Admin API (bez maila).
    Domyślnie WYŁĄCZONE. Włącz: AUTO_CONFIRM_EMAIL=true na Railway.
    Produkcja: Confirm email w Supabase + ten flag = false.

    Wymaga user_id + email zgodnego z kontem utworzonym w ostatnich 15 min.
    """
    flag = (os.environ.get("AUTO_CONFIRM_EMAIL") or "false").strip().lower()
    if flag not in ("1", "true", "yes", "on"):
        raise HTTPException(status_code=403, detail="AUTO_CONFIRM_EMAIL jest wyłączone.")
    ip = request.client.host if request.client else "0"
    if not allow_auto_confirm(ip):
        raise HTTPException(status_code=429, detail="Zbyt wiele prób. Spróbuj za chwilę.")
    require_supabase()
    supabase_url, supabase_key = _supabase_creds()
    uid = (body.user_id or "").strip()
    generic_fail = HTTPException(status_code=400, detail="Nie można potwierdzić e-maila.")
    try:
        url = build_supabase_auth_admin_url(supabase_url, uid)
    except HTTPException:
        raise generic_fail
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0, verify=httpx_verify()) as client:
        lookup = await client.get(url, headers=headers)
        if lookup.status_code >= 400:
            logger.info("auto-confirm lookup failed status=%s", lookup.status_code)
            raise generic_fail
        try:
            user = lookup.json() or {}
        except Exception:  # noqa: BLE001
            raise generic_fail
        if not isinstance(user, dict) or auto_confirm_denied_reason(user, body.email):
            raise generic_fail
        r = await client.put(url, headers=headers, json={"email_confirm": True})
        if r.status_code >= 400:
            r2 = await client.patch(url, headers=headers, json={"email_confirm": True})
            if r2.status_code >= 400:
                logger.info("auto-confirm admin write failed status=%s", r2.status_code)
                raise HTTPException(status_code=502, detail="Nie udało się potwierdzić e-maila.")
    return {"ok": True, "user_id": uid, "email_confirmed": True}


@router.get("/api/health/deep")
async def health_deep():
    """Optional deep check (Supabase round-trip) — not used by Railway healthcheck."""
    from supabase_rest import sb_get

    supabase_url, supabase_key = _supabase_creds()
    sub_status = "skipped"
    if supabase_url and supabase_key:
        async with httpx.AsyncClient(timeout=5.0, verify=httpx_verify()) as client:
            try:
                rows = await sb_get(
                    client,
                    "subscriptions",
                    params={"select": "id", "limit": "1"},
                )
                sub_status = "ok" if rows is not None else "empty"
            except Exception:  # noqa: BLE001
                sub_status = "error"
    else:
        sub_status = "not_configured"
    return {
        "status": "ok",
        "supabase_configured": bool(supabase_url and supabase_key),
        "subscription": sub_status,
        "openai_configured": bool((os.environ.get("OPENAI_API_KEY") or "").strip()),
    }
