"""
Furgonetka.pl — InPost Kurier (działalność nierejestrowana / prepaid).

Po Stripe checkout.session.completed → create_furgonetka_shipment(order_id)
→ POST /packages + PUT /order-commands → zapis furgonetka_package_id
→ GET /api/orders/{id}/furgonetka-label → PDF (StreamingResponse)

Env:
  FURGONETKA_SANDBOX=1          (opcjonalnie — sandbox API; domyślnie produkcja)
  FURGONETKA_API_URL=           (opcjonalnie nadpisuje host)
  FURGONETKA_CLIENT_ID / FURGONETKA_CLIENT_SECRET
  FURGONETKA_EMAIL (lub USERNAME) + FURGONETKA_PASSWORD
  FURGONETKA_API_KEY / FURGONETKA_ACCESS_TOKEN  (gotowy Bearer)
  FURGONETKA_INPOST_SERVICE_ID  (opcjonalnie)
  FURGONETKA_LABEL_PAGE=a6|a4
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
import time
import uuid
from typing import Any, Optional

import httpx

from billing_stripe import _ssl_verify

logger = logging.getLogger("furgonetka.broker")

ACCEPT_V1 = "application/vnd.furgonetka.v1+json"
ACCEPT_V2 = "application/vnd.furgonetka.v2+json"
LP_SHIP_PREFIX = "lp_ship:"

_token_cache: dict[str, Any] = {
    "access": None,
    "refresh": (os.getenv("FURGONETKA_REFRESH_TOKEN") or "").strip() or None,
    "expires_at": 0.0,
}


def _use_sandbox() -> bool:
    # Domyślnie produkcja (Railway). Sandbox tylko gdy świadomie włączysz FURGONETKA_SANDBOX=1.
    raw = (os.getenv("FURGONETKA_SANDBOX") or "").strip().lower()
    return raw in ("1", "true", "yes", "on", "sandbox", "test")


def api_base() -> str:
    custom = (os.getenv("FURGONETKA_API_URL") or "").strip().rstrip("/")
    if custom:
        return custom
    # Sandbox panel: sandbox.furgonetka.pl — REST zwykle api.sandbox… lub prod z kontem testowym
    if _use_sandbox():
        return (
            (os.getenv("FURGONETKA_SANDBOX_API_URL") or "").strip().rstrip("/")
            or "https://api.sandbox.furgonetka.pl"
        )
    return "https://api.furgonetka.pl"


def furgonetka_configured() -> bool:
    if (os.getenv("FURGONETKA_API_KEY") or os.getenv("FURGONETKA_ACCESS_TOKEN") or "").strip():
        return True
    email = (os.getenv("FURGONETKA_EMAIL") or os.getenv("FURGONETKA_USERNAME") or "").strip()
    password = (os.getenv("FURGONETKA_PASSWORD") or "").strip()
    cid = (os.getenv("FURGONETKA_CLIENT_ID") or "").strip()
    secret = (os.getenv("FURGONETKA_CLIENT_SECRET") or "").strip()
    return bool(email and password and cid and secret)


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
                raise RuntimeError(f"Furgonetka {r.status_code}: {r.text[:400]}")
            return r.content
        if r.status_code == 204:
            return None
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            msg = data.get("message") or data.get("error_description") or str(data)[:300]
            raise RuntimeError(f"Furgonetka {r.status_code}: {msg}")
        return data


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
            "Włącz InPost Kurier w panelu (sandbox) lub ustaw FURGONETKA_INPOST_SERVICE_ID."
        )
    return inpost["id"]


def _parse_lp_ship(notes: Optional[str]) -> Optional[dict[str, Any]]:
    if not notes:
        return None
    idx = notes.find(LP_SHIP_PREFIX)
    if idx < 0:
        return None
    raw = notes[idx + len(LP_SHIP_PREFIX) :].strip()
    if " |" in raw:
        raw = raw.split(" |", 1)[0].strip()
    try:
        import json
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _split_street(address: Optional[str]) -> tuple[str, str]:
    text = (address or "").strip() or "ul. Producenta"
    m = re.search(r"^(.*?)[\s,]+(\d+[A-Za-z]?(?:/\d+[A-Za-z]?)?)\s*$", text)
    if m:
        return m.group(1).strip()[:60] or "ul. Producenta", m.group(2)[:10]
    return text[:60], "1"


def _party(
    *,
    name: str,
    company: str,
    email: str,
    phone: str,
    street: str,
    city: str,
    postcode: str,
) -> dict[str, Any]:
    return {
        "name": (name or company or "Odbiorca")[:70],
        "company": (company or name or "")[:70],
        "email": (email or "orders@gastromanager.app")[:100],
        "phone": "".join(str(phone or "500600700").split())[:20],
        "street": (street or "ul. Przykładowa 1")[:70],
        "city": (city or "Warszawa")[:40],
        "country_code": "PL",
        "postcode": "".join(str(postcode or "00-001").split())[:10],
        "county": "",
    }


async def download_label_pdf(package_id: str) -> bytes:
    page = (os.getenv("FURGONETKA_LABEL_PAGE") or "a6").lower()
    content = await _api(
        "GET",
        f"/packages/{package_id}/label",
        accept="application/pdf",
        raw=True,
        params={"label[page_format]": page},
    )
    if not content:
        raise RuntimeError("Etykieta jeszcze niedostępna (204) — spróbuj za chwilę.")
    return content


async def _patch_order_package_id(
    client: httpx.AsyncClient,
    sb_patch,
    order_id: str,
    package_id: str,
    *,
    tracking: Optional[str] = None,
    ordered: bool = False,
) -> None:
    """Zapis furgonetka_package_id (+ alias broker_package_id)."""
    base = {
        "furgonetka_package_id": package_id,
        "broker_package_id": package_id,
        "broker_name": "furgonetka",
        "broker_label_ready": ordered,
        "shipment_status": "shipped" if ordered else "preparing",
        "order_status": "processing",
    }
    if tracking:
        base["delivery_tracking"] = str(tracking)

    for candidate in (
        base,
        {
            "furgonetka_package_id": package_id,
            "broker_package_id": package_id,
            "broker_name": "furgonetka",
            "shipment_status": base["shipment_status"],
        },
        {"furgonetka_package_id": package_id, "shipment_status": "preparing"},
        {"broker_package_id": package_id, "shipment_status": "preparing"},
    ):
        try:
            await sb_patch(client, "producer_orders", {"id": f"eq.{order_id}"}, candidate)
            return
        except Exception as e:
            logger.info("patch package id candidate failed: %s", e)
            continue


async def create_furgonetka_shipment(
    order_id: str,
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
) -> dict[str, Any]:
    """
    Po opłaceniu zamówienia: tworzy przesyłkę InPost Kurier w Furgonetce
    i zapisuje furgonetka_package_id w producer_orders / widoku orders.
    """
    oid = (order_id or "").strip()
    if not oid:
        raise ValueError("Brak order_id")

    if not furgonetka_configured():
        try:
            await sb_patch(
                client,
                "producer_orders",
                {"id": f"eq.{oid}"},
                {
                    "shipment_status": "preparing",
                    "broker_name": "furgonetka",
                    "notes": "Furgonetka: brak FURGONETKA_EMAIL/PASSWORD — stub",
                },
            )
        except Exception:
            pass
        return {
            "ok": True,
            "stub": True,
            "message": "Furgonetka nie skonfigurowana (FURGONETKA_EMAIL + PASSWORD + CLIENT_*).",
        }

    rows = await sb_get(
        client,
        "producer_orders",
        params={"select": "*", "id": f"eq.{oid}", "limit": "1"},
    )
    if not rows:
        raise RuntimeError(f"Nie znaleziono zamówienia {oid}")
    order = rows[0]

    existing = (
        (order.get("furgonetka_package_id") or order.get("broker_package_id") or "")
    ).strip()
    if existing:
        return {
            "ok": True,
            "already": True,
            "furgonetka_package_id": existing,
            "package_id": existing,
        }

    if str(order.get("payment_status") or "").lower() != "paid":
        raise RuntimeError("Zamówienie nie jest opłacone — najpierw Stripe paid")

    prod_rows = await sb_get(
        client,
        "local_producers",
        params={"select": "*", "id": f"eq.{order.get('producer_id')}", "limit": "1"},
    )
    producer = (prod_rows or [{}])[0]
    if not producer:
        raise RuntimeError("Brak dystrybutora (local_producers) dla zamówienia")

    ship = _parse_lp_ship(order.get("notes")) or {}
    restaurant_name = ship.get("name") or "Restauracja"
    restaurant_email = ship.get("email")
    account_key = order.get("restaurant_account_key")
    if account_key:
        try:
            profiles = await sb_get(
                client,
                "profiles",
                params={
                    "select": "restaurant_name,email",
                    "account_key": f"eq.{account_key}",
                    "limit": "1",
                },
            )
            if profiles:
                restaurant_name = ship.get("name") or profiles[0].get("restaurant_name") or restaurant_name
                restaurant_email = ship.get("email") or profiles[0].get("email") or restaurant_email
        except Exception:
            pass

    s_street, s_building = _split_street(producer.get("address"))
    pickup = _party(
        name=str(producer.get("owner_name") or producer.get("company_name") or "Producent"),
        company=str(producer.get("company_name") or "Producent"),
        email=str(producer.get("email") or "producer@example.com"),
        phone=str(producer.get("phone") or "500600700"),
        street=f"{s_street} {s_building}".strip(),
        city=str(producer.get("city") or "Warszawa"),
        postcode=str(producer.get("postal_code") or "00-001"),
    )
    receiver = _party(
        name=str(restaurant_name),
        company=str(restaurant_name),
        email=str(restaurant_email or "orders@gastromanager.app"),
        phone=str(ship.get("phone") or "500600700"),
        street=f"{ship.get('street') or 'ul. Restauracyjna'} {ship.get('building_number') or '1'}".strip(),
        city=str(ship.get("city") or "Warszawa"),
        postcode=str(ship.get("post_code") or "00-001"),
    )

    service_id = await resolve_inpost_service_id()
    payload = {
        "pickup": pickup,
        "receiver": receiver,
        "service_id": service_id,
        "parcels": [{
            "height": 20,
            "width": 30,
            "depth": 40,
            "weight": 2,
            "quantity": 1,
            "type": "package",
        }],
        "user_reference_number": f"LP-{oid[:8]}",
        "additional_services": {},
    }

    try:
        await _api("POST", "/packages/validate", json_body=payload, accept=ACCEPT_V2)
    except Exception as e:
        logger.info("packages/validate: %s", e)

    created = await _api("POST", "/packages", json_body=payload, accept=ACCEPT_V2)
    package_id = str((created or {}).get("package_id") or (created or {}).get("id") or "")
    if not package_id:
        raise RuntimeError("Furgonetka nie zwróciła package_id")

    # Zamówienie u przewoźnika — opłata ze skarbonki prepaid
    cmd = str(uuid.uuid4())
    page = (os.getenv("FURGONETKA_LABEL_PAGE") or "a6").lower()
    await _api(
        "PUT",
        f"/order-commands/{cmd}",
        json_body={
            "packages": [{"id": package_id}],
            "label": {"file_format": "pdf", "page_format": page},
        },
        accept=ACCEPT_V1,
    )

    ordered = False
    for _ in range(12):
        await asyncio.sleep(1.5)
        status = await _api("GET", f"/order-commands/{cmd}", accept=ACCEPT_V1)
        st = str((status or {}).get("status") or "")
        if st in ("successful", "partial_success"):
            ordered = True
            break
        if st == "error":
            errs = (status or {}).get("errors") or []
            err0 = errs[0] if errs else {}
            raise RuntimeError(err0.get("details") or err0.get("message") or "order-commands error")

    tracking = None
    try:
        details = await _api("GET", f"/packages/{package_id}", accept=ACCEPT_V2)
        tracking = (details or {}).get("tracking_number")
        if not tracking:
            parcels = (details or {}).get("parcels") or []
            if parcels:
                tracking = parcels[0].get("tracking_number")
    except Exception:
        pass

    await _patch_order_package_id(
        client,
        sb_patch,
        oid,
        package_id,
        tracking=tracking,
        ordered=ordered,
    )

    return {
        "ok": True,
        "stub": False,
        "furgonetka_package_id": package_id,
        "package_id": package_id,
        "tracking": tracking,
        "ordered": ordered,
        "sandbox": _use_sandbox(),
        "api_base": api_base(),
        "prepaid_note": "Koszt etykiety ze skarbonki prepaid Furgonetka.",
    }


# Alias używany wcześniej w commerce
async def create_furgonetka_shipment_for_order(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order: dict[str, Any],
    producer: dict[str, Any] = None,
    receiver: dict[str, Any] = None,
) -> dict[str, Any]:
    return await create_furgonetka_shipment(
        str(order.get("id")),
        client=client,
        sb_get=sb_get,
        sb_patch=sb_patch,
    )
