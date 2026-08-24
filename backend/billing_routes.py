"""Stripe Checkout / Portal / Webhook — wydzielone z server.py (dekalog §I)."""
from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get, sb_patch, sb_post
from url_safety import assert_safe_redirect_url

logger = logging.getLogger("billing.routes")

router = APIRouter(tags=["billing"])


def _require_tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


def _account_key_soft() -> str:
    """Fallback dla webhooka Stripe (bez nagłówka tenanta)."""
    from server import get_account_key

    return get_account_key()


def _tier_config() -> dict:
    from server import TIER_CONFIG

    return TIER_CONFIG


async def _subscription(client: httpx.AsyncClient) -> dict:
    from server import _get_subscription

    return await _get_subscription(client)


async def _ensure_sub(client: httpx.AsyncClient) -> dict:
    from server import _ensure_subscription

    return await _ensure_subscription(client)


def _sub_view(sub: dict, message: Optional[str] = None) -> dict:
    from server import _subscription_view

    return _subscription_view(sub, message=message)


class CheckoutSessionRequest(BaseModel):
    kind: str  # "subscription" | "topup"
    tier_level: Optional[int] = None
    package: Optional[str] = None
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    idempotency_key: Optional[str] = None


class ConfirmSessionRequest(BaseModel):
    session_id: str


class PortalSessionRequest(BaseModel):
    return_url: Optional[str] = None


@router.post("/api/billing/create-checkout-session")
async def billing_create_checkout(req: CheckoutSessionRequest):
    """
    Subskrypcja: jeśli jest już stripe_subscription_id — zmienia plan w Stripe (upgrade/downgrade)
    bez ręcznej rezygnacji. W przeciwnym razie tworzy Checkout Session.
    Top-up: zawsze Checkout. Kredyty z Checkout dolicza webhook / confirm-session.
    """
    from billing_stripe import (
        create_checkout_session,
        stripe_configured,
        upgrade_existing_subscription,
    )

    account_key = _require_tenant()
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY — skonfiguruj backend/.env")
    success = (req.success_url or os.getenv("BILLING_SUCCESS_URL") or "myapp://billing/success").strip()
    cancel = (req.cancel_url or os.getenv("BILLING_CANCEL_URL") or "myapp://billing/cancel").strip()
    if success.startswith("myapp://"):
        public = (os.getenv("PUBLIC_APP_URL") or "http://localhost:8081").rstrip("/")
        success = f"{public}/billing-success?session_id={{CHECKOUT_SESSION_ID}}"
    if cancel.startswith("myapp://"):
        public = (os.getenv("PUBLIC_APP_URL") or "http://localhost:8081").rstrip("/")
        cancel = f"{public}/billing-cancel"
    success = assert_safe_redirect_url(success)
    cancel = assert_safe_redirect_url(cancel)

    customer_id: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=45.0, verify=httpx_verify()) as client:
            sub = await _ensure_sub(client)
            customer_id = sub.get("stripe_customer_id")

            # Upgrade/downgrade istniejącej subskrypcji — bez drugiego Checkout
            if (
                req.kind == "subscription"
                and req.tier_level in (1, 2)
                and (sub.get("stripe_subscription_id") or "").startswith("sub_")
            ):
                cur_tier = int(sub.get("tier_level") or 0)
                if cur_tier == int(req.tier_level):
                    return {
                        "ok": True,
                        "upgraded": True,
                        "tier_level": cur_tier,
                        "message": "Ten plan jest już aktywny.",
                    }
                try:
                    result = await upgrade_existing_subscription(
                        account_key=account_key,
                        tier_level=int(req.tier_level),
                        stripe_subscription_id=sub["stripe_subscription_id"],
                        current_tier=cur_tier,
                        credits_balance=int(sub.get("credits_balance") or 0),
                        tier_config=_tier_config(),
                        client=client,
                        sb_get=sb_get,
                        sb_patch=sb_patch,
                        sb_post=sb_post,
                        idempotency_key=req.idempotency_key or str(uuid.uuid4()),
                    )
                    return {"ok": True, **result}
                except Exception as up_err:
                    logger.warning(
                        "upgrade_existing_subscription failed, fallback to Checkout: %s",
                        up_err,
                    )

            replace_sub_id = None
            if (
                req.kind == "subscription"
                and (sub.get("stripe_subscription_id") or "").startswith("sub_")
            ):
                # Nowy Checkout zastąpi starą subskrypcję po opłaceniu (bez ręcznej rezygnacji).
                replace_sub_id = str(sub["stripe_subscription_id"])

            session = await create_checkout_session(
                account_key=account_key,
                kind=req.kind,
                tier_level=req.tier_level,
                package=req.package,
                success_url=success,
                cancel_url=cancel,
                customer_id=customer_id,
                idempotency_key=req.idempotency_key or str(uuid.uuid4()),
                replace_subscription_id=replace_sub_id,
            )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("create-checkout-session failed")
        raise HTTPException(status_code=502, detail=str(e)[:300]) from e
    return {"ok": True, **session}


@router.post("/api/billing/confirm-session")
async def billing_confirm_session(req: ConfirmSessionRequest):
    """
    Potwierdzenie płatności bez Stripe CLI / webhooka.
    Backend odpytuje Stripe API — jeśli session jest opłacona, dolicza kredyty/tier.
    Frontend NIE może podać kwoty kredytów — tylko session_id.
    Sesja musi należeć do tenanta (metadata.account_key / client_reference_id).
    """
    from billing_stripe import (
        apply_paid_checkout_session,
        retrieve_checkout_session,
        stripe_configured,
    )

    account_key = _require_tenant()
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY")
    sid = (req.session_id or "").strip()
    if not sid.startswith("cs_"):
        raise HTTPException(status_code=400, detail="Nieprawidłowy session_id")
    try:
        session = await retrieve_checkout_session(sid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)[:300]) from e

    meta = dict(session.get("metadata") or {})
    session_owner = (
        (meta.get("account_key") or "").strip()
        or (session.get("client_reference_id") or "").strip()
    )
    if not session_owner or session_owner != account_key:
        raise HTTPException(
            status_code=403,
            detail="Ta sesja płatności nie należy do Twojego konta.",
        )

    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as client:
        result = await apply_paid_checkout_session(
            session,
            client=client,
            sb_get=sb_get,
            sb_post=sb_post,
            sb_patch=sb_patch,
            account_key_default=account_key,
            tier_config=_tier_config(),
        )
        if result.get("paid"):
            sub = await _subscription(client)
            view = _sub_view(sub, message="Płatność potwierdzona. Portfel zaktualizowany.")
            view["ok"] = True
            view["billing"] = result
            return view
        return {"ok": False, **result}


@router.post("/api/billing/portal")
async def billing_portal(req: PortalSessionRequest):
    """Stripe Customer Portal — zarządzanie kartą / anulowanie / faktury."""
    from billing_stripe import create_billing_portal_session, stripe_configured

    _require_tenant()
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY")
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        sub = await _ensure_sub(client)
        cid = sub.get("stripe_customer_id")
        if not cid:
            raise HTTPException(status_code=400, detail="Brak klienta Stripe — najpierw wykup plan.")
        ret = (req.return_url or os.getenv("PUBLIC_APP_URL") or "http://localhost:8081").strip()
        ret = assert_safe_redirect_url(ret)
        try:
            portal = await create_billing_portal_session(customer_id=cid, return_url=ret)
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e)[:300]) from e
        return {"ok": True, **portal}


@router.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    """Stripe Webhook — jedyne miejsce dodawania kredytów / zmiany tieru."""
    from billing_stripe import construct_event, handle_stripe_event

    payload = await request.body()
    sig = request.headers.get("stripe-signature") or ""
    try:
        event = construct_event(payload, sig)
    except Exception as e:
        logger.warning("Stripe webhook signature failed: %s", e)
        raise HTTPException(status_code=400, detail=f"Webhook signature: {e}") from e
    if hasattr(event, "to_dict"):
        event_dict = event.to_dict()
    else:
        event_dict = dict(event)
    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as client:
        result = await handle_stripe_event(
            event_dict,
            client=client,
            sb_get=sb_get,
            sb_post=sb_post,
            sb_patch=sb_patch,
            account_key_default=_account_key_soft(),
            tier_config=_tier_config(),
        )
    return result


@router.get("/api/billing/status")
async def billing_status():
    from billing_stripe import stripe_configured

    return {
        "ok": True,
        "stripe_configured": stripe_configured(),
        "webhook_secret_set": bool(
            (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip().startswith("whsec_")
        ),
        "confirm_session_available": True,
        "mock_billing": os.getenv("ALLOW_MOCK_BILLING", "false").strip().lower()
        in ("1", "true", "yes"),
    }
