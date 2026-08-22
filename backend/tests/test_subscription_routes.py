"""Smoke: subscription routes wymagają tenant account key."""
from fastapi.testclient import TestClient


def test_subscription_requires_tenant_key(monkeypatch):
    monkeypatch.setenv("ACCOUNT_KEY", "default")
    from server import app

    client = TestClient(app)
    r = client.get("/api/subscription")
    assert r.status_code == 401


def test_subscription_routes_registered():
    from server import app

    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/api/subscription" in paths
    assert "/api/subscription/usage-history" in paths
    assert "/api/subscription/topup" in paths
    assert "/api/subscription/resign" in paths
    assert "/api/subscription/cancel" in paths
