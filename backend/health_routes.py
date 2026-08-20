"""Liveness / deep health + opcjonalny auto-confirm e-maila (closed beta)."""
from __future__ import annotations

import os
import ssl

import certifi
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from supabase_rest import require_supabase, sb_get
from url_safety import build_supabase_auth_admin_url

router = APIRouter(tags=["health"])


def _httpx_verify():
    """SSL verify for httpx — Windows needs system cert store, not certifi bundle."""
    mode = os.environ.get("OPENAI_SSL_VERIFY", "auto").strip().lower()
    if mode in ("0", "false", "no"):
        return False
    if mode in ("certifi", "bundle"):
        return certifi.where()
    return ssl.create_default_context()


def _supabase_creds() -> tuple[str, str]:
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        or os.environ.get("SUPABASE_ANON_KEY", "").strip()
    )
    return url, key


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


@router.post("/api/auth/auto-confirm")
async def auth_auto_confirm(body: AutoConfirmBody):
    """
    Closed beta only: potwierdza e-mail przez Admin API (bez maila).
    Domyślnie WYŁĄCZONE. Włącz: AUTO_CONFIRM_EMAIL=true na Railway.
    Produkcja: Confirm email w Supabase + ten flag = false.
    """
    flag = (os.environ.get("AUTO_CONFIRM_EMAIL") or "false").strip().lower()
    if flag not in ("1", "true", "yes", "on"):
        raise HTTPException(status_code=403, detail="AUTO_CONFIRM_EMAIL jest wyłączone.")
    require_supabase()
    supabase_url, supabase_key = _supabase_creds()
    uid = (body.user_id or "").strip()
    url = build_supabase_auth_admin_url(supabase_url, uid)
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0, verify=_httpx_verify()) as client:
        r = await client.put(url, headers=headers, json={"email_confirm": True})
        if r.status_code >= 400:
            r2 = await client.patch(url, headers=headers, json={"email_confirm": True})
            if r2.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"Nie udało się potwierdzić e-maila: {r2.text[:300]}",
                )
    return {"ok": True, "user_id": uid, "email_confirmed": True}


@router.get("/api/health/deep")
async def health_deep():
    """Optional deep check (Supabase round-trip) — not used by Railway healthcheck."""
    supabase_url, supabase_key = _supabase_creds()
    sub_status = "skipped"
    if supabase_url and supabase_key:
        async with httpx.AsyncClient(timeout=5.0, verify=_httpx_verify()) as client:
            try:
                rows = await sb_get(
                    client,
                    "subscriptions",
                    params={
                        "select": "id",
                        "limit": "1",
                    },
                )
                sub_status = "ok" if rows is not None else "empty"
            except httpx.HTTPStatusError as e:
                sub_status = f"error {e.response.status_code}"
            except Exception as e:  # noqa: BLE001
                sub_status = f"error {type(e).__name__}"
    else:
        sub_status = "not_configured"
    return {
        "status": "ok",
        "supabase_configured": bool(supabase_url and supabase_key),
        "subscription": sub_status,
        "openai_configured": bool((os.environ.get("OPENAI_API_KEY") or "").strip()),
    }
