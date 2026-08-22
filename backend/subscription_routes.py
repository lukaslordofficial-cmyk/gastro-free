"""
Subskrypcje / portfel kredytów — API wydzielone z server.py.
Mutacje wymagają X-Account-Key tenanta (nie „default”).
"""
from __future__ import annotations

import math
import os
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get, sb_patch

router = APIRouter(tags=["subscription"])


class TopupRequest(BaseModel):
    package: Literal["small", "medium", "large"]


class SubscribeRequest(BaseModel):
    tier_level: int


def _ak() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


@router.get("/api/subscription/usage-history")
async def subscription_usage_history(limit: int = 500):
    """Historia zużycia kredytów AI (token_usage), najnowsze wpisy pierwsze.
    Wiele wywołań LLM z jednej akcji użytkownika jest scalanych w jeden wiersz."""
    from server import _aggregate_credit_history

    _ak()
    cap = max(1, min(int(limit), 1000))
    raw_cap = min(3000, max(cap * 4, cap))
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        try:
            rows = await sb_get(client, "token_usage", params=[
                ("select", "id,endpoint,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,cost_pln,extras,created_at"),
                ("order", "created_at.desc"),
                ("limit", str(raw_cap)),
            ])
        except httpx.HTTPStatusError:
            return {
                "ok": False,
                "needs_migration": True,
                "items": [],
                "count": 0,
                "message": "Brak tabeli token_usage. Uruchom migrację ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql w Supabase.",
            }
        items = []
        for r in rows or []:
            ex = r.get("extras") or {}
            if not isinstance(ex, dict):
                ex = {}
            credits = ex.get("credits_charged")
            if credits is None:
                credits = int(math.ceil(float(r.get("cost_pln") or 0) * 100))
            else:
                credits = int(credits)
            items.append({
                "id": r.get("id"),
                "endpoint": r.get("endpoint") or "",
                "model": r.get("model") or "",
                "credits": credits,
                "cost_pln": float(r.get("cost_pln") or 0),
                "created_at": r.get("created_at"),
                "extras": ex,
            })
        aggregated = _aggregate_credit_history(items)[:cap]
        return {"ok": True, "items": aggregated, "count": len(aggregated)}


@router.get("/api/subscription")
async def get_subscription():
    """Zwraca stan portfela, plan, listę funkcji (z blokadami) i pakiety doładowań."""
    from server import _get_subscription, _subscription_view

    _ak()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        try:
            sub = await _get_subscription(client)
        except httpx.HTTPStatusError:
            return {
                "ok": False,
                "needs_migration": True,
                "message": "Brak tabeli subscriptions. Uruchom migrację ADD_SUBSCRIPTIONS.sql w Supabase.",
            }
        view = _subscription_view(sub)
        view["ok"] = True
        return view


@router.post("/api/subscription/topup")
async def subscription_topup(req: TopupRequest):
    """MOCK doładowanie — tylko gdy ALLOW_MOCK_BILLING=true. Produkcyjnie: Stripe Checkout."""
    from server import TOPUP_PACKAGES, _ensure_subscription, _subscription_view

    ak = _ak()
    if os.getenv("ALLOW_MOCK_BILLING", "false").strip().lower() not in ("1", "true", "yes"):
        raise HTTPException(
            status_code=400,
            detail="Płatności MOCK wyłączone. Użyj POST /api/billing/create-checkout-session.",
        )
    pkg = TOPUP_PACKAGES[req.package]
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        sub = await _ensure_subscription(client)
        new_bal = int(sub.get("credits_balance") or 0) + pkg["credits"]
        await sb_patch(
            client,
            "subscriptions",
            {"account_key": f"eq.{ak}"},
            {"credits_balance": new_bal},
        )
        sub["credits_balance"] = new_bal
        view = _subscription_view(
            sub,
            message=f"Doładowano {pkg['label']} za {pkg['price_pln']} zł (MOCK).",
        )
        view["ok"] = True
        return view


@router.post("/api/subscription/subscribe")
async def subscription_subscribe(req: SubscribeRequest):
    """MOCK subskrypcja — tylko gdy ALLOW_MOCK_BILLING=true. Produkcyjnie: Stripe Checkout."""
    from datetime import datetime, timezone, timedelta

    from server import TIER_CONFIG, _ensure_subscription, _subscription_view

    ak = _ak()
    if os.getenv("ALLOW_MOCK_BILLING", "false").strip().lower() not in ("1", "true", "yes"):
        raise HTTPException(
            status_code=400,
            detail="Płatności MOCK wyłączone. Użyj POST /api/billing/create-checkout-session.",
        )
    if req.tier_level not in (1, 2):
        raise HTTPException(status_code=400, detail="Nieprawidłowy tier (dozwolone: 1 lub 2).")
    cfg = TIER_CONFIG[req.tier_level]
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        sub = await _ensure_subscription(client)
        grant = cfg["monthly_grant"]
        new_bal = int(sub.get("credits_balance") or 0) + grant
        cpe = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        upd = {
            "tier_level": req.tier_level,
            "credits_balance": new_bal,
            "status": "active",
            "current_period_end": cpe,
        }
        await sb_patch(client, "subscriptions", {"account_key": f"eq.{ak}"}, upd)
        view = _subscription_view(
            {**sub, **upd},
            message=f"Aktywowano plan {cfg['name']} (+{grant} kredytów). MOCK.",
        )
        view["ok"] = True
        return view


@router.post("/api/subscription/resign")
async def subscription_resign():
    """Rezygnacja z subskrypcji — natychmiast Tier 0 Free, bez ponownego pakietu 100 kredytów."""
    from server import _ensure_subscription, _subscription_view

    ak = _ak()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        sub = await _ensure_subscription(client)
        upd = {
            "tier_level": 0,
            "status": "active",
            "current_period_end": None,
            "free_starter_claimed": True,
        }
        await sb_patch(client, "subscriptions", {"account_key": f"eq.{ak}"}, upd)
        view = _subscription_view(
            {**sub, **upd},
            message=(
                f"Przełączono na plan Free. Saldo: {sub.get('credits_balance')} kredytów "
                f"(bez ponownego pakietu startowego)."
            ),
        )
        view["ok"] = True
        return view


@router.post("/api/subscription/cancel")
async def subscription_cancel():
    """Anulowanie — brak dalszych doładowań; kredyty i tier zostają do końca okresu."""
    from server import _ensure_subscription, _subscription_view

    ak = _ak()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        sub = await _ensure_subscription(client)
        await sb_patch(
            client,
            "subscriptions",
            {"account_key": f"eq.{ak}"},
            {"status": "canceled"},
        )
        view = _subscription_view(
            {**sub, "status": "canceled"},
            message=(
                "Subskrypcja anulowana. Kredyty i plan pozostają do końca "
                "bieżącego okresu, bez kolejnych doładowań."
            ),
        )
        view["ok"] = True
        return view
