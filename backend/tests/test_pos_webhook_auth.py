"""POS webhook HMAC tenant token."""
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from pos_webhook_auth import (
    build_pos_webhook_path,
    require_pos_webhook_tenant,
    tenant_pos_token,
    verify_pos_token,
)


def test_hmac_roundtrip(monkeypatch):
    monkeypatch.setenv("POS_WEBHOOK_SECRET", "master-secret-value")
    key = "ak_abc123456789"
    token = tenant_pos_token(key)
    assert verify_pos_token(key, token)
    assert not verify_pos_token(key, "0" * len(token))
    assert not verify_pos_token("ak_otheraccount1", token)


def test_url_contains_account_and_token(monkeypatch):
    monkeypatch.setenv("POS_WEBHOOK_SECRET", "master-secret-value")
    url = build_pos_webhook_path("ak_abc123456789", "gopos", "https://api.example.com")
    assert url.startswith("https://api.example.com/api/pos/webhook?")
    assert "account=ak_abc123456789" in url
    assert "provider=gopos" in url
    assert "token=" in url


def test_require_pos_webhook_ok(monkeypatch):
    monkeypatch.setenv("POS_WEBHOOK_SECRET", "master-secret-value")
    key = "ak_abc123456789"
    token = tenant_pos_token(key)

    app = FastAPI()

    @app.post("/hook")
    async def hook(request: Request):
        return {"account": require_pos_webhook_tenant(request)}

    r = TestClient(app).post(f"/hook?account={key}&token={token}")
    assert r.status_code == 200
    assert r.json()["account"] == key


def test_require_pos_webhook_bad_token(monkeypatch):
    monkeypatch.setenv("POS_WEBHOOK_SECRET", "master-secret-value")
    app = FastAPI()

    @app.post("/hook")
    async def hook(request: Request):
        return {"account": require_pos_webhook_tenant(request)}

    r = TestClient(app).post("/hook?account=ak_abc123456789&token=nope")
    assert r.status_code == 401
