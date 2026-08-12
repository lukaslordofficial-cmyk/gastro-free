"""Unit tests for PostgREST URL builder (SSRF posture)."""
import os

import httpx
import pytest
from fastapi import HTTPException

import supabase_rest as sr


def test_rest_url_uses_env_host_only(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co")
    url = sr._rest_url("inventory_items")
    assert isinstance(url, httpx.URL)
    assert url.scheme == "https"
    assert url.host == "proj.supabase.co"
    assert url.path == "/rest/v1/inventory_items"


def test_rest_url_rejects_traversal(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co")
    with pytest.raises(HTTPException):
        sr._rest_url("../auth/v1/admin")
    with pytest.raises(HTTPException):
        sr._rest_url("a/b/c")


def test_rest_url_allows_rpc(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co")
    url = sr._rest_url("rpc/warehouse_inventory_refresh_status")
    assert url.path.endswith("/rpc/warehouse_inventory_refresh_status")


def test_tenant_params_injected(monkeypatch):
    monkeypatch.setenv("ACCOUNT_KEY", "ak_test")
    sr.configure(get_account_key=lambda: "ak_test")
    out = sr._with_tenant_params("inventory_items", {"select": "id"})
    assert out["account_key"] == "eq.ak_test"
    # Non-tenant table unchanged
    assert sr._with_tenant_params("profiles", {"select": "id"}) == {"select": "id"}
