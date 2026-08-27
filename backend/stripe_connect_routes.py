"""
Stripe Connect Express — onboarding dystrybutorów (panel WWW).
Wydzielone z server.py.
"""
from __future__ import annotations

import html as html_lib
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get, sb_patch
from url_safety import assert_safe_redirect_url

router = APIRouter(tags=["stripe-connect"])
logger = logging.getLogger("stripe.connect.routes")


class StripeConnectRequest(BaseModel):
    producer_id: str
    email: Optional[str] = None


async def _auth_uid(request: Request) -> Optional[str]:
    from server import _auth_user_id_from_request

    return await _auth_user_id_from_request(request)


async def _run_onboard(pid: str, *, require_owner_uid: Optional[str]) -> dict:
    from billing_stripe import stripe_configured
    from stripe_connect import start_connect_onboarding

    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY")
    pid = (pid or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Brak producer_id")

    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as client:
        rows = await sb_get(
            client,
            "local_producers",
            params={
                "select": "id,auth_user_id,email,company_name,stripe_connect_id,stripe_account_id",
                "id": f"eq.{pid}",
                "limit": "1",
            },
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Dystrybutor nie istnieje")
        owner = (rows[0].get("auth_user_id") or "").strip()
        if require_owner_uid is not None:
            if not require_owner_uid:
                raise HTTPException(status_code=401, detail="Zaloguj się (Bearer JWT)")
            if owner and owner != require_owner_uid:
                raise HTTPException(
                    status_code=403,
                    detail="To nie jest Twój profil dystrybutora",
                )
        try:
            return await start_connect_onboarding(
                client=client,
                sb_get=sb_get,
                sb_patch=sb_patch,
                producer_id=pid,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.exception("stripe connect onboard failed")
            raise HTTPException(status_code=502, detail=str(e)[:300]) from e


@router.post("/api/stripe/connect")
async def stripe_connect_onboard_post(request: Request, body: StripeConnectRequest):
    """Tworzy Stripe Express (PL) + Account Link. Wymaga Bearer JWT właściciela."""
    uid = await _auth_uid(request)
    return await _run_onboard(body.producer_id, require_owner_uid=uid)


@router.get("/api/stripe/connect")
async def stripe_connect_onboard_get(
    producer_id: str,
    refresh: Optional[int] = None,
    token: Optional[str] = None,
):
    """Refresh URL z Stripe Account Link — tylko z HMAC z refresh_url."""
    from stripe_connect import verify_connect_refresh_token

    if not verify_connect_refresh_token(producer_id, token):
        raise HTTPException(status_code=401, detail="Brak tokenu odświeżenia Connect.")
    result = await _run_onboard(producer_id, require_owner_uid=None)
    if result.get("url"):
        return RedirectResponse(url=result["url"], status_code=303)
    return result


@router.get("/api/stripe/connect/callback")
async def stripe_connect_callback(
    producer_id: Optional[str] = None,
    account_id: Optional[str] = None,
):
    """Return URL po onboardingu Stripe — zapis acct_... → local_producers."""
    from stripe_connect import connect_www_success_url, sync_connect_account_to_producer

    pid = (producer_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Brak producer_id")

    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as client:
        try:
            # Query account_id jest ignorowane — atakujący mógłby podpiąć cudze acct_.
            # ID pochodzi z local_producers (zapisane przy starcie onboardingu).
            synced = await sync_connect_account_to_producer(
                client=client,
                sb_get=sb_get,
                sb_patch=sb_patch,
                producer_id=pid,
                account_id=None,
            )
        except Exception as e:
            logger.exception("stripe connect callback failed")
            return HTMLResponse(
                content=(
                    "<html><body style='font-family:sans-serif;padding:2rem'>"
                    "<h1>Stripe Connect — błąd</h1>"
                    f"<p>{html_lib.escape(str(e)[:300])}</p>"
                    "</body></html>"
                ),
                status_code=502,
            )

    success = connect_www_success_url()
    if success.startswith("http"):
        success = assert_safe_redirect_url(success)
        sep = "&" if "?" in success else "?"
        return RedirectResponse(
            url=(
                f"{success}{sep}producer_id={pid}"
                f"&stripe_connect_id={synced.get('stripe_connect_id', '')}"
            ),
            status_code=303,
        )
    return {
        "ok": True,
        "message": "Konto Stripe Connect zapisane. Możesz wrócić do panelu WWW.",
        **synced,
    }


@router.get("/api/stripe/connect/done")
async def stripe_connect_done(
    producer_id: Optional[str] = None,
    stripe_connect_id: Optional[str] = None,
):
    """Prosta strona sukcesu (gdy brak STRIPE_CONNECT_WWW_SUCCESS_URL)."""
    return HTMLResponse(
        content=(
            "<html><body style='font-family:sans-serif;padding:2rem'>"
            "<h1>Stripe połączony</h1>"
            f"<p>Dystrybutor: <code>{html_lib.escape(producer_id or '—')}</code></p>"
            f"<p>Konto: <code>{html_lib.escape(stripe_connect_id or '—')}</code></p>"
            "<p>Produkty będą widoczne dla restauratorów po zatwierdzeniu profilu.</p>"
            "</body></html>"
        )
    )


@router.get("/api/stripe/connect/status")
async def stripe_connect_status(producer_id: str, request: Request):
    """Status Connect dystrybutora — tylko właściciel (Bearer JWT)."""
    from stripe_connect import producer_connect_id

    pid = (producer_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Brak producer_id")

    uid = await _auth_uid(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Zaloguj się (Bearer JWT)")

    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        rows = await sb_get(
            client,
            "local_producers",
            params={
                "select": (
                    "id,auth_user_id,stripe_connect_id,stripe_account_id,"
                    "payouts_enabled,stripe_onboarding_complete"
                ),
                "id": f"eq.{pid}",
                "limit": "1",
            },
        )
    if not rows:
        raise HTTPException(status_code=404, detail="Dystrybutor nie istnieje")
    p = rows[0]
    owner = (p.get("auth_user_id") or "").strip()
    # Bez przypisanego właściciela — nie udostępniaj statusu obcym zalogowanym.
    if not owner or owner != uid:
        raise HTTPException(status_code=403, detail="To nie jest Twój profil dystrybutora")
    acct = producer_connect_id(p)
    return {
        "ok": True,
        "producer_id": pid,
        "stripe_connect_id": acct or None,
        "connected": bool(acct),
        "payouts_enabled": bool(p.get("payouts_enabled")),
        "stripe_onboarding_complete": bool(p.get("stripe_onboarding_complete")),
    }
