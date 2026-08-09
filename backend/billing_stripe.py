"""
Bezpieczna integracja Stripe Checkout + Webhooks.
Kredyty i tiery zmienia WYŁĄCZNIE webhook (nigdy sygnał z aplikacji).

Na Windows używamy httpx + systemowy SSL (jak OpenAI), bo certifi bywa zepsute.
"""
from __future__ import annotations

import logging
import os
import ssl
from datetime import datetime, timezone, timedelta
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("billing.stripe")

STRIPE_API = "https://api.stripe.com/v1"

STRIPE_PRODUCT_MAP = {
    "prod_UtaaLCsLbKaNKb": {"kind": "subscription", "tier_level": 1},
    "prod_UtaoGsCcAG9iTM": {"kind": "subscription", "tier_level": 2},
    "prod_Utav6FfYa4xRm5": {"kind": "topup", "package": "small", "credits": 100},
    "prod_Utb0Nd2J1MBYHE": {"kind": "topup", "package": "medium", "credits": 500},
    "prod_Utb3fRH0CMX3Nn": {"kind": "topup", "package": "large", "credits": 1000},
}

# Domyślne Price ID z konta testowego (nadpisywane env)
DEFAULT_PRICES = {
    "tier1": "price_1TtnPdQseiDVSEcCDARTRYCj",
    "tier2": "price_1TtnchQseiDVSEcCfSjfHjBW",
    "topup_100": "price_1TtnjSQseiDVSEcC3ntKwdtV",
    "topup_500": "price_1TtnoCQseiDVSEcCEVGaQqMU",
    "topup_1000": "price_1Ttnr8QseiDVSEcClQO5bnCT",
}


def stripe_configured() -> bool:
    return bool((os.getenv("STRIPE_SECRET_KEY") or "").strip())


def _secret() -> str:
    key = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
    if not key:
        raise RuntimeError("Brak STRIPE_SECRET_KEY w backend/.env")
    return key


def _ssl_verify():
    mode = os.environ.get("OPENAI_SSL_VERIFY", "auto").strip().lower()
    if mode in ("0", "false", "no"):
        return False
    if mode in ("certifi", "bundle"):
        import certifi
        return certifi.where()
    return ssl.create_default_context()


def _env_price(name: str, fallback: str) -> str:
    return (os.getenv(name) or "").strip() or fallback


def resolve_price_id(*, tier_level: Optional[int] = None, package: Optional[str] = None) -> str:
    if tier_level == 1:
        return _env_price("STRIPE_PRICE_TIER1", DEFAULT_PRICES["tier1"])
    if tier_level == 2:
        return _env_price("STRIPE_PRICE_TIER2", DEFAULT_PRICES["tier2"])
    if package == "small":
        return _env_price("STRIPE_PRICE_TOPUP_100", DEFAULT_PRICES["topup_100"])
    if package == "medium":
        return _env_price("STRIPE_PRICE_TOPUP_500", DEFAULT_PRICES["topup_500"])
    if package == "large":
        return _env_price("STRIPE_PRICE_TOPUP_1000", DEFAULT_PRICES["topup_1000"])
    raise ValueError("Nieznany produkt billingowy")


def _form_encode(data: dict, prefix: str = "") -> list[tuple[str, str]]:
    """Koduje zagnieżdżone dicty jak Stripe form-urlencoded."""
    items: list[tuple[str, str]] = []
    for k, v in data.items():
        key = f"{prefix}[{k}]" if prefix else k
        if isinstance(v, dict):
            items.extend(_form_encode(v, key))
        elif isinstance(v, list):
            for i, el in enumerate(v):
                if isinstance(el, dict):
                    items.extend(_form_encode(el, f"{key}[{i}]"))
                else:
                    items.append((f"{key}[{i}]", str(el)))
        elif v is None:
            continue
        elif isinstance(v, bool):
            items.append((key, "true" if v else "false"))
        else:
            items.append((key, str(v)))
    return items


async def _stripe_post(path: str, data: dict, *, idempotency_key: Optional[str] = None) -> dict:
    headers = {"Authorization": f"Bearer {_secret()}"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key[:255]
    body = urlencode(_form_encode(data))
    async with httpx.AsyncClient(timeout=45.0, verify=_ssl_verify()) as client:
        r = await client.post(f"{STRIPE_API}{path}", content=body, headers={
            **headers,
            "Content-Type": "application/x-www-form-urlencoded",
        })
        payload = r.json()
        if r.status_code >= 400:
            msg = payload.get("error", {}).get("message") or r.text[:300]
            raise RuntimeError(f"Stripe API {r.status_code}: {msg}")
        return payload


async def create_checkout_session(
    *,
    account_key: str,
    kind: str,
    tier_level: Optional[int] = None,
    package: Optional[str] = None,
    success_url: str,
    cancel_url: str,
    customer_email: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> dict[str, Any]:
    if kind == "subscription":
        if tier_level not in (1, 2):
            raise ValueError("tier_level musi być 1 lub 2")
        price_id = resolve_price_id(tier_level=tier_level)
        mode = "subscription"
        metadata = {
            "account_key": account_key,
            "kind": "subscription",
            "tier_level": str(tier_level),
        }
        payload: dict[str, Any] = {
            "mode": mode,
            "success_url": success_url,
            "cancel_url": cancel_url,
            "client_reference_id": account_key,
            "allow_promotion_codes": "true",
            "line_items": [{"price": price_id, "quantity": 1}],
            "metadata": metadata,
            "subscription_data": {"metadata": metadata},
        }
    elif kind == "topup":
        if package not in ("small", "medium", "large"):
            raise ValueError("Nieprawidłowy pakiet kredytów")
        price_id = resolve_price_id(package=package)
        credits = {"small": 100, "medium": 500, "large": 1000}[package]
        mode = "payment"
        metadata = {
            "account_key": account_key,
            "kind": "topup",
            "package": package,
            "credits": str(credits),
        }
        payload = {
            "mode": mode,
            "success_url": success_url,
            "cancel_url": cancel_url,
            "client_reference_id": account_key,
            "allow_promotion_codes": "true",
            "line_items": [{"price": price_id, "quantity": 1}],
            "metadata": metadata,
            "payment_intent_data": {"metadata": metadata},
        }
    else:
        raise ValueError("kind musi być subscription|topup")

    if customer_email:
        payload["customer_email"] = customer_email

    session = await _stripe_post("/checkout/sessions", payload, idempotency_key=idempotency_key)
    return {
        "id": session["id"],
        "url": session["url"],
        "mode": mode,
        "price_id": price_id,
        "metadata": metadata,
    }


async def create_billing_portal_session(*, customer_id: str, return_url: str) -> dict[str, Any]:
    session = await _stripe_post("/billing_portal/sessions", {
        "customer": customer_id,
        "return_url": return_url,
    })
    return {"url": session["url"]}


def construct_event(payload: bytes, sig_header: str):
    """Weryfikacja podpisu webhooka (lokalna kryptografia — bez sieci)."""
    import stripe
    stripe.api_key = _secret()
    secret = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()
    if not secret:
        raise RuntimeError(
            "Brak STRIPE_WEBHOOK_SECRET — uruchom: "
            "stripe listen --forward-to localhost:8001/api/billing/webhook"
        )
    return stripe.Webhook.construct_event(payload, sig_header, secret)


async def _already_processed(client: httpx.AsyncClient, sb_get, event_id: str) -> bool:
    try:
        rows = await sb_get(client, "stripe_webhook_events", params={
            "select": "id", "id": f"eq.{event_id}", "limit": "1",
        })
        return bool(rows)
    except Exception:
        return False


async def _mark_processed(client: httpx.AsyncClient, sb_post, event_id: str, event_type: str) -> None:
    try:
        await sb_post(client, "stripe_webhook_events", {
            "id": event_id,
            "event_type": event_type,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.warning("stripe_webhook_events insert failed: %s", e)


async def _patch_subscription(
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    sb_post,
    account_key: str,
    changes: dict,
) -> dict:
    rows = await sb_get(client, "subscriptions", params={
        "select": "*", "account_key": f"eq.{account_key}", "limit": "1",
    })
    if not rows:
        payload = {
            "account_key": account_key,
            "tier_level": 0,
            "credits_balance": 0,
            "status": "active",
            **changes,
        }
        created = await sb_post(client, "subscriptions", payload)
        return created[0] if isinstance(created, list) and created else payload
    await sb_patch(client, "subscriptions", {"account_key": f"eq.{account_key}"}, changes)
    return {**rows[0], **changes}


async def _add_credits_safe(
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    sb_post,
    account_key: str,
    credits: int,
    extra: Optional[dict] = None,
) -> dict:
    rows = await sb_get(client, "subscriptions", params={
        "select": "*", "account_key": f"eq.{account_key}", "limit": "1",
    })
    bal = int((rows[0].get("credits_balance") if rows else 0) or 0)
    new_bal = max(0, bal + int(credits))
    changes = {"credits_balance": new_bal, **(extra or {})}
    return await _patch_subscription(client, sb_get, sb_patch, sb_post, account_key, changes)


async def retrieve_checkout_session(session_id: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0, verify=_ssl_verify()) as client:
        r = await client.get(
            f"{STRIPE_API}/checkout/sessions/{session_id}",
            headers={"Authorization": f"Bearer {_secret()}"},
            params={"expand[]": "line_items"},
        )
        payload = r.json()
        if r.status_code >= 400:
            msg = payload.get("error", {}).get("message") or r.text[:300]
            raise RuntimeError(f"Stripe session: {msg}")
        return payload


async def apply_paid_checkout_session(
    session: dict,
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_post,
    sb_patch,
    account_key_default: str,
    tier_config: dict,
) -> dict:
    """
    Bezpieczne potwierdzenie płatności bez webhooka:
    backend sam odpytuje Stripe o session.payment_status == 'paid'.
    Idempotentne po session.id (zapis w stripe_webhook_events).
    """
    session_id = session.get("id") or ""
    if not session_id:
        raise ValueError("Brak session.id")
    # reuse event table as idempotency store
    fake_event = {
        "id": f"cs_confirm_{session_id}",
        "type": "checkout.session.completed",
        "data": {"object": session},
    }
    # Ensure metadata present
    meta = dict(session.get("metadata") or {})
    if not meta.get("kind"):
        mode = session.get("mode")
        meta["kind"] = "subscription" if mode == "subscription" else "topup"
        session = {**session, "metadata": meta}
        fake_event["data"]["object"] = session

    status = (session.get("payment_status") or "").lower()
    if status not in ("paid", "no_payment_required"):
        return {
            "ok": False,
            "paid": False,
            "payment_status": status,
            "message": f"Sesja jeszcze nieopłacona (status={status}).",
        }

    result = await handle_stripe_event(
        fake_event,
        client=client,
        sb_get=sb_get,
        sb_post=sb_post,
        sb_patch=sb_patch,
        account_key_default=account_key_default,
        tier_config=tier_config,
    )
    return {"ok": True, "paid": True, **result}


async def handle_stripe_event(
    event: dict,
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_post,
    sb_patch,
    account_key_default: str,
    tier_config: dict,
) -> dict:
    event_id = event.get("id") or ""
    event_type = event.get("type") or ""
    if event_id and await _already_processed(client, sb_get, event_id):
        return {"ok": True, "duplicate": True, "type": event_type}

    data_obj = (event.get("data") or {}).get("object") or {}
    result: dict[str, Any] = {"ok": True, "type": event_type}

    if event_type == "checkout.session.completed":
        meta = dict(data_obj.get("metadata") or {})
        account_key = meta.get("account_key") or data_obj.get("client_reference_id") or account_key_default
        kind = meta.get("kind") or ("subscription" if data_obj.get("mode") == "subscription" else "topup")
        customer_id = data_obj.get("customer")
        subscription_id = data_obj.get("subscription")

        if kind == "local_producer_order":
            from local_producers_commerce import apply_paid_producer_checkout_session
            lp = await apply_paid_producer_checkout_session(
                data_obj,
                client=client,
                sb_get=sb_get,
                sb_patch=sb_patch,
            )
            result["action"] = "local_producer_order_paid"
            result["local_producer"] = lp
        elif kind == "topup":
            credits = int(meta.get("credits") or 0)
            if credits <= 0:
                pkg = meta.get("package")
                credits = {"small": 100, "medium": 500, "large": 1000}.get(pkg or "", 0)
            extra = {}
            if customer_id:
                extra["stripe_customer_id"] = customer_id
            await _add_credits_safe(
                client, sb_get, sb_patch, sb_post, account_key, credits, extra=extra or None,
            )
            result["action"] = f"topup_+{credits}"
        elif kind == "subscription":
            tier = int(meta.get("tier_level") or 0)
            cfg = tier_config.get(tier) or {}
            grant = int(cfg.get("monthly_grant") or 0)
            cpe = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
            rows = await sb_get(client, "subscriptions", params={
                "select": "credits_balance", "account_key": f"eq.{account_key}", "limit": "1",
            })
            bal = int((rows[0].get("credits_balance") if rows else 0) or 0)
            changes: dict[str, Any] = {
                "tier_level": tier,
                "status": "active",
                "credits_balance": bal + grant,
                "current_period_end": cpe,
            }
            if customer_id:
                changes["stripe_customer_id"] = customer_id
            if subscription_id:
                changes["stripe_subscription_id"] = subscription_id
            await _patch_subscription(client, sb_get, sb_patch, sb_post, account_key, changes)
            result["action"] = f"subscribe_tier_{tier}_+{grant}"

    elif event_type in ("customer.subscription.updated", "customer.subscription.created"):
        meta = dict(data_obj.get("metadata") or {})
        account_key = meta.get("account_key") or account_key_default
        status_raw = (data_obj.get("status") or "").lower()
        tier = int(meta.get("tier_level") or 0)
        if status_raw in ("active", "trialing"):
            our_status = "active"
        elif status_raw in ("past_due", "unpaid"):
            our_status = "past_due"
        elif status_raw in ("canceled", "incomplete_expired"):
            our_status = "canceled"
        else:
            our_status = status_raw or "active"

        period_end = None
        try:
            ts = data_obj.get("current_period_end")
            if ts:
                period_end = datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
        except Exception:
            period_end = None

        changes = {
            "status": our_status,
            "stripe_subscription_id": data_obj.get("id"),
        }
        if data_obj.get("customer"):
            changes["stripe_customer_id"] = data_obj.get("customer")
        if period_end:
            changes["current_period_end"] = period_end
        if tier in (1, 2) and our_status in ("active", "past_due"):
            changes["tier_level"] = tier
        await _patch_subscription(client, sb_get, sb_patch, sb_post, account_key, changes)
        result["action"] = f"subscription_{our_status}"

    elif event_type == "customer.subscription.deleted":
        meta = dict(data_obj.get("metadata") or {})
        account_key = meta.get("account_key") or account_key_default
        await _patch_subscription(client, sb_get, sb_patch, sb_post, account_key, {
            "tier_level": 0,
            "status": "expired",
            "current_period_end": None,
            "stripe_subscription_id": None,
            "free_starter_claimed": True,
        })
        result["action"] = "subscription_deleted_to_free"

    elif event_type == "invoice.paid":
        billing_reason = data_obj.get("billing_reason")
        if billing_reason == "subscription_cycle":
            meta: dict = {}
            lines = ((data_obj.get("lines") or {}).get("data") or [])
            for line in lines:
                if line.get("metadata"):
                    meta = dict(line["metadata"])
            account_key = meta.get("account_key") or account_key_default
            tier = int(meta.get("tier_level") or 0)
            sub_id = data_obj.get("subscription")
            if not tier and sub_id:
                try:
                    async with httpx.AsyncClient(timeout=30.0, verify=_ssl_verify()) as c:
                        r = await c.get(
                            f"{STRIPE_API}/subscriptions/{sub_id}",
                            headers={"Authorization": f"Bearer {_secret()}"},
                        )
                        if r.status_code < 400:
                            sub = r.json()
                            meta = dict(sub.get("metadata") or {})
                            account_key = meta.get("account_key") or account_key
                            tier = int(meta.get("tier_level") or 0)
                except Exception as e:
                    logger.warning("invoice.paid retrieve sub failed: %s", e)
            if tier in (1, 2):
                grant = int((tier_config.get(tier) or {}).get("monthly_grant") or 0)
                if grant > 0:
                    await _add_credits_safe(
                        client, sb_get, sb_patch, sb_post, account_key, grant,
                        extra={"status": "active", "tier_level": tier},
                    )
                    result["action"] = f"renewal_+{grant}"

    elif event_type == "account.updated":
        # Stripe Connect Express — sync acct_... → local_producers.stripe_connect_id
        try:
            from stripe_connect import handle_connect_account_updated
            lp = await handle_connect_account_updated(
                data_obj,
                client=client,
                sb_get=sb_get,
                sb_patch=sb_patch,
            )
            result["action"] = "connect_account_updated"
            result["local_producer"] = lp
        except Exception as e:
            logger.warning("account.updated sync failed: %s", e)
            result["action"] = "connect_account_updated_failed"
            result["error"] = str(e)[:200]

    if event_id:
        await _mark_processed(client, sb_post, event_id, event_type)
    return result
