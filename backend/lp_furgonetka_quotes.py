"""
Wycena kurierów Furgonetka (POST /packages/calculate-price) — porównanie stawek.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

SERVICE_LABELS = {
    "inpost": "InPost Kurier",
    "dpd": "DPD",
    "ups": "UPS",
    "gls": "GLS",
    "fedex": "FedEx",
    "dhl": "DHL",
    "poczta": "Poczta Polska",
    "orlen": "Orlen Paczka",
    "meest": "Meest",
    "ambro": "Ambro Express",
}


def service_label(code: str | None) -> str:
    key = str(code or "").strip().lower()
    return SERVICE_LABELS.get(key, (code or "Kurier").strip() or "Kurier")


def _parcel_weight_kg(parcels: Iterable[dict[str, Any]]) -> float:
    total = 0.0
    for p in parcels:
        try:
            w = float(p.get("weight") or 0)
        except (TypeError, ValueError):
            w = 0.0
        try:
            q = float(p.get("quantity") or 1)
        except (TypeError, ValueError):
            q = 1.0
        total += max(w, 0) * max(q, 1)
    return round(max(total, 0.1), 3)


def mock_quotes_for_parcels(parcels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sandbox bez OAuth — stawki rosną z wagą i objętością, nie stałe 15 zł."""
    kg = _parcel_weight_kg(parcels)
    vol = 0.0
    for p in parcels:
        try:
            vol += (
                float(p.get("width") or 20)
                * float(p.get("height") or 15)
                * float(p.get("depth") or 20)
                * float(p.get("quantity") or 1)
            )
        except (TypeError, ValueError):
            vol += 6000
    vol_m3 = vol / 1_000_000.0
    base = 9.5 + 1.15 * kg + 42.0 * vol_m3
    rows = [
        ("inpost", 1.00, 12301),
        ("dpd", 1.08, 12302),
        ("gls", 1.12, 12303),
        ("ups", 1.28, 12304),
        ("dhl", 1.35, 12305),
        ("poczta", 0.96, 12306),
    ]
    out = []
    for code, mult, sid in rows:
        gross = round(base * mult, 2)
        net = round(gross / 1.23, 2)
        out.append({
            "service_id": sid,
            "service": code,
            "name": service_label(code),
            "available": True,
            "price_gross": gross,
            "price_net": net,
            "tax": 23,
            "source": "sandbox",
        })
    out.sort(key=lambda r: r["price_gross"])
    return out


def normalize_services_prices(
    raw: Any,
    *,
    services_by_id: Optional[dict[Any, dict]] = None,
) -> list[dict[str, Any]]:
    rows = []
    if isinstance(raw, dict):
        items = raw.get("services_prices") or raw.get("prices") or []
    elif isinstance(raw, list):
        items = raw
    else:
        items = []
    services_by_id = services_by_id or {}
    for item in items:
        if not isinstance(item, dict):
            continue
        sid = item.get("service_id")
        code = str(item.get("service") or "").strip().lower()
        meta = services_by_id.get(sid) or services_by_id.get(str(sid)) or {}
        if not code:
            code = str(meta.get("service") or "").strip().lower()
        name = (
            (meta.get("name") or "").strip()
            or service_label(code)
        )
        available = item.get("available") is not False
        pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
        try:
            gross = float(pricing.get("price_gross") or item.get("price_gross") or 0)
        except (TypeError, ValueError):
            gross = 0.0
        try:
            net = float(pricing.get("price_net") or item.get("price_net") or 0)
        except (TypeError, ValueError):
            net = 0.0
        errors = item.get("errors") or []
        err0 = ""
        if errors and isinstance(errors[0], dict):
            err0 = str(errors[0].get("details") or errors[0].get("message") or "")[:180]
        elif errors:
            err0 = str(errors[0])[:180]
        rows.append({
            "service_id": sid,
            "service": code,
            "name": name,
            "available": available and gross > 0,
            "price_gross": round(gross, 2) if gross else None,
            "price_net": round(net, 2) if net else None,
            "tax": pricing.get("tax"),
            "error": err0 or None,
            "source": "furgonetka",
        })
    rows.sort(key=lambda r: (not r["available"], r.get("price_gross") or 9999))
    return rows
