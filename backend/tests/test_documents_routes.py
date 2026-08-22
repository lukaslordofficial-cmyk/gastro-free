"""Smoke: documents + catalog scan + expiry scan routers + tenant gates."""


def test_documents_router_paths():
    from documents_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/documents/confirm-invoice" in paths
    assert "/api/documents/process" in paths


def test_supplier_catalog_scan_paths():
    from supplier_catalog_scan_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/suppliers/{supplier_id}/upload-catalog" in paths
    assert "/api/suppliers/{supplier_id}/confirm-catalog" in paths


def test_expiry_scan_path():
    from inventory_expiry_scan_routes import router

    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/inventory/scan-expiration" in paths


def test_catalog_upload_requires_tenant(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ACCOUNT_KEY", "default")
    from server import app

    client = TestClient(app)
    r = client.post(
        "/api/suppliers/00000000-0000-0000-0000-000000000001/upload-catalog",
        files={"file": ("x.jpg", b"abc", "image/jpeg")},
    )
    assert r.status_code == 401


def test_confirm_catalog_requires_tenant(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ACCOUNT_KEY", "default")
    from server import app

    client = TestClient(app)
    r = client.post(
        "/api/suppliers/00000000-0000-0000-0000-000000000001/confirm-catalog",
        json={"products": [{"product_name": "X", "price_netto": 1}]},
    )
    assert r.status_code == 401


def test_voice_interpret_requires_tenant(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ACCOUNT_KEY", "default")
    from server import app

    client = TestClient(app)
    r = client.post("/api/voice/interpret", json={"text": "dodaj ser"})
    assert r.status_code == 401
