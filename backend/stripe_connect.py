"""
Stripe Connect Express — onboarding dystrybutorów (Lokalni Przetwórcy).

POST /api/stripe/connect → accounts.create (express, PL) + accountLinks.create
GET  /api/stripe/connect/callback → zapis acct_... → local_producers.stripe_connect_id
Webhook account.updated → sync payouts_enabled / onboarding complete
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from typing import Any, Optional

import httpx

from billing_stripe import STRIPE_API, _secret, _ssl_verify, _stripe_post, stripe_configured

logger = logging.getLogger("stripe.connect")

# Capabilities wymagane przy Account.create / Account.update (destination charges).
EXPRESS_REQUESTED_CAPABILITIES: dict[str, dict[str, bool]] = {
    "card_payments": {"requested": True},
    "transfers": {"requested": True},
}

# Automatyczne wypłaty na konto bankowe — codziennie, bez klikania w panelu.
# Środki z Destination Charge lądują od razu na saldo Connect; Stripe payout → bank next day.
EXPRESS_PAYOUT_SETTINGS: dict[str, Any] = {
    "payouts": {
        "schedule": {
            "interval": "daily",
        },
    },
}

RESTAURATEUR_DISTRIBUTOR_INACTIVE_PL = (
    "Wybrany lokalny dystrybutor nie ma jeszcze w pełni aktywnego konta Stripe Connect "
    "(status Restricted / brak aktywnego `transfers`). "
    "Nie możesz teraz opłacić tego zamówienia. "
    "Poproś dystrybutora o dokończenie onboardingu Connect w panelu WWW "
    "albo wybierz innego dostawcę."
)


def distributor_inactive_message(*, account_id: str = "", detail: str = "") -> str:
    """Komunikat dla restauratora — bez żargonu Stripe API."""
    base = RESTAURATEUR_DISTRIBUTOR_INACTIVE_PL
    acct = (account_id or "").strip()
    extra = (detail or "").strip()
    bits = [base]
    if acct.startswith("acct_"):
        bits.append(f"(konto: {acct})")
    if extra and "insufficient_capabilities" not in extra.lower():
        bits.append(extra[:160])
    return " ".join(bits)


def _public_base() -> str:
    from url_safety import checkout_redirect_public_base

    custom = (os.getenv("PUBLIC_APP_URL") or "").strip().rstrip("/")
    if custom:
        return custom
    return checkout_redirect_public_base()


def connect_return_url(producer_id: str) -> str:
    custom = (os.getenv("STRIPE_CONNECT_RETURN_URL") or "").strip()
    if custom:
        sep = "&" if "?" in custom else "?"
        return f"{custom}{sep}producer_id={producer_id}"
    return f"{_public_base()}/api/stripe/connect/callback?producer_id={producer_id}"


def _connect_link_secret() -> str:
    return (
        (os.getenv("INTERNAL_API_SECRET") or "").strip()
        or (os.getenv("STRIPE_SECRET_KEY") or "").strip()
    )


def connect_refresh_token(producer_id: str) -> str:
    secret = _connect_link_secret()
    pid = (producer_id or "").strip()
    if not secret or not pid:
        return ""
    return hmac.new(
        secret.encode("utf-8"),
        f"connect-refresh:{pid}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:40]


def verify_connect_refresh_token(producer_id: str, token: Optional[str]) -> bool:
    expected = connect_refresh_token(producer_id)
    got = (token or "").strip()
    if not expected or not got or len(got) != len(expected):
        return False
    return hmac.compare_digest(expected, got)


def connect_refresh_url(producer_id: str) -> str:
    q = f"producer_id={producer_id}&refresh=1&token={connect_refresh_token(producer_id)}"
    custom = (os.getenv("STRIPE_CONNECT_REFRESH_URL") or "").strip()
    if custom:
        sep = "&" if "?" in custom else "?"
        return f"{custom}{sep}{q}"
    return f"{_public_base()}/api/stripe/connect?{q}"


def connect_www_success_url() -> str:
    return (os.getenv("STRIPE_CONNECT_WWW_SUCCESS_URL") or "").strip() or (
        f"{_public_base()}/api/stripe/connect/done"
    )


async def _stripe_get(path: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {_secret()}"}
    async with httpx.AsyncClient(timeout=45.0, verify=_ssl_verify()) as client:
        r = await client.get(f"{STRIPE_API}{path}", headers=headers)
        payload = r.json()
        if r.status_code >= 400:
            err = payload.get("error") or {}
            msg = err.get("message") or r.text[:300]
            code = err.get("code") or ""
            raise RuntimeError(f"Stripe API {r.status_code}: {code + ': ' if code else ''}{msg}")
        return payload


def producer_connect_id(producer: dict[str, Any]) -> str:
    """Prefer stripe_connect_id; fallback legacy stripe_account_id."""
    return (
        (producer.get("stripe_connect_id") or "").strip()
        or (producer.get("stripe_account_id") or "").strip()
    )


async def ensure_express_capabilities(account_id: str) -> dict[str, Any]:
    """
    Dopina capabilities + codzienny payout_schedule na istniejącym Express (Account.update).

    Konta utworzone wcześniej bez card_payments/transfers dają przy Checkout
    destination charge błąd insufficient_capabilities_for_transfer.
    """
    acct = (account_id or "").strip()
    if not acct.startswith("acct_"):
        raise ValueError("Nieprawidłowy stripe_connect_id (oczekiwane acct_...)")
    payload: dict[str, Any] = {
        "capabilities": EXPRESS_REQUESTED_CAPABILITIES,
        "settings": EXPRESS_PAYOUT_SETTINGS,
    }
    try:
        return await _stripe_post(f"/accounts/{acct}", payload)
    except Exception as e:
        # Stare konta / ograniczenia Stripe — nie blokuj capabilities przez settings.
        logger.warning(
            "Account.update with daily payouts failed for %s (%s) — retry capabilities only",
            acct,
            e,
        )
        return await _stripe_post(
            f"/accounts/{acct}",
            {"capabilities": EXPRESS_REQUESTED_CAPABILITIES},
        )


def _capability_status(account: dict[str, Any], name: str) -> str:
    caps = account.get("capabilities") or {}
    raw = caps.get(name)
    if isinstance(raw, dict):
        return str(raw.get("status") or "").lower()
    return str(raw or "").lower()


def _account_looks_restricted(account: dict[str, Any]) -> bool:
    """Restricted / disabled w Dashboard → destination charge zwykle pada."""
    req = account.get("requirements") or {}
    disabled = str(req.get("disabled_reason") or "").strip().lower()
    if disabled:
        return True
    # Stripe czasem zwraca past_due / currently_due pełne listy przy Restricted
    if req.get("disabled_reason"):
        return True
    return False


async def assert_destination_charge_ready(account_id: str) -> dict[str, Any]:
    """
    Przed Checkout: ``transfers`` musi być **active** (pending/Restricted = błąd 400).
    """
    acct = (account_id or "").strip()
    if not acct.startswith("acct_"):
        raise ValueError(
            "Dystrybutor nie ma poprawnego Stripe Connect (acct_...). "
            "Onboarding: panel WWW → Stripe Connect."
        )

    try:
        await ensure_express_capabilities(acct)
    except Exception as e:
        logger.warning("ensure_express_capabilities(%s) failed: %s", acct, e)

    account = await _stripe_get(f"/accounts/{acct}")
    transfers = _capability_status(account, "transfers")
    card_payments = _capability_status(account, "card_payments")
    charges_enabled = bool(account.get("charges_enabled"))
    details_submitted = bool(account.get("details_submitted"))
    restricted = _account_looks_restricted(account)
    disabled_reason = str((account.get("requirements") or {}).get("disabled_reason") or "")

    if restricted or transfers != "active":
        raise ValueError(
            distributor_inactive_message(
                account_id=acct,
                detail=(
                    f"transfers={transfers or 'brak'}; "
                    f"card_payments={card_payments or 'brak'}; "
                    f"disabled_reason={disabled_reason or '—'}; "
                    f"details_submitted={details_submitted}"
                ),
            )
        )

    return {
        "account_id": acct,
        "transfers": transfers,
        "card_payments": card_payments,
        "charges_enabled": charges_enabled,
        "details_submitted": details_submitted,
        "payouts_enabled": bool(account.get("payouts_enabled")),
        "restricted": False,
    }


async def create_express_account(
    *,
    producer: dict[str, Any],
    email: Optional[str] = None,
) -> dict[str, Any]:
    """
    stripe.Account.create — Express PL z wymuszonymi capabilities:
    ``card_payments`` + ``transfers`` (requested=True)
    oraz ``settings.payouts.schedule.interval=daily`` (auto-wypłata na bank).
    """
    if not stripe_configured():
        raise RuntimeError("Brak STRIPE_SECRET_KEY")

    existing = producer_connect_id(producer)
    if existing.startswith("acct_"):
        # Istniejące konto: dociągnij capabilities + daily payouts.
        try:
            await ensure_express_capabilities(existing)
        except Exception as e:
            logger.warning("capabilities/payouts refresh for %s: %s", existing, e)
        return {"id": existing, "existing": True}

    # Wymuszamy capabilities + daily payouts już przy CREATE.
    payload: dict[str, Any] = {
        "type": "express",
        "country": "PL",
        "capabilities": dict(EXPRESS_REQUESTED_CAPABILITIES),
        "settings": dict(EXPRESS_PAYOUT_SETTINGS),
        "business_type": "company",
        "metadata": {
            "producer_id": str(producer.get("id") or ""),
            "kind": "local_producer_connect",
        },
    }

    mail = (email or producer.get("email") or "").strip()
    if mail:
        payload["email"] = mail
    company = (producer.get("company_name") or "").strip()
    if company:
        payload["business_profile"] = {"name": company[:100]}

    account = await _stripe_post(
        "/accounts",
        payload,
        idempotency_key=f"lp_connect_acct_{producer.get('id')}",
    )
    acct_id = str(account.get("id") or "")
    # Po create — natychmiast upewnij się, że requested capabilities są na koncie
    if acct_id.startswith("acct_"):
        try:
            account = await ensure_express_capabilities(acct_id)
        except Exception as e:
            logger.warning("post-create capabilities for %s: %s", acct_id, e)
    return account


def is_insufficient_capabilities_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return (
        "insufficient_capabilities_for_transfer" in text
        or "legacy_payments" in text
        or (
            "destination account needs to have" in text
            and "transfers" in text
        )
    )


async def create_account_onboarding_link(
    *,
    account_id: str,
    producer_id: str,
) -> dict[str, Any]:
    """stripe.accountLinks.create — type=account_onboarding."""
    link = await _stripe_post(
        "/account_links",
        {
            "account": account_id,
            "refresh_url": connect_refresh_url(producer_id),
            "return_url": connect_return_url(producer_id),
            "type": "account_onboarding",
        },
    )
    return link


async def start_connect_onboarding(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    producer_id: str,
) -> dict[str, Any]:
    rows = await sb_get(
        client,
        "local_producers",
        params={"select": "*", "id": f"eq.{producer_id}", "limit": "1"},
    )
    if not rows:
        raise ValueError("Nie znaleziono dystrybutora")
    producer = rows[0]

    account = await create_express_account(producer=producer)
    acct_id = str(account.get("id") or "")
    if not acct_id.startswith("acct_"):
        raise RuntimeError("Stripe nie zwrócił acct_...")

    # Zapisz ID od razu (nawet przed dokończeniem onboardingu) — callback/webhook uzupełnią flagi.
    patch = {
        "stripe_connect_id": acct_id,
        "stripe_account_id": acct_id,
    }
    try:
        await sb_patch(client, "local_producers", {"id": f"eq.{producer_id}"}, patch)
    except Exception as e:
        logger.warning("patch stripe_connect_id early failed: %s", e)
        try:
            await sb_patch(
                client,
                "local_producers",
                {"id": f"eq.{producer_id}"},
                {"stripe_connect_id": acct_id},
            )
        except Exception:
            raise

    link = await create_account_onboarding_link(account_id=acct_id, producer_id=producer_id)
    return {
        "ok": True,
        "account_id": acct_id,
        "url": link.get("url"),
        "expires_at": link.get("expires_at"),
        "existing": bool(account.get("existing")),
    }


async def sync_connect_account_to_producer(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    producer_id: Optional[str] = None,
    account_id: Optional[str] = None,
) -> dict[str, Any]:
    """Po return URL / webhook: pobierz konto Stripe i zapisz w Supabase."""
    if not account_id and not producer_id:
        raise ValueError("Wymagane producer_id lub account_id")

    producer = None
    if producer_id:
        rows = await sb_get(
            client,
            "local_producers",
            params={"select": "*", "id": f"eq.{producer_id}", "limit": "1"},
        )
        producer = (rows or [None])[0]
        if not producer:
            raise ValueError("Nie znaleziono dystrybutora")
        account_id = account_id or producer_connect_id(producer)

    if not account_id or not str(account_id).startswith("acct_"):
        raise ValueError("Brak stripe_connect_id / acct_...")

    account = await _stripe_get(f"/accounts/{account_id}")
    acct = str(account.get("id") or account_id)
    charges_enabled = bool(account.get("charges_enabled"))
    payouts_enabled = bool(account.get("payouts_enabled"))
    details_submitted = bool(account.get("details_submitted"))
    onboarding_complete = details_submitted and (charges_enabled or payouts_enabled)

    meta = dict(account.get("metadata") or {})
    pid = producer_id or meta.get("producer_id")
    if not pid:
        found = await sb_get(
            client,
            "local_producers",
            params={"select": "*", "stripe_connect_id": f"eq.{acct}", "limit": "1"},
        )
        if not found:
            found = await sb_get(
                client,
                "local_producers",
                params={"select": "*", "stripe_account_id": f"eq.{acct}", "limit": "1"},
            )
        if not found:
            raise ValueError(f"Brak dystrybutora dla {acct}")
        producer = found[0]
        pid = producer["id"]
    elif not producer:
        rows = await sb_get(
            client,
            "local_producers",
            params={"select": "*", "id": f"eq.{pid}", "limit": "1"},
        )
        producer = (rows or [None])[0]
        if not producer:
            raise ValueError("Nie znaleziono dystrybutora")

    patch = {
        "stripe_connect_id": acct,
        "stripe_account_id": acct,
        "payouts_enabled": payouts_enabled,
        "stripe_onboarding_complete": onboarding_complete,
    }
    try:
        await sb_patch(client, "local_producers", {"id": f"eq.{pid}"}, patch)
    except Exception as e:
        msg = str(e).lower()
        if "column" in msg or "schema" in msg:
            await sb_patch(
                client,
                "local_producers",
                {"id": f"eq.{pid}"},
                {"stripe_connect_id": acct},
            )
        else:
            raise

    return {
        "ok": True,
        "producer_id": pid,
        "stripe_connect_id": acct,
        "charges_enabled": charges_enabled,
        "payouts_enabled": payouts_enabled,
        "stripe_onboarding_complete": onboarding_complete,
    }


async def handle_connect_account_updated(
    account_obj: dict[str, Any],
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
) -> dict[str, Any]:
    acct = str(account_obj.get("id") or "")
    if not acct.startswith("acct_"):
        return {"ok": False, "reason": "not_account"}
    meta = dict(account_obj.get("metadata") or {})
    return await sync_connect_account_to_producer(
        client=client,
        sb_get=sb_get,
        sb_patch=sb_patch,
        producer_id=meta.get("producer_id"),
        account_id=acct,
    )
