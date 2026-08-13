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
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import time
import uuid
from typing import Any, Optional

import httpx

from billing_stripe import _ssl_verify
from lp_packaging import (
    estimate_order_weight_kg,
    furgonetka_parcels_payload,
    parcels_for_weight_kg,
)
from lp_tracking import (
    latest_tracking_state,
    order_status_for_state,
    shipment_status_for_state,
    tracking_events_public,
)

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
    raw = (os.getenv("FURGONETKA_SANDBOX") or "").strip().lower()
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
    custom = (os.getenv("FURGONETKA_API_URL") or "").strip().rstrip("/")
    if custom:
        return custom
    if _use_sandbox():
        return (
            (os.getenv("FURGONETKA_SANDBOX_API_URL") or "").strip().rstrip("/")
            or "https://api.sandbox.furgonetka.pl"
        )
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
                raise RuntimeError(f"Furgonetka {r.status_code}: {r.text[:400]}")
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
                return f"Furgonetka {status}: " + "; ".join(parts)
        msg = data.get("message") or data.get("error_description")
        if msg:
            return f"Furgonetka {status}: {msg}"
    return f"Furgonetka {status}: {(text or str(data))[:300]}"


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


async def list_account_services() -> list[dict[str, Any]]:
    data = await _api("GET", "/account/services", accept=ACCEPT_V1)
    services = (data or {}).get("services") or []
    return [s for s in services if isinstance(s, dict) and s.get("id")]


async def calculate_courier_quotes(
    *,
    pickup: dict[str, Any],
    receiver: dict[str, Any],
    parcels: list[dict[str, Any]],
) -> dict[str, Any]:
    """Oficjalna wycena Furgonetka — porównanie wszystkich usług na koncie."""
    from lp_furgonetka_quotes import mock_quotes_for_parcels, normalize_services_prices

    if _use_mock() and not _has_oauth_secrets():
        quotes = mock_quotes_for_parcels(parcels)
        return {"ok": True, "source": "sandbox", "quotes": quotes}

    try:
        services = await list_account_services()
        ids = [s.get("id") for s in services if s.get("id") is not None]
        if not ids:
            raise RuntimeError("Brak usług kurierskich na koncie Furgonetka (GET /account/services).")
        by_id = {s.get("id"): s for s in services}
        by_id.update({str(s.get("id")): s for s in services})
        body = {
            "package": {
                "pickup": pickup,
                "receiver": receiver,
                "service_id": ids[0],
                "parcels": parcels,
            },
            "services": {"service_id": ids},
        }
        data = await _api(
            "POST",
            "/packages/calculate-price",
            json_body=body,
            accept=ACCEPT_V2,
        )
        quotes = normalize_services_prices(data, services_by_id=by_id)
        return {"ok": True, "source": "furgonetka", "quotes": quotes}
    except Exception as exc:
        if _is_client_auth_error(exc):
            logger.warning("Furgonetka OAuth failed, using sandbox quotes: %s", exc)
            quotes = mock_quotes_for_parcels(parcels)
            return {
                "ok": True,
                "source": "sandbox",
                "quotes": quotes,
                "auth_error": str(exc)[:240],
            }
        raise


def _parse_lp_courier(notes: Optional[str]) -> Optional[dict[str, Any]]:
    if not notes:
        return None
    idx = notes.find(LP_COURIER_PREFIX)
    if idx < 0:
        return None
    raw = notes[idx + len(LP_COURIER_PREFIX) :].strip()
    if " |" in raw:
        raw = raw.split(" |", 1)[0].strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


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
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _split_street(address: Optional[str]) -> tuple[str, str]:
    text = (address or "").strip()
    if not text:
        return "", ""
    m = re.search(r"^(.*?)[\s,]+(\d+[A-Za-z]?(?:/\d+[A-Za-z]?)?)\s*$", text)
    if m:
        return m.group(1).strip()[:60], m.group(2)[:10]
    return text[:60], ""


def _normalize_postcode(raw: Optional[str]) -> str:
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 5:
        return f"{digits[:2]}-{digits[2:]}"
    return (raw or "").strip()


def _normalize_phone(raw: Optional[str]) -> str:
    digits = re.sub(r"\D", "", str(raw or ""))
    if digits.startswith("48") and len(digits) == 11:
        return digits
    if len(digits) == 9:
        return digits
    return digits[:20]


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
    street_full = (street or "").strip()[:70]
    return {
        "name": (name or company or "")[:70],
        "company": (company or name or "")[:70],
        "email": (
            (email or "").strip()
            or (os.getenv("FURGONETKA_FALLBACK_EMAIL") or "orders@gastromanager.app")
        )[:100],
        "phone": _normalize_phone(phone),
        "street": street_full,
        "city": (city or "")[:40],
        "country_code": "PL",
        "postcode": _normalize_postcode(postcode),
        "county": "",
    }


def _missing_party_fields(party: dict[str, Any], *, who: str) -> list[str]:
    need = {
        "name": "imię/nazwa",
        "phone": "telefon",
        "street": "ulica i numer",
        "city": "miasto",
        "postcode": "kod pocztowy",
    }
    missing = []
    for key, label in need.items():
        val = str(party.get(key) or "").strip()
        if not val:
            missing.append(f"{who}: {label}")
    pc = str(party.get("postcode") or "")
    if pc and not re.match(r"^\d{2}-\d{3}$", pc):
        missing.append(f"{who}: kod pocztowy (format 00-000)")
    phone = str(party.get("phone") or "")
    if phone and len(re.sub(r"\D", "", phone)) < 9:
        missing.append(f"{who}: telefon (min. 9 cyfr)")
    return missing


async def download_label_pdf(package_id: str) -> bytes:
    if str(package_id).startswith("mock-") or _use_mock():
        return (
            b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n"
            b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
            b"0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\n"
            b"startxref\n190\n%%EOF\n"
        )
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


async def _patch_order(
    client: httpx.AsyncClient,
    sb_patch,
    order_id: str,
    payload: dict[str, Any],
) -> None:
    keys = list(payload.keys())
    while keys:
        candidate = {k: payload[k] for k in keys}
        try:
            await sb_patch(client, "producer_orders", {"id": f"eq.{order_id}"}, candidate)
            return
        except Exception as e:
            logger.info("patch producer_orders dropped field (%s): %s", keys[-1], e)
            keys = keys[:-1]


async def _save_shipping_error(
    client: httpx.AsyncClient,
    sb_patch,
    order_id: str,
    message: str,
) -> None:
    await _patch_order(client, sb_patch, order_id, {
        "shipping_error": message[:500],
        "shipment_status": "preparing",
        "order_status": "preparing",
        "broker_name": "furgonetka",
    })


async def _poll_command(kind: str, cmd: str, *, rounds: int = 16) -> dict[str, Any]:
    last: dict[str, Any] = {}
    for _ in range(rounds):
        await asyncio.sleep(1.4)
        last = await _api("GET", f"/{kind}/{cmd}", accept=ACCEPT_V1) or {}
        st = str(last.get("status") or "")
        if st in ("successful", "partial_success"):
            return last
        if st == "error":
            errs = last.get("errors") or []
            err0 = errs[0] if errs else {}
            if isinstance(err0, dict):
                raise RuntimeError(
                    err0.get("details") or err0.get("message") or f"{kind} error"
                )
            raise RuntimeError(f"{kind} error")
    raise RuntimeError(f"{kind} timeout (status={last.get('status')})")


async def _ensure_regulations() -> None:
    try:
        data = await _api("GET", "/regulations", accept=ACCEPT_V1)
    except Exception as e:
        logger.info("GET /regulations: %s", e)
        return
    regs = (data or {}).get("regulations") if isinstance(data, dict) else data
    if not isinstance(regs, list):
        return
    pending = []
    for r in regs:
        if not isinstance(r, dict) or r.get("accepted"):
            continue
        pending.append({
            "service": r.get("service"),
            "version": r.get("version"),
            "datetime": r.get("datetime"),
            "accepted": True,
        })
    if not pending:
        return
    try:
        await _api("POST", "/regulations", json_body={"regulations": pending}, accept=ACCEPT_V1)
    except Exception:
        try:
            await _api("POST", "/regulations", json_body=pending, accept=ACCEPT_V1)
        except Exception as e:
            logger.warning("POST /regulations failed: %s", e)


def _extract_tracking(details: Optional[dict[str, Any]]) -> Optional[str]:
    if not details:
        return None
    tracking = details.get("tracking_number")
    if tracking:
        return str(tracking)
    parcels = details.get("parcels") or []
    if parcels and isinstance(parcels[0], dict):
        t = parcels[0].get("tracking_number")
        if t:
            return str(t)
    return None


async def _store_label_pdf(order_id: str, producer_id: str, package_id: str) -> Optional[str]:
    try:
        pdf = await download_label_pdf(package_id)
    except Exception as e:
        logger.info("label download skipped: %s", e)
        return None
    try:
        from lp_invoice_url import DEFAULT_DOCS_BUCKET, upload_private_bytes

        path = f"labels/{producer_id or 'unknown'}/{order_id}.pdf"
        return await upload_private_bytes(
            bucket=DEFAULT_DOCS_BUCKET,
            path=path,
            content=pdf,
            content_type="application/pdf",
            verify=_ssl_verify(),
        )
    except Exception as e:
        logger.info("label storage upload skipped: %s", e)
        return None


async def _schedule_pickup(package_id: str) -> dict[str, Any]:
    proposals_raw = await _api(
        "POST",
        "/packages/pickup-date-proposals",
        json_body={"packages": [{"id": package_id}]},
        accept=ACCEPT_V1,
    )
    packages = (proposals_raw or {}).get("packages") or []
    first = packages[0] if packages else {}
    proposals = first.get("proposals") or []
    chosen = next(
        (p for p in proposals if isinstance(p, dict) and p.get("available") is not False),
        None,
    )
    if not chosen:
        raise RuntimeError("Brak dostępnego terminu podjazdu kuriera")

    pickup_date = {
        "date": chosen.get("date"),
        "min_time": chosen.get("min_time"),
        "max_time": chosen.get("max_time"),
    }
    cmd = str(uuid.uuid4())
    await _api(
        "PUT",
        f"/pickup-commands/{cmd}",
        json_body={
            "packages": [{"id": package_id}],
            "pickup_date": pickup_date,
        },
        accept=ACCEPT_V1,
    )
    result = await _poll_command("pickup-commands", cmd)
    pickup_id = None
    details = result.get("pickup_details") or []
    if details and isinstance(details[0], dict):
        pickup_id = details[0].get("pickup_id")
    return {
        "pickup_date": pickup_date.get("date"),
        "pickup_min_time": pickup_date.get("min_time"),
        "pickup_max_time": pickup_date.get("max_time"),
        "pickup_id": pickup_id,
        "pickup_command": cmd,
    }


async def fetch_package_tracking(package_id: str) -> dict[str, Any]:
    payload = await _api("GET", f"/packages/{package_id}/tracking", accept=ACCEPT_V1)
    state = latest_tracking_state(payload)
    events = tracking_events_public(payload)
    return {"raw": payload, "state": state, "events": events}


async def sync_order_tracking(
    order_id: str,
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    package_id: Optional[str] = None,
) -> dict[str, Any]:
    oid = (order_id or "").strip()
    rows = await sb_get(client, "producer_orders", params={
        "select": "*", "id": f"eq.{oid}", "limit": "1",
    })
    if not rows:
        raise RuntimeError("Zamówienie nie istnieje")
    order = rows[0]
    pid = (package_id or order.get("furgonetka_package_id") or order.get("broker_package_id") or "").strip()
    if not pid:
        return {"ok": False, "error": "Brak przesyłki Furgonetka", "order": order}

    tracking = await fetch_package_tracking(pid)
    state = tracking.get("state")
    details = None
    tracking_no = order.get("delivery_tracking")
    courier = order.get("courier_name")
    try:
        details = await _api("GET", f"/packages/{pid}", accept=ACCEPT_V2)
        tracking_no = _extract_tracking(details) or tracking_no
        courier = (details or {}).get("service") or courier
        if not state:
            state = (details or {}).get("state")
    except Exception:
        pass

    from datetime import datetime, timezone

    patch = {
        "tracking_state": state,
        "tracking_synced_at": datetime.now(timezone.utc).isoformat(),
        "shipment_status": shipment_status_for_state(state, fallback=str(order.get("shipment_status") or "preparing")),
        "order_status": order_status_for_state(state, fallback=str(order.get("order_status") or "preparing")),
        "broker_name": "furgonetka",
    }
    if tracking_no:
        patch["delivery_tracking"] = str(tracking_no)
    if courier:
        patch["courier_name"] = str(courier)
    if state == "delivery-problem":
        patch["shipping_error"] = "Problem z doręczeniem — sprawdź tracking kuriera"
    elif state in ("delivered", "collected", "transit", "delivery", "ordered"):
        patch["shipping_error"] = None

    await _patch_order(client, sb_patch, oid, patch)
    new_ship = str(patch.get("shipment_status") or "")
    old_ship = str(order.get("shipment_status") or "")
    if new_ship == "shipped" and old_ship != "shipped":
        try:
            from lp_stock import decrement_stock_for_shipped_order
            await decrement_stock_for_shipped_order(
                client=client,
                sb_get=sb_get,
                sb_patch=sb_patch,
                order_id=oid,
                producer_id=str(order.get("producer_id") or ""),
            )
        except Exception:
            logger.exception("LP stock decrement on tracking shipped failed")
    return {
        "ok": True,
        "package_id": pid,
        "state": state,
        "shipment_status": patch["shipment_status"],
        "tracking": tracking_no,
        "courier_name": courier,
        "events": tracking.get("events") or [],
        "pickup_date": order.get("pickup_date"),
        "pickup_min_time": order.get("pickup_min_time"),
        "pickup_max_time": order.get("pickup_max_time"),
    }


async def _load_order_products(
    client: httpx.AsyncClient,
    sb_get,
    order_id: str,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    items = await sb_get(client, "producer_order_items", params={
        "select": "id,product_id,quantity,unit_price",
        "order_id": f"eq.{order_id}",
    }) or []
    ids = [str(i.get("product_id")) for i in items if i.get("product_id")]
    products: dict[str, dict[str, Any]] = {}
    if ids:
        # PostgREST: id=in.(a,b)
        joined = ",".join(ids)
        rows = await sb_get(client, "producer_products", params={
            "select": "id,title,unit,weight_g",
            "id": f"in.({joined})",
        }) or []
        for p in rows:
            products[str(p.get("id"))] = p
    return items, products


async def _finish_existing_package(
    *,
    client: httpx.AsyncClient,
    sb_patch,
    order: dict[str, Any],
    package_id: str,
) -> dict[str, Any]:
    """Idempotencja: dokończ order/etykietę/podjazd jeśli coś zostało w połowie."""
    oid = str(order.get("id"))
    details = await _api("GET", f"/packages/{package_id}", accept=ACCEPT_V2)
    state = str((details or {}).get("state") or "").lower()
    tracking = _extract_tracking(details)
    ordered = state not in ("", "waiting")
    page = (os.getenv("FURGONETKA_LABEL_PAGE") or "a6").lower()

    if not ordered:
        await _ensure_regulations()
        cmd = str(uuid.uuid4())
        await _api(
            "PUT",
            f"/order-commands/{cmd}",
            json_body={
                "packages": [{"id": package_id}],
                "label": {"file_format": "pdf", "page_format": page},
            },
            accept=ACCEPT_V1,
        )
        await _poll_command("order-commands", cmd)
        ordered = True
        details = await _api("GET", f"/packages/{package_id}", accept=ACCEPT_V2)
        tracking = _extract_tracking(details) or tracking
        state = str((details or {}).get("state") or state)

    pickup = {}
    if not order.get("pickup_date"):
        try:
            pickup = await _schedule_pickup(package_id)
        except Exception as e:
            logger.warning("pickup retry failed: %s", e)
            pickup = {"pickup_error": str(e)[:300]}

    label_ref = order.get("label_storage_path")
    if ordered and not label_ref:
        label_ref = await _store_label_pdf(oid, str(order.get("producer_id") or ""), package_id)

    patch = {
        "furgonetka_package_id": package_id,
        "broker_package_id": package_id,
        "broker_name": "furgonetka",
        "broker_label_ready": bool(ordered),
        "shipment_status": shipment_status_for_state(state, fallback="preparing"),
        "order_status": order_status_for_state(state, fallback="awaiting_courier" if ordered else "preparing"),
        "tracking_state": state,
    }
    if tracking:
        patch["delivery_tracking"] = tracking
    if (details or {}).get("service"):
        patch["courier_name"] = details.get("service")
    if label_ref:
        patch["label_storage_path"] = label_ref
    if pickup.get("pickup_date"):
        patch["pickup_date"] = pickup["pickup_date"]
        patch["pickup_min_time"] = pickup.get("pickup_min_time")
        patch["pickup_max_time"] = pickup.get("pickup_max_time")
        patch["shipping_error"] = None
    elif pickup.get("pickup_error"):
        patch["shipping_error"] = f"Przesyłka zamówiona, podjazd: {pickup['pickup_error']}"[:500]
    await _patch_order(client, sb_patch, oid, patch)
    return {
        "ok": True,
        "already": True,
        "furgonetka_package_id": package_id,
        "package_id": package_id,
        "tracking": tracking,
        "ordered": ordered,
        "pickup": pickup,
        "label_storage_path": label_ref,
    }


async def create_furgonetka_shipment(
    order_id: str,
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
) -> dict[str, Any]:
    """
    Po opłaceniu: paczka z wagą zamówienia → InPost Kurier → etykieta → podjazd.
    Idempotentne względem order_id (istniejący package_id = dokończenie, nie duplikat).
    """
    oid = (order_id or "").strip()
    if not oid:
        raise ValueError("Brak order_id")

    if not furgonetka_configured() and not _use_mock():
        await _save_shipping_error(
            client, sb_patch, oid,
            "Furgonetka nie skonfigurowana (CLIENT_ID/SECRET + EMAIL/PASSWORD na Railway) "
            "albo ustaw FURGONETKA_SANDBOX=1 i FURGONETKA_MOCK=1 do testów.",
        )
        return {
            "ok": False,
            "stub": True,
            "error": "Furgonetka nie skonfigurowana — sandbox: FURGONETKA_SANDBOX=1 FURGONETKA_MOCK=1.",
        }

    rows = await sb_get(
        client,
        "producer_orders",
        params={"select": "*", "id": f"eq.{oid}", "limit": "1"},
    )
    if not rows:
        raise RuntimeError(f"Nie znaleziono zamówienia {oid}")
    order = rows[0]

    if str(order.get("payment_status") or "").lower() != "paid":
        raise RuntimeError("Zamówienie nie jest opłacone — najpierw Stripe paid")

    existing = (
        (order.get("furgonetka_package_id") or order.get("broker_package_id") or "")
    ).strip()
    if existing:
        try:
            return await _finish_existing_package(
                client=client, sb_patch=sb_patch, order=order, package_id=existing,
            )
        except Exception as e:
            logger.exception("finish existing package failed")
            await _save_shipping_error(client, sb_patch, oid, str(e)[:500])
            return {"ok": False, "already": True, "package_id": existing, "error": str(e)[:300]}

    try:
        if _use_mock():
            return await _create_mock_shipment(
                client=client, sb_get=sb_get, sb_patch=sb_patch, order=order,
            )
        return await _create_new_shipment(
            client=client, sb_get=sb_get, sb_patch=sb_patch, order=order,
        )
    except Exception as e:
        logger.exception("create_furgonetka_shipment failed")
        await _save_shipping_error(client, sb_patch, oid, str(e)[:500])
        return {"ok": False, "error": str(e)[:400]}


async def _create_mock_shipment(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order: dict[str, Any],
) -> dict[str, Any]:
    """Pełny flow bez konta firmowego Furgonetka — etykieta + tracking testowy."""
    from datetime import datetime, timezone, timedelta

    oid = str(order.get("id"))
    items, products = await _load_order_products(client, sb_get, oid)
    weight_kg = estimate_order_weight_kg(items, products)
    parcels_full = parcels_for_weight_kg(weight_kg)
    package_id = f"mock-{oid[:8]}-{uuid.uuid4().hex[:8]}"
    tracking = f"MOCK{oid[:8].upper()}PL"
    pickup_day = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
    label_ref = None
    try:
        from lp_invoice_url import DEFAULT_DOCS_BUCKET, upload_private_bytes

        pdf = (
            b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n"
            b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
            b"0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\n"
            b"startxref\n190\n%%EOF\n"
        )
        path = f"labels/{order.get('producer_id') or 'unknown'}/{oid}.pdf"
        label_ref = await upload_private_bytes(
            bucket=DEFAULT_DOCS_BUCKET,
            path=path,
            content=pdf,
            content_type="application/pdf",
            verify=_ssl_verify(),
        )
    except Exception as e:
        logger.info("mock label upload skipped: %s", e)

    patch = {
        "furgonetka_package_id": package_id,
        "broker_package_id": package_id,
        "broker_name": "furgonetka-sandbox",
        "broker_label_ready": True,
        "shipment_status": "preparing",
        "order_status": "awaiting_courier",
        "tracking_state": "ordered",
        "parcel_weight_kg": weight_kg,
        "courier_name": order.get("courier_name") or "inpost",
        "delivery_tracking": tracking,
        "pickup_date": pickup_day,
        "pickup_min_time": "10:00",
        "pickup_max_time": "18:00",
        "shipping_error": None,
    }
    if label_ref:
        patch["label_storage_path"] = label_ref
    await _patch_order(client, sb_patch, oid, patch)
    return {
        "ok": True,
        "stub": False,
        "mock": True,
        "sandbox": True,
        "furgonetka_package_id": package_id,
        "package_id": package_id,
        "tracking": tracking,
        "ordered": True,
        "weight_kg": weight_kg,
        "parcels": parcels_full,
        "pickup": {
            "pickup_date": pickup_day,
            "pickup_min_time": "10:00",
            "pickup_max_time": "18:00",
        },
        "label_storage_path": label_ref,
        "courier_name": order.get("courier_name") or "inpost",
        "prepaid_note": "Tryb testowy (FURGONETKA_MOCK / SANDBOX) — kurier nie jedzie na serio.",
    }


async def _create_new_shipment(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order: dict[str, Any],
) -> dict[str, Any]:
    oid = str(order.get("id"))
    prod_rows = await sb_get(
        client,
        "local_producers",
        params={"select": "*", "id": f"eq.{order.get('producer_id')}", "limit": "1"},
    )
    producer = (prod_rows or [None])[0]
    if not producer:
        raise RuntimeError("Brak dystrybutora (local_producers) dla zamówienia")

    ship = _parse_lp_ship(order.get("notes")) or {}
    restaurant_name = (
        ship.get("name")
        or order.get("delivery_name")
        or order.get("restaurant_name")
        or "Restauracja"
    )
    restaurant_email = ship.get("email") or order.get("delivery_email")
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
    sender_street = " ".join(x for x in (s_street, s_building) if x).strip()
    recv_street = " ".join(
        x for x in (
            ship.get("street") or order.get("delivery_address"),
            ship.get("building_number"),
        ) if x
    ).strip()

    pickup = _party(
        name=str(producer.get("owner_name") or producer.get("company_name") or ""),
        company=str(producer.get("company_name") or ""),
        email=str(producer.get("email") or producer.get("invoice_email") or ""),
        phone=str(producer.get("phone") or ""),
        street=sender_street,
        city=str(producer.get("city") or ""),
        postcode=str(producer.get("postal_code") or ""),
    )
    receiver = _party(
        name=str(restaurant_name),
        company=str(restaurant_name),
        email=str(restaurant_email or ""),
        phone=str(ship.get("phone") or order.get("delivery_phone") or ""),
        street=recv_street,
        city=str(ship.get("city") or order.get("delivery_city") or ""),
        postcode=str(ship.get("post_code") or order.get("delivery_postal_code") or ""),
    )

    missing = _missing_party_fields(pickup, who="nadawca (dystrybutor)") + _missing_party_fields(
        receiver, who="odbiorca (restauracja)",
    )
    if missing:
        raise RuntimeError("Niekompletny adres: " + "; ".join(missing))

    items, products = await _load_order_products(client, sb_get, oid)
    weight_kg = estimate_order_weight_kg(items, products)
    parcels_full = parcels_for_weight_kg(weight_kg)
    courier_sel = _parse_lp_courier(order.get("notes")) or {}
    try:
        w = int(courier_sel.get("width") or 0)
        h = int(courier_sel.get("height") or 0)
        d = int(courier_sel.get("depth") or 0)
    except (TypeError, ValueError):
        w = h = d = 0
    if w > 0 and h > 0 and d > 0 and parcels_full:
        parcels_full[0]["width"] = w
        parcels_full[0]["height"] = h
        parcels_full[0]["depth"] = d
    parcels = furgonetka_parcels_payload(parcels_full)

    service_id = courier_sel.get("service_id")
    if service_id in (None, "", 0, "0"):
        service_id = await resolve_inpost_service_id()
    else:
        try:
            service_id = int(service_id)
        except (TypeError, ValueError):
            pass
    payload = {
        "pickup": pickup,
        "receiver": receiver,
        "service_id": service_id,
        "parcels": parcels,
        "user_reference_number": f"LP-{oid[:8]}",
        "additional_services": {},
    }

    await _ensure_regulations()
    await _api("POST", "/packages/validate", json_body=payload, accept=ACCEPT_V2)

    created = await _api("POST", "/packages", json_body=payload, accept=ACCEPT_V2)
    package_id = str((created or {}).get("package_id") or (created or {}).get("id") or "")
    if not package_id:
        raise RuntimeError("Furgonetka nie zwróciła package_id")

    await _patch_order(client, sb_patch, oid, {
        "furgonetka_package_id": package_id,
        "broker_package_id": package_id,
        "broker_name": "furgonetka",
        "shipment_status": "preparing",
        "order_status": "preparing",
        "parcel_weight_kg": weight_kg,
        "shipping_error": None,
    })

    page = (os.getenv("FURGONETKA_LABEL_PAGE") or "a6").lower()
    cmd = str(uuid.uuid4())
    await _api(
        "PUT",
        f"/order-commands/{cmd}",
        json_body={
            "packages": [{"id": package_id}],
            "label": {"file_format": "pdf", "page_format": page},
        },
        accept=ACCEPT_V1,
    )
    await _poll_command("order-commands", cmd)

    details = {}
    try:
        details = await _api("GET", f"/packages/{package_id}", accept=ACCEPT_V2) or {}
    except Exception:
        details = {}
    tracking = _extract_tracking(details)
    courier = details.get("service") or "inpost"
    state = str(details.get("state") or "ordered")

    label_ref = await _store_label_pdf(oid, str(order.get("producer_id") or ""), package_id)

    pickup_info: dict[str, Any] = {}
    pickup_error = None
    try:
        pickup_info = await _schedule_pickup(package_id)
    except Exception as e:
        pickup_error = str(e)[:300]
        logger.warning("pickup schedule failed: %s", e)

    patch = {
        "furgonetka_package_id": package_id,
        "broker_package_id": package_id,
        "broker_name": "furgonetka",
        "broker_label_ready": True,
        "shipment_status": shipment_status_for_state(state, fallback="preparing"),
        "order_status": order_status_for_state(state, fallback="awaiting_courier"),
        "tracking_state": state,
        "parcel_weight_kg": weight_kg,
        "courier_name": courier,
    }
    if tracking:
        patch["delivery_tracking"] = tracking
    if label_ref:
        patch["label_storage_path"] = label_ref
    if pickup_info.get("pickup_date"):
        patch["pickup_date"] = pickup_info["pickup_date"]
        patch["pickup_min_time"] = pickup_info.get("pickup_min_time")
        patch["pickup_max_time"] = pickup_info.get("pickup_max_time")
        patch["shipping_error"] = None
    if pickup_error:
        patch["shipping_error"] = f"Przesyłka zamówiona, podjazd: {pickup_error}"[:500]
    await _patch_order(client, sb_patch, oid, patch)

    return {
        "ok": True,
        "stub": False,
        "furgonetka_package_id": package_id,
        "package_id": package_id,
        "tracking": tracking,
        "ordered": True,
        "weight_kg": weight_kg,
        "parcels": parcels_full,
        "pickup": pickup_info,
        "pickup_error": pickup_error,
        "label_storage_path": label_ref,
        "courier_name": courier,
        "sandbox": _use_sandbox(),
        "api_base": api_base(),
        "prepaid_note": "Koszt etykiety ze skarbonki prepaid Furgonetka (konto platformy).",
    }


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
