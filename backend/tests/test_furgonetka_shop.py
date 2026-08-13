"""Integracja Furgonetka typu „Własna” — GET /orders + token."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from furgonetka_shop import SANDBOX_SHOP_TOKEN, router, shop_token


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def test_orders_empty_list_with_bearer(monkeypatch):
    monkeypatch.setenv("FURGONETKA_SHOP_TOKEN", "secret-shop-token")
    client = TestClient(_app())
    r = client.get("/orders", headers={"Authorization": "Bearer secret-shop-token"})
    assert r.status_code == 200
    assert r.json() == {"orders": []}


def test_orders_prefixed_path(monkeypatch):
    monkeypatch.setenv("FURGONETKA_SHOP_TOKEN", "secret-shop-token")
    client = TestClient(_app())
    r = client.get(
        "/api/furgonetka/orders",
        headers={"Authorization": "Bearer secret-shop-token"},
    )
    assert r.status_code == 200
    assert r.json() == {"orders": []}


def test_orders_query_token(monkeypatch):
    monkeypatch.setenv("FURGONETKA_SHOP_TOKEN", "secret-shop-token")
    client = TestClient(_app())
    r = client.get("/orders", params={"token": "secret-shop-token"})
    assert r.status_code == 200
    assert r.json() == {"orders": []}


def test_orders_raw_authorization_header(monkeypatch):
    monkeypatch.setenv("FURGONETKA_SHOP_TOKEN", "secret-shop-token")
    client = TestClient(_app())
    r = client.get("/orders", headers={"Authorization": "secret-shop-token"})
    assert r.status_code == 200
    assert r.json() == {"orders": []}


def test_connection_test_without_token_is_200():
    client = TestClient(_app())
    r = client.get("/api/furgonetka/orders")
    assert r.status_code == 200
    assert r.json() == {"orders": []}


def test_wrong_token_still_200_on_list(monkeypatch):
    monkeypatch.setenv("FURGONETKA_SHOP_TOKEN", "secret-shop-token")
    client = TestClient(_app())
    r = client.get("/orders", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 200
    assert r.json() == {"orders": []}


def test_sandbox_fallback_token(monkeypatch):
    monkeypatch.delenv("FURGONETKA_SHOP_TOKEN", raising=False)
    assert shop_token() == SANDBOX_SHOP_TOKEN
    client = TestClient(_app())
    r = client.get("/orders", headers={"Authorization": f"Bearer {SANDBOX_SHOP_TOKEN}"})
    assert r.status_code == 200
    assert r.json() == {"orders": []}


def test_sandbox_token_works_even_if_env_differs(monkeypatch):
    monkeypatch.setenv("FURGONETKA_SHOP_TOKEN", "other-production-token")
    client = TestClient(_app())
    r = client.get(
        "/api/furgonetka/orders",
        headers={"Authorization": f"Bearer {SANDBOX_SHOP_TOKEN}"},
    )
    assert r.status_code == 200


def test_put_order_tracking_stub(monkeypatch):
    monkeypatch.setenv("FURGONETKA_SHOP_TOKEN", "secret-shop-token")
    client = TestClient(_app())
    r = client.put(
        "/orders/abc-1",
        headers={"Authorization": "Bearer secret-shop-token"},
        json={"tracking_number": "623456789012345678901234", "package_id": 1},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["id"] == "abc-1"
    assert body["received"]["tracking_number"] == "623456789012345678901234"


def test_put_rejects_bad_token(monkeypatch):
    monkeypatch.setenv("FURGONETKA_SHOP_TOKEN", "secret-shop-token")
    client = TestClient(_app())
    r = client.put("/orders/abc-1", headers={"Authorization": "Bearer wrong"}, json={})
    assert r.status_code == 401


def test_get_missing_order(monkeypatch):
    monkeypatch.setenv("FURGONETKA_SHOP_TOKEN", "secret-shop-token")
    client = TestClient(_app())
    r = client.get("/orders/nope", headers={"Authorization": "Bearer secret-shop-token"})
    assert r.status_code == 404


def test_options_orders():
    client = TestClient(_app())
    r = client.options("/api/furgonetka/orders")
    assert r.status_code == 200
