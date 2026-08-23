"""menu_vision_routes — mount + tenant guard wiring."""
from __future__ import annotations

import menu_vision_routes


def test_menu_vision_paths():
    paths = {getattr(r, "path", None) for r in menu_vision_routes.router.routes}
    assert "/api/menu/scan" in paths
    assert "/api/menu/confirm-scan" in paths
    assert "/api/menu/suggest-recipe" in paths
    assert "/api/inspirations/recipe" in paths
    assert "/api/recipes/ocr-text" in paths
