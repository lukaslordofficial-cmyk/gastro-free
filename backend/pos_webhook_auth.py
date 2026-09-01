"""POS webhook tenant token — HMAC of account_key, not a global password in the APK.

POS systems usually can only POST to a URL (no custom headers).
Short link (shown in Settings):
  /w/{provider}{base64url(uuid16 + hmac10)}
Legacy (still accepted):
  /api/pos/webhook?provider=gopos&account=ak_…&token=<hmac>
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re

from fastapi import HTTPException, Request

_ACCOUNT_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,80}$")
_UUID_ACC_RE = re.compile(r"^ak_([0-9a-fA-F]{32})$")
_SHORT_PATH_RE = re.compile(r"^/w/([A-Za-z0-9_-]{16,200})$")
_HEX_RE = re.compile(r"^[0-9a-f]+$")

# 1-znakowy kod providera w slugu (oszczędza &provider=…).
_PROVIDER_CHAR = {
    "generic": "g",
    "gopos": "o",
    "posbistro": "b",
    "dotykacka": "d",
    "softpos": "s",
    "ipos": "i",
    "poster": "p",
    "restimo": "r",
    "s4h": "4",
}
_CHAR_PROVIDER = {v: k for k, v in _PROVIDER_CHAR.items()}

# 10 bajtów HMAC w krótkim URL (80 bit) — query token dalej ma 40 hex (20 bajtów).
_SHORT_MAC_LEN = 10


def pos_master_secret() -> str:
    return (os.environ.get("POS_WEBHOOK_SECRET") or "").strip()


def _hmac_digest(account_key: str, secret: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), account_key.encode("utf-8"), hashlib.sha256).digest()


def tenant_pos_token(account_key: str, secret: str | None = None) -> str:
    master = (secret or pos_master_secret()).strip()
    if not master:
        raise RuntimeError("POS_WEBHOOK_SECRET nie jest ustawiony.")
    return _hmac_digest(account_key, master).hex()[:40]


def verify_pos_token(account_key: str, token: str, secret: str | None = None) -> bool:
    got = (token or "").strip().lower()
    if not got or not account_key or not _HEX_RE.fullmatch(got):
        return False
    try:
        expected = tenant_pos_token(account_key, secret)
    except RuntimeError:
        return False
    if len(got) == 40:
        return hmac.compare_digest(got, expected)
    # Krótki slug: pierwsze 10 bajtów tego samego HMAC (20 hex).
    if len(got) == 20:
        return hmac.compare_digest(got, expected[:20])
    return False


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(s: str) -> bytes:
    pad = "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("ascii"))


def encode_pos_short_slug(account_key: str, provider: str | None, secret: str | None = None) -> str:
    """Zwary kod do /w/{slug}. UUID-konta → 36 znaków; inne klucze trochę dłuższe."""
    master = (secret or pos_master_secret()).strip()
    if not master:
        raise RuntimeError("POS_WEBHOOK_SECRET nie jest ustawiony.")
    pchar = _PROVIDER_CHAR.get((provider or "generic").strip() or "generic", "g")
    mac = _hmac_digest(account_key, master)[:_SHORT_MAC_LEN]
    m = _UUID_ACC_RE.fullmatch(account_key)
    if m:
        return pchar + _b64e(bytes.fromhex(m.group(1)) + mac)
    return pchar + "x" + _b64e(mac + account_key.encode("utf-8"))


def decode_pos_short_slug(slug: str) -> tuple[str, str, str | None] | None:
    """Zwraca (account_key, token_hex20, provider_id) albo None."""
    raw_slug = (slug or "").strip()
    if len(raw_slug) < 17:
        return None
    pchar, rest = raw_slug[0], raw_slug[1:]
    provider = _CHAR_PROVIDER.get(pchar)
    if not provider or not rest:
        return None
    try:
        if rest.startswith("x"):
            blob = _b64d(rest[1:])
            if len(blob) < _SHORT_MAC_LEN + 8:
                return None
            mac, acc = blob[:_SHORT_MAC_LEN], blob[_SHORT_MAC_LEN:].decode("utf-8")
        else:
            blob = _b64d(rest)
            if len(blob) != 16 + _SHORT_MAC_LEN:
                return None
            mac = blob[16:]
            acc = "ak_" + blob[:16].hex()
    except (ValueError, UnicodeDecodeError):
        return None
    if not _ACCOUNT_RE.match(acc):
        return None
    return acc, mac.hex(), provider


def extract_pos_account_and_token(request: Request) -> tuple[str, str]:
    path = (request.url.path or "").split("?", 1)[0]
    m = _SHORT_PATH_RE.fullmatch(path.rstrip("/") or path)
    if m:
        parsed = decode_pos_short_slug(m.group(1))
        if parsed:
            account, token, provider = parsed
            try:
                request.state.pos_provider = provider
            except Exception:
                pass
            return account, token
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
    slug = encode_pos_short_slug(account_key, provider)
    base = (base_url or "").rstrip("/")
    path = f"/w/{slug}"
    return f"{base}{path}" if base else path
