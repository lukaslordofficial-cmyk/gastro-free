"""
Walidacja URL-i wychodzących (ochrona przed SSRF / open redirect).

Używane przy:
- Delta-Scraper (fetch stron hurtowni)
- Stripe success/cancel/return URL (redirect allowlist)
- ścieżkach PostgREST (tylko bezpieczne nazwy tabel)
"""
from __future__ import annotations

import ipaddress
import os
import re
import socket
from urllib.parse import urlparse

from fastapi import HTTPException

_TABLE_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
_BLOCKED_HOSTS = frozenset({
    "localhost",
    "metadata.google.internal",
    "metadata.google",
    "kubernetes.default",
    "kubernetes.default.svc",
})


def assert_safe_rest_path(path: str) -> str:
    """Zapobiega path traversal / SSRF przez path w `{SUPABASE_URL}/rest/v1/{path}`."""
    raw = (path or "").strip().lstrip("/")
    if not raw or ".." in raw or "//" in raw or "\\" in raw or "/" in raw.split("?", 1)[0]:
        raise HTTPException(status_code=400, detail="Nieprawidłowa ścieżka REST.")
    table = raw.split("?", 1)[0]
    if not _TABLE_RE.fullmatch(table):
        raise HTTPException(status_code=400, detail="Nieprawidłowa nazwa tabeli.")
    return raw


def _resolve_ips(hostname: str) -> list[ipaddress._BaseAddress]:
    ips: list[ipaddress._BaseAddress] = []
    try:
        for info in socket.getaddrinfo(hostname, None):
            addr = info[4][0]
            try:
                ips.append(ipaddress.ip_address(addr))
            except ValueError:
                continue
    except socket.gaierror as e:
        raise HTTPException(status_code=400, detail=f"Nie można rozwiązać hosta: {e}") from e
    return ips


def _is_blocked_ip(ip: ipaddress._BaseAddress) -> bool:
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def assert_safe_outbound_url(
    url: str,
    *,
    allow_http: bool = True,
    resolve_dns: bool = True,
) -> str:
    """
    Waliduje URL przed fetchowaniem przez backend (SSRF).
    Domyślnie: http/https, bez lokalnych/prywatnych IP, bez file:// itp.
    """
    cleaned = (url or "").strip()
    if not cleaned or len(cleaned) > 2048:
        raise HTTPException(status_code=400, detail="URL niedozwolony.")
    parsed = urlparse(cleaned)
    schemes = {"https", "http"} if allow_http else {"https"}
    if parsed.scheme not in schemes or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Dozwolone tylko http(s) z hostem.")
    host = parsed.hostname.lower().rstrip(".")
    if host in _BLOCKED_HOSTS or host.endswith(".local") or host.endswith(".internal"):
        raise HTTPException(status_code=400, detail="Host niedozwolony.")
    # Literal IP in hostname
    try:
        literal = ipaddress.ip_address(host)
        if _is_blocked_ip(literal):
            raise HTTPException(status_code=400, detail="Cel SSRF zablokowany.")
    except ValueError:
        literal = None
    if resolve_dns and literal is None:
        for ip in _resolve_ips(host):
            if _is_blocked_ip(ip):
                raise HTTPException(status_code=400, detail="Cel SSRF zablokowany.")
    return cleaned


def _allowed_redirect_hosts() -> set[str]:
    hosts: set[str] = {"localhost", "127.0.0.1"}
    for key in ("PUBLIC_APP_URL", "BILLING_SUCCESS_URL", "BILLING_CANCEL_URL", "LP_BILLING_SUCCESS_URL", "LP_BILLING_CANCEL_URL"):
        raw = (os.getenv(key) or "").strip()
        if not raw:
            continue
        try:
            p = urlparse(raw if "://" in raw else f"https://{raw}")
            if p.hostname:
                hosts.add(p.hostname.lower())
        except Exception:
            continue
    extra = (os.getenv("ALLOWED_REDIRECT_HOSTS") or "").strip()
    for part in extra.split(","):
        h = part.strip().lower()
        if h:
            hosts.add(h)
    return hosts


def assert_safe_redirect_url(url: str, *, allow_deep_link_schemes: tuple[str, ...] = ("myapp",)) -> str:
    """
    Allowlist dla Stripe success/cancel/return.
    Akceptuje deep linki aplikacji oraz http(s) na znanych hostach.
    """
    cleaned = (url or "").strip()
    if not cleaned or len(cleaned) > 2048:
        raise HTTPException(status_code=400, detail="Nieprawidłowy URL przekierowania.")
    parsed = urlparse(cleaned)
    scheme = (parsed.scheme or "").lower()
    if scheme in allow_deep_link_schemes:
        return cleaned
    if scheme not in ("https", "http"):
        raise HTTPException(status_code=400, detail="Schemat URL niedozwolony.")
    host = (parsed.hostname or "").lower()
    if not host:
        raise HTTPException(status_code=400, detail="Brak hosta w URL.")
    allowed = _allowed_redirect_hosts()
    if host not in allowed and not any(host.endswith(f".{a}") for a in allowed if "." in a):
        # Allow Railway / Expo / Cloudflare preview only if explicitly listed via env.
        raise HTTPException(
            status_code=400,
            detail="Host przekierowania spoza allowlisty. Ustaw PUBLIC_APP_URL / ALLOWED_REDIRECT_HOSTS.",
        )
    if scheme == "http" and host not in ("localhost", "127.0.0.1"):
        raise HTTPException(status_code=400, detail="Poza localhost wymagany jest HTTPS.")
    return cleaned
