"""Real-time Token-to-Credit billing — pure cost math (no I/O)."""
from __future__ import annotations

import math
from typing import Any, Optional

USD_TO_PLN = 4.0

# USD per 1M tokens (input / output / cached input). Whisper: USD per minute.
TOKEN_PRICING_USD: dict[str, dict[str, float]] = {
    "gpt-4o-mini": {"input": 0.15, "output": 0.60, "cached_input": 0.075},
    "gpt-4o": {"input": 2.50, "output": 10.00, "cached_input": 1.25},
    "whisper-1": {"per_minute": 0.006},
}

# Future: ElevenLabs Jarvis TTS surcharge (not applied yet).
ELEVENLABS_SURCHARGE_CREDITS = 10


def pricing_for_model(model: str) -> dict[str, float]:
    key = (model or "").strip().lower()
    if key in TOKEN_PRICING_USD:
        return TOKEN_PRICING_USD[key]
    if "gpt-4o-mini" in key or "mini" in key:
        return TOKEN_PRICING_USD["gpt-4o-mini"]
    if "gpt-4o" in key:
        return TOKEN_PRICING_USD["gpt-4o"]
    if "whisper" in key:
        return TOKEN_PRICING_USD["whisper-1"]
    return TOKEN_PRICING_USD["gpt-4o-mini"]


def cached_tokens_from_usage(usage: Any) -> int:
    if usage is None:
        return 0
    details = getattr(usage, "prompt_tokens_details", None)
    if details is None and isinstance(usage, dict):
        details = usage.get("prompt_tokens_details")
    if details is None:
        return 0
    if isinstance(details, dict):
        return int(details.get("cached_tokens") or 0)
    return int(getattr(details, "cached_tokens", 0) or 0)


def audio_seconds_from_usage(usage: Any) -> float:
    if usage is None:
        return 0.0
    usage_type = getattr(usage, "type", None)
    if usage_type is None and isinstance(usage, dict):
        usage_type = usage.get("type")
    if usage_type == "duration" or hasattr(usage, "seconds"):
        try:
            return float(getattr(usage, "seconds", 0) or 0)
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def tokens_from_usage(usage: Any) -> tuple[int, int, int, float]:
    """Returns (prompt_tokens, completion_tokens, cached_tokens, audio_seconds)."""
    if usage is None:
        return 0, 0, 0, 0.0
    if isinstance(usage, dict):
        pt = int(usage.get("prompt_tokens") or 0)
        ct = int(usage.get("completion_tokens") or 0)
        cached = cached_tokens_from_usage(usage)
        audio = audio_seconds_from_usage(usage)
        return pt, ct, cached, audio
    pt = int(getattr(usage, "prompt_tokens", 0) or 0)
    ct = int(getattr(usage, "completion_tokens", 0) or 0)
    cached = cached_tokens_from_usage(usage)
    audio = audio_seconds_from_usage(usage)
    return pt, ct, cached, audio


def compute_cost_usd(
    model: str,
    *,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    cached_tokens: int = 0,
    audio_seconds: float = 0.0,
) -> float:
    prices = pricing_for_model(model)
    if "whisper" in (model or "").lower() or "per_minute" in prices:
        minutes = max(0.0, float(audio_seconds)) / 60.0
        return round(minutes * prices.get("per_minute", 0.006), 8)

    cached = min(max(0, int(cached_tokens)), max(0, int(prompt_tokens)))
    regular_input = max(0, int(prompt_tokens) - cached)
    in_rate = prices["input"]
    cached_rate = prices.get("cached_input", in_rate * 0.5)
    out_rate = prices["output"]
    cost = (regular_input * in_rate + cached * cached_rate + int(completion_tokens) * out_rate) / 1_000_000.0
    return round(cost, 8)


def usd_to_credits(cost_usd: float, *, usd_to_pln: float = USD_TO_PLN) -> tuple[int, float]:
    """PLN → grosze → credits (1 grosz = 1 kredyt), zaokrąglenie w górę."""
    if cost_usd <= 0:
        return 0, 0.0
    cost_pln = cost_usd * usd_to_pln
    credits = math.ceil(cost_pln * 100)
    return int(credits), round(cost_pln, 6)


def compute_credits_from_usage(
    model: str,
    *,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    cached_tokens: int = 0,
    audio_seconds: float = 0.0,
    extra_credits: int = 0,
    usd_to_pln: float = USD_TO_PLN,
) -> dict[str, Any]:
    cost_usd = compute_cost_usd(
        model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        audio_seconds=audio_seconds,
    )
    credits, cost_pln = usd_to_credits(cost_usd, usd_to_pln=usd_to_pln)
    if extra_credits > 0:
        credits += int(extra_credits)
    return {
        "credits_deducted": credits,
        "cost_usd": cost_usd,
        "cost_pln": cost_pln,
        "prompt_tokens": int(prompt_tokens),
        "completion_tokens": int(completion_tokens),
        "cached_tokens": int(cached_tokens),
        "audio_seconds": round(float(audio_seconds), 3),
        "model": model,
    }


def compute_credits_from_openai_usage(
    model: str,
    usage: Any,
    *,
    extra_credits: int = 0,
    usd_to_pln: float = USD_TO_PLN,
) -> dict[str, Any]:
    pt, ct, cached, audio = tokens_from_usage(usage)
    return compute_credits_from_usage(
        model,
        prompt_tokens=pt,
        completion_tokens=ct,
        cached_tokens=cached,
        audio_seconds=audio,
        extra_credits=extra_credits,
        usd_to_pln=usd_to_pln,
    )


def merge_billing_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    if not events:
        return {"credits_deducted": 0, "credits_remaining": None}
    total = sum(int(e.get("credits_deducted") or 0) for e in events)
    last = events[-1]
    return {
        "credits_deducted": total,
        "credits_remaining": last.get("credits_remaining"),
        "cost_usd": round(sum(float(e.get("cost_usd") or 0) for e in events), 6),
        "cost_pln": round(sum(float(e.get("cost_pln") or 0) for e in events), 6),
        "prompt_tokens": sum(int(e.get("prompt_tokens") or 0) for e in events),
        "completion_tokens": sum(int(e.get("completion_tokens") or 0) for e in events),
        "cached_tokens": sum(int(e.get("cached_tokens") or 0) for e in events),
    }
