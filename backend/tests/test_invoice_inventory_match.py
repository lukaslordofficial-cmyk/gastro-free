"""Regresja: faktura nie scala „ser mozzarella” z samym „ser”."""
from inventory_invoice_match import normalize_invoice_line_name
from server import (
    _find_inventory_duplicate,
    _food_names_compatible,
    _inventory_names_same_product,
)


def test_mozzarella_not_merged_into_generic_ser():
    assert _inventory_names_same_product("Ser mozzarella", "Ser") is False
    assert _inventory_names_same_product("mozarella", "ser") is False
    assert _inventory_names_same_product("Ser mozzarella", "Ser mozzarella") is True
    assert _inventory_names_same_product("Mozzarella", "Ser mozzarella") is True


def test_food_names_compatible_blocks_ser_subset():
    assert _food_names_compatible("Ser mozzarella", "Ser") is False
    assert _food_names_compatible("mozarella", "Ser") is False
    assert _food_names_compatible("Pomidor", "Pomidory") is True


def test_pomidor_still_merges_plural():
    assert _inventory_names_same_product("Pomidor", "Pomidory") is True
    assert _inventory_names_same_product("pomidory świeże", "pomidor") is True


def test_find_duplicate_invoice_creates_mozzarella_not_ser():
    rows = [
        {"id": "1", "name": "Ser", "quantity": 2, "unit": "kg"},
        {"id": "2", "name": "Mleko", "quantity": 10, "unit": "l"},
    ]
    for name in ("Ser mozzarella", "Ser mozarella", "Mozzarella", "Ser Mozz."):
        hit = _find_inventory_duplicate(name, rows, for_invoice=True)
        assert hit is None, name


def test_find_duplicate_invoice_updates_existing_mozzarella():
    rows = [
        {"id": "1", "name": "Ser", "quantity": 2, "unit": "kg"},
        {"id": "3", "name": "Ser mozzarella", "quantity": 1, "unit": "kg"},
    ]
    hit = _find_inventory_duplicate("mozarella", rows, for_invoice=True)
    assert hit is not None
    assert hit["id"] == "3"


def test_goat_vs_mozzarella_cheese_distinct():
    assert _inventory_names_same_product("ser kozi", "ser mozzarella") is False


def test_normalize_mozz_abbrev():
    assert "mozzarella" in normalize_invoice_line_name("Ser Mozz.").lower()
    assert normalize_invoice_line_name("Ser mozzarella") == "Ser mozzarella"
