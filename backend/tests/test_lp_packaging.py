"""Waga i rozmiar paczek LP."""
from lp_packaging import (
    estimate_order_weight_kg,
    furgonetka_parcels_payload,
    line_weight_kg,
    parcels_for_weight_kg,
    size_for_weight_kg,
)


def test_line_weight_kg_unit():
    assert line_weight_kg(quantity=3, unit="kg", weight_g=None) == 3
    assert line_weight_kg(quantity=500, unit="g", weight_g=None) == 0.5
    assert line_weight_kg(quantity=2, unit="szt", weight_g=1000) == 2.0


def test_estimate_mixed_items():
    items = [
        {"product_id": "a", "quantity": 2},
        {"product_id": "b", "quantity": 1.5},
    ]
    products = {
        "a": {"unit": "szt", "weight_g": 500},
        "b": {"unit": "kg", "weight_g": None},
    }
    assert estimate_order_weight_kg(items, products) == 2.5


def test_parcels_split_over_limit(monkeypatch):
    monkeypatch.setenv("LP_PARCEL_MAX_KG", "25")
    parcels = parcels_for_weight_kg(40)
    assert len(parcels) == 2
    payload = furgonetka_parcels_payload(parcels)
    assert all("package_size" not in p for p in payload)
    assert sum(p["weight"] for p in payload) >= 40


def test_size_buckets():
    assert size_for_weight_kg(1) == "S"
    assert size_for_weight_kg(8) == "M"
    assert size_for_weight_kg(20) == "L"
