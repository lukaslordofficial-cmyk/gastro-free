"""Prod-scale hardening: flags, circuit, upload, tenant inject, credits lock."""
from __future__ import annotations

import asyncio

from feature_flags import deal_hunter_enabled, lp_marketplace_enabled
from openai_circuit import OpenAICircuit
from request_guards import (
    content_length_too_large,
    is_ai_path,
    is_deal_hunter_path,
    is_lp_marketplace_path,
    is_upload_path,
    max_upload_bytes,
)
from request_log import new_request_id, short_tenant_id


def test_ai_paths_include_get_style_routes():
    assert is_ai_path("/api/voice/transcribe")
    assert is_ai_path("/api/inspirations/recipe")
    assert is_ai_path("/api/orders/compare-offers")
    assert is_upload_path("/api/documents/scan")
    assert is_upload_path("/api/voice/transcribe")
    assert not is_upload_path("/api/actions/apply")
    assert is_deal_hunter_path("/api/bargain-hunter/optimize")
    assert is_deal_hunter_path("/api/orders/compare-offers")
    assert not is_deal_hunter_path("/api/voice/dispatch")
    assert is_lp_marketplace_path("/api/local-producers/checkout")
    assert is_lp_marketplace_path("/producer/products/nowy")
    assert not is_lp_marketplace_path("/api/billing/webhook")


def test_upload_content_length(monkeypatch):
    monkeypatch.setenv("MAX_UPLOAD_BYTES", str(1024 * 1024))
    assert max_upload_bytes() == 1024 * 1024
    assert content_length_too_large(None) is False
    assert content_length_too_large("100") is False
    assert content_length_too_large(str(2 * 1024 * 1024)) is True


def test_feature_flags_default_on(monkeypatch):
    monkeypatch.delenv("DEAL_HUNTER_ENABLED", raising=False)
    monkeypatch.delenv("LP_MARKETPLACE_ENABLED", raising=False)
    assert deal_hunter_enabled() is True
    assert lp_marketplace_enabled() is True
    monkeypatch.setenv("DEAL_HUNTER_ENABLED", "false")
    monkeypatch.setenv("LP_MARKETPLACE_ENABLED", "0")
    assert deal_hunter_enabled() is False
    assert lp_marketplace_enabled() is False


def test_openai_circuit_opens_and_cools():
    c = OpenAICircuit(fail_threshold=3, window_s=60, cooldown_s=10)
    now = 1000.0
    assert c.allow(now)
    c.record_failure(now)
    c.record_failure(now + 1)
    assert c.allow(now + 2)
    c.record_failure(now + 2)
    assert not c.allow(now + 3)
    assert c.allow(now + 3 + 10)


def test_request_id_and_tenant_hash():
    a = short_tenant_id("ak_user_one")
    b = short_tenant_id("ak_user_two")
    assert a != b
    assert a != "ak_user_one"
    assert short_tenant_id("default") == "anon"
    rid = new_request_id("abcDEF12-ok")
    assert rid == "abcDEF12-ok"
    assert len(new_request_id(None)) == 16


def test_supplier_orders_tenant_inject(monkeypatch):
    import supabase_rest as sr

    monkeypatch.setenv("ACCOUNT_KEY", "ak_test")
    sr.configure(get_account_key=lambda: "ak_test")
    out = sr._with_tenant_params("supplier_orders", {"select": "id"})
    assert out["account_key"] == "eq.ak_test"
    payload = sr._with_tenant_payload("supplier_orders", {"status": "draft"})
    assert payload["account_key"] == "ak_test"


def test_pos_and_warehouse_tenant_inject(monkeypatch):
    import supabase_rest as sr

    monkeypatch.setenv("ACCOUNT_KEY", "ak_test")
    sr.configure(get_account_key=lambda: "ak_test")
    for table in ("pos_products", "pos_settings", "recipes", "warehouse_expiry_alerts"):
        out = sr._with_tenant_params(table, {"select": "id"})
        assert out["account_key"] == "eq.ak_test"
        payload = sr._with_tenant_payload(table, {"name": "x"})
        assert payload["account_key"] == "ak_test"


def test_deduct_credits_retries_empty_patch(monkeypatch):
    import billing_credits as bc

    calls = {"n": 0}

    async def fake_ensure(_client):
        return {"credits_balance": 80}

    async def fake_patch(_client, _table, params, payload):
        calls["n"] += 1
        if calls["n"] == 1:
            assert params.get("credits_balance") == "eq.80"
            return []
        return [{"credits_balance": payload["credits_balance"]}]

    monkeypatch.setattr(bc, "_ensure_subscription", fake_ensure)
    monkeypatch.setattr(bc, "sb_patch", fake_patch)
    monkeypatch.setattr(bc, "get_account_key", lambda: "ak_test")

    bal = asyncio.run(bc._deduct_credits(None, 5, endpoint="test"))
    assert calls["n"] == 2
    assert bal == 75
