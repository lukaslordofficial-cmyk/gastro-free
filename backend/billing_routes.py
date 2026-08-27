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
from url_safety import assert_safe_redirect_url, checkout_redirect_public_base, is_safe_app_return_url

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
    Subskrypcja: jeśli jest już stripe_subscription_id (lub aktywna w Stripe) — zmienia plan
    bez ręcznej rezygnacji. W przeciwnym razie tworzy Checkout Session.
    Top-up: zawsze Checkout. Kredyty z Checkout dolicza webhook / confirm-session.
    """
    from billing_stripe import (
        cancel_stripe_subscription,
        create_checkout_session,
        find_customer_active_subscription_id,
        stripe_configured,
        upgrade_existing_subscription,
    )

    account_key = _require_tenant()
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY — skonfiguruj backend/.env")

    # Stripe wymaga http(s). NIE używaj PUBLIC_APP_URL=localhost:8081 (Expo) —
    # na telefonie / produkcji pada allowlista albo „witryna nieosiągalna”.
    public = checkout_redirect_public_base()
    billing_ok = f"{public}/api/billing/billing-return?status=success&session_id={{CHECKOUT_SESSION_ID}}"
    billing_cancel = f"{public}/api/billing/billing-return?status=cancel"

    success = (req.success_url or os.getenv("BILLING_SUCCESS_URL") or billing_ok).strip()
    cancel = (req.cancel_url or os.getenv("BILLING_CANCEL_URL") or billing_cancel).strip()
    if (
        success.startswith("myapp://")
        or success.startswith("exp://")
        or success.startswith("exp+")
        or "localhost" in success
        or "127.0.0.1" in success
    ):
        success = billing_ok
    if (
        cancel.startswith("myapp://")
        or cancel.startswith("exp://")
        or cancel.startswith("exp+")
        or "localhost" in cancel
        or "127.0.0.1" in cancel
    ):
        cancel = billing_cancel
    success = assert_safe_redirect_url(success)
    cancel = assert_safe_redirect_url(cancel)

    customer_id: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=45.0, verify=httpx_verify()) as client:
            sub = await _ensure_sub(client)
            customer_id = sub.get("stripe_customer_id")
            sid = str(sub.get("stripe_subscription_id") or "").strip()

            # DB bez sub_*, ale Stripe customer ma aktywną subskrypcję → odzyskaj ID i upgrade
            if (
                req.kind == "subscription"
                and req.tier_level in (1, 2)
                and not sid.startswith("sub_")
                and str(customer_id or "").startswith("cus_")
            ):
                recovered = await find_customer_active_subscription_id(str(customer_id))
                if recovered:
                    sid = recovered
                    try:
                        await sb_patch(
                            client,
                            "subscriptions",
                            {"account_key": f"eq.{account_key}"},
                            {"stripe_subscription_id": sid},
                        )
                    except Exception as sync_err:
                        logger.warning("sync recovered stripe_subscription_id failed: %s", sync_err)
                    sub["stripe_subscription_id"] = sid

            # Upgrade/downgrade istniejącej subskrypcji — bez drugiego Checkout i bez rezygnacji
            if (
                req.kind == "subscription"
                and req.tier_level in (1, 2)
                and sid.startswith("sub_")
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
                        stripe_subscription_id=sid,
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
                    # Fallback: anuluj starą subskrypcję i otwórz Checkout nowego planu
                    # (bez komunikatu „najpierw zrezygnuj” — robimy to automatycznie).
                    logger.warning(
                        "upgrade_existing_subscription failed, cancel+checkout: %s",
                        up_err,
                    )
                    try:
                        await cancel_stripe_subscription(sid, at_period_end=False)
                        await sb_patch(
                            client,
                            "subscriptions",
                            {"account_key": f"eq.{account_key}"},
                            {"stripe_subscription_id": None},
                        )
                    except Exception as cancel_err:
                        logger.warning("auto-cancel before checkout failed: %s", cancel_err)
                        raise HTTPException(
                            status_code=502,
                            detail=(
                                "Nie udało się automatycznie zmienić planu. "
                                "Użyj przycisku „Zrezygnuj z planu”, a potem wybierz nowy — "
                                f"albo „Zarządzaj subskrypcją”. ({str(up_err)[:140]})"
                            ),
                        ) from up_err
                    sid = ""
                    # fall through to Checkout poniżej

            try:
                session = await create_checkout_session(
                    account_key=account_key,
                    kind=req.kind,
                    tier_level=req.tier_level,
                    package=req.package,
                    success_url=success,
                    cancel_url=cancel,
                    customer_id=customer_id,
                    idempotency_key=req.idempotency_key or str(uuid.uuid4()),
                    replace_subscription_id=None,
                )
            except Exception as checkout_err:
                err_l = str(checkout_err).lower()
                # Customer ma już subskrypcję w Stripe, a my nie złapaliśmy jej wyżej
                if (
                    req.kind == "subscription"
                    and str(customer_id or "").startswith("cus_")
                    and (
                        "already has a subscription" in err_l
                        or "already subscribed" in err_l
                        or "cannot create a subscription" in err_l
                    )
                ):
                    recovered = await find_customer_active_subscription_id(str(customer_id))
                    if recovered and req.tier_level in (1, 2):
                        cur_tier = int(sub.get("tier_level") or 0)
                        result = await upgrade_existing_subscription(
                            account_key=account_key,
                            tier_level=int(req.tier_level),
                            stripe_subscription_id=recovered,
                            current_tier=cur_tier,
                            credits_balance=int(sub.get("credits_balance") or 0),
                            tier_config=_tier_config(),
                            client=client,
                            sb_get=sb_get,
                            sb_patch=sb_patch,
                            sb_post=sb_post,
                            idempotency_key=req.idempotency_key or str(uuid.uuid4()),
                        )
                        try:
                            await sb_patch(
                                client,
                                "subscriptions",
                                {"account_key": f"eq.{account_key}"},
                                {"stripe_subscription_id": recovered},
                            )
                        except Exception:
                            pass
                        return {"ok": True, **result}
                    # Ostatnia deska: Checkout bez customer (nowy customer) — unikamy blokady
                    session = await create_checkout_session(
                        account_key=account_key,
                        kind=req.kind,
                        tier_level=req.tier_level,
                        package=req.package,
                        success_url=success,
                        cancel_url=cancel,
                        customer_id=None,
                        idempotency_key=(req.idempotency_key or str(uuid.uuid4())) + "-nocust",
                        replace_subscription_id=None,
                    )
                else:
                    raise
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("create-checkout-session failed")
        msg = str(e)[:300]
        low = msg.lower()
        if "already has a subscription" in low or "already subscribed" in low:
            msg = (
                "W Stripe jest już aktywna subskrypcja. Nie musisz nic anulować ręcznie — "
                "kliknij ponownie „Ulepsz plan”, albo użyj „Zrezygnuj z planu” poniżej i wybierz nowy. "
                f"({msg[:120]})"
            )
        raise HTTPException(status_code=502, detail=msg) from e
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
        # Portal też nie może wracać na localhost Expo.
        public = checkout_redirect_public_base()
        ret = (req.return_url or f"{public}/api/billing/billing-return?status=portal").strip()
        if "localhost" in ret or "127.0.0.1" in ret:
            ret = f"{public}/api/billing/billing-return?status=portal"
        ret = assert_safe_redirect_url(ret)
        try:
            portal = await create_billing_portal_session(customer_id=cid, return_url=ret)
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e)[:300]) from e
        return {"ok": True, **portal}


@router.get("/api/billing/billing-return")
async def billing_return(
    status: str = "success",
    session_id: str = "",
    app: str = "",
):
    """Stripe success/cancel (http/https) → HTML z deep linkiem do aplikacji."""
    import json
    from html import escape
    from urllib.parse import quote, unquote

    from fastapi.responses import HTMLResponse

    st = (status or "").strip().lower()
    ok = st in ("success", "ok", "paid", "portal")
    sid = (session_id or "").strip()
    suffix = f"?session_id={quote(sid, safe='')}" if sid.startswith("cs_") else ""
    if st == "portal":
        deep = "myapp:///billing/portal-return"
        title = "Panel subskrypcji"
        hint = "Wracamy do Gastro-Managera."
    elif ok:
        deep = f"myapp:///billing/success{suffix}"
        title = "Płatność zrealizowana"
        hint = "Wracamy do aplikacji. Jeśli kredyty się nie doliczyły — kliknij „Potwierdź płatność”."
    else:
        deep = "myapp:///billing/cancel"
        title = "Płatność anulowana"
        hint = "Możesz wrócić do aplikacji i spróbować ponownie."

    app_url = unquote((app or "").strip())
    if app_url and is_safe_app_return_url(app_url):
        joiner = "&" if "?" in app_url else "?"
        if ok and sid.startswith("cs_") and "session_id=" not in app_url:
            app_url = f"{app_url}{joiner}session_id={quote(sid, safe='')}"
        primary = app_url
    else:
        primary = deep

    expo_primary = primary.startswith("exp://") or primary.startswith("exp+")
    auto_fallback = "" if expo_primary else deep
    safe_primary = escape(primary, quote=True)
    safe_deep = escape(deep, quote=True)
    html = f"""<!DOCTYPE html>
<html lang="pl"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{escape(title)}</title>
<style>
body{{font-family:system-ui,sans-serif;background:#0A120E;color:#F5F5F5;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}}
a.btn{{color:#0A120E;background:#00FF88;font-weight:800;display:inline-block;margin:12px 0;
padding:14px 22px;border-radius:12px;text-decoration:none}}
a.alt{{color:#00FF88;display:inline-block;margin:8px}}
p{{opacity:.8;line-height:1.5;max-width:28rem}}
</style></head><body>
<div>
<h1 style="font-size:1.35rem;margin:0 0 12px">{escape(title)}</h1>
<p>{escape(hint)}</p>
<p style="margin-top:20px"><a class="btn" id="open-app" href="{safe_primary}">Wróć do aplikacji</a></p>
<p><a class="alt" href="{safe_deep}">Otwórz zainstalowaną aplikację</a></p>
</div>
<script>
(function(){{
  var primary = {json.dumps(primary)};
  var fallback = {json.dumps(auto_fallback)};
  function go(u){{ if (!u) return; try {{ window.location.href = u; }} catch (e) {{}} }}
  go(primary);
  setTimeout(function(){{ go(primary); }}, 250);
  if (fallback && fallback !== primary) {{
    setTimeout(function(){{ go(fallback); }}, 1600);
  }}
  var a = document.getElementById('open-app');
  if (a) a.addEventListener('click', function(ev){{
    ev.preventDefault();
    go(primary);
  }});
}})();
</script>
</body></html>"""
    return HTMLResponse(content=html)


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
        raise HTTPException(status_code=400, detail="Invalid signature") from e
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
    from billing_stripe import resolve_price_id, stripe_configured, stripe_secret_key
    from url_safety import checkout_redirect_public_base

    sk = stripe_secret_key()
    if sk.startswith("sk_live_"):
        key_mode = "live"
    elif sk.startswith("sk_test_"):
        key_mode = "test"
    else:
        key_mode = "missing"

    public_ok = False
    try:
        base = checkout_redirect_public_base()
        public_ok = bool(base) and "localhost" not in base and "127.0.0.1" not in base
    except Exception:
        public_ok = False

    prices_ok = False
    try:
        resolve_price_id(tier_level=1)
        resolve_price_id(tier_level=2)
        resolve_price_id(package="small")
        resolve_price_id(package="medium")
        resolve_price_id(package="large")
        prices_ok = True
    except Exception:
        prices_ok = False

    return {
        "ok": True,
        "stripe_configured": stripe_configured(),
        "stripe_key_mode": key_mode,
        "stripe_prices_ok": prices_ok,
        "webhook_secret_set": bool(
            (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip().startswith("whsec_")
        ),
        "public_api_url_ok": public_ok,
        "confirm_session_available": True,
        "mock_billing": os.getenv("ALLOW_MOCK_BILLING", "false").strip().lower()
        in ("1", "true", "yes"),
    }
