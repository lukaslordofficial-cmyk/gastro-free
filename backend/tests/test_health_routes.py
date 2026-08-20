"""Wydzielony router health — liveness + bramka AUTO_CONFIRM_EMAIL."""
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from health_routes import auto_confirm_denied_reason, router


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
        json={"user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "email": "a@b.co"},
    )
    assert r.status_code == 403


def test_auto_confirm_requires_email(monkeypatch):
    monkeypatch.setenv("AUTO_CONFIRM_EMAIL", "true")
    r = TestClient(_app()).post(
        "/api/auth/auto-confirm",
        json={"user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},
    )
    assert r.status_code == 422


def test_auto_confirm_denied_reason_mismatch_and_age():
    now = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)
    user = {
        "email": "cook@example.com",
        "created_at": "2026-08-20T11:55:00+00:00",
    }
    assert auto_confirm_denied_reason(user, "cook@example.com", now=now) is None
    assert auto_confirm_denied_reason(user, "other@example.com", now=now) == "email"
    old = {
        "email": "cook@example.com",
        "created_at": (now - timedelta(hours=2)).isoformat(),
    }
    assert auto_confirm_denied_reason(old, "cook@example.com", now=now) == "too_old"


def test_health_deep_without_supabase(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    r = TestClient(_app()).get("/api/health/deep")
    assert r.status_code == 200
    assert r.json()["subscription"] == "not_configured"
