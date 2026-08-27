"""Stripe Price IDs must come from env in production."""
import pytest

from billing_stripe import DEFAULT_PRICES, resolve_price_id


def test_resolve_price_requires_env(monkeypatch):
    monkeypatch.delenv("STRIPE_PRICE_TIER1", raising=False)
    monkeypatch.delenv("ALLOW_STRIPE_TEST_PRICE_FALLBACK", raising=False)
    with pytest.raises(RuntimeError, match="STRIPE_PRICE_TIER1"):
        resolve_price_id(tier_level=1)


def test_resolve_price_test_fallback(monkeypatch):
    monkeypatch.delenv("STRIPE_PRICE_TIER1", raising=False)
    monkeypatch.setenv("ALLOW_STRIPE_TEST_PRICE_FALLBACK", "true")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    assert resolve_price_id(tier_level=1).startswith("price_")


def test_live_key_rejects_bundled_test_price_ids(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_dummy")
    monkeypatch.setenv("STRIPE_PRICE_TIER1", DEFAULT_PRICES["tier1"])
    with pytest.raises(RuntimeError, match="sk_live_"):
        resolve_price_id(tier_level=1)


def test_live_alias_secret_stripe_key_is_preferred(monkeypatch):
    from billing_stripe import stripe_publishable_key, stripe_secret_key

    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setenv("SECRET_STRIPE_KEY", "sk_live_dummy")
    assert stripe_secret_key() == "sk_live_dummy"

    monkeypatch.setenv("STRIPE_PUBLISHABLE_KEY", "pk_test_dummy")
    monkeypatch.setenv("PUBLISHABLE_STRIPE_KEY", "pk_live_dummy")
    assert stripe_publishable_key() == "pk_live_dummy"


def test_live_key_accepts_custom_price_id(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_dummy")
    monkeypatch.setenv("STRIPE_PRICE_TIER1", "price_live_custom_abc")
    assert resolve_price_id(tier_level=1) == "price_live_custom_abc"
