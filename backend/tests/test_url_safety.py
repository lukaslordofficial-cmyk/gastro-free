"""Unit tests for SSRF / redirect allowlist helpers."""
import os

import pytest
from fastapi import HTTPException

from url_safety import (
    assert_safe_outbound_url,
    assert_safe_redirect_url,
    assert_safe_rest_path,
    build_supabase_auth_user_url,
)


def test_rest_path_ok():
    assert assert_safe_rest_path("inventory_items") == "inventory_items"
    assert assert_safe_rest_path("/menu_items") == "menu_items"


def test_rest_path_rejects_traversal():
    with pytest.raises(HTTPException):
        assert_safe_rest_path("../etc/passwd")
    with pytest.raises(HTTPException):
        assert_safe_rest_path("a/b")
    with pytest.raises(HTTPException):
        assert_safe_rest_path("bad;drop")


def test_outbound_blocks_localhost():
    with pytest.raises(HTTPException):
        assert_safe_outbound_url("http://127.0.0.1/secret", resolve_dns=False)
    with pytest.raises(HTTPException):
        assert_safe_outbound_url("http://localhost/admin", resolve_dns=False)
    with pytest.raises(HTTPException):
        assert_safe_outbound_url("file:///etc/passwd", resolve_dns=False)


def test_outbound_blocks_plain_http_public():
    with pytest.raises(HTTPException):
        assert_safe_outbound_url("http://example.com/cennik", resolve_dns=False)
    # Skip DNS in unit test — host is public-looking.
    url = assert_safe_outbound_url("https://example.com/cennik", resolve_dns=False)
    assert url.startswith("https://example.com")


def test_redirect_allows_deep_link():
    assert assert_safe_redirect_url("myapp://billing/success").startswith("myapp://")
    from url_safety import is_safe_app_return_url
    assert is_safe_app_return_url("exp://10.0.0.1:8081/--/lp/success")
    assert is_safe_app_return_url("myapp://lp/success")
    assert is_safe_app_return_url("myapp:///lp/success")
    assert not is_safe_app_return_url("https://evil.example/phish")


def test_redirect_allows_localhost_http():
    assert assert_safe_redirect_url("http://localhost:8081/billing-success")


def test_redirect_blocks_unknown_host(monkeypatch):
    monkeypatch.delenv("PUBLIC_APP_URL", raising=False)
    monkeypatch.delenv("ALLOWED_REDIRECT_HOSTS", raising=False)
    with pytest.raises(HTTPException):
        assert_safe_redirect_url("https://evil.example/phish")


def test_redirect_allows_public_app_host(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.com")
    assert assert_safe_redirect_url("https://app.example.com/billing-success")


def test_checkout_redirect_skips_localhost_expo(monkeypatch):
    from url_safety import checkout_redirect_public_base

    monkeypatch.setenv("PUBLIC_APP_URL", "http://localhost:8081")
    monkeypatch.setenv("PUBLIC_API_URL", "https://api.example.com")
    monkeypatch.delenv("CHECKOUT_REDIRECT_BASE_URL", raising=False)
    monkeypatch.delenv("BACKEND_PUBLIC_URL", raising=False)
    monkeypatch.delenv("RAILWAY_PUBLIC_DOMAIN", raising=False)
    base = checkout_redirect_public_base()
    assert "localhost" not in base
    assert base.startswith("https://api.example.com")


def test_checkout_redirect_requires_public_url(monkeypatch):
    from url_safety import checkout_redirect_public_base

    monkeypatch.setenv("PUBLIC_APP_URL", "http://localhost:8081")
    monkeypatch.delenv("CHECKOUT_REDIRECT_BASE_URL", raising=False)
    monkeypatch.delenv("PUBLIC_API_URL", raising=False)
    monkeypatch.delenv("BACKEND_PUBLIC_URL", raising=False)
    monkeypatch.delenv("RAILWAY_PUBLIC_DOMAIN", raising=False)
    with pytest.raises(HTTPException):
        checkout_redirect_public_base()


def test_auth_user_url_fixed_origin():
    assert build_supabase_auth_user_url("https://proj.supabase.co") == (
        "https://proj.supabase.co/auth/v1/user"
    )
