"""Smoke: reports routes + tenant gate."""
from fastapi.testclient import TestClient


def test_reports_router_paths():
    from reports_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/reports/comprehensive" in paths
    assert "/api/reports/analyze-period" in paths
    assert "/api/reports/compare-periods" in paths


def test_comprehensive_requires_tenant(monkeypatch):
    monkeypatch.setenv("ACCOUNT_KEY", "default")
    from server import app

    client = TestClient(app)
    r = client.post(
        "/api/reports/comprehensive",
        json={"from_date": "2026-08-01", "to_date": "2026-08-22"},
    )
    assert r.status_code == 401
