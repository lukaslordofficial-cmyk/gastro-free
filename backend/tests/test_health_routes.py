"""Wydzielony router health — liveness + bramka AUTO_CONFIRM_EMAIL."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from health_routes import router


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def test_health_ok(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = TestClient(_app()).get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "gastro-voice"
    assert body["supabase_configured"] is False
    assert body["openai_configured"] is False


def test_health_alias_and_root():
    client = TestClient(_app())
    assert client.get("/health").status_code == 200
    assert client.get("/").json()["status"] == "ok"
    assert client.get("/api/").json()["service"] == "gastro-voice"


def test_auto_confirm_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AUTO_CONFIRM_EMAIL", raising=False)
    r = TestClient(_app()).post(
        "/api/auth/auto-confirm",
        json={"user_id": "aaaaaaaa"},
    )
    assert r.status_code == 403


def test_health_deep_without_supabase(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    r = TestClient(_app()).get("/api/health/deep")
    assert r.status_code == 200
    assert r.json()["subscription"] == "not_configured"
