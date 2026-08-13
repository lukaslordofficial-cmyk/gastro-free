"""
Dobór paczek LP na podstawie wagi zamówienia.

Nie zgadujemy kartonu z samej liczby kilogramów produktu luzem —
bierzemy weight_g produktu albo jednostkę kg/g, potem dzielimy na
paczki mieszczące się w limicie kuriera (domyślnie 25 kg).
"""
from __future__ import annotations

import math
import os
from typing import Any, Iterable, Optional


def _env_float(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip().replace(",", ".")
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def parcel_thresholds_kg() -> tuple[float, float, float]:
    """S / M / L — górne progi wagi (kg)."""
    return (
        _env_float("LP_PARCEL_S_KG", 5.0),
        _env_float("LP_PARCEL_M_KG", 15.0),
        _env_float("LP_PARCEL_L_KG", 25.0),
    )


def parcel_max_kg() -> float:
    return _env_float("LP_PARCEL_MAX_KG", 25.0)


def unknown_unit_kg() -> float:
    """Fallback gdy produkt nie ma wagi (kg na 1 szt. / 1 jednostkę)."""
    return _env_float("LP_PARCEL_FALLBACK_UNIT_KG", 0.5)


def _dims_for_size(size: str) -> dict[str, int]:
    """Wymiary cm — nadpisywalne env (szer. × wys. × gł.)."""
    key = size.upper()
    w = _env_int(f"LP_PARCEL_{key}_WIDTH_CM", {"S": 20, "M": 30, "L": 40, "XL": 50}[key])
    h = _env_int(f"LP_PARCEL_{key}_HEIGHT_CM", {"S": 15, "M": 20, "L": 30, "XL": 40}[key])
    d = _env_int(f"LP_PARCEL_{key}_DEPTH_CM", {"S": 20, "M": 25, "L": 30, "XL": 40}[key])
    return {"width": w, "height": h, "depth": d}


def size_for_weight_kg(weight_kg: float) -> str:
    s, m, l = parcel_thresholds_kg()
    if weight_kg <= s:
        return "S"
    if weight_kg <= m:
        return "M"
    if weight_kg <= l:
        return "L"
    return "XL"


def line_weight_kg(
    *,
    quantity: Any,
    unit: Optional[str],
    weight_g: Any,
) -> float:
    try:
        qty = float(quantity or 0)
    except (TypeError, ValueError):
        qty = 0.0
    if qty <= 0:
        return 0.0

    u = (unit or "szt").strip().lower()
    if u in ("kg", "kilogram", "kilogramy", "kilograma"):
        return qty
    if u in ("g", "gram", "gramy", "grama"):
        return qty / 1000.0

    try:
        wg = float(weight_g or 0)
    except (TypeError, ValueError):
        wg = 0.0
    if wg > 0:
        return qty * (wg / 1000.0)

    # l / ml — gęstość ~ wody, tylko do szacunku kuriera
    if u in ("l", "ltr", "litr", "litry", "litra"):
        return qty
    if u in ("ml",):
        return qty / 1000.0

    return qty * unknown_unit_kg()


def estimate_order_weight_kg(
    items: Iterable[dict[str, Any]],
    products_by_id: Optional[dict[str, dict[str, Any]]] = None,
) -> float:
    products_by_id = products_by_id or {}
    total = 0.0
    for item in items:
        pid = str(item.get("product_id") or "")
        prod = products_by_id.get(pid) or item.get("producer_products") or {}
        if not isinstance(prod, dict):
            prod = {}
        total += line_weight_kg(
            quantity=item.get("quantity"),
            unit=prod.get("unit") or item.get("unit"),
            weight_g=prod.get("weight_g") if prod.get("weight_g") is not None else item.get("weight_g"),
        )
    return round(max(total, 0.0), 3)


def parcels_for_weight_kg(weight_kg: float) -> list[dict[str, Any]]:
    """Lista paczek w formacie Furgonetka ``parcels`` (waga w kg, wymiary cm)."""
    max_kg = max(1.0, parcel_max_kg())
    remaining = max(weight_kg, 0.5)
    parcels: list[dict[str, Any]] = []
    guard = 0
    while remaining > 0.049 and guard < 20:
        guard += 1
        chunk = min(remaining, max_kg)
        size = size_for_weight_kg(chunk)
        dims = _dims_for_size(size if size != "XL" else "L")
        kg_int = max(1, int(math.ceil(chunk - 1e-9)))
        parcels.append({
            "type": "package",
            "quantity": 1,
            "weight": kg_int,
            "package_size": size,
            **dims,
        })
        remaining = round(remaining - chunk, 3)
    if not parcels:
        dims = _dims_for_size("S")
        parcels.append({"type": "package", "quantity": 1, "weight": 1, "package_size": "S", **dims})
    return parcels


def furgonetka_parcels_payload(parcels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Bez pola package_size — API Furgonetki go nie wymaga."""
    out = []
    for p in parcels:
        out.append({
            "type": p.get("type") or "package",
            "quantity": int(p.get("quantity") or 1),
            "weight": int(p.get("weight") or 1),
            "width": int(p.get("width") or 20),
            "height": int(p.get("height") or 15),
            "depth": int(p.get("depth") or 20),
        })
    return out
