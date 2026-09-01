"""POS webhook HMAC tenant token."""
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from pos_webhook_auth import (
    build_pos_webhook_path,
    decode_pos_short_slug,
    encode_pos_short_slug,
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


def test_url_is_short_slug(monkeypatch):
    monkeypatch.setenv("POS_WEBHOOK_SECRET", "master-secret-value")
    key = "ak_" + ("ab" * 16)
    url = build_pos_webhook_path(key, "gopos", "https://api.example.com")
    assert url.startswith("https://api.example.com/w/")
    assert "account=" not in url
    assert "token=" not in url
    assert "provider=" not in url
    slug = url.rsplit("/", 1)[-1]
    parsed = decode_pos_short_slug(slug)
    assert parsed is not None
    acc, token, provider = parsed
    assert acc == key
    assert provider == "gopos"
    assert verify_pos_token(acc, token)


def test_short_slug_non_uuid_account(monkeypatch):
    monkeypatch.setenv("POS_WEBHOOK_SECRET", "master-secret-value")
    key = "ak_abc123456789"
    slug = encode_pos_short_slug(key, "poster")
    parsed = decode_pos_short_slug(slug)
    assert parsed is not None
    acc, token, provider = parsed
    assert acc == key
    assert provider == "poster"
    assert verify_pos_token(acc, token)


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


def test_require_pos_webhook_short_path(monkeypatch):
    monkeypatch.setenv("POS_WEBHOOK_SECRET", "master-secret-value")
    key = "ak_" + ("cd" * 16)
    path = build_pos_webhook_path(key, "dotykacka", "")

    app = FastAPI()

    @app.post("/w/{code}")
    async def hook(request: Request, code: str):
        return {
            "account": require_pos_webhook_tenant(request),
            "provider": getattr(request.state, "pos_provider", None),
        }

    r = TestClient(app).post(path)
    assert r.status_code == 200
    body = r.json()
    assert body["account"] == key
    assert body["provider"] == "dotykacka"


def test_require_pos_webhook_bad_token(monkeypatch):
    monkeypatch.setenv("POS_WEBHOOK_SECRET", "master-secret-value")
    app = FastAPI()

    @app.post("/hook")
    async def hook(request: Request):
        return {"account": require_pos_webhook_tenant(request)}

    r = TestClient(app).post("/hook?account=ak_abc123456789&token=nope")
    assert r.status_code == 401
