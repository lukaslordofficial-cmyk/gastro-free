"""Smoke: eksporty używane przez server.py muszą istnieć (Railway import)."""
from ingredient_name_norm import (
    apply_normalize_ingredient_names_to_dishes,
    apply_whole_product_names_to_dishes,
    normalize_ingredient_name,
)


def test_normalize_plural():
    assert normalize_ingredient_name("pomidory") == "pomidor"


def test_apply_whole_product_on_dish_obj():
    class Ing:
        def __init__(self, name):
            self.name = name

    class Dish:
        ingredients = [Ing("żółtko"), Ing("pomidory")]

    d = Dish()
    apply_whole_product_names_to_dishes([d])
    assert d.ingredients[0].name == "jajko"
    assert d.ingredients[1].name == "pomidor"


def test_apply_normalize_alias_exists():
    # Import używany w server.py — brak = crash Railway healthcheck
    assert callable(apply_normalize_ingredient_names_to_dishes)
