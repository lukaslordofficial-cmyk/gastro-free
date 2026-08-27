"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `lp_orders`."""
from __future__ import annotations

from fastapi import HTTPException
from fastapi import Request
from http_ssl import httpx_verify as _httpx_verify
from supabase_rest import sb_get
from supabase_rest import sb_patch
from supabase_rest import sb_post
from typing import Optional
from url_safety import app_deep_link
from url_safety import assert_safe_redirect_url
from url_safety import build_supabase_auth_user_url
from url_safety import checkout_redirect_public_base
from url_safety import is_app_or_dev_deep_link
from url_safety import is_safe_app_return_url
import httpx
import json
import os
import uuid
from app_core import SUPABASE_KEY, SUPABASE_URL, _SUPABASE_ANON_KEY, get_account_key, logger
from models import LpCheckoutRequest, LpConfirmRequest, LpCourierQuoteRequest, LpProductCreateRequest



# Subscription API: backend/subscription_routes.py (include_router)


# ─────────────────────────────────────────────────────────────────────────────
# Stripe Connect — helpers (endpointy: stripe_connect_routes.py)
# ─────────────────────────────────────────────────────────────────────────────

async def _auth_user_id_from_request(request: Request) -> Optional[str]:
    """Supabase Auth user id z Bearer JWT (panel WWW / apka)."""
    auth = (request.headers.get("authorization") or "").strip()
    if not auth.lower().startswith("bearer ") or not SUPABASE_URL:
        return None
    user_jwt = auth[7:].strip()
    if not user_jwt or user_jwt == SUPABASE_KEY:
        return None
    try:
        apikey = _SUPABASE_ANON_KEY or SUPABASE_KEY
        async with httpx.AsyncClient(timeout=8.0, verify=_httpx_verify()) as httpx_c:
            uresp = await httpx_c.get(
                build_supabase_auth_user_url(SUPABASE_URL),
                headers={"Authorization": f"Bearer {user_jwt}", "apikey": apikey},
            )
            if uresp.status_code == 200:
                return (uresp.json() or {}).get("id")
    except Exception:
        return None
    return None


async def local_producers_commerce_status():
    from billing_stripe import stripe_configured
    from local_producers_commerce import inpost_configured
    from furgonetka_broker import furgonetka_configured, _use_mock, _use_sandbox
    return {
        "ok": True,
        "stripe_configured": stripe_configured(),
        "furgonetka_configured": furgonetka_configured(),
        "furgonetka_sandbox": _use_sandbox() or _use_mock(),
        "furgonetka_mock": _use_mock(),
        "inpost_configured": inpost_configured(),
        "courier_broker": "furgonetka" if furgonetka_configured() else ("inpost_shipx" if inpost_configured() else None),
        "payment_methods": ["card", "blik"],
        "marketplace_model": "destination_charges",
        "requires_stripe_connect_id": True,
        "connect_payout_schedule": "daily",
        "notify_email": "resend",
        "notify_sms": "smsapi",
        "connect_onboard": "POST /api/stripe/connect",
        "label_endpoint": "GET /api/orders/{order_id}/furgonetka-label",
        "courier_quotes": "POST /api/local-producers/courier-quotes",
    }


async def local_producers_courier_quotes(req: LpCourierQuoteRequest):
    """Oficjalna wycena Furgonetka: porównanie stawek kurierów (waga + wymiary cm)."""
    from furgonetka_broker import (
        _party,
        _split_street,
        calculate_courier_quotes,
        furgonetka_configured,
        _use_mock,
    )
    from lp_packaging import (
        estimate_order_weight_kg,
        furgonetka_parcels_payload,
        parcels_for_weight_kg,
    )

    producer_id = (req.producer_id or "").strip()
    if not producer_id:
        raise HTTPException(status_code=400, detail="Brak producer_id")
    post = (req.post_code or "").strip()
    city = (req.city or "").strip()
    street = " ".join(x for x in ((req.street or "").strip(), (req.building_number or "").strip()) if x)
    if not post or not city or not street:
        raise HTTPException(
            status_code=400,
            detail="Podaj ulicę, miasto i kod pocztowy, żeby policzyć stawki kurierów.",
        )

    async with httpx.AsyncClient(timeout=45.0, verify=_httpx_verify()) as client:
        producers = await sb_get(client, "local_producers", params={
            "select": "id,company_name,owner_name,email,invoice_email,phone,address,city,postal_code",
            "id": f"eq.{producer_id}",
            "limit": "1",
        })
        if not producers:
            raise HTTPException(status_code=404, detail="Nie znaleziono dystrybutora")
        producer = producers[0]
        s_street, s_building = _split_street(producer.get("address"))
        sender_street = " ".join(x for x in (s_street, s_building) if x).strip()
        pickup = _party(
            name=str(producer.get("owner_name") or producer.get("company_name") or "Nadawca"),
            company=str(producer.get("company_name") or ""),
            email=str(producer.get("invoice_email") or producer.get("email") or ""),
            phone=str(producer.get("phone") or "500000000"),
            street=sender_street or "ul. Magazynowa 1",
            city=str(producer.get("city") or "Warszawa"),
            postcode=str(producer.get("postal_code") or "00-001"),
        )
        receiver = _party(
            name=str(req.receiver_name or "Restauracja"),
            company=str(req.receiver_name or "Restauracja"),
            email="",
            phone=str(req.receiver_phone or "500000000"),
            street=street,
            city=city,
            postcode=post,
        )
        items = [it.model_dump() for it in (req.items or [])]
        product_ids = [str(it.get("product_id") or "") for it in items if it.get("product_id")]
        products_by_id: dict = {}
        if product_ids:
            uniq = list(dict.fromkeys(product_ids))[:80]
            try:
                rows = await sb_get(client, "producer_products", params={
                    "select": "id,unit,weight_g",
                    "id": f"in.({','.join(uniq)})",
                })
                products_by_id = {str(r.get("id")): r for r in (rows or [])}
            except Exception:
                logger.warning("LP courier quotes: product weight lookup failed", exc_info=True)
        weight_kg = estimate_order_weight_kg(items, products_by_id)
        parcels_full = parcels_for_weight_kg(weight_kg)
        if req.width_cm and req.height_cm and req.depth_cm and parcels_full:
            parcels_full[0]["width"] = int(req.width_cm)
            parcels_full[0]["height"] = int(req.height_cm)
            parcels_full[0]["depth"] = int(req.depth_cm)
        parcels = furgonetka_parcels_payload(parcels_full)
        dims = parcels[0] if parcels else {"width": 20, "height": 15, "depth": 20, "weight": 1}

        if not furgonetka_configured() and not _use_mock():
            raise HTTPException(
                status_code=503,
                detail="Furgonetka nie jest skonfigurowana na serwerze (FURGONETKA_*).",
            )
        try:
            quoted = await calculate_courier_quotes(
                pickup=pickup, receiver=receiver, parcels=parcels,
            )
        except Exception as e:
            logger.exception("LP courier quotes failed")
            raise HTTPException(status_code=502, detail=str(e)[:280])

    from lp_furgonetka_quotes import bookable_quotes

    quotes = bookable_quotes(quoted.get("quotes") or [], weight_kg=weight_kg)
    cheapest = quotes[0] if quotes else None
    auth_error = quoted.get("auth_error")
    if quoted.get("source") == "sandbox" and auth_error:
        note = (
            "Furgonetka odrzuciła logowanie OAuth (Client authentication failed). "
            "Na Railway wgraj FURGONETKA_CLIENT_ID i FURGONETKA_CLIENT_SECRET z tego samego środowiska "
            "co API (sandbox.furgonetka.pl → Integracje / OAuth2), albo ustaw FURGONETKA_MOCK=1. "
            "Poniżej stawki testowe, żeby dało się złożyć zamówienie."
        )
    elif quoted.get("source") == "sandbox":
        note = "Stawki testowe (sandbox) — ustaw FURGONETKA_* z konta, żeby dostać żywe ceny."
    else:
        note = "Ceny brutto z kalkulatora Furgonetka dla podanej wagi i wymiarów."
    return {
        "ok": True,
        "source": quoted.get("source"),
        "weight_kg": weight_kg,
        "width_cm": dims.get("width"),
        "height_cm": dims.get("height"),
        "depth_cm": dims.get("depth"),
        "parcels": len(parcels),
        "package_size": (parcels_full[0].get("package_size") if parcels_full else "S"),
        "quotes": quotes,
        "cheapest": cheapest,
        "note": note,
        "auth_error": auth_error,
    }


async def local_producers_checkout(req: LpCheckoutRequest):
    """Tworzy Stripe Checkout dla zamówienia LP (card + BLIK)."""
    from billing_stripe import stripe_configured
    from local_producers_commerce import create_producer_order_checkout

    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY — skonfiguruj backend/.env / Railway")
    order_id = (req.order_id or "").strip()
    if not order_id:
        raise HTTPException(status_code=400, detail="Brak order_id")

    account_key = get_account_key()
    # Stripe wymaga http(s). Strona na API robi deep link — NIE Expo localhost:8081.
    public = checkout_redirect_public_base()
    app_ret = (req.app_return_url or "").strip()
    app_q = ""
    if app_ret and is_safe_app_return_url(app_ret):
        from urllib.parse import quote as _q
        app_q = f"&app={_q(app_ret, safe='')}"
    success = (
        req.success_url
        or os.getenv("LP_BILLING_SUCCESS_URL")
        or f"{public}/api/local-producers/billing-return?status=success&session_id={{CHECKOUT_SESSION_ID}}{app_q}"
    ).strip()
    cancel = (
        req.cancel_url
        or os.getenv("LP_BILLING_CANCEL_URL")
        or f"{public}/api/local-producers/billing-return?status=cancel"
    ).strip()
    billing_ok = (
        f"{public}/api/local-producers/billing-return"
        f"?status=success&session_id={{CHECKOUT_SESSION_ID}}{app_q}"
    )
    billing_cancel = f"{public}/api/local-producers/billing-return?status=cancel{app_q}"
    if is_app_or_dev_deep_link(success):
        success = billing_ok
    if is_app_or_dev_deep_link(cancel):
        cancel = billing_cancel
    # Env czasem ma PUBLIC_APP_URL=http://localhost:8081 — na telefonie pada.
    if "localhost" in success or "127.0.0.1" in success:
        success = billing_ok
    if "localhost" in cancel or "127.0.0.1" in cancel:
        cancel = billing_cancel
    success = assert_safe_redirect_url(success)
    cancel = assert_safe_redirect_url(cancel)

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        orders = await sb_get(client, "producer_orders", params={
            "select": "*",
            "id": f"eq.{order_id}",
            "limit": "1",
        })
        if not orders:
            raise HTTPException(status_code=404, detail="Zamówienie nie istnieje")
        order = orders[0]
        # service_role omija RLS — twarda izolacja tenantowa
        if order.get("restaurant_account_key") and order.get("restaurant_account_key") != account_key:
            raise HTTPException(status_code=403, detail="To zamówienie należy do innego konta")
        if str(order.get("payment_status") or "").lower() == "paid":
            raise HTTPException(status_code=400, detail="Zamówienie jest już opłacone")

        producers = await sb_get(client, "local_producers", params={
            "select": "*",
            "id": f"eq.{order.get('producer_id')}",
            "limit": "1",
        })
        if not producers:
            raise HTTPException(status_code=404, detail="Producent nie istnieje")
        producer = producers[0]

        email = None
        try:
            profiles = await sb_get(client, "profiles", params={
                "select": "email",
                "account_key": f"eq.{account_key}",
                "limit": "1",
            })
            if profiles and profiles[0].get("email"):
                email = profiles[0]["email"]
        except Exception:
            pass

        try:
            session = await create_producer_order_checkout(
                order=order,
                producer=producer,
                account_key=account_key,
                customer_email=email,
                success_url=success,
                cancel_url=cancel,
                idempotency_key=req.idempotency_key or str(uuid.uuid4()),
            )
        except ValueError as e:
            # 400 — czytelny komunikat dla restauratora (konto dystrybutora nieaktywne itd.)
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.exception("LP checkout failed")
            from stripe_connect import (
                distributor_inactive_message,
                is_insufficient_capabilities_error,
                producer_connect_id,
            )
            if is_insufficient_capabilities_error(e):
                raise HTTPException(
                    status_code=400,
                    detail=distributor_inactive_message(
                        account_id=producer_connect_id(producer),
                        detail=str(e)[:120],
                    ),
                )
            raise HTTPException(status_code=502, detail=str(e)[:400])

        # Zapisz session id w notes (best-effort) — kolumna payment_intent po opłaceniu
        try:
            note = (order.get("notes") or "")
            tag = f"stripe_cs:{session['id']}"
            if tag not in note:
                await sb_patch(client, "producer_orders", {"id": f"eq.{order_id}"}, {
                    "notes": f"{note} | {tag}".strip(" |"),
                })
        except Exception:
            pass

    return {"ok": True, **session}


async def local_producers_billing_return(
    status: str = "success",
    session_id: str = "",
    app: str = "",
):
    """
    Stripe success/cancel (http/https) → HTML z deep linkiem.
    Expo Go nie obsługuje gastromanager:// — wtedy używamy `app` z Linking.createURL.
    """
    from html import escape
    from urllib.parse import quote, unquote
    from fastapi.responses import HTMLResponse

    ok = (status or "").strip().lower() in ("success", "ok", "paid")
    sid = (session_id or "").strip()
    suffix = f"?session_id={quote(sid, safe='')}" if sid.startswith("cs_") else ""
    # Trzy slashe: gastromanager:///lp/success → ścieżka /lp/success (nie host=lp → /success).
    if ok:
        deep = app_deep_link(f"lp/success{suffix}")
        title = "Płatność zrealizowana"
        hint = "Wracamy do Gastro Manager. Jeśli nic się nie dzieje — kliknij przycisk poniżej."
    else:
        deep = app_deep_link("lp/cancel")
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

    # Expo Go: NIE skacz automatycznie na custom scheme — to otwiera „This screen doesn't exist”.
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


async def local_producers_confirm_payment(req: LpConfirmRequest):
    """Potwierdzenie płatności LP bez webhooka (odpytanie Stripe)."""
    from billing_stripe import retrieve_checkout_session, stripe_configured
    from local_producers_commerce import apply_paid_producer_checkout_session

    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY")
    sid = (req.session_id or "").strip()
    if not sid.startswith("cs_"):
        raise HTTPException(status_code=400, detail="Nieprawidłowy session_id")
    try:
        session = await retrieve_checkout_session(sid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)[:300])

    from server import require_tenant_account_key
    account_key = require_tenant_account_key()
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

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        result = await apply_paid_producer_checkout_session(
            session,
            client=client,
            sb_get=sb_get,
            sb_patch=sb_patch,
            sb_post=sb_post,
            # Szybka odpowiedź do apki — kurier/SMS w tle.
            defer_fulfillment=True,
        )
    if result.get("paid"):
        result["message"] = (
            "Płatność potwierdzona. Lokalny przetwórca wkrótce otrzyma pieniądze "
            "i nada do ciebie paczkę z kurierem."
        )
    return result


async def producer_products_create(req: LpProductCreateRequest, request: Request):
    """
    Tworzy produkt dystrybutora z automatyczną stawką VAT
    (billing_type + kategoria). Kategoria jest wymagana.
    """
    from product_vat import (
        resolve_billing_type,
        resolve_product_vat_rate,
        require_category_id,
    )

    uid = await _auth_user_id_from_request(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Wymagane logowanie dystrybutora")

    try:
        category_id = require_category_id(req.category_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    title = (req.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Podaj nazwę produktu.")
    try:
        price = float(req.price)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Podaj poprawną cenę.")
    if price < 0:
        raise HTTPException(status_code=400, detail="Podaj poprawną cenę.")
    try:
        stock = float(req.stock if req.stock is not None else 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Podaj poprawny stan.")
    if stock < 0:
        raise HTTPException(status_code=400, detail="Podaj poprawny stan.")

    async with httpx.AsyncClient(timeout=45.0, verify=_httpx_verify()) as client:
        producers = await sb_get(client, "local_producers", params={
            "select": "id,auth_user_id,billing_type,settlement_document_type",
            "auth_user_id": f"eq.{uid}",
            "limit": "1",
        })
        if not producers:
            raise HTTPException(status_code=404, detail="Brak profilu dystrybutora")
        producer = producers[0]

        cats = await sb_get(client, "producer_categories", params={
            "select": "id,name,slug",
            "id": f"eq.{category_id}",
            "limit": "1",
        })
        if not cats:
            raise HTTPException(status_code=400, detail="Nieprawidłowa kategoria.")
        category = cats[0]

        billing = resolve_billing_type(producer)
        vat_rate = resolve_product_vat_rate(
            billing_type=billing,
            category_slug=category.get("slug"),
            category_name=category.get("name"),
            override_rate=req.vat_rate_override,
        )

        payload = {
            "producer_id": producer["id"],
            "title": title,
            "category_id": category_id,
            "description": (req.description or "").strip() or None,
            "price": price,
            "unit": (req.unit or "szt").strip() or "szt",
            "stock": stock,
            "weight_g": req.weight_g,
            "available": True if req.available is None else bool(req.available),
            "vat_rate": vat_rate,
        }
        rows = await sb_post(client, "producer_products", payload)
        row = rows[0] if isinstance(rows, list) and rows else rows
        return {
            "ok": True,
            "product": row,
            "vat_rate": vat_rate,
            "billing_type": billing,
            "auto_vat": True,
        }

__all__ = ['_auth_user_id_from_request', 'local_producers_billing_return', 'local_producers_checkout', 'local_producers_commerce_status', 'local_producers_confirm_payment', 'local_producers_courier_quotes', 'producer_products_create']
