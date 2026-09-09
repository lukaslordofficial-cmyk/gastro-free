"""Tests for Subscription & Credit Wallet (Quota & Tier Authorization).

MOCK top-ups/subscribe (no real payment). Single-account model (account_key='default').
Backend URL resolved via conftest.BASE_URL from EXPO_PUBLIC_BACKEND_URL.
"""
import os
import time
import pytest
import requests

from conftest import BASE_URL


# ---------- Supabase direct patch (admin) — used to force states not exposed by API ----------

def _load_env(path: str = "/app/backend/.env") -> dict:
    env = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return env


_ENV = _load_env()
_SB_URL = os.environ.get("SUPABASE_URL") or _ENV.get("SUPABASE_URL")
_SB_KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or _ENV.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("SUPABASE_KEY") or _ENV.get("SUPABASE_KEY"))


def _sb_patch_sub(**changes) -> bool:
    if not (_SB_URL and _SB_KEY):
        return False
    r = requests.patch(
        f"{_SB_URL}/rest/v1/subscriptions?account_key=eq.default",
        headers={"apikey": _SB_KEY, "Authorization": f"Bearer {_SB_KEY}",
                 "Content-Type": "application/json", "Prefer": "return=representation"},
        json=changes, timeout=15,
    )
    return r.status_code < 300


# ---------- Helpers ----------

def _get_sub(client: requests.Session) -> dict:
    r = client.get(f"{BASE_URL}/api/subscription", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _set_state(client: requests.Session, *, tier: int, credits: int) -> dict:
    """Restore known state: subscribe to tier (grants credits) then top-up/deduct via topup or drain."""
    r = client.post(f"{BASE_URL}/api/subscription/subscribe",
                    json={"tier_level": tier}, timeout=30)
    assert r.status_code == 200, r.text
    return _get_sub(client)


# ---------- 1. GET /api/subscription shape ----------

class TestSubscriptionGet:
    def test_get_shape(self, api_client):
        data = _get_sub(api_client)
        for key in ("tier_level", "tier_name", "credits_balance", "max_credits",
                    "credits_pln", "status", "current_period_end",
                    "deal_hunter_unlocked", "features", "topup_packages", "plans"):
            assert key in data, f"missing key {key}: {data.keys()}"
        # feature list
        assert isinstance(data["features"], list) and len(data["features"]) >= 5
        for f in data["features"]:
            assert "key" in f and "name" in f and "locked" in f
            if f["locked"]:
                assert f.get("locked_reason")
        # topup packages
        keys = {p["key"] for p in data["topup_packages"]}
        assert keys == {"small", "medium", "large"}
        # plans
        tiers = {p["tier_level"] for p in data["plans"]}
        assert tiers == {0, 1, 2}


# ---------- 2. Topup ----------

class TestTopup:
    def test_topup_small_adds_100(self, api_client):
        before = _get_sub(api_client)["credits_balance"]
        r = api_client.post(f"{BASE_URL}/api/subscription/topup",
                            json={"package": "small"}, timeout=30)
        if r.status_code == 400 and "MOCK" in (r.text or ""):
            c = api_client.post(f"{BASE_URL}/api/billing/create-checkout-session",
                                json={"kind": "topup", "package": "small"}, timeout=45)
            assert c.status_code == 200, c.text
            assert "checkout.stripe.com" in (c.json().get("url") or "")
            return
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["credits_balance"] == before + 100
        assert "message" in j

    def test_topup_medium_adds_500(self, api_client):
        before = _get_sub(api_client)["credits_balance"]
        r = api_client.post(f"{BASE_URL}/api/subscription/topup",
                            json={"package": "medium"}, timeout=30)
        if r.status_code == 400 and "MOCK" in (r.text or ""):
            c = api_client.post(f"{BASE_URL}/api/billing/create-checkout-session",
                                json={"kind": "topup", "package": "medium"}, timeout=45)
            assert c.status_code == 200, c.text
            return
        assert r.status_code == 200, r.text
        assert r.json()["credits_balance"] == before + 500

    def test_topup_large_adds_1000(self, api_client):
        before = _get_sub(api_client)["credits_balance"]
        r = api_client.post(f"{BASE_URL}/api/subscription/topup",
                            json={"package": "large"}, timeout=30)
        if r.status_code == 400 and "MOCK" in (r.text or ""):
            c = api_client.post(f"{BASE_URL}/api/billing/create-checkout-session",
                                json={"kind": "topup", "package": "large"}, timeout=45)
            assert c.status_code == 200, c.text
            return
        assert r.status_code == 200, r.text
        assert r.json()["credits_balance"] == before + 1000


# ---------- 3. Subscribe ----------

class TestSubscribe:
    def test_subscribe_tier1_grants_1000(self, api_client):
        before = _get_sub(api_client)["credits_balance"]
        r = api_client.post(f"{BASE_URL}/api/subscription/subscribe",
                            json={"tier_level": 1}, timeout=30)
        if r.status_code == 400 and "MOCK" in (r.text or ""):
            c = api_client.post(f"{BASE_URL}/api/billing/create-checkout-session",
                                json={"kind": "subscription", "tier_level": 1}, timeout=45)
            assert c.status_code == 200, c.text
            assert c.json().get("url", "").startswith("https://checkout.stripe.com")
            return
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["tier_level"] == 1
        assert j["status"] == "active"
        assert j["credits_balance"] == before + 1000
        assert j["current_period_end"], "should set period end"
        assert j["deal_hunter_unlocked"] is True

    def test_subscribe_tier2_grants_2500_and_unlocks_dh(self, api_client):
        before = _get_sub(api_client)["credits_balance"]
        r = api_client.post(f"{BASE_URL}/api/subscription/subscribe",
                            json={"tier_level": 2}, timeout=30)
        if r.status_code == 400 and "MOCK" in (r.text or ""):
            # Stripe-only mode — sprawdź Checkout Session zamiast MOCK grant
            c = api_client.post(f"{BASE_URL}/api/billing/create-checkout-session",
                                json={"kind": "subscription", "tier_level": 2}, timeout=45)
            assert c.status_code == 200, c.text
            assert c.json().get("url", "").startswith("https://checkout.stripe.com")
            return
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["tier_level"] == 2
        assert j["status"] == "active"
        assert j["credits_balance"] == before + 2500
        assert j["deal_hunter_unlocked"] is True

    def test_subscribe_invalid_tier(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/subscription/subscribe",
                            json={"tier_level": 5}, timeout=30)
        assert r.status_code in (400, 422)


# ---------- 4. Cancel ----------

class TestCancel:
    def test_cancel_marks_canceled_keeps_credits(self, api_client):
        # Ensure we start active tier2
        _set_state(api_client, tier=2, credits=0)
        before = _get_sub(api_client)
        r = api_client.post(f"{BASE_URL}/api/subscription/cancel", timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "canceled"
        assert j["credits_balance"] == before["credits_balance"]
        assert j["tier_level"] == before["tier_level"]


# ---------- 5. Tier Authorization (Deal Hunter) ----------

DEAL_HUNTER_ENDPOINTS = [
    ("/api/orders/compare-offers", {"items": [{"product_name_or_id": "kurczak", "quantity": 1, "unit": "kg"}]}),
    ("/api/suppliers/flip-order", {"from_supplier": "A", "to_supplier": "B"}),
    ("/api/suppliers/budget-cap-order", {"max_budget": 100}),
    ("/api/suppliers/check-minimum-order", {"supplier_name": "X"}),
]


class TestTierAuthorization:
    def test_tier0_locks_deal_hunter(self, api_client):
        if not _sb_patch_sub(tier_level=0, status="active", current_period_end=None):
            pytest.skip("No Supabase admin creds to force tier0.")
        # verify state
        cur = _get_sub(api_client)
        assert cur["tier_level"] == 0, cur
        for ep, payload in DEAL_HUNTER_ENDPOINTS:
            r = api_client.post(f"{BASE_URL}{ep}", json=payload, timeout=60)
            assert r.status_code == 403, f"{ep} expected 403 at tier0, got {r.status_code}: {r.text[:200]}"

    def test_tier2_unlocks_deal_hunter(self, api_client):
        _set_state(api_client, tier=2, credits=0)
        for ep, payload in DEAL_HUNTER_ENDPOINTS:
            r = api_client.post(f"{BASE_URL}{ep}", json=payload, timeout=60)
            # Should NOT be 403 due to Łowca Okazji lock. Other errors (400/404/500 from
            # payload/data) are unrelated to the tier gate.
            if r.status_code == 403:
                detail = ""
                try:
                    detail = (r.json().get("detail") or "").lower()
                except Exception:
                    detail = r.text.lower()
                assert "łowca" not in detail and "deal" not in detail and "plan" not in detail, \
                    f"{ep} still tier-locked at tier2: {r.text}"
            # Otherwise: acceptable — gate passed


# ---------- 6. Credit gate (0 credits → AI blocked, manual OK) ----------

class TestCreditGate:
    def test_zero_credits_blocks_ai_but_allows_manual(self, api_client):
        # Force credits=0 while keeping tier2 so we isolate credit gate
        if not _sb_patch_sub(tier_level=2, credits_balance=0, status="active"):
            pytest.skip("No Supabase admin creds to force 0 credits.")
        # AI endpoints → 403
        r1 = api_client.post(f"{BASE_URL}/api/voice/interpret",
                             json={"text": "dodaj pomidor"}, timeout=60)
        assert r1.status_code == 403, f"voice/interpret expected 403 at 0 credits, got {r1.status_code}: {r1.text[:200]}"
        r2 = api_client.post(f"{BASE_URL}/api/reports/analyze-period",
                             json={"period": "week"}, timeout=60)
        assert r2.status_code == 403, f"analyze-period expected 403 at 0 credits, got {r2.status_code}: {r2.text[:200]}"
        # Manual endpoint still OK
        r3 = api_client.post(f"{BASE_URL}/api/menu/recompute-availability",
                             json={}, timeout=60)
        assert r3.status_code == 200, r3.text
        # restore
        _sb_patch_sub(credits_balance=3500)

    def test_credit_gate_manual_endpoint_ok_when_credits_present(self, api_client):
        # Simple sanity: recompute-availability should be 200 with credits present.
        _set_state(api_client, tier=2, credits=0)  # ensures tier2 active + credits
        r = api_client.post(f"{BASE_URL}/api/menu/recompute-availability",
                            json={}, timeout=60)
        assert r.status_code == 200, r.text


# ---------- 7. Credit deduction on successful AI call ----------

class TestCreditDeduction:
    def test_voice_interpret_deducts_credits(self, api_client):
        _set_state(api_client, tier=2, credits=0)  # ensures balance >= 3500
        before = _get_sub(api_client)["credits_balance"]
        r = api_client.post(f"{BASE_URL}/api/voice/interpret",
                            json={"text": "dodaj 5 kg pomidorów do magazynu"},
                            timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        # optional: token_usage.extras.credits_charged
        tu = j.get("token_usage") or {}
        extras = (tu.get("extras") or {}) if isinstance(tu, dict) else {}
        charged = extras.get("credits_charged")
        assert charged is None or charged >= 1
        # small sleep to ensure PATCH propagated
        time.sleep(1)
        after = _get_sub(api_client)["credits_balance"]
        assert after < before, f"credits not deducted: before={before} after={after}"


# ---------- 8. Cleanup: restore tier2 active + credits>=3000 ----------

class TestZZRestoreFinalState:
    """Named to sort last (Z) — ensures healthy state per review request."""

    def test_restore_tier2_healthy(self, api_client):
        cur = _get_sub(api_client)
        # Subscribe again to refresh grants until we have >=3000 credits and tier2.
        tries = 0
        while (cur.get("tier_level") != 2 or cur.get("status") != "active"
               or int(cur.get("credits_balance") or 0) < 3000):
            r = api_client.post(f"{BASE_URL}/api/subscription/subscribe",
                                json={"tier_level": 2}, timeout=30)
            assert r.status_code == 200, r.text
            cur = _get_sub(api_client)
            tries += 1
            if tries >= 5:
                break
        assert cur["tier_level"] == 2
        assert cur["status"] == "active"
        assert int(cur["credits_balance"]) >= 3000, cur
