"""Unit tests for bargain_hunter pure functions."""
from __future__ import annotations

import pytest

from bargain_hunter import (
    build_optimize_response,
    compute_monolith,
    compute_split,
    find_tied_suppliers,
    line_total,
)


def _quote(sid: str, name: str, price: float, qty: float = 1.0) -> dict:
    lt = line_total(price, qty)
    return {
        "supplier_id": sid,
        "supplier_name": name,
        "supplier_email": f"{sid}@test.pl",
        "matched_name": f"Produkt {name}",
        "unit_price_base": price,
        "line_total": lt,
    }


def _item(name: str, qty: float, quotes: dict[str, dict]) -> dict:
    return {
        "product_name": name,
        "quantity": qty,
        "unit": "kg",
        "base_dim": "kg",
        "base_quantity": qty,
        "best_by_supplier": quotes,
    }


META = {
    "s1": {"name": "Hurtownia A", "email": "a@test.pl", "min_order_value": 0},
    "s2": {"name": "Hurtownia B", "email": "b@test.pl", "min_order_value": 0},
    "s3": {"name": "Hurtownia C", "email": "c@test.pl", "min_order_value": 100},
}


class TestLineTotal:
    def test_rounds_to_two_decimals(self):
        assert line_total(10.555, 2) == 21.11


class TestSingleSku:
    def test_not_optimized_one_supplier(self):
        items = [_item("kurczak", 5, {"s1": _quote("s1", "A", 18, 5)})]
        result = build_optimize_response(items, META)
        assert result["is_optimized"] is False
        assert result["best_option"] is not None
        assert result["savings_pln"] == 0.0
        assert result["option_all_one"] is not None
        assert result["option_optimized"]["total_pln"] == result["option_all_one"]["total_pln"]

    def test_tied_suppliers_same_price(self):
        items = [
            _item(
                "kurczak",
                2,
                {
                    "s1": _quote("s1", "A", 10, 2),
                    "s2": _quote("s2", "B", 10, 2),
                },
            )
        ]
        tied = find_tied_suppliers(items[0], 20.0, META)
        assert len(tied) == 2
        result = build_optimize_response(items, META)
        assert result["is_optimized"] is False
        assert len(result["tied_suppliers"]) == 2

    def test_tied_excludes_different_min_order(self):
        items = [
            _item(
                "kurczak",
                2,
                {
                    "s1": _quote("s1", "A", 10, 2),
                    "s3": _quote("s3", "C", 10, 2),
                },
            )
        ]
        tied = find_tied_suppliers(items[0], 20.0, META)
        assert len(tied) == 1
        assert tied[0]["supplier_id"] == "s1"


class TestMultiSku:
    def test_same_total_not_optimized(self):
        items = [
            _item("a", 1, {"s1": _quote("s1", "A", 10, 1), "s2": _quote("s2", "B", 15, 1)}),
            _item("b", 1, {"s1": _quote("s1", "A", 10, 1), "s2": _quote("s2", "B", 15, 1)}),
        ]
        result = build_optimize_response(items, META)
        assert result["is_optimized"] is False
        assert result["option_all_one"]["total_pln"] == result["option_optimized"]["total_pln"]

    def test_different_totals_optimized(self):
        items = [
            _item("a", 1, {"s1": _quote("s1", "A", 20, 1), "s2": _quote("s2", "B", 10, 1)}),
            _item("b", 1, {"s1": _quote("s1", "A", 5, 1), "s2": _quote("s2", "B", 20, 1)}),
        ]
        result = build_optimize_response(items, META)
        assert result["is_optimized"] is True
        assert result["savings_pln"] > 0
        assert result["cheaper_variant"] in ("monolith", "split")
        assert result["pricing_matrix"]
        assert len(result["pricing_matrix"]) == 2


class TestMonolithPartialCoverage:
    def test_monolith_missing_items(self):
        items = [
            _item("a", 1, {"s1": _quote("s1", "A", 10, 1)}),
            _item("b", 1, {"s2": _quote("s2", "B", 5, 1)}),
        ]
        mono = compute_monolith(items, META)
        assert mono is not None
        assert len(mono["missing"]) >= 1

    def test_split_covers_both(self):
        items = [
            _item("a", 1, {"s1": _quote("s1", "A", 10, 1)}),
            _item("b", 1, {"s2": _quote("s2", "B", 5, 1)}),
        ]
        split = compute_split(items, META)
        assert split["missing"] == []
        assert split["total_pln"] == 15.0
