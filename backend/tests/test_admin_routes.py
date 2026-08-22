"""Smoke: admin routes."""
from __future__ import annotations

import admin_routes as m


def test_admin_routes_registered():
    paths = {getattr(r, "path", None) for r in m.router.routes}
    assert "/api/admin/migration-status" in paths
