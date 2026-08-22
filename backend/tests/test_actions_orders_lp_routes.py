"""Smoke: actions / orders-hunter / local-producers routers + tenant on hunter."""


def test_actions_router_paths():
    from actions_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/actions/apply" in paths
    assert "/api/waste/apply" in paths


def test_orders_hunter_paths():
    from orders_hunter_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/orders/compare-offers" in paths
    assert "/api/voice/dispatch" in paths


def test_local_producers_paths():
    from local_producers_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/local-producers/commerce-status" in paths
    assert "/api/local-producers/checkout" in paths
    assert "/api/local-producers/orders/{order_id}/label" in paths


def test_compare_offers_requires_tenant(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ACCOUNT_KEY", "default")
    from server import app

    client = TestClient(app)
    r = client.post("/api/orders/compare-offers", json={"items": []})
    assert r.status_code in (401, 400)
