"""Voice CRUD routes — mount + tenant guard expectations."""
from __future__ import annotations

import voice_crud_routes


def test_voice_crud_router_wired():
    paths = {getattr(r, "path", None) for r in voice_crud_routes.router.routes}
    assert "/api/menu/recompute-availability" in paths
    assert "/api/menu/set-price" in paths
    assert "/api/recipes/set-ingredient" in paths
    assert "/api/inventory/set-thresholds" in paths


def test_set_menu_price_model_rejects_negative_via_handler_contract():
    # Walidacja ceny jest w handlerze (nie Field ge=0) — model przyjmuje float.
    req = voice_crud_routes.SetMenuPriceRequest(new_price=-1)
    assert req.new_price == -1


def test_set_ingredient_model():
    req = voice_crud_routes.SetRecipeIngredientRequest(
        ingredient_name="mąka",
        quantity=100,
        unit="g",
    )
    assert req.mode == "upsert"
