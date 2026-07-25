"""Unit tests for token_billing."""
from __future__ import annotations

import math

from token_billing import (
    USD_TO_PLN,
    compute_cost_usd,
    compute_credits_from_usage,
    usd_to_credits,
)


class TestUsdToCredits:
    def test_ceil_example_from_spec(self):
        # $0.0315 * 4 PLN = 0.126 PLN = 12.6 groszy -> 13 credits
        credits, pln = usd_to_credits(0.0315)
        assert pln == round(0.0315 * USD_TO_PLN, 6)
        assert credits == math.ceil(0.126 * 100)

    def test_small_cost_four_credits(self):
        # $0.01 * 4 = 0.04 PLN = 4 grosze
        credits, _ = usd_to_credits(0.01)
        assert credits == 4

    def test_zero_cost_zero_credits(self):
        assert usd_to_credits(0.0) == (0, 0.0)


class TestGpt4oMini:
    def test_mixed_tokens(self):
        cost = compute_cost_usd(
            "gpt-4o-mini",
            prompt_tokens=1000,
            completion_tokens=500,
        )
        expected = (1000 * 0.15 + 500 * 0.60) / 1_000_000.0
        assert abs(cost - expected) < 1e-9

    def test_cached_tokens_cheaper(self):
        full = compute_cost_usd("gpt-4o-mini", prompt_tokens=1000, completion_tokens=0)
        cached = compute_cost_usd(
            "gpt-4o-mini", prompt_tokens=1000, completion_tokens=0, cached_tokens=512
        )
        assert cached < full


class TestWhisper:
    def test_duration_billing(self):
        cost = compute_cost_usd("whisper-1", audio_seconds=60.0)
        assert abs(cost - 0.006) < 1e-9


class TestComputeCredits:
    def test_returns_breakdown(self):
        r = compute_credits_from_usage(
            "gpt-4o-mini", prompt_tokens=2000, completion_tokens=1000
        )
        assert r["credits_deducted"] >= 1
        assert r["prompt_tokens"] == 2000
        assert r["completion_tokens"] == 1000
