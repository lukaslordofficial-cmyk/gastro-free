from __future__ import annotations

from billing_stripe import _ssl_verify
from pl_phone import humanize_courier_phone_error
from typing import Any
from typing import Optional
import base64
import httpx
import logging
import os
import time

"""
Furgonetka.pl — InPost Kurier (konto platformy / prepaid).

Po Stripe paid:
  validate → POST /packages → PUT /order-commands → etykieta PDF
  → POST /packages/pickup-date-proposals → PUT /pickup-commands
  → GET /packages/{id}/tracking

Env:
  FURGONETKA_SANDBOX=1
  FURGONETKA_API_URL=
  FURGONETKA_CLIENT_ID / FURGONETKA_CLIENT_SECRET
  FURGONETKA_EMAIL (lub USERNAME) + FURGONETKA_PASSWORD
  FURGONETKA_API_KEY / FURGONETKA_ACCESS_TOKEN
  FURGONETKA_INPOST_SERVICE_ID
  FURGONETKA_LABEL_PAGE=a6|a4
"""

logger = logging.getLogger("furgonetka.broker")

ACCEPT_V1 = "application/vnd.furgonetka.v1+json"
ACCEPT_V2 = "application/vnd.furgonetka.v2+json"
LP_SHIP_PREFIX = "lp_ship:"
LP_COURIER_PREFIX = "lp_courier:"

_token_cache: dict[str, Any] = {
    "access": None,
    "refresh": (os.getenv("FURGONETKA_REFRESH_TOKEN") or "").strip() or None,
    "expires_at": 0.0,
}


def _use_sandbox() -> bool:
    """
    Tryb testowy (konto sandbox.furgonetka.pl).
    Domyślnie WŁĄCZONY — wyłącz przez FURGONETKA_SANDBOX=0 lub FURGONETKA_PRODUCTION=1.
    """
    prod = (os.getenv("FURGONETKA_PRODUCTION") or "").strip().lower()
    if prod in ("1", "true", "yes", "on"):
        return False
    raw = (os.getenv("FURGONETKA_SANDBOX") or "").strip().lower()
    if raw in ("0", "false", "off", "no"):
        return False
    if not raw:
        return True
    return raw in ("1", "true", "yes", "on", "sandbox", "test")


def _use_mock() -> bool:
    raw = (os.getenv("FURGONETKA_MOCK") or "").strip().lower()
    if raw in ("1", "true", "yes", "on", "mock"):
        return True
    # Sandbox bez danych OAuth — pełny flow testowy bez konta firmowego.
    if _use_sandbox() and not _has_oauth_secrets():
        return True
    return False


def _is_client_auth_error(exc: BaseException | str) -> bool:
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            "client authentication failed",
            "invalid_client",
            "unauthorized_client",
            "invalid client",
        )
    )


def _has_oauth_secrets() -> bool:
    if (os.getenv("FURGONETKA_API_KEY") or os.getenv("FURGONETKA_ACCESS_TOKEN") or "").strip():
        return True
    email = (os.getenv("FURGONETKA_EMAIL") or os.getenv("FURGONETKA_USERNAME") or "").strip()
    password = (os.getenv("FURGONETKA_PASSWORD") or "").strip()
    cid = (os.getenv("FURGONETKA_CLIENT_ID") or "").strip()
    secret = (os.getenv("FURGONETKA_CLIENT_SECRET") or "").strip()
    return bool(email and password and cid and secret)


def api_base() -> str:
    """
    OAuth / REST dla kont sandbox i produkcji: ten sam host api.furgonetka.pl.
    Nie używaj api.sandbox.furgonetka.pl — OAuth tam nie działa.
    """
    custom = (os.getenv("FURGONETKA_API_URL") or "").strip().rstrip("/")
    if custom:
        # Częsty błąd konfiguracji — normalizuj sandbox host na produkcyjny API.
        lowered = custom.lower()
        if "api.sandbox.furgonetka.pl" in lowered or "://sandbox.furgonetka.pl" in lowered:
            return "https://api.furgonetka.pl"
        return custom
    return "https://api.furgonetka.pl"


def furgonetka_configured() -> bool:
    if _use_mock():
        return True
    return _has_oauth_secrets()


def _basic_auth() -> str:
    cid = (os.getenv("FURGONETKA_CLIENT_ID") or "").strip()
    secret = (os.getenv("FURGONETKA_CLIENT_SECRET") or "").strip()
    if not cid or not secret:
        raise RuntimeError("Brak FURGONETKA_CLIENT_ID / FURGONETKA_CLIENT_SECRET")
    return "Basic " + base64.b64encode(f"{cid}:{secret}".encode()).decode("ascii")


async def _oauth_token(form: dict[str, str]) -> str:
    async with httpx.AsyncClient(timeout=45.0, verify=_ssl_verify()) as http:
        r = await http.post(
            f"{api_base()}/oauth/token",
            headers={
                "Authorization": _basic_auth(),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data=form,
        )
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            raise RuntimeError(
                data.get("error_description") or data.get("message") or r.text[:300]
            )
    _token_cache["access"] = data["access_token"]
    if data.get("refresh_token"):
        _token_cache["refresh"] = data["refresh_token"]
    _token_cache["expires_at"] = time.time() + max(60, int(data.get("expires_in") or 3600) - 120)
    return str(_token_cache["access"])


async def get_access_token() -> str:
    static = (os.getenv("FURGONETKA_API_KEY") or os.getenv("FURGONETKA_ACCESS_TOKEN") or "").strip()
    if static:
        return static

    access = _token_cache.get("access")
    exp = float(_token_cache.get("expires_at") or 0)
    if access and (exp == 0 or time.time() < exp):
        return str(access)

    refresh = _token_cache.get("refresh")
    if refresh:
        try:
            return await _oauth_token({
                "grant_type": "refresh_token",
                "refresh_token": str(refresh),
            })
        except Exception as e:
            logger.warning("Furgonetka refresh failed: %s", e)

    email = (os.getenv("FURGONETKA_EMAIL") or os.getenv("FURGONETKA_USERNAME") or "").strip()
    password = (os.getenv("FURGONETKA_PASSWORD") or "").strip()
    if not email or not password:
        raise RuntimeError("Ustaw FURGONETKA_EMAIL + FURGONETKA_PASSWORD (lub FURGONETKA_API_KEY)")
    return await _oauth_token({
        "grant_type": "password",
        "scope": "api",
        "username": email,
        "password": password,
    })


async def _api(
    method: str,
    path: str,
    *,
    json_body: Any = None,
    accept: str = ACCEPT_V1,
    raw: bool = False,
    params: Optional[dict] = None,
) -> Any:
    token = await get_access_token()
    headers = {"Authorization": f"Bearer {token}", "Accept": accept}
    if json_body is not None:
        headers["Content-Type"] = ACCEPT_V2 if "v2" in accept else ACCEPT_V1
    async with httpx.AsyncClient(timeout=60.0, verify=_ssl_verify()) as http:
        r = await http.request(
            method,
            f"{api_base()}{path}",
            headers=headers,
            json=json_body,
            params=params,
        )
        if raw:
            if r.status_code == 204:
                return None
            if r.status_code >= 400:
                raise RuntimeError(
                    humanize_courier_phone_error(f"Furgonetka {r.status_code}: {r.text[:400]}")
                )
            return r.content
        if r.status_code == 204:
            return None
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            raise RuntimeError(_fmt_api_error(r.status_code, data, r.text))
        return data


def _fmt_api_error(status: int, data: Any, text: str) -> str:
    if isinstance(data, dict):
        errs = data.get("errors")
        if isinstance(errs, list) and errs:
            parts = []
            for e in errs[:6]:
                if isinstance(e, dict):
                    parts.append(
                        str(e.get("details") or e.get("message") or e.get("code") or e)[:180]
                    )
                else:
                    parts.append(str(e)[:180])
            if parts:
                return humanize_courier_phone_error(
                    f"Furgonetka {status}: " + "; ".join(parts)
                )
        msg = data.get("message") or data.get("error_description")
        if msg:
            return humanize_courier_phone_error(f"Furgonetka {status}: {msg}")
    return humanize_courier_phone_error(
        f"Furgonetka {status}: {(text or str(data))[:300]}"
    )


async def resolve_inpost_service_id() -> Any:
    forced = (os.getenv("FURGONETKA_INPOST_SERVICE_ID") or "").strip()
    if forced:
        return int(forced) if forced.isdigit() else forced
    data = await _api("GET", "/account/services", accept=ACCEPT_V1)
    services = (data or {}).get("services") or []
    inpost = next(
        (
            s for s in services
            if str(s.get("service") or "").lower() == "inpost" and s.get("owner") == "furgonetka"
        ),
        None,
    ) or next(
        (s for s in services if str(s.get("service") or "").lower() == "inpost"),
        None,
    )
    if not inpost or not inpost.get("id"):
        raise RuntimeError(
            "Brak usługi InPost na koncie Furgonetka. "
            "Włącz InPost Kurier w panelu lub ustaw FURGONETKA_INPOST_SERVICE_ID."
        )
    return inpost["id"]

__all__ = ['ACCEPT_V1', 'ACCEPT_V2', 'LP_COURIER_PREFIX', 'LP_SHIP_PREFIX', '_api', '_basic_auth', '_fmt_api_error', '_has_oauth_secrets', '_is_client_auth_error', '_oauth_token', '_token_cache', '_use_mock', '_use_sandbox', 'api_base', 'furgonetka_configured', 'get_access_token', 'logger', 'resolve_inpost_service_id']
