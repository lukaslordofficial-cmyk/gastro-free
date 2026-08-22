"""Smoke: stripe connect + inventory yield routers."""


def test_stripe_connect_router_paths():
    from stripe_connect_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/stripe/connect" in paths
    assert "/api/stripe/connect/callback" in paths
    assert "/api/stripe/connect/status" in paths


def test_inventory_yield_router_path():
    from inventory_yield_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/inventory/{item_id}/portions-yield" in paths


def test_yield_requires_tenant(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ACCOUNT_KEY", "default")
    from server import app

    client = TestClient(app)
    r = client.get("/api/inventory/00000000-0000-0000-0000-000000000001/portions-yield")
    assert r.status_code == 401


def test_stripe_status_requires_jwt(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ACCOUNT_KEY", "ak_test")
    from server import app

    client = TestClient(app)
    r = client.get("/api/stripe/connect/status", params={"producer_id": "x"})
    assert r.status_code == 401
