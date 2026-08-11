"""Lokalni dostawcy w Łowcy — stock cap + search_scope."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import (  # noqa: E402
    _cap_order_qty_to_available_stock,
    _catalog_available_base_qty,
    _normalize_deal_hunter_search_scope,
    _strict_local_catalog_accept,
)


def test_search_scope_aliases():
    assert _normalize_deal_hunter_search_scope("lokalni") == "local_producers_only"
    assert _normalize_deal_hunter_search_scope("dostawcy") == "local_producers_only"
    assert _normalize_deal_hunter_search_scope("dystrybutorzy") == "local_producers_only"
    assert _normalize_deal_hunter_search_scope("both") == "both"
    assert _normalize_deal_hunter_search_scope("porownaj") == "both"
    assert _normalize_deal_hunter_search_scope(None) == "suppliers_only"


def test_stock_cap_5kg_need_3kg_available():
    """Użytkownik chce 5 kg, lokalny ma 3 kg → zamów 3 kg."""
    row = {
        "unit": "kg",
        "available_stock": 3,
        "source": "local_producer",
    }
    assert _catalog_available_base_qty(row, "kg") == 3.0
    qty, capped = _cap_order_qty_to_available_stock(5.0, 1.0, row, "kg")
    assert capped is True
    assert qty == 3.0


def test_stock_cap_no_limit_for_wholesaler():
    row = {"unit": "kg", "name": "buraki"}
    assert _catalog_available_base_qty(row, "kg") is None
    qty, capped = _cap_order_qty_to_available_stock(5.0, 1.0, row, "kg")
    assert capped is False
    assert qty == 5.0


def test_stock_cap_liters_and_pieces():
    row_l = {"unit": "l", "stock": 2.5}
    qty, capped = _cap_order_qty_to_available_stock(4.0, 1.0, row_l, "l")
    assert capped and qty == 2.5

    row_szt = {"unit": "szt", "available_stock": 7}
    qty2, capped2 = _cap_order_qty_to_available_stock(10.0, 1.0, row_szt, "szt")
    assert capped2 and qty2 == 7.0


def test_stock_cap_piece_pack_to_kg():
    """10 szt × 0.5 kg, potrzeba 8 kg → max 5 kg (10×0.5)."""
    row = {
        "unit": "szt",
        "available_stock": 10,
        "kg_total": 0.5,
    }
    assert _catalog_available_base_qty(row, "kg") == 5.0
    qty, capped = _cap_order_qty_to_available_stock(8.0, 0.5, row, "kg")
    assert capped is True
    assert qty == 5.0


def test_batat_plural_still_matches():
    assert _strict_local_catalog_accept(["batat"], "bataty")
    assert _strict_local_catalog_accept(["burak"], "buraki")
