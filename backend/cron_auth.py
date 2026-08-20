"""Auth for scheduler / admin maintenance endpoints.

Public GET jobs (expiry alerts, core alerts, migration-status) must not
run without a shared secret — they hit OpenAI, Expo Push and dump SQL.
"""
from __future__ import annotations

import hmac
import os

from fastapi import HTTPException, Request


def cron_secret() -> str:
    return (os.environ.get("CRON_JOB_SECRET") or os.environ.get("ADMIN_JOB_SECRET") or "").strip()


def _bearer(request: Request) -> str:
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def require_env_secret(
    request: Request,
    env_key: str,
    *,
    header: str,
    missing_detail: str,
    bad_detail: str,
) -> None:
    """401 unless header/Bearer matches env; 503 if env unset."""
    expected = (os.environ.get(env_key) or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail=missing_detail)
    got = (request.headers.get(header) or "").strip() or _bearer(request)
    if not got or len(got) != len(expected) or not hmac.compare_digest(got, expected):
        raise HTTPException(status_code=401, detail=bad_detail)


def require_cron_secret(request: Request) -> None:
    """401 unless X-Cron-Secret / Bearer matches CRON_JOB_SECRET; 503 if unset."""
    expected = cron_secret()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="CRON_JOB_SECRET nie jest ustawiony — joby cron są wyłączone.",
        )
    got = (request.headers.get("x-cron-secret") or "").strip() or _bearer(request)
    if not got or len(got) != len(expected) or not hmac.compare_digest(got, expected):
        raise HTTPException(status_code=401, detail="Brak albo zły sekret cron.")
