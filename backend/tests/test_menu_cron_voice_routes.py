"""Smoke: cron + menu vision + voice interpret routers and tenant gates."""


def test_cron_jobs_paths():
    from cron_jobs_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/inventory/expiry-daily-job" in paths
    assert "/api/manager/core-alerts-job" in paths


def test_menu_vision_paths():
    from menu_vision_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/menu/scan" in paths
    assert "/api/recipes/ocr-text" in paths
    assert "/api/menu/suggest-recipe" in paths
    assert "/api/inspirations/recipe" in paths
    assert "/api/menu/confirm-scan" in paths


def test_voice_interpret_paths():
    from voice_interpret_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/voice/interpret" in paths
    assert "/api/voice/interpret-waste" in paths


def test_cron_job_requires_secret(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("CRON_JOB_SECRET", "test-cron-secret")
    monkeypatch.setenv("ACCOUNT_KEY", "default")
    from server import app

    client = TestClient(app)
    r = client.get("/api/inventory/expiry-daily-job")
    assert r.status_code == 401


def test_recipe_ocr_requires_tenant(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ACCOUNT_KEY", "default")
    from server import app

    client = TestClient(app)
    r = client.post(
        "/api/recipes/ocr-text",
        files={"file": ("x.jpg", b"abc", "image/jpeg")},
    )
    assert r.status_code == 401


def test_suggest_recipe_requires_tenant(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ACCOUNT_KEY", "default")
    from server import app

    client = TestClient(app)
    r = client.post("/api/menu/suggest-recipe", json={"dishes": [{"name": "Zupa"}]})
    assert r.status_code == 401
