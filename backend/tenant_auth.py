"""Tenant account_key selection: JWT profile wins over spoofable header."""
from __future__ import annotations

import hashlib
import time

# Krótki TTL: po ban/revoke sesja nie zostaje w cache na 1.5 min.
_JWT_TTL_S = 25.0
_JWT_CACHE_MAX = 8000
_jwt_cache: dict[str, tuple[float, str]] = {}


def prefer_jwt_account_key(header_key: str, jwt_key: str | None, default: str) -> str:
    """If the user is logged in, ignore a mismatched X-Account-Key."""
    if jwt_key:
        return jwt_key.strip()
    raw = (header_key or "").strip()
    if raw and raw != "default":
        return raw
    return (default or "default").strip() or "default"


def _jwt_fp(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def jwt_cache_invalidate(token: str) -> None:
    if not token:
        return
    _jwt_cache.pop(_jwt_fp(token), None)


def jwt_cache_get(token: str) -> str | None:
    if not token:
        return None
    fp = _jwt_fp(token)
    row = _jwt_cache.get(fp)
    if not row:
        return None
    exp, key = row
    if exp <= time.monotonic():
        _jwt_cache.pop(fp, None)
        return None
    return key


def jwt_cache_put(token: str, account_key: str) -> None:
    key = (account_key or "").strip()
    if not token or not key:
        return
    now = time.monotonic()
    if len(_jwt_cache) >= _JWT_CACHE_MAX:
        dead = [k for k, (exp, _) in _jwt_cache.items() if exp <= now]
        for k in dead:
            _jwt_cache.pop(k, None)
        if len(_jwt_cache) >= _JWT_CACHE_MAX:
            # drop arbitrary oldest-ish: first inserted in py3.7+
            for k in list(_jwt_cache.keys())[: _JWT_CACHE_MAX // 5]:
                _jwt_cache.pop(k, None)
    _jwt_cache[_jwt_fp(token)] = (now + _JWT_TTL_S, key)

