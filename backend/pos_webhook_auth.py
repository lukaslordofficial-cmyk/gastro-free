"""POS webhook tenant token — HMAC of account_key, not a global password in the APK.

POS systems usually can only POST to a URL (no custom headers).
Each restaurant gets:
  /api/pos/webhook?provider=gopos&account=ak_…&token=<hmac>
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re

from fastapi import HTTPException, Request

_ACCOUNT_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,80}$")


def pos_master_secret() -> str:
    return (os.environ.get("POS_WEBHOOK_SECRET") or "").strip()


def tenant_pos_token(account_key: str, secret: str | None = None) -> str:
    master = (secret or pos_master_secret()).strip()
    if not master:
        raise RuntimeError("POS_WEBHOOK_SECRET nie jest ustawiony.")
    digest = hmac.new(master.encode("utf-8"), account_key.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest[:40]


def verify_pos_token(account_key: str, token: str, secret: str | None = None) -> bool:
    got = (token or "").strip()
    if not got or not account_key:
        return False
    try:
        expected = tenant_pos_token(account_key, secret)
    except RuntimeError:
        return False
    if len(got) != len(expected):
        return False
    return hmac.compare_digest(got, expected)


def extract_pos_account_and_token(request: Request) -> tuple[str, str]:
    q = request.query_params
    account = (q.get("account") or request.headers.get("x-account-key") or "").strip()
    token = (
        (q.get("token") or q.get("secret") or "").strip()
        or (request.headers.get("x-pos-webhook-secret") or "").strip()
    )
    auth = (request.headers.get("authorization") or "").strip()
    if not token and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    return account, token


def require_pos_webhook_tenant(request: Request) -> str:
    """Returns verified account_key or raises 401/503."""
    master = pos_master_secret()
    if not master:
        raise HTTPException(
            status_code=503,
            detail="POS_WEBHOOK_SECRET nie jest ustawiony — webhook POS wyłączony.",
        )
    account, token = extract_pos_account_and_token(request)
    if not account or account == "default" or not _ACCOUNT_RE.match(account):
        raise HTTPException(
            status_code=401,
            detail="Brak account w URL webhooka POS. Skopiuj link z Ustawień w aplikacji.",
        )
    if not verify_pos_token(account, token, master):
        raise HTTPException(status_code=401, detail="Nieprawidłowy token webhooka POS.")
    return account


def build_pos_webhook_path(account_key: str, provider: str | None, base_url: str) -> str:
    token = tenant_pos_token(account_key)
    base = (base_url or "").rstrip("/")
    path = f"/api/pos/webhook?account={account_key}&token={token}"
    if provider and provider != "generic":
        path += f"&provider={provider}"
    return f"{base}{path}" if base else path
