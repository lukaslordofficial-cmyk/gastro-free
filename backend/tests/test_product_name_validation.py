"""Testy walidacji nazw produktów (po usunięciu delta_scraper)."""
from product_name_validation import is_valid_product_name


def test_rejects_units_and_junk():
    assert not is_valid_product_name("szt")
    assert not is_valid_product_name("szt.")
    assert not is_valid_product_name("text")
    assert not is_valid_product_name("12,99")
    assert not is_valid_product_name("katalog")


def test_accepts_real_product_names():
    assert is_valid_product_name("Pomidor malinowy")
    assert is_valid_product_name("Masło ekstra 200g")
