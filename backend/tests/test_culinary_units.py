"""Tests: culinary_units + canonicalize bugfix contract."""
from __future__ import annotations

import culinary_units as cu


def test_convert_kg_to_g():
    assert cu.convert(1.0, "kg", "g") == 1000.0


def test_convert_ml_to_g_density():
    assert cu.convert(100.0, "ml", "g") == 100.0


def test_convert_culinary_piece_default():
    # 1 szt ≈ 200 g
    assert cu.convert_culinary(1.0, "szt", "g") == 200.0


def test_is_piece_unit():
    assert cu.is_piece_unit("szt")
    assert cu.is_piece_unit("opakowanie")
    assert not cu.is_piece_unit("g")


def test_canon_dim():
    assert cu.canon_dim("kg") == "gml"
    assert cu.canon_dim("szt") == "szt"
    assert cu.canon_dim("porcja") is None


def test_yield_available_direct():
    qty, ok = cu.yield_available(2.0, "kg", None, None, "g")
    assert ok and qty == 2000.0
