"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `billing_credits`."""
from __future__ import annotations

from supabase_rest import sb_patch
from supabase_rest import sb_post
from token_billing import USD_TO_PLN
from token_billing import compute_credits_from_usage
from token_billing import tokens_from_usage
from typing import Any
from typing import Optional
import httpx
from app_core import CHAT_MODEL, _openai, get_account_key, logger
from subscription_core import _ensure_subscription



# ─────────────────────────────────────────────────────────────────────────────
# Token usage billing — Real-time Token-to-Credit (see token_billing.py).
# ─────────────────────────────────────────────────────────────────────────────


async def _deduct_credits(client: httpx.AsyncClient, credits: int, *, endpoint: str) -> int:
    """Odejmuje kredyty; saldo nigdy nie spada poniżej 0. Zwraca nowe saldo."""
    if credits <= 0:
        try:
            sub = await _ensure_subscription(client)
            return int(sub.get("credits_balance") or 0)
        except Exception:
            return 0
    try:
        sub = await _ensure_subscription(client)
        new_bal = max(0, int(sub.get("credits_balance") or 0) - int(credits))
        await sb_patch(client, "subscriptions", {"account_key": f"eq.{get_account_key()}"},
                       {"credits_balance": new_bal})
        return new_bal
    except Exception as e:  # noqa: BLE001
        logger.debug(f"_deduct_credits skipped ({endpoint}): {e}")
        try:
            sub = await _ensure_subscription(client)
            return int(sub.get("credits_balance") or 0)
        except Exception:
            return 0


async def _log_token_usage(client: httpx.AsyncClient, *,
                           endpoint: str, model: str,
                           prompt_tokens: int, completion_tokens: int,
                           cached_tokens: int = 0,
                           audio_seconds: float = 0.0,
                           extra_credits: int = 0,
                           extras: Optional[dict] = None) -> dict:
    """Loguje zużycie do token_usage, odejmuje kredyty; zwraca billing summary."""
    breakdown = compute_credits_from_usage(
        model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        audio_seconds=audio_seconds,
        extra_credits=extra_credits,
        usd_to_pln=USD_TO_PLN,
    )
    credits = int(breakdown["credits_deducted"])
    ex = dict(extras or {})
    ex["credits_charged"] = credits
    try:
        payload = {
            "endpoint": endpoint,
            "model": model,
            "prompt_tokens": int(prompt_tokens),
            "completion_tokens": int(completion_tokens),
            "total_tokens": int(prompt_tokens + completion_tokens),
            "cost_usd": breakdown["cost_usd"],
            "cost_pln": breakdown["cost_pln"],
            "extras": {**ex, "cached_tokens": int(cached_tokens), "audio_seconds": audio_seconds},
        }
        await sb_post(client, "token_usage", payload)
    except Exception as e:  # noqa: BLE001
        logger.debug(f"_log_token_usage skipped: {e}")

    new_bal = await _deduct_credits(client, credits, endpoint=endpoint)
    return {
        **breakdown,
        "credits_remaining": new_bal,
        "endpoint": endpoint,
    }


async def _bill_openai_response(
    client: httpx.AsyncClient,
    resp: Any,
    *,
    endpoint: str,
    model: str,
    extras: Optional[dict] = None,
    extra_credits: int = 0,
) -> dict:
    """Rozlicza pojedyncze wywołanie OpenAI na podstawie response.usage."""
    usage = getattr(resp, "usage", None)
    if not usage:
        try:
            sub = await _ensure_subscription(client)
            bal = int(sub.get("credits_balance") or 0)
        except Exception:
            bal = None
        return {"credits_deducted": 0, "credits_remaining": bal, "cost_usd": 0.0, "cost_pln": 0.0}

    pt, ct, cached, audio = tokens_from_usage(usage)
    return await _log_token_usage(
        client,
        endpoint=endpoint,
        model=model,
        prompt_tokens=pt,
        completion_tokens=ct,
        cached_tokens=cached,
        audio_seconds=audio,
        extra_credits=extra_credits,
        extras=extras,
    )


def _with_billing(payload: dict, billing: Optional[dict]) -> dict:
    if not billing:
        return payload
    out = dict(payload)
    out["credits_deducted"] = int(billing.get("credits_deducted") or 0)
    if billing.get("credits_remaining") is not None:
        out["credits_remaining"] = int(billing["credits_remaining"])
    return out


async def _chat_and_bill(httpx_c: httpx.AsyncClient, prompt: str, *,
                         endpoint: str, temperature: float = 0.4,
                         extras: Optional[dict] = None) -> tuple[str, dict]:
    """Wywołanie GPT-4o-mini + rozliczenie tokenów (Token-to-Credit Billing)."""
    client = _openai()
    resp = await client.chat.completions.create(
        model=CHAT_MODEL, temperature=temperature,
        messages=[{"role": "user", "content": prompt}],
    )
    billing = await _bill_openai_response(
        httpx_c, resp, endpoint=endpoint, model=CHAT_MODEL, extras=extras,
    )
    return (resp.choices[0].message.content or "").strip(), billing

__all__ = ['_bill_openai_response', '_chat_and_bill', '_deduct_credits', '_log_token_usage', '_with_billing']
