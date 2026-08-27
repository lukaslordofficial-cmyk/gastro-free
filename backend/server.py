"""
Gastro Manager — Backend (Voice + Intent → Supabase actions)

• STT: OpenAI Whisper (whisper-1)      —> official `openai` SDK
• LLM: OpenAI GPT-4o mini              —> official `openai` SDK (Structured Outputs)
• DB : Supabase REST (service_role)

Klucz OpenAI pobierany JEDYNIE ze zmiennej środowiskowej process.env.OPENAI_API_KEY
(w Pythonie: os.environ["OPENAI_API_KEY"]).  Klucz NIGDY nie jest hardcodowany
ani logowany.  Użytkownik uzupełnia go we własnym .env — patrz backend/.env.example.

── Podział monolitu ─────────────────────────────────────────────────────────
Ten plik był monolitem (~11,5 tys. linii). Implementacje przeniesiono 1:1 do
modułów domenowych (models, constants, matching_utils, actions_core, …), a
fundament (config/klienci/helpery) do `app_core.py`. Tutaj zostaje wyłącznie:
tworzenie `app`, montowanie routerów, middleware multi-tenant, lifecycle HTTP.
Wszystkie nazwy są re-eksportowane (`from <modul> import *`), więc historyczne
`from server import X` działa dokładnie jak wcześniej.
"""
from __future__ import annotations

import re
import time
from typing import Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from http_ssl import httpx_verify as _httpx_verify
from tenant_auth import (
    jwt_cache_get,
    jwt_cache_invalidate,
    jwt_cache_put,
    prefer_jwt_account_key,
)
from request_guards import (
    content_length_too_large,
    is_ai_path,
    is_deal_hunter_path,
    is_lp_marketplace_path,
    is_mutate_method,
    is_public_mutate,
    is_upload_path,
    max_upload_bytes,
)
from rate_limit import allow_ai, allow_ip, allow_write
from feature_flags import (
    FEATURE_DISABLED_DETAIL,
    deal_hunter_enabled,
    lp_marketplace_enabled,
)
from openai_circuit import CIRCUIT_OPEN_DETAIL, openai_circuit
from request_log import new_request_id, short_tenant_id
from url_safety import build_supabase_auth_user_url, build_supabase_rest_url
# Re-eksport aliasów, których historycznie używano jako `from server import ...`.
from pl_fuzzy_norm import food_match_key as _food_match_key, norm_pl as _norm_pl
from culinary_units import is_piece_unit as _is_piece_unit, yield_available as _yield_available
from warehouse_category_guess import expiry_status as _expiry_status
from vision_batch_merge import (
    merge_catalog_vision_batches as _merge_catalog_vision_batches,
    merge_document_vision_batches as _merge_document_vision_batches,
)
from deal_hunter_catalog import normalize_deal_hunter_search_scope as _normalize_deal_hunter_search_scope
from inventory_invoice_match import normalize_invoice_line_name as _normalize_invoice_line_name
from supabase_rest import (
    push_account_key as _push_account_key,
    reset_account_key as _reset_account_key,
)
from cors_config import cors_allow_origins

# Routery (montowane niżej przez app.include_router).
from billing_routes import router as billing_router
from furgonetka_shop import router as furgonetka_shop_router
from health_routes import router as health_router
from legal_routes import router as legal_router
from account_routes import router as account_router
from pos_config_routes import router as pos_config_router
from pos_webhook_routes import router as pos_webhook_router
from pos_sync_routes import router as pos_sync_router
from order_email_routes import router as order_email_router
from voice_transcribe_routes import router as voice_transcribe_router
from voice_crud_routes import router as voice_crud_router
from supplier_min_order_routes import router as supplier_min_order_router
from supplier_intent_routes import router as supplier_intent_router
from daily_report_routes import router as daily_report_router
from supplier_catalog_view_routes import router as supplier_catalog_view_router
from admin_routes import router as admin_router
from restaurant_profile_routes import router as restaurant_profile_router
from subscription_routes import router as subscription_router
from reports_routes import router as reports_router
from stripe_connect_routes import router as stripe_connect_router
from inventory_yield_routes import router as inventory_yield_router
from documents_routes import router as documents_router
from supplier_catalog_scan_routes import router as supplier_catalog_scan_router
from inventory_expiry_scan_routes import router as inventory_expiry_scan_router
from cron_jobs_routes import router as cron_jobs_router
from menu_vision_routes import router as menu_vision_router
from voice_interpret_routes import router as voice_interpret_router
from actions_routes import router as actions_router
from orders_hunter_routes import router as orders_hunter_router
from local_producers_routes import router as local_producers_router

# ─── Fundament + implementacje domenowe (re-eksport pełnej powierzchni API) ───
from app_core import *  # noqa: F401,F403
from models import *  # noqa: F401,F403
from constants import *  # noqa: F401,F403
from matching_utils import *  # noqa: F401,F403
from catalog_units import *  # noqa: F401,F403
from billing_credits import *  # noqa: F401,F403
from subscription_core import *  # noqa: F401,F403
from interpret_impl import *  # noqa: F401,F403
from actions_core import *  # noqa: F401,F403
from expiration_apply import *  # noqa: F401,F403
from vision_ocr import *  # noqa: F401,F403
from catalog_offer_impl import *  # noqa: F401,F403
from supplier_meta import *  # noqa: F401,F403
from inventory_match import *  # noqa: F401,F403
from invoice_impl import *  # noqa: F401,F403
from menu_scan_impl import *  # noqa: F401,F403
from onboard_impl import *  # noqa: F401,F403
from menu_confirm_impl import *  # noqa: F401,F403
from compare_ai import *  # noqa: F401,F403
from deal_hunter_signals import *  # noqa: F401,F403
from compare_merge import *  # noqa: F401,F403
from compare_offers_impl import *  # noqa: F401,F403
from orders_helpers import *  # noqa: F401,F403
from orders_impl import *  # noqa: F401,F403
from pos_availability import *  # noqa: F401,F403
from dispatch_impl import *  # noqa: F401,F403
from analytics_periods import *  # noqa: F401,F403
from analytics_sales import *  # noqa: F401,F403
from analytics_waste import *  # noqa: F401,F403
from analytics_pnl import *  # noqa: F401,F403
from analytics_runners import *  # noqa: F401,F403
from lp_orders import *  # noqa: F401,F403
from lp_shipping import *  # noqa: F401,F403


app = FastAPI(title="Gastro Manager — Voice API")
app.add_middleware(
    CORSMiddleware, allow_origins=cors_allow_origins(), allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)
app.include_router(furgonetka_shop_router)
app.include_router(health_router)
app.include_router(legal_router)
app.include_router(account_router)
app.include_router(pos_config_router)
app.include_router(pos_webhook_router)
app.include_router(pos_sync_router)
app.include_router(order_email_router)
app.include_router(voice_transcribe_router)
app.include_router(voice_crud_router)
app.include_router(supplier_min_order_router)
app.include_router(supplier_intent_router)
app.include_router(daily_report_router)
app.include_router(supplier_catalog_view_router)
app.include_router(admin_router)
app.include_router(billing_router)
app.include_router(restaurant_profile_router)
app.include_router(subscription_router)
app.include_router(reports_router)
app.include_router(stripe_connect_router)
app.include_router(inventory_yield_router)
app.include_router(documents_router)
app.include_router(supplier_catalog_scan_router)
app.include_router(inventory_expiry_scan_router)
app.include_router(cron_jobs_router)
app.include_router(menu_vision_router)
app.include_router(voice_interpret_router)
app.include_router(actions_router)
app.include_router(orders_hunter_router)
app.include_router(local_producers_router)


def _json_error(status: int, detail: str, request_id: str) -> JSONResponse:
    resp = JSONResponse(status_code=status, content={"detail": detail})
    resp.headers["X-Request-Id"] = request_id
    return resp


@app.middleware("http")
async def account_key_middleware(request: Request, call_next):
    """Multi-tenant: X-Account-Key from logged-in app, else JWT→profiles, else ACCOUNT_KEY env."""
    t0 = time.perf_counter()
    path = request.url.path or ""
    method = (request.method or "GET").upper()
    request_id = new_request_id(request.headers.get("x-request-id"))
    # Furgonetka „Własna” wysyła Bearer {shop_token} — to NIE jest JWT użytkownika.
    # Lookup w Supabase Auth mógłby wisieć i Furgonetka zgłasza „błąd API”.
    skip_jwt = (
        path == "/orders"
        or path.rstrip("/") == "/orders"
        or path.startswith("/orders/")
        or path.startswith("/api/furgonetka")
        or path.split("?")[0].rstrip("/") == "/api/pos/webhook"
    )
    raw = (request.headers.get("x-account-key") or "").strip()
    header_key = raw if raw and re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", raw) else ""

    auth = (request.headers.get("authorization") or "").strip()
    bearer = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    is_service_role = bool(SUPABASE_KEY and bearer and bearer == SUPABASE_KEY)

    jwt_key: Optional[str] = None
    # Jeśli klient wysłał JWT — tenant z profilu wygrywa z X-Account-Key (anti-spoof).
    if not skip_jwt and SUPABASE_URL:
        if auth.lower().startswith("bearer ") and bearer != SUPABASE_KEY:
            user_jwt = auth[7:].strip()
            if user_jwt:
                # Zapis/AI: zawsze live lookup (revoke nie czeka na TTL cache).
                jwt_key = None if is_mutate_method(request.method) else jwt_cache_get(user_jwt)
                if not jwt_key:
                    try:
                        apikey = _SUPABASE_ANON_KEY or SUPABASE_KEY
                        httpx_c = _jwt_http
                        close_tmp = False
                        if httpx_c is None:
                            httpx_c = httpx.AsyncClient(timeout=8.0, verify=_httpx_verify())
                            close_tmp = True
                        try:
                            uresp = await httpx_c.get(
                                build_supabase_auth_user_url(SUPABASE_URL),
                                headers={
                                    "Authorization": f"Bearer {user_jwt}",
                                    "apikey": apikey,
                                },
                            )
                            if uresp.status_code in (401, 403):
                                jwt_cache_invalidate(user_jwt)
                            if uresp.status_code == 200:
                                uid = (uresp.json() or {}).get("id")
                                if uid:
                                    pref = await httpx_c.get(
                                        build_supabase_rest_url(SUPABASE_URL, "profiles"),
                                        params={"select": "account_key", "id": f"eq.{uid}", "limit": "1"},
                                        headers={
                                            "Authorization": f"Bearer {SUPABASE_KEY}",
                                            "apikey": SUPABASE_KEY,
                                            "Accept": "application/json",
                                        },
                                    )
                                    if pref.status_code == 200:
                                        rows = pref.json() or []
                                        if rows and rows[0].get("account_key"):
                                            jwt_key = str(rows[0]["account_key"]).strip() or None
                                    if not jwt_key:
                                        jwt_key = f"ak_{str(uid).replace('-', '')}"
                        finally:
                            if close_tmp:
                                await httpx_c.aclose()
                        if jwt_key:
                            jwt_cache_put(user_jwt, jwt_key)
                    except Exception as exc:  # noqa: BLE001
                        logger.debug("account_key JWT resolve skipped: %s", exc)

    key = prefer_jwt_account_key(
        header_key,
        jwt_key,
        _ACCOUNT_KEY_DEFAULT,
        allow_header=is_service_role,
    )

    if method != "OPTIONS":
        if is_deal_hunter_path(path) and not deal_hunter_enabled():
            return _json_error(503, FEATURE_DISABLED_DETAIL, request_id)
        if is_lp_marketplace_path(path) and not lp_marketplace_enabled():
            return _json_error(503, FEATURE_DISABLED_DETAIL, request_id)
        if is_upload_path(path) and content_length_too_large(request.headers.get("content-length")):
            mb = max(1, max_upload_bytes() // (1024 * 1024))
            return _json_error(
                413,
                f"Plik jest za duży. Wgraj mniejszy PDF lub zdjęcie (limit {mb} MB).",
                request_id,
            )

    ip = request.client.host if request.client else "0"
    if method != "OPTIONS" and is_ai_path(path):
        if not openai_circuit.allow():
            return _json_error(503, CIRCUIT_OPEN_DETAIL, request_id)
        bucket = key if key and key != "default" else f"ip:{ip}"
        if not allow_ai(bucket) or not allow_ip(ip):
            return _json_error(429, "Zbyt wiele zapytań AI. Spróbuj za chwilę.", request_id)

    if is_mutate_method(request.method) and not is_public_mutate(path):
        if key == "default":
            return _json_error(
                401,
                "Zaloguj się ponownie — brak konta restauracji przy zapisie.",
                request_id,
            )
        if not is_ai_path(path) and not allow_write(key):
            return _json_error(429, "Zbyt wiele zapytań. Spróbuj za chwilę.", request_id)

    token = _account_key_ctx.set(key)
    try:
        response = await call_next(request)
    except Exception:
        if is_ai_path(path):
            openai_circuit.record_failure()
        raise
    finally:
        _account_key_ctx.reset(token)

    status = getattr(response, "status_code", 0) or 0
    if is_ai_path(path):
        if status >= 500:
            openai_circuit.record_failure()
        elif 200 <= status < 400:
            openai_circuit.record_success()
    try:
        response.headers["X-Request-Id"] = request_id
    except Exception:  # noqa: BLE001
        pass
    ms = int((time.perf_counter() - t0) * 1000)
    logger.info(
        "http %s %s %s %s %sms ak=%s",
        request_id,
        method,
        path,
        status,
        ms,
        short_tenant_id(key),
    )
    return response


_jwt_http: httpx.AsyncClient | None = None


@app.on_event("startup")
async def _startup_shared_http():
    global _jwt_http
    _jwt_http = httpx.AsyncClient(
        timeout=8.0,
        verify=_httpx_verify(),
        limits=httpx.Limits(max_keepalive_connections=40, max_connections=120),
    )


@app.on_event("shutdown")
async def _shutdown_shared_http():
    global _jwt_http
    if _jwt_http is not None:
        await _jwt_http.aclose()
        _jwt_http = None
