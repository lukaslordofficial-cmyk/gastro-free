"""
Walidacja URL-i wychodzących (ochrona przed SSRF / open redirect).

Używane przy:
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

from http_ssl import is_production_runtime

_SEGMENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
_BLOCKED_HOSTS = frozenset({
    "localhost",
    "metadata.google.internal",
    "metadata.google",
    "kubernetes.default",
    "kubernetes.default.svc",
})


def assert_supabase_origin(base_url: str) -> str:
    """
    Ensure outbound Supabase calls use a fixed https origin from env
    (never a user-controlled host). Keeps scanners from treating
    f\"{SUPABASE_URL}/...\" as an SSRF sink.
    """
    cleaned = (base_url or "").strip().rstrip("/")
    if not cleaned:
        raise HTTPException(status_code=503, detail="SUPABASE_URL nie jest skonfigurowane.")
    parsed = urlparse(cleaned)
    if parsed.scheme != "https" or not parsed.hostname:
        raise HTTPException(status_code=503, detail="SUPABASE_URL musi być https:// z hostem.")
    host = parsed.hostname.lower().rstrip(".")
    if host in _BLOCKED_HOSTS or host.endswith(".local") or host.endswith(".internal"):
        raise HTTPException(status_code=503, detail="SUPABASE_URL host niedozwolony.")
    # Allow only known Supabase / custom project hosts (no raw IP / file schemes).
    try:
        if _is_blocked_ip(ipaddress.ip_address(host)):
            raise HTTPException(status_code=503, detail="SUPABASE_URL nie może wskazywać na prywatne IP.")
    except ValueError:
        pass
    return cleaned


def build_supabase_rest_url(base_url: str, path: str) -> str:
    """Compose `{SUPABASE_URL}/rest/v1/{path}` with path + origin checks."""
    origin = assert_supabase_origin(base_url)
    safe_path = assert_safe_rest_path(path)
    return f"{origin}/rest/v1/{safe_path}"


def build_supabase_auth_admin_url(base_url: str, user_id: str) -> str:
    """Compose Auth Admin user URL; user_id must already be a UUID-like token."""
    origin = assert_supabase_origin(base_url)
    uid = (user_id or "").strip()
    if not re.fullmatch(r"[0-9a-fA-F-]{32,36}", uid):
        raise HTTPException(status_code=400, detail="Nieprawidłowy user_id.")
    return f"{origin}/auth/v1/admin/users/{uid}"


def build_supabase_auth_user_url(base_url: str) -> str:
    """Fixed Auth ``/auth/v1/user`` endpoint (env origin only)."""
    origin = assert_supabase_origin(base_url)
    return f"{origin}/auth/v1/user"


def assert_safe_rest_path(path: str) -> str:
    """Zapobiega path traversal / SSRF przez path w `{SUPABASE_URL}/rest/v1/{path}`."""
    raw = (path or "").strip().lstrip("/")
    raw_no_query = raw.split("?", 1)[0]
    if not raw or ".." in raw or "//" in raw or "\\" in raw:
        raise HTTPException(status_code=400, detail="Nieprawidłowa ścieżka REST.")
    # Allow only these safe patterns inside `rest/v1/<path>`:
    # - `<table>`
    # - `rpc/<rpc_function>`
    if "/" in raw_no_query and not raw_no_query.startswith("rpc/"):
        raise HTTPException(status_code=400, detail="Nieprawidłowa ścieżka REST.")
    if raw_no_query.count("/") > 1:
        raise HTTPException(status_code=400, detail="Nieprawidłowa ścieżka REST.")

    # PostgREST REST endpoints also accept `rpc/<function_name>`.
    # The security scanner flags SSRF when rpc endpoints are assembled into URLs without validation,
    # so we explicitly allow the only safe slash pattern: `rpc/<fn>`.
    if raw_no_query.startswith("rpc/"):
        fn = raw_no_query.split("/", 1)[1]
        if not _SEGMENT_RE.fullmatch(fn):
            raise HTTPException(status_code=400, detail="Nieprawidłowa nazwa RPC.")
        return raw

    # Default: a PostgREST table name without any additional path segments.
    if not _SEGMENT_RE.fullmatch(raw_no_query):
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
    allow_http: bool = False,
    resolve_dns: bool = True,
) -> str:
    """
    Waliduje URL przed fetchowaniem przez backend (SSRF).
    Domyślnie tylko https — zwykłe http tylko gdy jawnie allow_http=True.
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


def checkout_redirect_public_base() -> str:
    """
    Bazowy URL pod Stripe success/cancel (strona HTML → deep link myapp://).
    NIE używaj PUBLIC_APP_URL=localhost:8081 (Expo) — telefon dostaje „witryna nieosiągalna”.
    """
    for key in (
        "CHECKOUT_REDIRECT_BASE_URL",
        "PUBLIC_API_URL",
        "BACKEND_PUBLIC_URL",
        "RAILWAY_PUBLIC_DOMAIN",
    ):
        raw = (os.getenv(key) or "").strip().rstrip("/")
        if not raw:
            continue
        if "://" not in raw:
            raw = f"https://{raw}"
        host = (urlparse(raw).hostname or "").lower()
        if host in ("localhost", "127.0.0.1"):
            continue
        return raw
    public_app = (os.getenv("PUBLIC_APP_URL") or "").strip().rstrip("/")
    if public_app:
        host = (urlparse(public_app if "://" in public_app else f"https://{public_app}").hostname or "").lower()
        if host and host not in ("localhost", "127.0.0.1"):
            return public_app if "://" in public_app else f"https://{public_app}"
    raise HTTPException(
        status_code=503,
        detail="Ustaw PUBLIC_API_URL albo CHECKOUT_REDIRECT_BASE_URL (publiczny HTTPS API).",
    )


def _allowed_redirect_hosts() -> set[str]:
    hosts: set[str] = set()
    if not is_production_runtime():
        hosts.update({"localhost", "127.0.0.1"})
    for key in (
        "PUBLIC_APP_URL",
        "BILLING_SUCCESS_URL",
        "BILLING_CANCEL_URL",
        "LP_BILLING_SUCCESS_URL",
        "LP_BILLING_CANCEL_URL",
        "CHECKOUT_REDIRECT_BASE_URL",
        "PUBLIC_API_URL",
        "BACKEND_PUBLIC_URL",
        "RAILWAY_PUBLIC_DOMAIN",
    ):
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


def is_safe_app_return_url(url: str) -> bool:
    """Deep link powrotu do apki (Expo Go / standalone) — nie http do obcych hostów."""
    cleaned = (url or "").strip()
    if not cleaned or len(cleaned) > 1024:
        return False
    parsed = urlparse(cleaned)
    scheme = (parsed.scheme or "").lower()
    if scheme == "myapp":
        return True
    if scheme == "exp" or scheme.startswith("exp+"):
        return True
    if scheme in ("gastro-manager", "gastromanager"):
        return True
    return False


def assert_safe_redirect_url(url: str, *, allow_deep_link_schemes: tuple[str, ...] = ("myapp", "exp")) -> str:
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
