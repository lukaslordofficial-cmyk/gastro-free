"""Request-id + skrót tenanta do logów (bez PII i pełnego account_key)."""
from __future__ import annotations

import hashlib
import re
import uuid

_REQ_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def new_request_id(incoming: str | None) -> str:
    raw = (incoming or "").strip()
    if raw and _REQ_ID_RE.fullmatch(raw):
        return raw[:64]
    return uuid.uuid4().hex[:16]


def short_tenant_id(account_key: str | None) -> str:
    k = (account_key or "").strip()
    if not k or k == "default":
        return "anon"
    return hashlib.sha256(k.encode("utf-8")).hexdigest()[:10]
