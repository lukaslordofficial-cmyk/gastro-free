"""
Cena kuriera InPost (Furgonetka) wg wagi zamówienia.

Nie zgadujemy 15 zł na sztywno — paczka 7 kg to inna stawka niż 1 kg.
Stawki szacunkowe prepaid (PLN brutto), nadpisywalne env.
"""
from __future__ import annotations

import os
from typing import Iterable, Optional

from lp_packaging import estimate_order_weight_kg, parcel_max_kg, parcels_for_weight_kg


def _env_float(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip().replace(",", ".")
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def courier_price_bands_pln() -> list[tuple[float, float]]:
    """(górny próg kg, cena PLN) — rosnąco."""
    return [
        (_env_float("LP_COURIER_KG_1", 1.0), _env_float("LP_COURIER_PLN_1", 12.99)),
        (_env_float("LP_COURIER_KG_5", 5.0), _env_float("LP_COURIER_PLN_5", 15.99)),
        (_env_float("LP_COURIER_KG_10", 10.0), _env_float("LP_COURIER_PLN_10", 18.99)),
        (_env_float("LP_COURIER_KG_15", 15.0), _env_float("LP_COURIER_PLN_15", 22.99)),
        (_env_float("LP_COURIER_KG_20", 20.0), _env_float("LP_COURIER_PLN_20", 26.99)),
        (_env_float("LP_COURIER_KG_25", 25.0), _env_float("LP_COURIER_PLN_25", 32.99)),
        (_env_float("LP_COURIER_KG_30", 30.0), _env_float("LP_COURIER_PLN_30", 38.99)),
    ]


def courier_price_for_weight_kg(weight_kg: float) -> float:
    """Cena jednej paczki (albo suma, gdy waga > limit kuriera)."""
    kg = max(float(weight_kg or 0), 0.1)
    max_kg = max(1.0, parcel_max_kg())
    if kg > max_kg + 0.049:
        parcels = parcels_for_weight_kg(kg)
        return round(sum(courier_price_for_single_parcel_kg(float(p["weight"])) for p in parcels), 2)
    return courier_price_for_single_parcel_kg(kg)


def courier_price_for_single_parcel_kg(weight_kg: float) -> float:
    kg = max(float(weight_kg or 0), 0.1)
    last_price = 38.99
    for limit, price in courier_price_bands_pln():
        last_price = price
        if kg <= limit + 1e-9:
            return round(price, 2)
    extra = _env_float("LP_COURIER_PLN_OVER", 8.0)
    over = max(0.0, kg - 30.0)
    return round(last_price + extra * (over / 5.0), 2)


def quote_courier_for_items(
    items: Iterable[dict],
    products_by_id: Optional[dict[str, dict]] = None,
) -> dict:
    weight_kg = estimate_order_weight_kg(items, products_by_id)
    price = courier_price_for_weight_kg(weight_kg)
    parcels = parcels_for_weight_kg(weight_kg)
    return {
        "weight_kg": weight_kg,
        "price_pln": price,
        "parcels": len(parcels),
        "parcel_size": parcels[0].get("package_size") if parcels else "S",
    }
