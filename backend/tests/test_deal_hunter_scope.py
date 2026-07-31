"""Scope rules for Łowca Okazji / critical-by-category (no random injection)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import _resolve_warehouse_categories  # noqa: E402


def test_resolve_mieso_to_meat_category():
    matched, unmatched = _resolve_warehouse_categories(["mięso"])
    assert matched == ["Mięso i wędliny"]
    assert unmatched == []


def test_resolve_brakujace_mieso_token():
    matched, unmatched = _resolve_warehouse_categories(["brakujące mięso"])
    assert matched == ["Mięso i wędliny"]
    assert unmatched == []


def test_ser_kozi_is_not_nabial_category():
    """Product name must NOT resolve to Nabiał via substring 'ser'."""
    matched, unmatched = _resolve_warehouse_categories(["ser kozi"])
    assert "Nabiał" not in matched
    assert unmatched == ["ser kozi"]


def test_all_categories():
    matched, unmatched = _resolve_warehouse_categories(["all"])
    assert matched == ["all"]
    assert unmatched == []


def test_named_product_like_category_stays_unmatched():
    matched, unmatched = _resolve_warehouse_categories(["filet z kurczaka"])
    assert matched == []
    assert unmatched == ["filet z kurczaka"]


def test_warzywa_and_nabial():
    matched, unmatched = _resolve_warehouse_categories(["warzywa", "nabiał"])
    assert matched == ["Warzywa i owoce", "Nabiał"]
    assert unmatched == []
