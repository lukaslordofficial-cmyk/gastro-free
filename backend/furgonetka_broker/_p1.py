from __future__ import annotations

from pl_phone import pl_phone_digits
from typing import Any
from typing import Optional
import httpx
import json
import os
import re
from ._p0 import ACCEPT_V1, ACCEPT_V2, LP_COURIER_PREFIX, LP_SHIP_PREFIX, _api, _has_oauth_secrets, _is_client_auth_error, _use_mock, logger



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
    digits = pl_phone_digits(raw)
    if digits:
        return digits
    return re.sub(r"\D", "", str(raw or ""))[:20]


def _ensure_person_name(raw: str, *, fallback_last: str = "Kontakt") -> str:
    """
    Furgonetka wymaga imienia i nazwiska (min. 2 człony) w polu ``name``.
    Nazwa restauracji typu „alkor” dostaje drugi człon, żeby walidacja przeszła.
    """
    cleaned = re.sub(r"\s+", " ", (raw or "").strip())
    if not cleaned:
        return f"Odbiorca {fallback_last}"[:70]
    parts = [p for p in cleaned.split(" ") if p]
    if len(parts) >= 2:
        return cleaned[:70]
    return f"{parts[0]} {fallback_last}"[:70]


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
    contact = _ensure_person_name(name or company or "")
    return {
        "name": contact,
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

__all__ = ['_ensure_person_name', '_missing_party_fields', '_normalize_phone', '_normalize_postcode', '_parse_lp_courier', '_parse_lp_ship', '_party', '_patch_order', '_save_shipping_error', '_split_street', 'calculate_courier_quotes', 'download_label_pdf', 'list_account_services']
