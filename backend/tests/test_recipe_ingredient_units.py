"""Unit tests — recipe_ingredient_units (wydzielone z server)."""
from __future__ import annotations

from types import SimpleNamespace

from recipe_ingredient_units import (
    apply_integer_quantities_to_dishes,
    canonicalize_ingredient_units,
    is_porcja_row,
    normalize_recipe_quantity,
)


def test_normalize_recipe_quantity_floors_and_rounds():
    assert normalize_recipe_quantity(0) == 1
    assert normalize_recipe_quantity(0.25) == 1
    assert normalize_recipe_quantity(1.4) == 1
    assert normalize_recipe_quantity(1.6) == 2


def test_is_porcja_row():
    assert is_porcja_row("Porcja")
    assert is_porcja_row("gramatura porcji")
    assert not is_porcja_row("śmietana 18%")


def test_canonicalize_same_ingredient_units():
    dishes = [
        SimpleNamespace(
            ingredients=[
                SimpleNamespace(name="Śmietana", quantity=100, unit="ml"),
                SimpleNamespace(name="Śmietana", quantity=0.2, unit="l"),
            ]
        )
    ]
    canonicalize_ingredient_units(dishes)
    units = {ing.unit for ing in dishes[0].ingredients}
    assert units == {"ml"}
    assert dishes[0].ingredients[1].quantity == 200.0


def test_apply_integer_quantities():
    dishes = [
        SimpleNamespace(
            suggested_ingredients=[
                {"name": "sól", "quantity": 0.3, "unit": "g"},
                {"name": "pieprz", "quantity": None, "unit": "g"},
            ]
        )
    ]
    apply_integer_quantities_to_dishes(dishes)
    assert dishes[0].suggested_ingredients[0]["quantity"] == 1
    assert dishes[0].suggested_ingredients[1]["quantity"] == 1
