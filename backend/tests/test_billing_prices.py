"""Stripe Price IDs must come from env in production."""
import pytest

from billing_stripe import resolve_price_id


def test_resolve_price_requires_env(monkeypatch):
    monkeypatch.delenv("STRIPE_PRICE_TIER1", raising=False)
    monkeypatch.delenv("ALLOW_STRIPE_TEST_PRICE_FALLBACK", raising=False)
    with pytest.raises(RuntimeError, match="STRIPE_PRICE_TIER1"):
        resolve_price_id(tier_level=1)


def test_resolve_price_test_fallback(monkeypatch):
    monkeypatch.delenv("STRIPE_PRICE_TIER1", raising=False)
    monkeypatch.setenv("ALLOW_STRIPE_TEST_PRICE_FALLBACK", "true")
    assert resolve_price_id(tier_level=1).startswith("price_")
