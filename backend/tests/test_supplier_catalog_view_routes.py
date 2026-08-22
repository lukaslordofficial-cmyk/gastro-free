"""Smoke: supplier catalog view routes."""
from __future__ import annotations

import supplier_catalog_view_routes as m


def test_catalog_view_routes_registered():
    paths = {getattr(r, "path", None) for r in m.router.routes}
    assert "/api/suppliers/{supplier_id}/catalog" in paths
    assert "/api/suppliers/{supplier_id}/refresh-catalog-visibility" in paths
