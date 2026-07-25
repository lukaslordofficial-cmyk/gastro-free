"""Reguła MAX_GAP: nie twórz koszyka u nowego dostawcy przy luce > 150 zł."""
from __future__ import annotations

from smart_basket_optimizer import (
    MAX_GAP_NEW_BASKET_PLN,
    build_smart_optimize_response,
    compute_split_max,
)


def _quote(sid: str, name: str, line_total: float) -> dict:
    return {
        "supplier_id": sid,
        "supplier_name": name,
        "supplier_email": None,
        "matched_name": "Herbata",
        "unit_price_base": line_total,
        "base_dim": "szt",
        "line_total": line_total,
        "order_base_qty": 1,
        "target_base_qty": 1,
    }


def test_max_gap_constant_is_150():
    assert MAX_GAP_NEW_BASKET_PLN == 150.0


def test_no_new_basket_when_gap_over_150_exclusive():
    """Herbata tylko w Eurocash (min 800) → brak koszyka Eurocash, pozycja w missing."""
    items = [
        {
            "product_name": "Herbata",
            "quantity": 1,
            "unit": "szt",
            "base_dim": "szt",
            "best_by_supplier": {
                "euro": _quote("euro", "Eurocash", 35.0),
            },
        }
    ]
    meta = {
        "euro": {"name": "Eurocash", "min_order_value": 800, "shipping_cost": 0, "free_shipping_threshold": 0},
    }
    sc = compute_split_max(items, meta)
    assert sc["suppliers"] == []
    assert "Herbata" in (sc.get("missing") or [])


def test_no_new_basket_when_gap_over_150_with_cheaper_elsewhere():
    """Herbata tańsza w Eurocash (min 800), droższa w Makro (bez min) → bierz Makro."""
    items = [
        {
            "product_name": "Herbata",
            "quantity": 1,
            "unit": "szt",
            "base_dim": "szt",
            "best_by_supplier": {
                "euro": _quote("euro", "Eurocash", 30.0),
                "makro": {**_quote("makro", "Makro", 42.0), "matched_name": "Herbata liściasta"},
            },
        }
    ]
    meta = {
        "euro": {"name": "Eurocash", "min_order_value": 800, "shipping_cost": 0, "free_shipping_threshold": 0},
        "makro": {"name": "Makro", "min_order_value": 0, "shipping_cost": 0, "free_shipping_threshold": 0},
    }
    sc = compute_split_max(items, meta)
    sids = [g["supplier_id"] for g in sc["suppliers"]]
    assert "euro" not in sids
    assert "makro" in sids
    assert sc["suppliers"][0]["items"][0]["product_name"] == "Herbata"


def test_full_response_filters_eurocash_tea():
    items = [
        {
            "product_name": "Herbata",
            "quantity": 2,
            "unit": "szt",
            "base_dim": "szt",
            "best_by_supplier": {
                "euro": _quote("euro", "Eurocash", 40.0),
            },
        },
        {
            "product_name": "Mąka",
            "quantity": 10,
            "unit": "kg",
            "base_dim": "kg",
            "best_by_supplier": {
                "makro": {
                    "supplier_id": "makro",
                    "supplier_name": "Makro",
                    "supplier_email": None,
                    "matched_name": "Mąka",
                    "unit_price_base": 3.5,
                    "base_dim": "kg",
                    "line_total": 35.0,
                    "order_base_qty": 10,
                    "target_base_qty": 10,
                },
            },
        },
    ]
    meta = {
        "euro": {"name": "Eurocash", "min_order_value": 800, "shipping_cost": 0, "free_shipping_threshold": 0},
        "makro": {"name": "Makro", "min_order_value": 0, "shipping_cost": 0, "free_shipping_threshold": 0},
    }
    result = build_smart_optimize_response(items, meta)
    for key in ("scenario_split_max", "scenario_monolith", "scenario_smart_hybrid"):
        sc = result.get(key) or {}
        for g in sc.get("suppliers") or []:
            assert g.get("supplier_id") != "euro", f"{key} nadal ma Eurocash"
            gap = float(g.get("gap_to_minimum_pln") or 0)
            min_v = float(g.get("min_order_value") or 0)
            if min_v > 0 and not g.get("meets_minimum_order"):
                assert gap <= MAX_GAP_NEW_BASKET_PLN
