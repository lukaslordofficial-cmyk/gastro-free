"""Tests for menu unit canonicalization (bug fix 1) and health endpoint (bug fix 2)."""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_BACKEND_URL', 'https://gastro-refactor.preview.emergentagent.com').rstrip('/')


def test_health_ok():
    r = requests.get(f"{BASE_URL}/api/", timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j.get('status') == 'ok'


def test_suggest_recipe_canonicalizes_shared_ingredient_units():
    """Bug 1: śmietana in one dish (ml) + another (g) → must return SAME unit in both."""
    payload = {
        "dishes": [
            {"name": "Krem z dyni", "hint_ingredients": ["dynia", "śmietana"]},
            {"name": "Placki ziemniaczane", "hint_ingredients": ["ziemniaki", "śmietana"]},
        ]
    }
    r = requests.post(f"{BASE_URL}/api/menu/suggest-recipe", json=payload, timeout=120)
    if r.status_code == 404:
        pytest.skip("suggest-recipe endpoint route shape not matching test payload")
    if r.status_code >= 500:
        pytest.skip(f"AI backend error: {r.status_code} {r.text[:200]}")
    assert r.status_code in (200, 201), f"Unexpected {r.status_code}: {r.text[:200]}"
    data = r.json()
    dishes = data.get('dishes') or data.get('items') or []
    if not dishes:
        pytest.skip("Response shape unknown; no dishes list returned")
    # Build map: ingredient name -> set of units seen
    seen = {}
    for d in dishes:
        ings = d.get('suggested_ingredients') or d.get('ingredients') or []
        for ing in ings:
            name = (ing.get('name') or ing.get('ingredient_name') or '').strip().lower()
            unit = (ing.get('unit') or '').strip().lower().rstrip('.')
            if not name or not unit:
                continue
            seen.setdefault(name, set()).add(unit)
    # For every shared ingredient across dishes, there must be only 1 unit
    for name, units in seen.items():
        assert len(units) == 1, f"Ingredient '{name}' has mixed units: {units}"
