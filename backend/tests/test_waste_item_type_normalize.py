"""Waste item_type normalization + piece size helpers."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from voice_actions_waste import (  # noqa: E402
    _piece_size_from_payload,
    normalize_waste_item_type,
)


def test_normalize_item_type_aliases():
    assert normalize_waste_item_type("ingredient") == "ingredient"
    assert normalize_waste_item_type("Składnik") == "ingredient"
    assert normalize_waste_item_type("DISH") == "dish"
    assert normalize_waste_item_type("potrawa") == "dish"
    assert normalize_waste_item_type("unknown") == ""
    assert normalize_waste_item_type(None) == ""


def test_piece_size_prefers_payload_over_inventory():
    assert _piece_size_from_payload({"piece_weight_g": 180}, {"unit_weight_volume": 250}) == 180.0
    assert _piece_size_from_payload({}, {"unit_weight_volume": 250}) == 250.0
    assert _piece_size_from_payload({"piece_weight_g": ""}, {"unit_weight_volume": None}) is None
