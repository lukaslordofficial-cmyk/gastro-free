"""
Gastro Manager — Backend (Voice + Intent → Supabase actions)

• STT: OpenAI Whisper (whisper-1)      —> official `openai` SDK
• LLM: OpenAI GPT-4o mini              —> official `openai` SDK (Structured Outputs)
• DB : Supabase REST (service_role)

Klucz OpenAI pobierany JEDYNIE ze zmiennej środowiskowej process.env.OPENAI_API_KEY
(w Pythonie: os.environ["OPENAI_API_KEY"]).  Klucz NIGDY nie jest hardcodowany
ani logowany.  Użytkownik uzupełnia go we własnym .env — patrz backend/.env.example.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import ssl
import uuid
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path
from typing import Any, Optional, Literal, Tuple

import re
import unicodedata

import certifi
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openai import AsyncOpenAI, APIError, OpenAIError
from pydantic import BaseModel, Field
from rapidfuzz import fuzz, process as rf_process

from bargain_hunter import build_optimize_response
from token_billing import (
    USD_TO_PLN,
    compute_credits_from_usage,
    merge_billing_events,
    tokens_from_usage,
)
from furgonetka_shop import router as furgonetka_shop_router
from url_safety import (
    assert_safe_redirect_url,
    checkout_redirect_public_base,
    build_supabase_auth_admin_url,
    build_supabase_auth_user_url,
    build_supabase_rest_url,
    is_safe_app_return_url,
)
from supabase_rest import (
    configure as _configure_supabase_rest,
    require_supabase as _require_supabase,
    sb_delete,
    sb_get,
    sb_headers as _sb_headers,
    sb_patch,
    sb_post,
)

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

_BACKEND_DIR = Path(__file__).resolve().parent
# Zawsze ładuj backend/.env (nie zależ od cwd procesu uvicorn).
load_dotenv(_BACKEND_DIR / ".env", override=True)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    or os.environ.get("SUPABASE_ANON_KEY", "").strip()
)
STT_MODEL = os.environ.get("OPENAI_STT_MODEL", "whisper-1")
CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")
VISION_MODEL = os.environ.get("OPENAI_VISION_MODEL", "gpt-4o")
# Wielostronicowe PDF-y (katalogi dostawców): render + Vision w batchach.
try:
    PDF_MAX_PAGES = max(1, min(80, int(os.environ.get("PDF_MAX_PAGES", "40") or "40")))
except ValueError:
    PDF_MAX_PAGES = 40
try:
    PDF_VISION_BATCH_SIZE = max(1, min(8, int(os.environ.get("PDF_VISION_BATCH_SIZE", "4") or "4")))
except ValueError:
    PDF_VISION_BATCH_SIZE = 4
# Kredyty = wyłącznie koszt tokenów OpenAI (usage). Brak sztucznej dopłaty za stronę.
PDF_INCLUDED_PAGES = 4  # informacyjnie (UI); nie wpływa na billing
INSPIRATIONS_MODEL = (
    os.environ.get("OPENAI_INSPIRATIONS_MODEL", "gpt-4o").strip() or "gpt-4o"
)
# Default tenant when client does not send X-Account-Key (legacy / ops).
# Authenticated app clients send X-Account-Key from profiles.account_key.
_ACCOUNT_KEY_DEFAULT = (os.environ.get("ACCOUNT_KEY") or "default").strip() or "default"
_account_key_ctx: ContextVar[str] = ContextVar("account_key", default=_ACCOUNT_KEY_DEFAULT)
_SUPABASE_ANON_KEY = (
    os.environ.get("SUPABASE_ANON_KEY", "").strip()
    or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY", "").strip()
)


def get_account_key() -> str:
    """Per-request account_key (middleware) with env fallback."""
    try:
        return _account_key_ctx.get() or _ACCOUNT_KEY_DEFAULT
    except LookupError:
        return _ACCOUNT_KEY_DEFAULT


_configure_supabase_rest(get_account_key=get_account_key)


def require_tenant_account_key() -> str:
    """Blokuje zapis na shared „default” — skany / faktury / menu muszą mieć ak_*."""
    key = (get_account_key() or "").strip()
    if not key or key == "default":
        raise HTTPException(
            status_code=401,
            detail=(
                "Brak X-Account-Key zalogowanego konta. "
                "Zaloguj się ponownie i spróbuj jeszcze raz."
            ),
        )
    return key


# Back-compat alias for imports/tests — prefer get_account_key() at runtime.
_ACCOUNT_KEY = _ACCOUNT_KEY_DEFAULT


def _env(name: str, default: str = "") -> str:
    """Odczyt zmiennej z backend/.env (nadpisuje puste/stare wartości w procesie)."""
    load_dotenv(_BACKEND_DIR / ".env", override=True)
    return (os.environ.get(name) or default).strip()


def _resend_api_key() -> str:
    return _env("RESEND_API_KEY")


def _resend_from_email() -> str:
    fallback = "asystent.dostaw@gastromanager.org"
    raw = _env("RESEND_FROM_EMAIL", fallback).strip()
    blocked = ("gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com")
    host = raw.rsplit("@", 1)[-1].lower() if "@" in raw else ""
    if not raw or raw.lower() == "onboarding@resend.dev" or host in blocked:
        return fallback
    return raw

logger = logging.getLogger("gastro")
logging.basicConfig(level=logging.INFO)

# Do NOT crash the whole process on missing env — Railway healthcheck needs the
# process listening. API routes that need Supabase still fail with 503.
_SUPABASE_CONFIGURED = bool(SUPABASE_URL and SUPABASE_KEY)
if not _SUPABASE_CONFIGURED:
    logger.error(
        "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (lub SUPABASE_ANON_KEY) "
        "nie są ustawione — ustaw Variables w Railway, inaczej API DB nie zadziała."
    )

app = FastAPI(title="Gastro Manager — Voice API")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)
app.include_router(furgonetka_shop_router)


@app.middleware("http")
async def account_key_middleware(request: Request, call_next):
    """Multi-tenant: X-Account-Key from logged-in app, else JWT→profiles, else ACCOUNT_KEY env."""
    path = request.url.path or ""
    # Furgonetka „Własna” wysyła Bearer {shop_token} — to NIE jest JWT użytkownika.
    # Lookup w Supabase Auth mógłby wisieć i Furgonetka zgłasza „błąd API”.
    skip_jwt = path == "/orders" or path.startswith("/orders/") or path.startswith(
        "/api/furgonetka"
    )
    raw = (request.headers.get("x-account-key") or "").strip()
    # Allow only safe slug chars (ak_<uuid> / default / custom deploy slugs)
    if raw and re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", raw):
        key = raw
    else:
        key = _ACCOUNT_KEY_DEFAULT

    # Jeśli klient wysłał „default” (race przed AuthProvider) — spróbuj odzyskać z JWT.
    if not skip_jwt and (key == "default" or not raw):
        auth = (request.headers.get("authorization") or "").strip()
        if auth.lower().startswith("bearer ") and SUPABASE_URL:
            user_jwt = auth[7:].strip()
            if user_jwt and user_jwt != SUPABASE_KEY:
                try:
                    apikey = _SUPABASE_ANON_KEY or SUPABASE_KEY
                    async with httpx.AsyncClient(timeout=8.0, verify=_httpx_verify()) as httpx_c:
                        uresp = await httpx_c.get(
                            build_supabase_auth_user_url(SUPABASE_URL),
                            headers={
                                "Authorization": f"Bearer {user_jwt}",
                                "apikey": apikey,
                            },
                        )
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
                                        key = str(rows[0]["account_key"]).strip() or key
                                if key == "default":
                                    key = f"ak_{str(uid).replace('-', '')}"
                except Exception as exc:  # noqa: BLE001
                    logger.debug("account_key JWT resolve skipped: %s", exc)

    token = _account_key_ctx.set(key)
    try:
        return await call_next(request)
    finally:
        _account_key_ctx.reset(token)


_openai_client: AsyncOpenAI | None = None


def _httpx_verify():
    """SSL verify for httpx — Windows needs system cert store, not certifi bundle."""
    mode = os.environ.get("OPENAI_SSL_VERIFY", "auto").strip().lower()
    if mode in ("0", "false", "no"):
        return False
    if mode in ("certifi", "bundle"):
        return certifi.where()
    return ssl.create_default_context()


def _openai() -> AsyncOpenAI:
    """Lazy OpenAI client. Fails fast with a clear message if key is missing."""
    global _openai_client
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "OPENAI_API_KEY nie jest ustawione. Dodaj klucz OpenAI w pliku "
                "backend/.env (patrz backend/.env.example) i zrestartuj backend."
            ),
        )
    if _openai_client is None:
        _openai_client = AsyncOpenAI(
            api_key=OPENAI_API_KEY,
            http_client=httpx.AsyncClient(verify=_httpx_verify(), timeout=120.0),
        )
    return _openai_client


# ─────────────────────────────────────────────────────────────────────────────
# Supabase REST — see backend/supabase_rest.py (service_role, tenant filters)
# ─────────────────────────────────────────────────────────────────────────────

# Back-compat for modules that import SB_HEADERS as a dict snapshot.
SB_HEADERS = _sb_headers()


def _pg_ts(iso: str) -> str:
    """Timestamp bezpieczny w query string PostgREST (bez '+' → spacja w URL)."""
    raw = (iso or "").strip()
    if not raw:
        return raw
    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
        return raw + "T00:00:00Z"
    if raw.endswith("Z"):
        return raw
    try:
        from datetime import datetime, timezone
        s = raw.replace(" ", "T")
        if s.endswith("+00:00") or s.endswith("-00:00"):
            return s[:-6] + "Z"
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return raw.replace("+", "%2B")


def _current_year_month() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m")


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas (Structured Outputs)
# ─────────────────────────────────────────────────────────────────────────────

Intent = Literal[
    "waste",
    "add_revenue",
    "add_fixed_cost",
    "add_variable_cost",
    "add_inventory_item",
    "add_menu_item",
    "add_supplier",
    "add_supplier_product",
    # Voice CRUD (edycja parametrów)
    "edit_menu_item_price",
    "add_recipe_ingredient",
    "edit_recipe_ingredient_qty",
    "edit_inventory_item",
    # Partie dat ważności
    "add_expiration_batch",
    # Zamawianie u dostawców
    "order_product",
    "order_critical_items_by_category",
    "supplier_flip_order",
    "budget_cap_order",
    "compare_catalogs_top_savings",
    "predictive_weekend_restock",
    "check_minimum_order_value",
    # Masowe operacje destrukcyjne (soft-delete / reset) — zabezpieczone modalem na FE
    "bulk_delete_menu",
    "bulk_delete_suppliers",
    "bulk_reset_inventory",
    "bulk_delete_inventory",
    "restore_last_deleted_menu",
    "restore_deleted_inventory",
    "upload_menu",
    # Pojedyncze usuwanie po nazwie (fuzzy)
    "delete_menu_item",
    "delete_supplier",
    "delete_inventory_item",
    # Dostępność dania (POS)
    "toggle_menu_item_availability",
    # Masowe zmiany cenowe / bufory
    "bulk_edit_menu_prices_percentage",
    "bulk_edit_menu_prices_fixed",
    "bulk_edit_inventory_buffers",
    # Edycja kategorii / nazwy dania
    "edit_menu_item_category",
    "rename_menu_item",
    # Skalowanie receptury
    "scale_recipe",
    # Sterowanie UI (nawigacja / filtry) — wykonywane na froncie
    "navigate_screen",
    "filter_ui_inventory",
    "filter_ui_menu_blocked",
    # Analityka okresowa (AI Trend & Analytics Orchestrator)
    "summarize_custom_period",
    "compare_two_periods",
    # Ranking sprzedaży / zużycia magazynu
    "rank_menu_sales",
    "rank_inventory_usage",
    "rank_waste_cost",
    "rank_dead_menu",
    "list_expiring_soon",
    "rank_supplier_spend",
    "manager_core_alerts",
    "haccp_tip",
    "upload_invoice",
    "upload_offer",
    "upload_document",
    "unknown",
]


# --- Payloads per intent -----------------------------------------------------

class WastePayload(BaseModel):
    item_type: Literal["dish", "ingredient", "unknown"] = "unknown"
    related_id: Optional[str] = None
    item_name: str = ""
    quantity: float = 0.0
    unit: str = ""
    reason: str = ""


class RevenuePayload(BaseModel):
    description: str
    amount_pln: float
    note: Optional[str] = None


FixedCostType = Literal["rent", "media", "payroll", "other"]
VarCostType = Literal["materials", "waste", "other"]


class FixedCostPayload(BaseModel):
    type: FixedCostType = "other"
    name: str
    amount_pln: float


class VarCostPayload(BaseModel):
    type: VarCostType = "other"
    name: str
    amount_pln: float


class InventoryItemPayload(BaseModel):
    name: str
    category_name: Optional[str] = None
    quantity: float = 0.0
    unit: str = "szt"
    min_quantity: float = 0.0
    optimal_quantity: Optional[float] = None
    safety_buffer_percent: float = 20.0
    unit_cost: Optional[float] = None
    portion_size: Optional[float] = None
    is_combo_polprodukt: bool = False


class MenuIngredient(BaseModel):
    ingredient_name: str
    quantity: float
    unit: str


class MenuItemPayload(BaseModel):
    name: str
    category: Optional[str] = None
    price_pln: float
    ingredients: list[MenuIngredient] = []


class SupplierPayload(BaseModel):
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    category: Optional[str] = None
    nip: Optional[str] = None
    notes: Optional[str] = None


class SupplierProductPayload(BaseModel):
    supplier_name: Optional[str] = None       # for AI to name the supplier
    supplier_id: Optional[str] = None         # if resolved
    product_name: str
    variant: Optional[str] = None
    price_pln: float
    unit_count: Optional[int] = None
    volume_label: Optional[str] = None


# --- Response schema returned by /voice/interpret ---------------------------

class VoiceInterpretation(BaseModel):
    intent: Intent
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    reason: Optional[str] = Field(default=None, description="Krótkie uzasadnienie klasyfikacji dla użytkownika")
    payload: dict  # dyskryminator: przy zapisie waliduje się osobno pod właściwy typ
    fuzzy_matches: list[dict] = Field(default_factory=list,
                                      description="Lista dopasowań fuzzy: [{field, matched_to, score, resolved_id}]")
    alternate_intents: list[dict] = Field(
        default_factory=list,
        description="Gdy niepewność: [{intent, label}] — FE pokazuje 2 propozycje",
    )
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


def _guard_period_intent(text: str, data: dict) -> dict:
    """Koryguje mylenie summarize ↔ compare i dokłada alternate_intents przy niskiej pewności."""
    t = _strip_pl_month(text or "")
    pl = dict(data.get("payload") or {})
    intent = data.get("intent") or "unknown"
    conf = float(data.get("confidence") or 0.5)

    # „wgraj/zeskanuj menu” → upload_menu (nie oferta dostawcy)
    if (
        re.search(r"\b(wgraj|zeskanuj|skanuj|dodaj)\b.{0,40}\b(menu|karte dan|karte menu|karte potraw)\b", t)
        or re.search(r"\b(menu|karte dan)\b.{0,40}\b(wgraj|zeskanuj|skanuj)\b", t)
    ):
        if intent in ("upload_offer", "upload_document", "upload_invoice", "unknown", "add_supplier"):
            intent = "upload_menu"
            data["intent"] = intent
            data["reason"] = ((data.get("reason") or "") + " | guard: upload_menu").strip(" |")

    # „przywróć magazyn/produkty” ≠ przywróć menu
    if re.search(r"\b(przywroc|przywrocic|cofnij)\b", t):
        if re.search(r"\b(magazyn\w*|produkt\w*|skladnik\w*)\b", t) and not re.search(r"\b(menu|danie|potraw\w*|karte)\b", t):
            intent = "restore_deleted_inventory"
            data["intent"] = intent
        elif re.search(r"\b(menu|danie|potraw\w*|karte)\b", t):
            intent = "restore_last_deleted_menu"
            data["intent"] = intent

    # TYLKO wyraźne porównanie — NIE „a”/„i” jako łącznik (fałszywe trafienia)
    compare_re = re.compile(
        r"\b(porownaj|porownanie|porownac|zestaw|zestawienie|versus|\bvs\b|roznic[ae]?)\b",
        re.I,
    )
    has_compare = bool(compare_re.search(t))
    # dwa miesiące + spójnik „i/oraz/vs” między nimi
    months_found = re.findall(
        r"\b(stycznia|styczen|lutego|luty|marca|marzec|kwietnia|kwiecien|maja|maj|"
        r"czerwca|czerwiec|lipca|lipiec|sierpnia|sierpien|wrzesnia|wrzesien|"
        r"pazdziernika|pazdziernik|listopada|listopad|grudnia|grudzien|grudznia)\b",
        t,
    )
    month_hits = len(months_found)
    if not has_compare and month_hits >= 2 and re.search(r"\b(i|oraz|vs|versus)\b", t):
        has_compare = True

    finance_one = bool(re.search(
        r"\b(zysk|zyski|przychod|przychody|utarg|podsumuj|analiz|dane|raport|sprzedaz)\b",
        t,
    ))

    # TWARDY OVERRIDE: „pokaż zyski z lipca” → zawsze summarize (nigdy compare)
    if finance_one and month_hits <= 1 and not has_compare:
        intent = "summarize_custom_period"
        data["intent"] = intent
        data["confidence"] = max(conf, 0.88)
        data["reason"] = (
            (data.get("reason") or "")
            + " | Wymuszono: analiza jednego okresu (zyski/dane), nie porównanie."
        ).strip(" |")
        if not pl.get("period_1"):
            pl["period_1"] = (text or "").strip()
        pl["period_type"] = pl.get("period_type") or "month"
        pl.pop("period_2", None)

    elif intent == "compare_two_periods" and not has_compare and month_hits <= 1:
        intent = "summarize_custom_period"
        data["intent"] = intent
        data["confidence"] = min(conf, 0.72)
        data["reason"] = (
            (data.get("reason") or "")
            + " | Skorygowano: jeden okres → analiza, nie porównanie."
        ).strip(" |")
        if not pl.get("period_1") and pl.get("period_2"):
            pl["period_1"] = pl["period_2"]
        pl.pop("period_2", None)

    elif intent == "summarize_custom_period" and has_compare and month_hits >= 2:
        intent = "compare_two_periods"
        data["intent"] = intent
        data["reason"] = (
            (data.get("reason") or "")
            + " | Skorygowano: wykryto porównanie dwóch okresów."
        ).strip(" |")

    # Uzupełnij period_1 pełnym tekstem użytkownika
    if intent in (
        "summarize_custom_period",
        "rank_menu_sales",
        "rank_inventory_usage",
        "rank_waste_cost",
        "rank_dead_menu",
        "rank_supplier_spend",
    ):
        if not pl.get("period_1") or len(str(pl.get("period_1") or "")) < 4:
            pl["period_1"] = (text or "").strip()
        pl["period_type"] = pl.get("period_type") or (
            "year" if intent.startswith("rank_") else "month"
        )

    # Zawsze zaproponuj 2 warianty przy finance/compare (żeby FE mógł przełączyć)
    if intent in ("summarize_custom_period", "compare_two_periods") or finance_one:
        if intent == "summarize_custom_period":
            alts = [
                {"intent": "summarize_custom_period", "label": "Pokazanie danych / zysków z okresu"},
                {"intent": "compare_two_periods", "label": "Porównanie dwóch okresów"},
            ]
        else:
            alts = [
                {"intent": "compare_two_periods", "label": "Porównanie dwóch okresów"},
                {"intent": "summarize_custom_period", "label": "Pokazanie danych / zysków z okresu"},
            ]
        data["alternate_intents"] = alts

    data["payload"] = pl
    return data


# --- Apply request (client confirms) ----------------------------------------

class ApplyRequest(BaseModel):
    intent: Intent
    payload: dict
    transcript: Optional[str] = None
    source: Literal["voice", "manual"] = "voice"


class ApplyResponse(BaseModel):
    intent: Intent
    ok: bool
    id: Optional[str] = None
    detail: str = ""
    extras: dict = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/")
async def root():
    return {"service": "gastro-voice", "status": "ok"}


@app.get("/api/download/gastro-manager-updated.zip")
async def download_updated_zip():
    """Serves the packaged updated codebase for the user to review locally."""
    path = Path(__file__).parent / "static" / "gastro-manager-updated.zip"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Paczka nie została jeszcze zbudowana.")
    return FileResponse(
        path=str(path),
        media_type="application/zip",
        filename="gastro-manager-updated.zip",
    )


@app.get("/")
@app.get("/health")
@app.get("/api/health")
async def health():
    """Lightweight liveness for Railway — no outbound calls (must stay fast)."""
    return {
        "status": "ok",
        "service": "gastro-voice",
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_KEY),
        "openai_configured": bool(OPENAI_API_KEY),
        "account_key_default": _ACCOUNT_KEY_DEFAULT,
        "stt_model": STT_MODEL,
        "chat_model": CHAT_MODEL,
    }


class AutoConfirmBody(BaseModel):
    user_id: str = Field(..., min_length=8, max_length=80)


@app.post("/api/auth/auto-confirm")
async def auth_auto_confirm(body: AutoConfirmBody):
    """
    Closed beta: potwierdza e-mail użytkownika przez Admin API (bez maila).
    Wyłącz: AUTO_CONFIRM_EMAIL=false na Railway.
    Docelowo wyłącz też „Confirm email” w Supabase → Authentication → Providers → Email.
    """
    flag = (os.environ.get("AUTO_CONFIRM_EMAIL") or "true").strip().lower()
    if flag in ("0", "false", "no", "off"):
        raise HTTPException(status_code=403, detail="AUTO_CONFIRM_EMAIL jest wyłączone.")
    _require_supabase()
    uid = (body.user_id or "").strip()
    url = build_supabase_auth_admin_url(SUPABASE_URL, uid)
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0, verify=_httpx_verify()) as client:
        r = await client.put(url, headers=headers, json={"email_confirm": True})
        if r.status_code >= 400:
            # starsze API czasem używa PATCH
            r2 = await client.patch(url, headers=headers, json={"email_confirm": True})
            if r2.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"Nie udało się potwierdzić e-maila: {r2.text[:300]}",
                )
    return {"ok": True, "user_id": uid, "email_confirmed": True}


@app.get("/api/health/deep")
async def health_deep():
    """Optional deep check (Supabase round-trip) — not used by Railway healthcheck."""
    sub_status = "skipped"
    if SUPABASE_URL and SUPABASE_KEY:
        async with httpx.AsyncClient(timeout=5.0, verify=_httpx_verify()) as client:
            try:
                rows = await sb_get(
                    client,
                    "subscriptions",
                    params={
                        "select": "tier_level,credits_balance",
                        "account_key": f"eq.{get_account_key()}",
                        "limit": "1",
                    },
                )
                if rows:
                    sub_status = (
                        f"ok tier={rows[0].get('tier_level')} "
                        f"credits={rows[0].get('credits_balance')}"
                    )
                else:
                    sub_status = "empty"
            except httpx.HTTPStatusError as e:
                sub_status = f"error {e.response.status_code}"
            except Exception as e:  # noqa: BLE001
                sub_status = f"error {type(e).__name__}"
    else:
        sub_status = "not_configured"
    return {
        "status": "ok",
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_KEY),
        "account_key": get_account_key(),
        "subscription": sub_status,
        "openai_configured": bool(OPENAI_API_KEY),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 1) Voice transcription  — official openai SDK
# ─────────────────────────────────────────────────────────────────────────────

class TranscribeResponse(BaseModel):
    text: str
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


@app.post("/api/voice/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...), language: str = Form("pl")):
    client = _openai()
    await _guard_ai()
    contents = await audio.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Puste nagranie audio.")

    filename = audio.filename or "audio.webm"
    if "." not in filename:
        ct = (audio.content_type or "").lower()
        ext = ("webm" if "webm" in ct
               else "wav" if "wav" in ct
               else "mp3" if ("mpeg" in ct or "mp3" in ct)
               else "m4a" if ("m4a" in ct or "mp4" in ct or "aac" in ct)
               else "webm")
        filename = f"{filename}.{ext}"

    buf = io.BytesIO(contents)
    buf.name = filename  # SDK uses `.name` for MIME detection

    try:
        resp = await client.audio.transcriptions.create(
            model=STT_MODEL,
            file=buf,
            language=language or "pl",
            prompt=(
                "Kontekst: restauracja / gastronomia. Raportowanie strat magazynowych, "
                "dodawanie kosztów, przychodów, produktów magazynowych, dań z menu, "
                "dostawców. Ilości w kg, litrach, sztukach. Ceny w PLN."
            ),
        )
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"Whisper API: {e.message}") from e
    except OpenAIError as e:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"Whisper: {e}") from e

    billing = {"credits_deducted": 0, "credits_remaining": None}
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
        billing = await _bill_openai_response(
            httpx_c, resp, endpoint="/api/voice/transcribe", model=STT_MODEL,
            extras={"filename": filename},
        )

    return TranscribeResponse(
        text=(getattr(resp, "text", "") or "").strip(),
        credits_deducted=int(billing.get("credits_deducted") or 0),
        credits_remaining=billing.get("credits_remaining"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# 2) Interpret voice → intent + payload
# ─────────────────────────────────────────────────────────────────────────────

# JSON Schema for Structured Outputs — enforces exact shape and enums.
_JSON_SCHEMA = {
    "name": "VoiceInterpretation",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["intent", "confidence", "reason", "payload"],
        "properties": {
            "intent": {
                "type": "string",
                "enum": [
                    "waste", "add_revenue", "add_fixed_cost", "add_variable_cost",
                    "add_inventory_item", "add_menu_item",
                    "add_supplier", "add_supplier_product",
                    "edit_menu_item_price", "add_recipe_ingredient",
                    "edit_recipe_ingredient_qty", "edit_inventory_item",
                    "add_expiration_batch",
                    "order_product", "order_critical_items_by_category",
                    "supplier_flip_order", "budget_cap_order",
                    "compare_catalogs_top_savings", "predictive_weekend_restock",
                    "check_minimum_order_value",
                    "bulk_delete_menu", "bulk_delete_suppliers", "bulk_reset_inventory",
                    "bulk_delete_inventory", "restore_last_deleted_menu", "restore_deleted_inventory",
                    "delete_menu_item", "delete_supplier", "delete_inventory_item",
                    "toggle_menu_item_availability",
                    "bulk_edit_menu_prices_percentage", "bulk_edit_menu_prices_fixed",
                    "bulk_edit_inventory_buffers",
                    "edit_menu_item_category", "rename_menu_item", "scale_recipe",
                    "navigate_screen", "filter_ui_inventory", "filter_ui_menu_blocked",
                    "summarize_custom_period", "compare_two_periods",
                    "rank_menu_sales", "rank_inventory_usage",
                    "rank_waste_cost", "rank_dead_menu", "list_expiring_soon",
                    "rank_supplier_spend", "manager_core_alerts", "haccp_tip",
                    "upload_invoice", "upload_offer", "upload_document", "upload_menu",
                    "unknown",
                ],
            },
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "reason": {"type": "string"},
            "payload": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "item_type", "related_id", "item_name", "quantity", "unit",
                    "reason_text",
                    "description", "amount_pln", "note",
                    "cost_type", "cost_name",
                    "product_name", "category_name",
                    "min_quantity", "current_quantity", "safety_buffer_percent",
                    "unit_cost", "portion_size", "is_combo_polprodukt",
                    "menu_category", "price_pln", "ingredients",
                    "supplier_name", "supplier_id", "contact_person", "phone",
                    "email", "supplier_category", "nip", "notes",
                    "variant", "unit_count", "volume_label",
                    # Voice CRUD + supplier intents
                    "dish_name", "new_price", "ingredient_name",
                    "from_supplier", "to_supplier", "category",
                    "max_budget",
                    "items",
                    "categories",
                    # Bulk / delete / availability / navigation / scaling
                    "percentage", "amount", "action", "available",
                    "new_category", "new_name", "portions", "screen",
                    # Analityka okresowa
                    "period_type", "limit_days", "period_1", "period_2",
                    # Ranking sprzedaży / zużycia
                    "rank", "top_n",
                    # Partie dat ważności
                    "expiration_date", "alert_days",
                ],
                "properties": {
                    # waste
                    "item_type": {"type": ["string", "null"], "enum": ["dish", "ingredient", "unknown", None]},
                    "related_id": {"type": ["string", "null"]},
                    "item_name": {"type": ["string", "null"]},
                    "quantity": {"type": ["number", "null"]},
                    "unit": {"type": ["string", "null"]},
                    "reason_text": {"type": ["string", "null"]},
                    # revenue / costs
                    "description": {"type": ["string", "null"]},
                    "amount_pln": {"type": ["number", "null"]},
                    "note": {"type": ["string", "null"]},
                    "cost_type": {
                        "type": ["string", "null"],
                        "enum": ["rent", "media", "payroll", "materials", "waste", "other", None],
                    },
                    "cost_name": {"type": ["string", "null"]},
                    # inventory item
                    "product_name": {"type": ["string", "null"]},
                    "category_name": {"type": ["string", "null"]},
                    "min_quantity": {"type": ["number", "null"]},
                    "current_quantity": {"type": ["number", "null"]},
                    "safety_buffer_percent": {"type": ["number", "null"]},
                    "unit_cost": {"type": ["number", "null"]},
                    "portion_size": {"type": ["number", "null"]},
                    "is_combo_polprodukt": {"type": ["boolean", "null"]},
                    # menu item
                    "menu_category": {"type": ["string", "null"]},
                    "price_pln": {"type": ["number", "null"]},
                    "ingredients": {
                        "type": ["array", "null"],
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["ingredient_name", "quantity", "unit"],
                            "properties": {
                                "ingredient_name": {"type": "string"},
                                "quantity": {"type": "number"},
                                "unit": {"type": "string"},
                            },
                        },
                    },
                    # supplier
                    "supplier_name": {"type": ["string", "null"]},
                    "supplier_id": {"type": ["string", "null"]},
                    "contact_person": {"type": ["string", "null"]},
                    "phone": {"type": ["string", "null"]},
                    "email": {"type": ["string", "null"]},
                    "supplier_category": {"type": ["string", "null"]},
                    "nip": {"type": ["string", "null"]},
                    "notes": {"type": ["string", "null"]},
                    # supplier product
                    "variant": {"type": ["string", "null"]},
                    "unit_count": {"type": ["integer", "null"]},
                    "volume_label": {"type": ["string", "null"]},
                    # Voice CRUD — nazwa dania/składnika + nowa cena
                    "dish_name": {"type": ["string", "null"]},
                    "new_price": {"type": ["number", "null"]},
                    "ingredient_name": {"type": ["string", "null"]},
                    # Supplier intents
                    "from_supplier": {"type": ["string", "null"]},
                    "to_supplier": {"type": ["string", "null"]},
                    "category": {"type": ["string", "null"]},
                    "max_budget": {"type": ["number", "null"]},
                    # Bulk / delete / availability / navigation / scaling
                    "percentage": {"type": ["number", "null"]},
                    "amount": {"type": ["number", "null"]},
                    "action": {"type": ["string", "null"], "enum": ["increase", "decrease", None]},
                    "available": {"type": ["boolean", "null"]},
                    "new_category": {"type": ["string", "null"]},
                    "new_name": {"type": ["string", "null"]},
                    "portions": {"type": ["number", "null"]},
                    "screen": {
                        "type": ["string", "null"],
                        "enum": ["index", "menu", "magazyn", "dostawcy", "ustawienia", None],
                    },
                    # Analityka okresowa (AI Trend & Analytics Orchestrator)
                    "period_type": {
                        "type": ["string", "null"],
                        "enum": ["day", "week", "month", "year", "custom", None],
                    },
                    "limit_days": {"type": ["integer", "null"]},
                    "period_1": {"type": ["string", "null"]},
                    "period_2": {"type": ["string", "null"]},
                    # Ranking: best/worst + ile pozycji
                    "rank": {
                        "type": ["string", "null"],
                        "enum": ["best", "worst", None],
                    },
                    "top_n": {"type": ["integer", "null"]},
                    "expiration_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
                    "alert_days": {
                        "type": ["array", "null"],
                        "items": {"type": "integer"},
                        "description": "Dni przed końcem ważności na przypomnienie, np. [7,3,1]",
                    },
                    # Lista produktów dla order_product / supplier_flip_order
                    "items": {
                        "type": ["array", "null"],
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["product_name", "quantity", "unit"],
                            "properties": {
                                "product_name": {"type": "string"},
                                "quantity": {"type": "number"},
                                "unit": {"type": "string"},
                            },
                        },
                    },
                    # Lista kategorii magazynowych dla order_critical_items_by_category
                    # ('all' → globalnie wszystkie krytyczne braki).
                    "categories": {
                        "type": ["array", "null"],
                        "items": {"type": "string"},
                    },
                },
            },
        },
    },
}


def _build_system_prompt(dishes: list, ingredients: list, suppliers: list) -> str:
    d = "\n".join(f"  - id={x['id']} \"{x['name']}\"" for x in dishes[:120]) or "  (brak)"
    i = "\n".join(f"  - id={x['id']} \"{x['name']}\" ({x.get('unit','')})" for x in ingredients[:200]) or "  (brak)"
    s = "\n".join(f"  - id={x['id']} \"{x['name']}\"" for x in suppliers[:80]) or "  (brak)"
    return f"""Jesteś asystentem restauracji (Gastro Manager). Otrzymujesz dyktowaną w języku polskim
komendę użytkownika i musisz sklasyfikować JEDNĄ intencję oraz wypełnić spójny payload.

DOSTĘPNE INTENCJE:
1. "waste" – zgłoszenie straty magazynowej.
   Słowa-klucze: wyrzuciłem, wyrzucić, zepsuł, spalił, skwaśniał, spleśniał, przeterminował,
   strata, wylałem, zmarnował, wyrzucamy, uszkodzenie, wyleciał, wyrzucone.
   * jeśli dotyczy gotowego dania → item_type="dish", related_id=id z listy dań poniżej
   * jeśli dotyczy surowca z magazynu → item_type="ingredient", related_id=id z listy składników
   * pola do wypełnienia: item_type, related_id, item_name, quantity, unit, reason_text

2. "add_revenue" – przychód / utarg / wpłata / płatność otrzymana / wynajem sali.
   Słowa: przychód, utarg, wpływ, zarobek, wynajem, sprzedaż, wpłata.
   * pola: description, amount_pln, note

3. "add_fixed_cost" – KOSZT STAŁY comiesięczny.
   Słowa: czynsz, wynajem lokalu, prąd, gaz, woda, media, internet, telefon,
   wynagrodzenia, pensje, ZUS, księgowa, ubezpieczenie, monitoring, abonament.
   cost_type: "rent" | "media" | "payroll" | "other"
   * pola: cost_type, cost_name, amount_pln

4. "add_variable_cost" – KOSZT ZMIENNY (jednorazowy zakup / mandat / strata pieniężna).
   Słowa: zakup, faktura, dostawa, zaopatrzenie, surowce, materiały,
   mandat, kara, awaria, naprawa, transport.
   cost_type: "materials" | "waste" | "other"
   * pola: cost_type, cost_name, amount_pln

5. "add_inventory_item" – dodanie NOWEGO produktu do magazynu.
   Słowa: dodaj do magazynu, nowy produkt, załóż w magazynie, wprowadź, przyjmij.
   * pola: product_name, category_name, quantity, unit, min_quantity,
     safety_buffer_percent (min 10, domyślnie 20), unit_cost, portion_size, is_combo_polprodukt

6. "add_menu_item" – dodanie nowego dania do MENU wraz z recepturą.
   Słowa: dodaj do menu, nowe danie, nowa potrawa, wprowadź danie, wpisz do karty,
   receptura, składniki dania.
   * pola: product_name (nazwa dania), menu_category, price_pln,
     ingredients[] (lista {{ingredient_name, quantity, unit}})

7. "add_supplier" – dodanie nowego DOSTAWCY.
   Słowa: nowy dostawca, dodaj dostawcę, załóż kontrahenta, hurtownia, kontrakt.
   * pola: supplier_name, contact_person, phone, email, supplier_category, nip, notes

8. "add_supplier_product" – dodanie produktu do KATALOGU konkretnego dostawcy z ceną.
   Słowa: u dostawcy X, dodaj do oferty, cennik dostawcy, dostawca ma, oferuje.
   * pola: supplier_name (nazwa dostawcy), product_name, variant, price_pln,
     unit_count, volume_label

9. "edit_menu_item_price" – ZMIANA ceny istniejącego dania w menu.
   Słowa: zmień cenę, ustaw cenę, przecena, nowa cena.
   * pola: dish_name (nazwa dania — MOŻE być zniekształcona przez Whisper, użyj najlepszego dopasowania z listy), new_price

10. "add_recipe_ingredient" – DOPISANIE nowego składnika do receptury istniejącego dania.
    Słowa: dodaj do (dania), dopisz składnik, dorzuć do receptury.
    * pola: dish_name, ingredient_name, quantity, unit

11. "edit_recipe_ingredient_qty" – ZMIANA gramatury/ilości istniejącego składnika w recepturze dania.
    Słowa: zmień gramaturę, zmień ilość składnika, popraw ilość.
    * pola: dish_name, ingredient_name, quantity, unit

12. "edit_inventory_item" – ZMIANA parametrów produktu w magazynie (próg krytyczny, stan bieżący, safety buffer).
    Słowa: zmień próg, ustaw stan, próg krytyczny, safety buffer, minimum, poziom bezpieczeństwa.
    * pola: item_name (nazwa surowca), min_quantity (nowy próg krytyczny, opcjonalne),
      current_quantity (nowy stan magazynu, opcjonalne),
      safety_buffer_percent (nowy bufor bezpieczeństwa %, opcjonalne), unit

12b. "add_expiration_batch" – USTAWIENIE daty ważności dla produktu JUŻ w magazynie (bez dodawania nowego produktu i bez zwiększania stanu).
    Słowa: data ważności, termin przydatności, ustaw datę, partia, ważne do, spożyć przed,
    „ustaw datę ważności twarogu 20.08.2026”, „mleko ważność 25 lipca”.
    * pola: item_name (MUSI istnieć w magazynie), quantity (ile sztuk tej partii daty), unit,
      expiration_date (YYYY-MM-DD — ZAWSZE konwertuj z PL formatów DD.MM.YYYY / „20 sierpnia 2026”),
      alert_days (tablica int, opcjonalna; domyślnie [7,3,1] — kiedy przypomnieć).
    * NIE twórz nowego produktu. NIE zwiększaj stanu magazynu.
      Jeśli produktu nie ma w magazynie — backend zwróci błąd (użytkownik musi najpierw dodać produkt).
    * Jedna wypowiedź może opisać jedną partię; wiele dat = wiele wariantów quantity+expiration w batches[].

13. "order_product" – złóż zamówienie produktów u dostawcy (zwykłe zamówienie hurtowe).
    Słowa: zamów, chcę zamówić, potrzebuję dostawy, dorzuć do zamówienia.
    * pola: items[] (lista {{product_name, quantity, unit}}), supplier_name (opcjonalny)

13b. "order_critical_items_by_category" – ZBIORCZE zamówienie BRAKÓW magazynowych
    (produktów poniżej progu krytycznego), z filtrem po kategoriach — ORAZ opcjonalnie
    KONKRETNYCH produktów wymienionych z nazwy w tej samej komendzie.
    Słowa: „zamów wszystkie braki", „zamów brakujące produkty", „domów co się kończy",
    „zamów mięso i nabiał", „zamów braki z warzyw", „uzupełnij magazyn",
    „ile brakuje", „braki magazynowe", „zamów wszystko czego brakuje",
    MIX: „zamów ser kozi, filet z kurczaka i wszystkie brakujące warzywa".
    * pole `categories: string[]` — TYLKO nazwy KATEGORII magazynowych (NIGDY nazwy produktów!).
      Sztywne nazwy do dopasowania (użyj dokładnie tych stringów):
        'Mięso i wędliny', 'Ryby i owoce morza', 'Nabiał', 'Warzywa i owoce', 'Pieczywo',
        'Suchy magazyn', 'Oleje i tłuszcze', 'Przyprawy', 'Mrożonki', 'Napoje', 'Alkohole',
        'Wywary i sosy', 'Chemia i czystość', 'Opakowania', 'Inne'.
    * Fuzzy dopasowanie po potocznych słowach KATEGORII (nie produktów!):
        „mięso"/„wędliny"            → 'Mięso i wędliny'
        „ryby"/„owoce morza"         → 'Ryby i owoce morza'
        „nabiał"                     → 'Nabiał'
        „warzywa"/„owoce"/„jarzyny"  → 'Warzywa i owoce'
        „pieczywo"                   → 'Pieczywo'
        „napoje"                     → 'Napoje'
        „alkohole"                   → 'Alkohole'
        „mrożonki"/„mrożone"         → 'Mrożonki'
        „suchy magazyn"/„suchy"      → 'Suchy magazyn'
        „olej"/„tłuszcze"            → 'Oleje i tłuszcze'
        „przyprawy"                  → 'Przyprawy'
        „wywary"/„sosy"              → 'Wywary i sosy'
        „chemia"/„środki czystości"  → 'Chemia i czystość'
        „opakowania"                 → 'Opakowania'
    * stock_target:
        „brakujące"/„braki"/„krytyczne"/„kończy się" → "critical" (DOMYŚLNE)
        „do optymalnego"/„uzupełnij magazyn do pełna" → "optimal"
    * Jeśli użytkownik mówi „zamów WSZYSTKIE braki"/„zamów wszystko czego brakuje"
      bez wskazania kategorii → categories = ["all"].
      NIGDY nie ustawiaj categories=["all"], gdy użytkownik wymienił konkretną kategorię
      LUB konkretne produkty z nazwy.
    * Jeśli mówi „zamów mięso i nabiał" → categories = ["Mięso i wędliny", "Nabiał"], items = null.
    * MIX nazwy + kategoria (WAŻNE): gdy wymienia KONKRETNE produkty ORAZ braki z kategorii
      (np. „zamów ser kozi i brakujące mięso"):
        intent = order_critical_items_by_category
        categories = ["Mięso i wędliny"]   ← TYLKO kategoria braków, NIE „ser kozi”
        items = [{{"product_name": "ser kozi", "quantity": null, "unit": "szt"}}]
        stock_target = "critical"
      Backend scali nazwiane pozycje z brakami WYŁĄCZNIE wskazanej kategorii.
      NIE dodawaj produktów z innych kategorii / globalnych braków.
    * Samo „zamów ser kozi i filet" BEZ kategorii braków → użyj "order_product" (items[]),
      categories = null. NIE używaj order_critical_items_by_category.
    * Same braki kategorii BEZ nazwanych produktów → categories wypełnione, items = null.

14. "supplier_flip_order" – PRZERZUCENIE koszyka z jednego dostawcy do drugiego (zmiana ceny/oferty).
    Słowa: przerzuć na, zmień dostawcę, weź od (dostawcy) zamiast, przełącz na.
    * pola: from_supplier (nazwa OBECNEGO dostawcy), to_supplier (nazwa NOWEGO), category (opcjonalna kategoria produktów, np. "mięso", "napoje")

15. "budget_cap_order" – kompletuj zamówienie do LIMITU KWOTOWEGO, priorytetyzując najpilniejsze braki.
    Słowa: za maksymalnie X zł, do budżetu, w ramach X złotych, do (kwoty).
    * pola: category (opcjonalna, jeśli podana), max_budget (limit w PLN)

16. "compare_catalogs_top_savings" – porównaj cenniki wszystkich dostawców, pokaż 5 największych PROMOCJI procentowych.
    Słowa: gdzie taniej, top okazji, największe rabaty, top 5 promocji, gdzie oszczędzę.
    * brak payload (wszystkie pola null poza intent).

17. "predictive_weekend_restock" – wylicz sugerowane zamówienie na podstawie historycznej sprzedaży z POS z analogicznego okresu.
    Słowa: ile zamówić na weekend, przygotuj zamówienie na piątek/sobotę, prognoza, co potrzebujemy.
    * brak payload (opcjonalnie category).

18. "check_minimum_order_value" – sprawdź minimum logistyczne dostawy u konkretnego dostawcy i zasugeruj dorzucenia.
    Słowa: darmowy transport, minimum zamówienia, minimum logistyczne, ile dorzucić.
    * pola: supplier_name (dostawca), category (opcjonalne — czego dorzucić).

19. "bulk_delete_menu" – WYCZYSZCZENIE CAŁEGO MENU (ukrycie wszystkich dań).
    Słowa: usuń całe menu, wyczyść menu, usuń wszystkie pozycje z karty, skasuj wszystkie dania, wyczyść kartę dań.
    * brak payload (wszystkie pola null poza intent).

20. "bulk_delete_suppliers" – USUNIĘCIE WSZYSTKICH DOSTAWCÓW.
    Słowa: usuń wszystkich dostawców, wyczyść bazę dostawców, skasuj wszystkich kontrahentów, usuń całą listę dostawców.
    * brak payload.

21. "bulk_reset_inventory" – RESET STANÓW MAGAZYNOWYCH DO ZERA (remanent). Produkty ZOSTAJĄ na liście, zeruje się tylko ilość.
    Słowa: zresetuj stany, wyzeruj stany, remanent do zera, magazyn na zero, wyzeruj ilości.
    * brak payload.

21b. "bulk_delete_inventory" – CAŁKOWITE USUNIĘCIE WSZYSTKICH produktów z magazynu (znikają też nazwy).
    Słowa: usuń wszystkie produkty z magazynu, wyczyść magazyn, skasuj wszystkie składniki, usuń całą listę magazynową.
    * brak payload.

21c. "restore_last_deleted_menu" – PRZYWRÓCENIE usuniętych pozycji MENU (nie magazynu).
    Używaj TYLKO gdy użytkownik mówi o menu / daniach / potrawach.
21d. "restore_deleted_inventory" – PRZYWRÓCENIE usuniętych produktów MAGAZYNU.
    Używaj gdy: „przywróć magazyn”, „przywróć produkty”, „cofnij usunięcie magazynu”.
    NIGDY nie myl z restore_last_deleted_menu.
    Słowa: przywróć menu, przywróć skasowane dania, cofnij usunięcie menu, przywróć ostatnio usunięte pozycje.
    * brak payload.

22. "delete_menu_item" – usunięcie POJEDYNCZEGO dania z menu po nazwie.
    Słowa: usuń danie, skasuj z menu, wyrzuć z karty (konkretną potrawę).
    * pola: dish_name (nazwa dania — może być zniekształcona przez Whisper).

23. "delete_supplier" – usunięcie POJEDYNCZEGO dostawcy po nazwie.
    Słowa: usuń dostawcę, skasuj kontrahenta (konkretnego).
    * pola: supplier_name.

24. "delete_inventory_item" – usunięcie POJEDYNCZEGO produktu z magazynu po nazwie.
    Słowa: usuń z magazynu, skasuj produkt (konkretny surowiec).
    * pola: item_name.

25. "toggle_menu_item_availability" – WŁĄCZENIE/WYŁĄCZENIE dostępności dania w POS.
    Słowa: wyłącz danie, zablokuj potrawę, włącz z powrotem, odblokuj danie, dzisiaj niedostępne.
    * pola: dish_name, available (false=wyłącz/zablokuj, true=włącz/odblokuj).

26. "bulk_edit_menu_prices_percentage" – MASOWA zmiana cen w menu o PROCENT.
    Słowa: podnieś ceny o X procent, obniż ceny o X%, przez inflację o X%.
    * pola: percentage (liczba %, np. 10), action ("increase"|"decrease"), category (opcjonalna kategoria menu, np. "Burgery", "Alkohole").

27. "bulk_edit_menu_prices_fixed" – MASOWA zmiana cen w menu o KWOTĘ (zł).
    Słowa: podnieś ceny o X złotych, obniż każdą pozycję o X zł.
    * pola: amount (kwota PLN), action ("increase"|"decrease"), category (opcjonalna).

28. "bulk_edit_inventory_buffers" – MASOWA zmiana buforów bezpieczeństwa w magazynie o PROCENT (punkty procentowe).
    Słowa: zwiększ bufory bezpieczeństwa o X%, zmniejsz bufory dla warzyw o połowę.
    * pola: percentage, action ("increase"|"decrease"), category (opcjonalna kategoria magazynu, np. "Warzywa", "Nabiał").

29. "edit_menu_item_category" – zmiana KATEGORII istniejącego dania.
    Słowa: przenieś do kategorii, zmień kategorię dania.
    * pola: dish_name, new_category.

30. "rename_menu_item" – zmiana NAZWY istniejącego dania.
    Słowa: zmień nazwę dania, przemianuj potrawę.
    * pola: dish_name, new_name.

31. "scale_recipe" – PRZELICZENIE receptury dania na X porcji (kalkulator).
    Słowa: przelicz składniki na X porcji, ile potrzebuję na X porcji, rozpisz na X porcji.
    * pola: dish_name, portions (liczba porcji).

32. "navigate_screen" – NAWIGACJA po aplikacji (zmiana ekranu/zakładki).
    Słowa: otwórz zakładkę, przejdź do, przełącz na, pokaż ekran, wróć do panelu.
    * pola: screen — jedna z: "index" (pulpit/kokpit/koszty/finanse/start),
      "menu" (menu/karta dań), "magazyn" (magazyn/stany), "dostawcy" (dostawcy/zamówienia), "ustawienia" (ustawienia/profil).

33. "filter_ui_inventory" – FILTROWANIE widoku magazynu po kategorii (i opcjonalnie dostawcy).
    Słowa: pokaż w magazynie tylko (kategoria), wyświetl tylko nabiał/warzywa/mięso.
    * pola: category (nazwa kategorii magazynu), supplier_id (opcjonalny).

34. "filter_ui_menu_blocked" – POKAŻ w menu tylko dania ZABLOKOWANE (brak składników / niedostępne).
    Słowa: pokaż zablokowane potrawy, które dania są niedostępne, co jest wyłączone.
    * brak payload.

36. "summarize_custom_period" – PODSUMOWANIE / ANALIZA JEDNEGO okresu (zyski, przychody, koszty).
    Słowa: pokaż zyski z lipca, podsumuj lipiec 2025, jak poszło w maju, analiza miesiąca,
    pokaż dane z lipca, przychody za sierpień, raport za 2025.
    WAŻNE: jeśli użytkownik podaje JEDEN okres (nawet z rokiem) → TĘ intencję, NIE compare.
    * pola: period_type ("day"|"week"|"month"|"year"|"custom"),
      limit_days (liczba dni jeśli wprost podana, np. 30; inaczej null),
      period_1 — WYPEŁNIJ pełnym tekstem okresu z rokiem gdy podany (np. "lipiec 2025", "2025-07").

37. "compare_two_periods" – PORÓWNANIE dwóch okresów finansowych.
    TYLKO gdy użytkownik wyraźnie porównuje: „porównaj”, „vs”, „a”, „zestaw”, „różnica między”.
    Przykłady: porównaj lipiec 2025 i sierpień 2025, maj vs czerwiec.
    NIE używaj gdy: „pokaż zyski z lipca”, „podsumuj maj” (to summarize_custom_period).
    * pola: period_1 (np. "lipiec 2025"), period_2 (np. "sierpień 2025") — ZAWSZE z rokiem jeśli podany.

38. "rank_menu_sales" – RANKING sprzedaży potraw / produktów z menu (POS).
    Słowa: pokaż najlepiej sprzedający się produkt/produkty, top sprzedaż, hit dnia/tygodnia/miesiąca,
    najsłabiej sprzedające się potrawy, flop, najgorsza sprzedaż, alkohole które się nie sprzedają,
    „w lipcu", „w maju", „za czerwiec".
    * pola: rank ("best"|"worst"), period_type ("day"|"week"|"month"|"year"|"custom"),
      limit_days (opcjonalnie), top_n (ile pozycji, domyślnie 5),
      category (opcjonalny filtr: np. "alkohole", "burgery" — kategoria menu),
      period_1 — WYPEŁNIJ gdy użytkownik poda konkretny miesiąc/okres nazwany
        (np. "lipiec", "maj", "2026-07"). To pozwala policzyć kalendarzowy miesiąc, nie „ostatnie 30 dni".

39. "rank_inventory_usage" – RANKING zużycia produktów z magazynu (przez sprzedaż × receptury).
    Słowa: produkt z magazynu którego zużyliśmy najwięcej/najmniej, co schodzi z magazynu,
    największe zużycie składników, najmniej używany surowiec w tygodniu/miesiącu/lipcu.
    * pola: rank ("best"=najwięcej|"worst"=najmniej), period_type, limit_days, top_n,
      category (opcjonalny filtr kategorii magazynu, np. "Nabiał"),
      period_1 (nazwa miesiąca / YYYY-MM jak wyżej).

39b. "rank_waste_cost" – RANKING STRAT MAGAZYNOWYCH W ZŁOTÓWKACH (waste_logs × cena zakupu).
    Słowa: ile utopiłem w koszu, ranking strat, ile wyrzuciłem w złotówkach, największe straty produktu,
    strata finansowa na odpadach, kosz w tym miesiącu / 18 dni / 67 dni.
    * pola: period_type, limit_days, top_n, period_1 (opcjonalnie nazwa miesiąca).
    * System mnoży quantity × unit_cost z inventory_items (z faktur).

39c. "rank_dead_menu" – NAJSŁABIEJ SPRZEDAJĄCE SIĘ dania (mała sprzedaż POS, ale qty>0).
    Słowa: martwe dania, najsłabiej sprzedające się, flop, pozycje z najmniejszą rotacją,
    dania które prawie nie schodzą, ranking najgorszej sprzedaży.
    NIE pokazuj dań z zerową sprzedażą — tylko pozycje które się sprzedały, ale najsłabiej.
    * pola: period_type, limit_days, top_n, category (opcjonalnie), period_1.

39d. "list_expiring_soon" – DRABINA DAT WAŻNOŚCI (partie kończące się za 1/2/3 dni).
    Słowa: co zaraz się przeterminuje, produkty na 3 dni, kończąca się data ważności,
    alerty dat ważności, co ratować w chłodni, półprodukty do jutra.
    * pola: limit_days (domyślnie 3 = dziś / jutro / pojutrze), top_n.

39e. "rank_supplier_spend" – WYDATKI U DOSTAWCÓW (suma faktur w okresie).
    Słowa: ile wydałem u Makro, ranking dostawców, wydatki na dostawy w kwartale,
    u którego dostawcy poszło najwięcej kasy, spend dostawcy.
    * pola: period_type, limit_days, top_n, period_1, supplier_name (opcjonalnie filtr nazwy).

39f. "manager_core_alerts" – ALERTY KORELACJI CORE (POS↔magazyn, magazyn↔straty, straty↔zł, POS↔straty).
    Słowa: co jest nie tak w lokalach, alerty managera, sprawdź korelacje, problemy magazyn-sprzedaż,
    czy mam braki przy ruchu, paradoks strat, dublowanie dostaw.
    * pola: period_type, limit_days (domyślnie tydzień).

39g. "haccp_tip" – PORADA HACCP / PRZECHOWYWANIA / FIFO.
    Słowa: jak przechowywać łososia, temperatura dla ryb, co to FIFO, tip HACCP do sałaty,
    ile trzymać sos, temperatura nabiału.
    * pola: item_name lub product_name (produkt / temat), note (opcjonalnie pytanie).

40. "upload_invoice" – użytkownik chce WGRAĆ FAKTURĘ zakupową do MAGAZYNU (skan AI).
    Słowa: chcę wgrać fakturę, wgraj fakturę, skanuj fakturę, dodaj fakturę zakupową.
    * brak wymaganych pól. Otwiera skaner w kontekście magazynu.

41. "upload_offer" – użytkownik chce WGRAĆ OFERTĘ / fakturę OD DOSTAWCY.
    Słowa: chcę wgrać ofertę, wgraj ofertę dostawcy, gazetka, cennik dostawcy (skan),
    wgraj fakturę od dostawcy.
    * brak wymaganych pól. Otwiera skaner w kontekście dostawców.

42. "upload_document" – użytkownik chce WGRAĆ DOKUMENT (faktura magazynowa — domyślnie).
    Słowa: chcę wgrać dokument, skanuj dokument, wgraj plik do systemu.
    * brak wymaganych pól.

43. "upload_menu" – WGRAJ / ZESKANUJ MENU RESTAURACJI (kartę dań) do zakładki Menu.
    Słowa: wgraj menu, zeskanuj menu, dodaj kartę dań, wgraj kartę menu, skanuj menu.
    NIGDY nie myl z upload_offer (oferta dostawcy) ani upload_invoice.
    * brak wymaganych pól. Otwiera skaner menu (nie katalog dostawcy).

35. "unknown" – jeśli intencja niejasna albo brak wystarczających danych.

ZASADY OGÓLNE:
- Zawsze zwracaj JEDEN top-level JSON zgodny ze schematem.
- WSZYSTKIE klucze payload MUSZĄ być obecne; nieużywane ustaw na null.
- Ceny/kwoty w PLN jako liczba dziesiętna (przecinek → kropka).
- unit z zestawu: "g","kg","ml","L","szt","opak","porcja".
- Zawsze wypełniaj pole `reason` (top-level) — krótkie polskie uzasadnienie DECYZJI KLASYFIKACJI (max 120 zn.).
- Jeżeli intencja to "waste"/"add_supplier_product" i próbujesz dopasować id z listy — użyj
  DOKŁADNIE tego id (UUID) z sekcji poniżej. Jeśli nie masz pewności → null.
- WAŻNE dla intencji edit_*/add_recipe_ingredient/order_product/supplier_*:
  NIE ustawiaj id — po prostu wypełnij pola z tekstu (dish_name, ingredient_name, item_name).
  Nawet zniekształcone przez Whisper nazwy (np. "pana kota") są OK — backend zrobi fuzzy match do bazy.

DOSTĘPNE DANIA (menu_items):
{d}

DOSTĘPNE SKŁADNIKI (inventory_items):
{i}

DOSTĘPNI DOSTAWCY (suppliers):
{s}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Voice CRUD Fuzzy Matching — próg 65 (permisywny dla błędów Whisper).
# ─────────────────────────────────────────────────────────────────────────────

VOICE_FUZZY_THRESHOLD = 65


def _resolve_by_fuzzy(query: Optional[str], rows: list[dict],
                      key: str = "name", threshold: int = VOICE_FUZZY_THRESHOLD
                      ) -> tuple[Optional[dict], float]:
    """Dopasowuje `query` (nazwa dyktowana głosem) do rekordów `rows` po polu `key`.
    Używa token_set_ratio + partial_ratio (fallback), by tolerować krótsze zapytania
    Whisper (np. "pana kota" ↔ "Panna cotta z owocami").
    Zwraca (rekord, score) lub (None, 0.0)."""
    if not query or not rows:
        return None, 0.0
    q = _norm_pl(query)
    if not q:
        return None, 0.0
    best_row: Optional[dict] = None
    best_score = 0.0
    for row in rows:
        cand = _norm_pl(row.get(key, "") or "")
        if not cand:
            continue
        # dwa scorery: bierzemy większy
        s1 = float(fuzz.token_set_ratio(q, cand))
        s2 = float(fuzz.partial_ratio(q, cand))
        s = max(s1, s2)
        if s > best_score:
            best_score = s
            best_row = row
    if best_score >= threshold:
        return best_row, best_score
    return None, best_score


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


# ─────────────────────────────────────────────────────────────────────────────
# Subskrypcje i Portfel Kredytowy (Quota & Tier Authorization Management)
# ─────────────────────────────────────────────────────────────────────────────

TIER_CONFIG = {
    0: {
        "name": "Free", "max_credits": 1000, "monthly_grant": 0, "price_pln": 0,
        "deal_hunter": False, "price_note": None,
        "perks": [
            "Reklamy w aplikacji (po zakończeniu trialu)",
            "Manualny magazyn, finanse i baza receptur, bez wsparcia automatyzacji",
            "100 kredytów AI na start + 30 dni trialu Premium "
            "(Łowca Okazji, dark UI — jak plan Profesjonalny)",
            "Po trialu: Free; pozostałe kredyty zostają na koncie",
        ],
    },
    1: {
        "name": "Podstawowy", "max_credits": 5000, "monthly_grant": 1000, "price_pln": 50,
        "deal_hunter": False, "price_note": "50 zł za miesiąc",
        "perks": [
            "100% bez reklam",
            "Odnawialny pakiet 1000 kredytów AI dodawany na konto co miesiąc",
            "Skanowanie, kategoryzacja i księgowanie faktur zakupowych przez AI",
            "„Skaner Menu z Wizją AI” – AI samo stworzy bazę potraw z roboczą "
            "propozycją składu i gramatury",
            "Pełne zarządzanie aplikacją poprzez sterowanie głosem",
            "Integracja z POS – system monitoruje sprzedaż, zużycie produktów, "
            "a nawet blokuje sprzedaż dań, jeśli braknie kluczowych składników produkcyjnych",
            "Bezobsługowy „Kreator Zamówień AI” – automatyczne wykrywanie braków "
            "magazynowych, generowanie gotowych wiadomości SMS/E-mail do twoich "
            "dostawców z treścią zamówienia",
        ],
    },
    2: {
        "name": "Profesjonalny", "max_credits": 20000, "monthly_grant": 2500, "price_pln": 100,
        "deal_hunter": True, "price_note": "100 zł za miesiąc",
        "perks": [
            "Wszystkie funkcje z pakietu Podstawowego (Skaner Faktur, Ofert, Menu, "
            "Sterowanie Głosem itp.)",
            "Odnawialny pakiet 2500 kredytów AI co miesiąc",
            "Inteligentny moduł „ŁOWCA OKAZJI” – automatyczne skanowanie i analiza "
            "ofert dostawców, i tworzenie najtańszych ofert zakupowych, podczas "
            "składania zamówień",
            "„Dynamiczny Asystent Zamiany” – przeliczanie gramatur potraw",
        ],
    },
}

STARTER_CREDITS = 100
TRIAL_DAYS = 30


def _trial_active(sub: dict) -> bool:
    """True gdy trial_ends_at > now — Free dostaje features Premium (tier 2) przez 30 dni."""
    from datetime import datetime, timezone
    end = _parse_dt(sub.get("trial_ends_at"))
    if not end:
        return False
    return datetime.now(timezone.utc) < end


def _premium_entitled(sub: dict) -> bool:
    """Płatny Profesjonalny (tier>=2) LUB aktywny 30-dniowy trial Premium."""
    return int(sub.get("tier_level") or 0) >= 2 or _trial_active(sub)


def _trial_ends_iso_from_now() -> str:
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone.utc) + timedelta(days=TRIAL_DAYS)).isoformat()


TOPUP_PACKAGES = {
    "small":  {"credits": 100,  "price_pln": 10, "label": "+100 kredytów"},
    "medium": {"credits": 500,  "price_pln": 30, "label": "+500 kredytów"},
    "large":  {"credits": 1000, "price_pln": 50, "label": "+1000 kredytów"},
}

FEATURE_CATALOG = [
    {"key": "voice",       "icon": "🎙️", "name": "Szybka komenda głosowa",           "cost": "~1-2 kredyty",    "requires_deal_hunter": False},
    {"key": "invoice",     "icon": "🧾", "name": "Skanowanie i księgowanie faktury",  "cost": "~15-20 kredytów", "requires_deal_hunter": False},
    {"key": "menu",        "icon": "🥗", "name": "Analiza karty menu i receptur",     "cost": "~25-30 kredytów", "requires_deal_hunter": False},
    {"key": "trend",       "icon": "📊", "name": "Analiza trendów AI",                "cost": "~5-10 kredytów",  "requires_deal_hunter": False},
    {"key": "deal_hunter", "icon": "🏷️", "name": "Łowca Okazji (porównywarka ofert)", "cost": "~3-8 kredytów",   "requires_deal_hunter": True},
]


def _parse_dt(val):
    from datetime import datetime, timezone
    if not val:
        return None
    s = str(val).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def _ensure_subscription(client: httpx.AsyncClient) -> dict:
    """Pobiera (lub tworzy) pojedynczy wiersz subskrypcji dla konta restauracji."""
    key = get_account_key()
    if not key or key == "default":
        # Nie twórz / nie czytaj shared demo wallet przy braku prawdziwego tenanta.
        return {
            "account_key": "default",
            "tier_level": 0,
            "credits_balance": 0,
            "status": "active",
            "current_period_end": None,
            "trial_ends_at": None,
            "free_starter_claimed": True,
        }
    rows = await sb_get(client, "subscriptions",
                        params={"select": "*", "account_key": f"eq.{key}", "limit": "1"})
    if rows:
        return rows[0]
    payload = {
        "account_key": key,
        "tier_level": 0,
        "credits_balance": STARTER_CREDITS,
        "status": "active",
        "current_period_end": None,
        "free_starter_claimed": True,
        # Free + 100 kr. + 30-dniowy trial Premium; po trial_ends_at → Free, kredyty zostają
        "trial_ends_at": _trial_ends_iso_from_now(),
    }
    created = await sb_post(client, "subscriptions", payload)
    if isinstance(created, list) and created:
        return created[0]
    return payload


def _apply_renewals(sub: dict):
    """Leniwe odnawianie: dolicza grant co 30 dni dla aktywnej subskrypcji tier>0.
    Dla anulowanej — po wygaśnięciu okresu degraduje do Free. Zwraca (sub, changes|None)."""
    from datetime import datetime, timezone, timedelta
    tier = int(sub.get("tier_level") or 0)
    status = sub.get("status") or "active"
    end = _parse_dt(sub.get("current_period_end"))
    if tier <= 0 or not end:
        return sub, None
    now = datetime.now(timezone.utc)
    if status == "canceled":
        if now >= end:
            changes = {"tier_level": 0, "current_period_end": None, "status": "expired"}
            return {**sub, **changes}, changes
        return sub, None
    grant = TIER_CONFIG.get(tier, {}).get("monthly_grant", 0)
    bal = int(sub.get("credits_balance") or 0)
    added = 0
    while now >= end and grant > 0:
        bal += grant
        added += grant
        end = end + timedelta(days=30)
    if added:
        changes = {"credits_balance": bal, "current_period_end": end.isoformat()}
        return {**sub, **changes}, changes
    return sub, None


async def _get_subscription(client: httpx.AsyncClient) -> dict:
    sub = await _ensure_subscription(client)
    sub2, changes = _apply_renewals(sub)
    if changes:
        try:
            await sb_patch(client, "subscriptions", {"account_key": f"eq.{get_account_key()}"}, changes)
        except Exception as e:  # noqa: BLE001
            logger.debug(f"renewal patch skipped: {e}")
    return sub2


async def _check_ai_access(client: httpx.AsyncClient, *, needs_credits: bool = True,
                           needs_deal_hunter: bool = False) -> dict:
    """Autoryzacja tieru przed operacją AI. Rzuca 403 gdy brak uprawnień/kredytów.
    Fail-open: jeśli tabela subscriptions nie istnieje jeszcze (brak migracji), nie blokuje."""
    try:
        sub = await _get_subscription(client)
    except httpx.HTTPStatusError as e:
        logger.warning(f"subscriptions niedostępne → autoryzacja pominięta: {e}")
        return {"tier_level": 2, "credits_balance": 10 ** 9, "status": "active"}
    # Łowca: płatny tier 2 LUB aktywny 30-dniowy trial Premium
    if needs_deal_hunter and not _premium_entitled(sub):
        raise HTTPException(
            status_code=403,
            detail="Moduł „Łowca Okazji” dostępny w planie Profesjonalnym (Tier 2) "
                   "lub podczas 30-dniowego trialu Premium. "
                   "Ulepsz subskrypcję w zakładce Subskrypcja.")
    bal = int(sub.get("credits_balance") or 0)
    if needs_credits and bal <= 0:
        raise HTTPException(
            status_code=403,
            detail=f"Brak kredytów AI (saldo: {bal}). Doładuj portfel w zakładce Subskrypcja, "
                   "aby korzystać z funkcji AI (operacje ręczne pozostają dostępne).")
    return sub


async def _guard_ai(*, needs_credits: bool = True, needs_deal_hunter: bool = False) -> dict:
    """Otwiera własnego klienta Supabase i weryfikuje dostęp (dla endpointów bez klienta)."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as c:
        return await _check_ai_access(c, needs_credits=needs_credits,
                                      needs_deal_hunter=needs_deal_hunter)


class InterpretRequest(BaseModel):
    text: str


@app.post("/api/voice/interpret", response_model=VoiceInterpretation)
async def interpret(payload: InterpretRequest):
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Brak tekstu wejściowego.")

    client = _openai()
    await _guard_ai()

    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
        try:
            dishes = await sb_get(httpx_c, "menu_items",
                                  params={"select": "id,name", "is_active": "eq.true", "limit": "300"})
        except Exception:
            dishes = []
        try:
            ingredients = await sb_get(httpx_c, "inventory_items",
                                       params={"select": "id,name,unit", "limit": "1000"})
        except Exception:
            ingredients = []
        try:
            suppliers = await sb_get(httpx_c, "suppliers",
                                     params={"select": "id,name", "limit": "200"})
        except Exception:
            suppliers = []

        system = _build_system_prompt(dishes, ingredients, suppliers)

        try:
            resp = await client.chat.completions.create(
                model=CHAT_MODEL,
                temperature=0.0,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": text},
                ],
                response_format={"type": "json_schema", "json_schema": _JSON_SCHEMA},
            )
        except APIError as e:
            raise HTTPException(status_code=502, detail=f"OpenAI chat: {e.message}") from e
        except OpenAIError as e:  # pragma: no cover
            raise HTTPException(status_code=502, detail=f"OpenAI: {e}") from e

        # Token billing (real usage from OpenAI).
        billing = await _bill_openai_response(
            httpx_c, resp,
            endpoint="/api/voice/interpret",
            model=CHAT_MODEL,
            extras={"transcript_preview": text[:120]},
        )

        raw = (resp.choices[0].message.content or "").strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=502, detail=f"Model zwrócił nie-JSON: {e}: {raw[:200]}") from e

        # Guard: „pokaż zyski z lipca 2025” ≠ compare; porównanie tylko przy wyraźnych słowach
        data = _guard_period_intent(text, data)
        # ── Fuzzy resolve nazw dla intencji CRUD/order/supplier (odporność na Whisper).
        pl = data.get("payload") or {}
        intent_val = data.get("intent")
        extras: dict = {}

        # ── Normalizacja: LLM czasami zwraca ingredients:[{ingredient_name,quantity,unit}]
        # dla add_recipe_ingredient/edit_recipe_ingredient_qty zamiast pól top-level.
        # Spłaszczamy — bierzemy pierwszy ingredient jako źródło danych.
        if intent_val in ("add_recipe_ingredient", "edit_recipe_ingredient_qty"):
            ings = pl.get("ingredients")
            if isinstance(ings, list) and ings and not (pl.get("ingredient_name") or "").strip():
                first = ings[0] or {}
                if isinstance(first, dict):
                    pl["ingredient_name"] = first.get("ingredient_name") or pl.get("ingredient_name")
                    if pl.get("quantity") in (None, 0):
                        pl["quantity"] = first.get("quantity")
                    if not (pl.get("unit") or "").strip():
                        pl["unit"] = first.get("unit") or pl.get("unit")

        def _remember_match(field: str, matched_to: str, score: float, resolved_id: str) -> None:
            extras.setdefault("fuzzy_matches", []).append({
                "field": field, "matched_to": matched_to,
                "score": round(score, 1), "resolved_id": resolved_id,
            })

        # dish_name → menu_items
        if intent_val in ("edit_menu_item_price", "add_recipe_ingredient", "edit_recipe_ingredient_qty",
                          "delete_menu_item", "toggle_menu_item_availability",
                          "edit_menu_item_category", "rename_menu_item", "scale_recipe"):
            q = pl.get("dish_name")
            row, score = _resolve_by_fuzzy(q, dishes)
            if row:
                pl["dish_id"] = row["id"]
                pl["dish_name_resolved"] = row["name"]
                _remember_match("dish_name", row["name"], score, row["id"])

        # item_name → inventory_items
        if intent_val in ("edit_inventory_item", "delete_inventory_item", "add_expiration_batch"):
            q = pl.get("item_name")
            row, score = _resolve_by_fuzzy(q, ingredients)
            if row:
                pl["inventory_id"] = row["id"]
                pl["item_name_resolved"] = row["name"]
                _remember_match("item_name", row["name"], score, row["id"])

        # ingredient_name → inventory_items (bez resolvowania id, ale zwracamy resolved name)
        if intent_val in ("add_recipe_ingredient", "edit_recipe_ingredient_qty"):
            q = pl.get("ingredient_name")
            row, score = _resolve_by_fuzzy(q, ingredients)
            if row:
                pl["ingredient_inventory_id"] = row["id"]
                pl["ingredient_name_resolved"] = row["name"]
                _remember_match("ingredient_name", row["name"], score, row["id"])

        # supplier_name / from_supplier / to_supplier → suppliers
        for f in ("supplier_name", "from_supplier", "to_supplier"):
            q = pl.get(f)
            if not q:
                continue
            row, score = _resolve_by_fuzzy(q, suppliers)
            if row:
                pl[f"{f}_id"] = row["id"]
                pl[f"{f}_resolved"] = row["name"]
                _remember_match(f, row["name"], score, row["id"])

        data["payload"] = pl
        if extras.get("fuzzy_matches"):
            reason = data.get("reason") or ""
            picks = "; ".join(m["matched_to"] for m in extras["fuzzy_matches"])
            data["reason"] = (reason + f" | Dopasowano: {picks}").strip(" |")
            # Attach as top-level flag for FE convenience
            data["fuzzy_matches"] = extras["fuzzy_matches"]

    try:
        fields = {k: v for k, v in data.items()
                  if k in ("intent", "confidence", "reason", "payload", "fuzzy_matches", "alternate_intents")}
        fields["credits_deducted"] = int(billing.get("credits_deducted") or 0)
        fields["credits_remaining"] = billing.get("credits_remaining")
        return VoiceInterpretation(**fields)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Schema mismatch: {e}") from e


# ─────────────────────────────────────────────────────────────────────────────
# BC route (used by pre-existing frontend flow) — thin adapter over new schema
# ─────────────────────────────────────────────────────────────────────────────

class WasteInterpretationLegacy(BaseModel):
    item_type: Literal["dish", "ingredient", "unknown"]
    related_id: Optional[str] = None
    item_name: str
    quantity: float
    unit: str
    reason: str
    confidence: float = 0.5
    notes: Optional[str] = None


@app.post("/api/voice/interpret-waste", response_model=WasteInterpretationLegacy)
async def interpret_waste_legacy(payload: InterpretRequest):
    resp = await interpret(payload)
    p = resp.payload
    if resp.intent != "waste":
        return WasteInterpretationLegacy(
            item_type="unknown", item_name=p.get("item_name") or "",
            quantity=float(p.get("quantity") or 0), unit=p.get("unit") or "",
            reason=p.get("reason_text") or "", confidence=resp.confidence,
            notes=resp.reason,
        )
    return WasteInterpretationLegacy(
        item_type=p.get("item_type") or "unknown",
        related_id=p.get("related_id"),
        item_name=p.get("item_name") or "",
        quantity=float(p.get("quantity") or 0),
        unit=p.get("unit") or "",
        reason=p.get("reason_text") or "",
        confidence=resp.confidence,
        notes=resp.reason,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3) Actions.apply — persist to Supabase according to intent
# ─────────────────────────────────────────────────────────────────────────────

def _to_base(qty: float, unit: str) -> tuple[float, str]:
    """Sprowadza do wspólnej bazy. Gęstość gastronomiczna 1 g == 1 ml, więc
    waga (g/kg) i objętość (ml/l) mają WSPÓLNĄ bazę 'g' — dzięki temu składnik
    receptury podany w ml odejmuje się/liczy z magazynu w g (i odwrotnie)."""
    u = (unit or "").lower().strip().rstrip(".")
    if u in ("kg", "kilogram"):
        return qty * 1000.0, "g"
    if u in ("g", "gram", "gramy"):
        return qty, "g"
    if u in ("l", "litr", "litry"):
        return qty * 1000.0, "g"   # 1 l = 1000 ml = 1000 g (płyny gastro)
    if u in ("ml", "mililitr"):
        return qty, "g"
    return qty, u


def _convert(qty: float, from_unit: str, to_unit: str) -> Optional[float]:
    a, ua = _to_base(qty, from_unit)
    b, ub = _to_base(1.0, to_unit)
    if ua != ub:
        return None
    return a / b


_PIECE_DEFAULT_SIZE = 200.0  # domyślnie 1 szt/opak ≈ 200 g/ml (produkty płynne/gastro)


def _norm_name(s: str) -> str:
    return " ".join((s or "").lower().split())


# Części produktu → cały produkt (magazyn/receptura kupuje całość, nie części).
_PART_TO_WHOLE: dict[str, str] = {
    # jajko
    "zoltko": "jajko", "zoltka": "jajko", "zoltek": "jajko",
    "zoltkajaja": "jajko", "zoltkojaja": "jajko", "zoltkojajka": "jajko",
    "zoltkajajka": "jajko", "zoltkojaj": "jajko", "zoltkajaj": "jajko",
    "bialko": "jajko", "bialka": "jajko",
    "bialkojaja": "jajko", "bialkojajka": "jajko", "bialkojaj": "jajko",
    "eggyolk": "jajko", "eggwhite": "jajko", "yolk": "jajko",
    "melanz": "jajko", "melanz jajeczny": "jajko",
    # cytrusy / owoce
    "skorka cytryny": "cytryna", "skorkacytryny": "cytryna",
    "sok z cytryny": "cytryna", "sokzcytryny": "cytryna", "sok cytrynowy": "cytryna",
    "skorka pomaranczy": "pomarańcza", "skorkapomaranczy": "pomarańcza",
    "sok z pomaranczy": "pomarańcza", "skorka limonki": "limonka",
    "sok z limonki": "limonka", "skorka limetki": "limonka",
    # warzywa / zioła
    "lisc pietruszki": "pietruszka", "natka pietruszki": "pietruszka",
    "korzen pietruszki": "pietruszka", "lisc selera": "seler",
    "zabek czosnku": "czosnek", "zabki czosnku": "czosnek",
    # mięso / inne
    "skorka kurczaka": "kurczak", "kosci kurczaka": "kurczak",
    "skorka indyka": "indyk", "miazsz awokado": "awokado",
}


def _strip_diacritics_pl(s: str) -> str:
    table = str.maketrans({
        "ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n",
        "ó": "o", "ś": "s", "ź": "z", "ż": "z",
    })
    return (s or "").lower().translate(table)


def _whole_product_name(name: str) -> str:
    """Mapuje część produktu (np. żółtko) na cały produkt magazynowy (jajko)."""
    raw = (name or "").strip()
    if not raw:
        return raw
    key = _strip_diacritics_pl(_norm_name(raw))
    key_compact = key.replace(" ", "")
    mapped = _PART_TO_WHOLE.get(key) or _PART_TO_WHOLE.get(key_compact)
    if mapped:
        return mapped
    # „żółtko jaja / żółtko z jajka / białko jajka” itp.
    if "zoltko" in key_compact or key_compact.startswith("bialkojaj") or (
        "bialko" in key_compact and "jaj" in key_compact
    ):
        return "jajko"
    if key_compact.startswith("skorkacytr") or key_compact.startswith("sokzcytr"):
        return "cytryna"
    if key_compact.startswith("skorkapomar") or key_compact.startswith("sokzpomar"):
        return "pomarańcza"
    return raw


# Plural / stem-ish → singular display (pomidory→pomidor). Used at recipe + inventory write.
_PLURAL_TO_SINGULAR: dict[str, str] = {
    "pomidory": "pomidor", "pomidorow": "pomidor", "pomidora": "pomidor",
    "jajka": "jajko", "jajek": "jajko", "jaja": "jajko",
    "ziemniaki": "ziemniak", "ziemniakow": "ziemniak",
    "marchewki": "marchew", "marchewek": "marchew",
    "ogorki": "ogórek", "ogorkow": "ogórek",
    "papryki": "papryka", "cukinie": "cukinia", "baklazany": "bakłażan",
    "pieczarki": "pieczarka", "pieczarek": "pieczarka",
    "grzyby": "grzyb", "grzybow": "grzyb",
    "borowiki": "borowik", "borowikow": "borowik",
    "boczniaki": "boczniak", "boczniakow": "boczniak",
    "cebule": "cebula", "cytryny": "cytryna", "limonki": "limonka",
    "jablka": "jabłko", "jablek": "jabłko", "banany": "banan", "bananow": "banan",
    "truskawki": "truskawka", "truskawek": "truskawka",
    "maliny": "malina", "orzechy": "orzech", "orzechow": "orzech",
    "migdaly": "migdał", "oliwki": "oliwka", "oliwek": "oliwka",
    "bulki": "bułka", "bulek": "bułka", "chleby": "chleb",
    "kielbasy": "kiełbasa", "kielbas": "kiełbasa",
    "boczki": "boczek", "filety": "filet", "piersi": "pierś",
    "steki": "stek", "kotlety": "kotlet", "kotletow": "kotlet",
    "krewetki": "krewetka", "krewetek": "krewetka",
}


# Dish-like names that must NOT become warehouse SKUs — rewrite to buyable ingredient.
_DISH_LIKE_TO_INGREDIENT: dict[str, str] = {
    "risotto": "ryż arborio",
    "risotto grzybowe": "ryż arborio",
    "risotto z grzybami": "ryż arborio",
    "paella": "ryż bomba",
    "couscous": "kuskus",
    "kuskus": "kuskus",
    "polenta": "kasza kukurydziana",
    "gnocchi": "gnocchi (półprodukt)",
    "nalesniki": "mąka pszenna",
    "naleśniki": "mąka pszenna",
}


def _normalize_ingredient_name(name: str) -> str:
    """Kanoniczna nazwa składnika: całe produkty + singular PL (pomidory→pomidor)."""
    raw = _whole_product_name((name or "").strip())
    if not raw:
        return raw
    key = _strip_diacritics_pl(_norm_name(raw))
    if key in _PLURAL_TO_SINGULAR:
        return _PLURAL_TO_SINGULAR[key]
    # Ostatni token liczby mnogiej (np. „pomidory cherry” → „pomidor cherry”)
    parts = key.split()
    if len(parts) >= 2 and parts[-1] in _PLURAL_TO_SINGULAR:
        last = _PLURAL_TO_SINGULAR[parts[-1]]
        orig_parts = raw.split()
        if orig_parts:
            orig_parts[-1] = last
            return " ".join(orig_parts)
    # Dish-like → buyable ingredient
    if key in _DISH_LIKE_TO_INGREDIENT:
        return _DISH_LIKE_TO_INGREDIENT[key]
    for dish_key, ing in _DISH_LIKE_TO_INGREDIENT.items():
        if key == dish_key or key.startswith(dish_key + " "):
            return ing
    return raw


def _apply_normalize_ingredient_names_to_dishes(dishes: list) -> None:
    """In-place: normalize ingredient names (singular + dish→SKU rewrite)."""
    for d in dishes or []:
        ings = getattr(d, "suggested_ingredients", None)
        if ings is None and isinstance(d, dict):
            ings = d.get("suggested_ingredients") or d.get("ingredients")
        if not ings:
            ings = getattr(d, "ingredients", None)
        if not ings:
            continue
        for ing in ings:
            if hasattr(ing, "name"):
                ing.name = _normalize_ingredient_name(getattr(ing, "name", "") or "")
            elif isinstance(ing, dict) and "name" in ing:
                ing["name"] = _normalize_ingredient_name(ing.get("name") or "")


def _is_combo_polprodukt_name(name: str) -> bool:
    """Wykrywa półprodukt combo (nie kupowany jako jeden SKU).

    Reguły (menu scan → magazyn):
    1. Mix / mieszanka / zestaw warzyw lub sałat bez jednego buyable SKU.
    2. Przetworzone/grillowane/pieczone/smażone mieszanki (np. „warzywa grillowane”).
    3. Domowe frytki / pieczone dodatki złożone z wielu składników.
    4. Nazwy z „mix”, „mixem”, „assorted”, „selection” + warzywa/mięsa.
    NIE oznacza: pojedynczego surowca (pomidor, boczek, ryż).
    """
    n = _strip_diacritics_pl(_norm_name(name or ""))
    if not n or len(n) < 4:
        return False
    # Jawne combo / półprodukt
    if any(k in n for k in (
        "polprodukt", "pol-produkt", "combo", "mise en place", "prep ",
    )):
        return True
    # Mix / mieszanka
    if any(k in n for k in ("mieszanka", "mix warzyw", "mix salat", "mix salat", "vegetable mix", "assorted")):
        return True
    if n.startswith("mix ") or " mix" in n:
        if any(k in n for k in ("warzyw", "salat", "mies", "grzyb", "owoc")):
            return True
    # Przetworzone mieszanki (grill / piecz / smaż) — typowo nie jeden SKU
    processed = any(k in n for k in (
        "grillowan", "pieczon", "smazo", "smazon", "duszone", "gotowane",
        "blanszowan", "marynowan", "glazurowan",
    ))
    multi = any(k in n for k in (
        "warzyw", "salat", "grzyb", "owoc", "mies", "dodatk", "zestaw",
    ))
    if processed and multi:
        return True
    # Klasyczne przykłady
    if n in (
        "warzywa grillowane", "warzywa pieczone", "warzywa duszone",
        "warzywa smażone", "warzywa smazone", "grilled vegetables",
        "pieczone warzywa", "grillowane warzywa", "smażone warzywa",
        "smazone warzywa", "mix sałat", "mix salat", "sałatka mieszana",
        "salatka mieszana",
    ):
        return True
    return False


# Propozycje składników combo (gdy wykryto półprodukt bez receptury).
_COMBO_DEFAULT_INGREDIENTS: dict[str, list[str]] = {
    "warzywa grillowane": ["cukinia", "papryka", "bakłażan", "olej rzepakowy"],
    "warzywa pieczone": ["cukinia", "papryka", "bakłażan", "olej rzepakowy"],
    "pieczone warzywa": ["cukinia", "papryka", "bakłażan", "olej rzepakowy"],
    "grillowane warzywa": ["cukinia", "papryka", "bakłażan", "olej rzepakowy"],
    "mix sałat": ["sałata rzymska", "rukola", "roszponka"],
    "mix salat": ["sałata rzymska", "rukola", "roszponka"],
}


def _combo_default_ingredients(name: str) -> list[str]:
    key = _strip_diacritics_pl(_norm_name(name or ""))
    if key in _COMBO_DEFAULT_INGREDIENTS:
        return list(_COMBO_DEFAULT_INGREDIENTS[key])
    for k, ings in _COMBO_DEFAULT_INGREDIENTS.items():
        if k in key or key in k:
            return list(ings)
    if "warzyw" in key and any(p in key for p in ("grill", "piecz", "smaz", "smaż")):
        return ["cukinia", "papryka", "bakłażan", "olej rzepakowy"]
    return []


def _apply_whole_product_names_to_dishes(dishes: list) -> None:
    """In-place: części → całe produkty + singular PL (pomidory→pomidor)."""
    _apply_normalize_ingredient_names_to_dishes(dishes)


def _is_porcja_row(name: str) -> bool:
    return _norm_name(name) in ("porcja", "porcje", "wielkosc porcji", "wielkość porcji",
                                "wielkosc porc) i", "gramatura", "gramatura porcji")

def _to_gml(qty: float, unit: str, unit_size: float) -> Optional[float]:
    """Zamiana na wspólną bazę g/ml (gęstość kulinarna 1:1). None dla nieznanej jednostki."""
    u = _norm_name(unit)
    if u == "kg":
        return qty * 1000.0
    if u in ("g", "gram", "gramy"):
        return qty
    if u in ("l", "litr", "litry"):
        return qty * 1000.0
    if u == "ml":
        return qty
    if _is_piece_unit(u):
        return qty * unit_size
    return None


def _from_gml(val: float, unit: str, unit_size: float) -> Optional[float]:
    u = _norm_name(unit)
    if u == "kg":
        return val / 1000.0
    if u in ("g", "gram", "gramy"):
        return val
    if u in ("l", "litr", "litry"):
        return val / 1000.0
    if u == "ml":
        return val
    if _is_piece_unit(u):
        return (val / unit_size) if unit_size else None
    return None


def _convert_culinary(qty: float, from_unit: str, to_unit: str,
                      unit_size: Optional[float] = None) -> Optional[float]:
    """Konwersja odporna dla g/kg/ml/l/szt/opak.
    - g↔ml: gęstość gastronomiczna 1:1 (śmietana, mleko, oleje, sosy).
    - szt/opak ↔ waga/objętość: przez `unit_size` (g/ml na 1 szt), domyślnie 200.
    Zwraca None tylko dla całkiem nieznanej jednostki (np. 'porcja')."""
    try:
        size = float(unit_size) if (unit_size and float(unit_size) > 0) else _PIECE_DEFAULT_SIZE
    except (TypeError, ValueError):
        size = _PIECE_DEFAULT_SIZE
    gml = _to_gml(qty, from_unit, size)
    if gml is None:
        return None
    return _from_gml(gml, to_unit, size)


# ── Spójność jednostek składników zwracanych przez AI ────────────────────────
# Bug: dla tego samego składnika (np. śmietana) AI raz zwracało g, raz ml,
# przez co przelicznik porcji się sypał. Poniżej sprowadzamy KAŻDY składnik o tej
# samej nazwie do JEDNEJ jednostki we WSZYSTKICH potrawach z danego skanu.
_LIQUID_NAME_HINTS = (
    "smietan", "śmietan", "mlek", "olej", "sos", "bulion", "wywar", "woda",
    "sok", "krem", "ocet", "syrop", "wino", "piwo", "śmieta", "majonez",
    "musztard", "ketchup", "passata", "przecier", "esencj", "napój", "napoj",
)


def _canon_dim(u: str) -> Optional[str]:
    """Wymiar jednostki: 'gml' dla g/kg/ml/l (przeliczalne 1:1), 'szt' dla sztuk."""
    x = (u or "").strip().lower().rstrip(".")
    if x in ("g", "gram", "gramy", "kg", "kilogram", "ml", "mililitr", "l", "litr", "litry"):
        return "gml"
    if x in ("szt", "sztuka", "sztuki", "opak", "op", "opakowanie",
             "plaster", "plasterek", "listek", "list", "zabek", "ząbek"):
        return "szt"
    return None


def _iter_ingredients(dish):
    """Zwraca listę składników potrawy niezależnie od modelu (scan/suggest/confirm)."""
    for attr in ("suggested_ingredients", "ingredients"):
        val = getattr(dish, attr, None)
        if val is not None:
            return val
    return []


def _normalize_recipe_quantity(qty, unit: str = "") -> int:
    """Ilości w recepturze: zawsze całkowite ≥ 1.
    Ułamki typu 0.25 g pieprzu/soli → minimum 1 (idealnie 1–2 na porcję)."""
    try:
        q = float(qty)
    except (TypeError, ValueError):
        return 1
    if q <= 0:
        return 1
    if q < 1:
        return 1
    return max(1, int(round(q)))


def _apply_integer_quantities_to_dishes(dishes: list) -> None:
    """In-place: quantity → int ≥ 1 dla suggest-recipe / confirm-scan.

    Null quantity (OCR bez gramatury) → 1, żeby AI/skan nigdy nie zapisał 0.
    """
    for d in dishes:
        for ing in _iter_ingredients(d):
            if isinstance(ing, dict):
                q = ing.get("quantity")
                ing["quantity"] = _normalize_recipe_quantity(
                    1 if q is None else q, ing.get("unit") or ""
                )
            else:
                q = getattr(ing, "quantity", None)
                setattr(
                    ing,
                    "quantity",
                    _normalize_recipe_quantity(
                        1 if q is None else q, getattr(ing, "unit", "") or ""
                    ),
                )


def _normalize_inspiration_quantities(recipe) -> None:
    """Inspiracje: base_quantity → całkowite; min. 1 jednostka na porcję."""
    portions = max(1, int(getattr(recipe, "default_portions", None) or 1))
    for sec in getattr(recipe, "ingredients_sections", None) or []:
        ings = getattr(sec, "ingredients", None) or []
        for ing in ings:
            try:
                base = float(getattr(ing, "base_quantity", 0) or 0)
            except (TypeError, ValueError):
                base = 0.0
            per = base / portions
            if per < 1:
                # mikroilości (sól/pieprz) → 1 na porcję
                setattr(ing, "base_quantity", float(portions))
            else:
                setattr(ing, "base_quantity", float(max(1, int(round(base)))))


def _canonicalize_ingredient_units(dishes: list) -> None:
    """In-place: ujednolica jednostkę każdego składnika w obrębie całego skanu.
    Wszystkie wystąpienia „śmietana” dostaną tę samą jednostkę (g LUB ml),
    a ilości zostaną przeliczone 1:1 (g↔ml) / 1000 (kg→g, l→ml)."""
    from collections import Counter
    votes: dict[str, Counter] = {}
    for d in dishes:
        for ing in _iter_ingredients(d):
            name = _norm_name(getattr(ing, "name", "") or "")
            unit = getattr(ing, "unit", "") or ""
            if not name or _canon_dim(unit) != "gml":
                continue
            u = unit.strip().lower().rstrip(".")
            base = "g" if u in ("g", "gram", "gramy", "kg", "kilogram") else "ml"
            votes.setdefault(name, Counter())[base] += 1

    canon: dict[str, str] = {}
    for name, ctr in votes.items():
        top = ctr.most_common()
        best = top[0][1]
        tied = [u for u, c in top if c == best]
        if len(tied) == 1:
            canon[name] = tied[0]
        else:
            canon[name] = "ml" if any(h in name for h in _LIQUID_NAME_HINTS) else "g"

    for d in dishes:
        for ing in _iter_ingredients(d):
            name = _norm_name(getattr(ing, "name", "") or "")
            if name not in canon:
                continue
            target = canon[name]
            cur = getattr(ing, "unit", "") or ""
            q = getattr(ing, "quantity", None)
            if q is not None and (cur or "").strip().lower().rstrip(".") != target:
                conv = _convert_culinary(float(q), cur, target)
                if conv is not None:
                    try:
                        ing.quantity = round(conv, 2)
                    except Exception:  # noqa: BLE001
                        pass
            ing.unit = target


        return None
    return _from_gml(gml, to_unit, size)


async def _apply_waste(client: httpx.AsyncClient, p: dict, transcript: Optional[str], source: str):
    warnings: list[str] = []
    deductions: list[dict] = []

    item_type = p.get("item_type") or "unknown"
    if item_type not in ("dish", "ingredient"):
        raise HTTPException(status_code=400, detail="Waste: item_type musi być 'dish' lub 'ingredient'.")

    log_payload = {
        "item_id": p.get("related_id") if item_type == "ingredient" else None,
        "item_name": p.get("item_name") or "",
        "quantity": p.get("quantity") or 0,
        "unit": p.get("unit") or "",
        "reason": p.get("reason_text") or "",
        "item_type": item_type,
        "related_id": p.get("related_id"),
        "source": source,
        "transcript": transcript,
    }
    try:
        log_rows = await sb_post(client, "waste_logs", log_payload)
    except httpx.HTTPStatusError as e:
        body = e.response.text or ""
        if any(k in body for k in ("item_type", "related_id", "source", "transcript")):
            warnings.append("Migracja SQL nie zastosowana — zapisano tylko podstawowe pola.")
            log_rows = await sb_post(client, "waste_logs", {
                "item_id": log_payload["item_id"], "item_name": log_payload["item_name"],
                "quantity": log_payload["quantity"], "unit": log_payload["unit"],
                "reason": log_payload["reason"],
            })
        else:
            raise HTTPException(status_code=502, detail=f"waste_logs insert: {body}") from e
    log_id = (log_rows[0] if isinstance(log_rows, list) else log_rows)["id"]

    related_id = p.get("related_id")
    qty = float(p.get("quantity") or 0)
    unit_in = p.get("unit") or ""
    if item_type == "ingredient" and related_id:
        rows: list = []
        try:
            rows = await sb_get(client, "inventory_items",
                                params={"select": "id,name,quantity,unit,unit_weight_volume",
                                        "id": f"eq.{related_id}"})
        except httpx.HTTPStatusError:
            try:
                rows = await sb_get(client, "inventory_items",
                                    params={"select": "id,name,quantity,unit", "id": f"eq.{related_id}"})
            except httpx.HTTPStatusError as e:
                warnings.append(f"Nie udało się pobrać produktu z magazynu "
                                f"(kod {e.response.status_code}) — magazyn niezmieniony.")
                rows = []
        if rows:
            inv = rows[0]
            conv = _convert_culinary(qty, unit_in, inv["unit"], inv.get("unit_weight_volume"))
            delta = conv if conv is not None else qty
            new_qty = max(0.0, float(inv.get("quantity") or 0) - float(delta))
            try:
                await sb_patch(client, "inventory_items", {"id": f"eq.{related_id}"}, {"quantity": new_qty})
                deductions.append({"inventory_id": inv["id"], "name": inv["name"],
                                   "deducted": round(float(delta), 4), "unit": inv["unit"],
                                   "new_quantity": round(new_qty, 4)})
            except Exception as e:  # noqa: BLE001
                warnings.append(f"Nie udało się zaktualizować stanu {inv['name']} ({str(e)[:60]}).")
        else:
            warnings.append(f"Zgłoszono stratę. Uwaga: Składnik [{p.get('item_name') or 'surowiec'}] "
                            "nie był wcześniej wprowadzony na magazyn – stan ustawiono na 0.")
    elif item_type == "dish" and related_id:
        try:
            recipe = await sb_get(client, "recipe_ingredients",
                                  params={"select": "ingredient_name,quantity,unit",
                                          "menu_item_id": f"eq.{related_id}"}) or []
        except httpx.HTTPStatusError as e:
            warnings.append(f"Nie udało się odczytać receptury (kod {e.response.status_code}) — "
                            "zapisano tylko log straty, magazyn niezmieniony.")
            recipe = []
        # Wielkość porcji (baza g/ml): z menu_items.portion_size_grams lub legacy wiersza "Porcja".
        portion_base: Optional[float] = None
        try:
            mi = await sb_get(client, "menu_items",
                              params={"select": "portion_size_grams", "id": f"eq.{related_id}", "limit": "1"})
            if mi and mi[0].get("portion_size_grams"):
                portion_base = float(mi[0]["portion_size_grams"])
        except httpx.HTTPStatusError:
            portion_base = None
        if portion_base is None:
            for r in recipe:
                if _is_porcja_row(r.get("ingredient_name")):
                    pv = _to_gml(float(r.get("quantity") or 0), r.get("unit") or "g", _PIECE_DEFAULT_SIZE)
                    if pv:
                        portion_base = pv
                    break
        # Liczba porcji na podstawie zgłoszonego ubytku (0.5 l zupy → 500 g → n porcji).
        wu = _norm_name(unit_in)
        if wu in ("", "szt", "szt.", "porcja", "porcje", "opak", "danie", "dania"):
            portions = qty
        else:
            waste_base = _to_gml(qty, unit_in, _PIECE_DEFAULT_SIZE)
            portions = (waste_base / portion_base) if (waste_base and portion_base) else qty
        if not portions or portions <= 0:
            portions = 1.0

        inv_all: list = []
        try:
            inv_all = await sb_get(client, "inventory_items",
                                   params={"select": "id,name,quantity,unit,unit_weight_volume",
                                           "limit": "1000"}) or []
        except httpx.HTTPStatusError:
            try:
                inv_all = await sb_get(client, "inventory_items",
                                       params={"select": "id,name,quantity,unit", "limit": "1000"}) or []
            except httpx.HTTPStatusError as e:
                warnings.append(f"Nie udało się pobrać magazynu (kod {e.response.status_code}) — "
                                "zapisano tylko log straty.")
                inv_all = []
        inv_map = {_norm_name(r["name"]): r for r in inv_all}
        for ing in recipe:
            iname = ing.get("ingredient_name") or ""
            if _is_porcja_row(iname):
                continue  # "Porcja" to parametr potrawy, nie składnik do odjęcia
            try:
                key = _norm_name(iname)
                inv = inv_map.get(key) or next(
                    (v for k, v in inv_map.items() if key and (key in k or k in key)), None)
                if not inv:
                    warnings.append(f"Zgłoszono stratę. Uwaga: Składnik [{iname}] nie był wcześniej "
                                    "wprowadzony na magazyn – stan ustawiono na 0.")
                    continue
                used = float(ing.get("quantity") or 0) * portions
                conv = _convert_culinary(used, ing.get("unit") or "g", inv["unit"],
                                         inv.get("unit_weight_volume"))
                if conv is None:
                    warnings.append(f"Pominięto {iname}: nieobsługiwana jednostka "
                                    f"{ing.get('unit')}→{inv['unit']}.")
                    continue
                new_qty = max(0.0, float(inv.get("quantity") or 0) - conv)
                await sb_patch(client, "inventory_items", {"id": f"eq.{inv['id']}"}, {"quantity": new_qty})
                deductions.append({"inventory_id": inv["id"], "name": inv["name"],
                                   "deducted": round(conv, 4), "unit": inv["unit"],
                                   "new_quantity": round(new_qty, 4)})
            except Exception as e:  # noqa: BLE001
                warnings.append(f"Zgłoszono stratę. Uwaga: składnik [{iname}] pominięto przy "
                                f"odejmowaniu ({str(e)[:60]}).")
                continue

    # POS Bottleneck Engine: przelicz dostępność dań po każdej zmianie stanu magazynu.
    if deductions:
        try:
            await _recompute_menu_availability(client, changed_inventory_ids={d["inventory_id"] for d in deductions})
        except Exception as e:
            logger.debug(f"_recompute_menu_availability skipped: {e}")

    return log_id, {"deductions": deductions}, warnings


async def _apply_revenue(client, p, transcript, source):
    desc = (p.get("description") or "").strip() or "Wpływ (dyktowane)"
    amt = float(p.get("amount_pln") or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Revenue: amount_pln musi być > 0.")
    row = await sb_post(client, "revenue_entries", {
        "year_month": _current_year_month(),
        "description": desc, "amount_pln": amt,
        "note": p.get("note") or transcript,
    })
    return row[0]["id"], {"description": desc, "amount_pln": amt}, []


async def _apply_fixed_cost(client, p, transcript, source):
    name = (p.get("cost_name") or p.get("description") or "").strip() or "Koszt stały"
    amt = float(p.get("amount_pln") or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Fixed cost: amount_pln musi być > 0.")
    typ = p.get("cost_type") or "other"
    if typ not in ("rent", "media", "payroll", "other"):
        typ = "other"
    row = await sb_post(client, "fixed_costs", {
        "year_month": _current_year_month(),
        "type": typ, "name": name, "amount_pln": amt,
        "note": p.get("note") or transcript,
    })
    return row[0]["id"], {"type": typ, "name": name, "amount_pln": amt}, []


async def _apply_variable_cost(client, p, transcript, source):
    name = (p.get("cost_name") or p.get("description") or "").strip() or "Koszt zmienny"
    amt = float(p.get("amount_pln") or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Variable cost: amount_pln musi być > 0.")
    typ = p.get("cost_type") or "other"
    if typ not in ("materials", "waste", "other"):
        typ = "other"
    row = await sb_post(client, "variable_cost_entries", {
        "year_month": _current_year_month(),
        "type": typ, "name": name, "amount_pln": amt,
        "note": p.get("note") or transcript,
    })
    return row[0]["id"], {"type": typ, "name": name, "amount_pln": amt}, []


async def _resolve_category_id(client, name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    rows = await sb_get(client, "inventory_categories",
                        params={"select": "id,name", "name": f"ilike.{name}", "limit": "1"})
    if rows:
        return rows[0]["id"]
    # create new
    new = await sb_post(client, "inventory_categories", {"name": name, "color": "#6B7280", "icon_name": "package"})
    return new[0]["id"]


async def _apply_expiration_batch(client, p, transcript, source):
    """Zapis partii z datą ważności (głos) → warehouse_inventory.

    TYLKO istniejące produkty w magazynie — nie tworzy nowych pozycji
    i nie zwiększa stanu (produkty dodaje się w Magazynie / fakturą / „dodaj produkt”).
    """
    warnings: list[str] = []
    name = (p.get("item_name") or p.get("product_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Brak nazwy produktu.")

    raw_batches = p.get("batches")
    if not isinstance(raw_batches, list) or not raw_batches:
        raw_batches = [{
            "quantity": p.get("quantity"),
            "expiration_date": p.get("expiration_date"),
        }]

    def _norm_date(edate: str) -> str:
        edate = str(edate or "").strip()
        m = re.match(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$", edate)
        if m:
            edate = f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", edate):
            raise HTTPException(
                status_code=400,
                detail=f"Podaj datę ważności z kalendarza (RRRR-MM-DD). Otrzymano: {edate or 'puste'}.",
            )
        return edate

    batches: list[dict] = []
    for b in raw_batches:
        qty = float(b.get("quantity") or 0)
        if qty <= 0:
            continue
        batches.append({
            "quantity": qty,
            "expiration_date": _norm_date(b.get("expiration_date")),
        })
    if not batches:
        raise HTTPException(status_code=400, detail="Dodaj co najmniej jedną partię (ilość > 0 + data).")

    unit = (p.get("unit") or "szt").strip() or "szt"
    alert_days = p.get("alert_days") or [7, 3, 1]
    if not isinstance(alert_days, list) or not alert_days:
        alert_days = [7, 3, 1]
    alert_days = [int(x) for x in alert_days]
    total_qty = sum(b["quantity"] for b in batches)

    inv_id = p.get("inventory_id") or p.get("related_id")
    inv_name = name
    if not inv_id:
        inv_all = await sb_get(client, "inventory_items", params={"select": "id,name,quantity,unit", "limit": "2000"}) or []
        best = None
        best_score = 0.0
        qn = _norm_pl(name)
        for row in inv_all:
            cand = _norm_pl(str(row.get("name") or ""))
            if not cand:
                continue
            score = max(float(fuzz.token_set_ratio(qn, cand)), float(fuzz.partial_ratio(qn, cand)))
            if score > best_score:
                best_score = score
                best = row
        if not best or best_score < FUZZY_MATCH_THRESHOLD:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Nie znaleziono „{name}” w magazynie. "
                    "Najpierw dodaj produkt w Magazynie, komendą „dodaj produkt” albo przez skan faktury."
                ),
            )
        inv_id = best["id"]
        inv_name = best.get("name") or name
        unit = (best.get("unit") or unit or "szt")
    else:
        try:
            rows = await sb_get(
                client, "inventory_items",
                params={"select": "id,name,quantity,unit", "id": f"eq.{inv_id}", "limit": "1"},
            ) or []
            if not rows:
                raise HTTPException(status_code=404, detail="Produkt nie istnieje w magazynie.")
            inv_name = rows[0].get("name") or name
            unit = rows[0].get("unit") or unit
        except HTTPException:
            raise
        except Exception:
            warnings.append("Nie udało się odczytać produktu — zapisuję partie dat.")

    saved_ids = []
    for b in batches:
        edate = b["expiration_date"]
        qty = b["quantity"]
        status = _expiry_status(edate)
        try:
            from datetime import date as _date
            exp = _date.fromisoformat(edate)
            if 0 <= (exp - _date.today()).days <= 7 and status == "fresh":
                status = "warning"
        except Exception:
            pass

        payload = {
            "inventory_item_id": inv_id,
            "product_name": inv_name,
            "quantity": qty,
            "unit": unit,
            "expiration_date": edate,
            "status": status,
            "alert_triggers": alert_days,
            "source": "voice",
        }
        try:
            row = await sb_post(client, "warehouse_inventory", payload)
        except httpx.HTTPStatusError as e:
            payload.pop("alert_triggers", None)
            try:
                row = await sb_post(client, "warehouse_inventory", payload)
                if "alert_triggers" not in "".join(warnings):
                    warnings.append("Kolumna alert_triggers niedostępna — uruchom migrację ADD_INVOICE_EXPIRY_BATCHES.")
            except httpx.HTTPStatusError as e2:
                raise HTTPException(
                    status_code=500,
                    detail=f"Nie zapisano partii (migracja warehouse_inventory?): {e2.response.text[:120]}",
                ) from e2
        batch_id = (row[0] if isinstance(row, list) else row).get("id")
        saved_ids.append(batch_id)

    return (saved_ids[0] if saved_ids else None), {
        "product_name": inv_name,
        "quantity": total_qty,
        "unit": unit,
        "batches": batches,
        "alert_days": alert_days,
        "increase_stock": False,
        "created_new": False,
        "batches_count": len(batches),
    }, warnings


async def _apply_inventory_item(client, p, transcript, source):
    warnings: list[str] = []
    name = (p.get("product_name") or p.get("item_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Inventory item: brak nazwy.")
    unit = p.get("unit") or "szt"
    qty = float(p.get("quantity") or 0)
    minq = float(p.get("min_quantity") or 0)
    buf = float(p.get("safety_buffer_percent") or 20)
    if buf < 10:
        buf = 10
    opt_raw = p.get("optimal_quantity")
    try:
        opt_q = float(opt_raw) if opt_raw is not None and str(opt_raw).strip() != "" else None
    except (TypeError, ValueError):
        opt_q = None
    cat_id = await _resolve_category_id(client, p.get("category_name"))
    payload = {
        "name": name, "category_id": cat_id,
        "quantity": qty, "unit": unit,
        "min_quantity": minq,
        "portion_size": p.get("portion_size"),
        "is_combo_polprodukt": bool(p.get("is_combo_polprodukt") or False),
        "unit_cost": p.get("unit_cost") or 0,
        "safety_buffer_percent": buf,
    }
    if opt_q is not None and opt_q > 0:
        payload["optimal_quantity"] = opt_q
    try:
        row = await sb_post(client, "inventory_items", payload)
    except httpx.HTTPStatusError as e:
        body = e.response.text or ""
        if "optimal_quantity" in body:
            warnings.append("Kolumna optimal_quantity nie istnieje — pomijam (uruchom migrację SQL).")
            payload.pop("optimal_quantity", None)
            try:
                row = await sb_post(client, "inventory_items", payload)
            except httpx.HTTPStatusError as e2:
                body = e2.response.text or ""
                if "safety_buffer_percent" in body:
                    warnings.append("Kolumna safety_buffer_percent nie istnieje — pomijam.")
                    payload.pop("safety_buffer_percent", None)
                    row = await sb_post(client, "inventory_items", payload)
                else:
                    raise HTTPException(status_code=502, detail=f"inventory_items insert: {body}") from e2
        elif "safety_buffer_percent" in body:
            warnings.append("Kolumna safety_buffer_percent nie istnieje — pomijam (uruchom migrację SQL).")
            payload.pop("safety_buffer_percent", None)
            row = await sb_post(client, "inventory_items", payload)
        else:
            raise HTTPException(status_code=502, detail=f"inventory_items insert: {body}") from e
    return row[0]["id"], {
        "name": name, "quantity": qty, "unit": unit,
        "min_quantity": minq, "optimal_quantity": opt_q,
    }, warnings


async def _apply_menu_item(client, p, transcript, source):
    warnings: list[str] = []
    name = (p.get("product_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Menu item: brak nazwy.")
    price = float(p.get("price_pln") or 0)
    if price <= 0:
        raise HTTPException(status_code=400, detail="Menu item: price_pln musi być > 0.")
    # Dedup: tylko aktywne dania (bez restore soft-deleted)
    try:
        existing = await sb_get(client, "menu_items", params={
            "select": "id,name,is_active,price_pln,category", "limit": "5000",
        }) or []
    except httpx.HTTPStatusError:
        existing = await sb_get(client, "menu_items", params={
            "select": "id,name,price_pln,category", "limit": "5000",
        }) or []
    active = [m for m in existing if m.get("is_active") is not False]
    hit, _score = _resolve_by_fuzzy(name, active, threshold=88)
    if hit:
        menu_id = hit["id"]
        warnings.append(f"Potrawa „{hit.get('name')}” już jest w menu — pominięto duplikat.")
        return menu_id, {"name": hit.get("name") or name, "price_pln": float(hit.get("price_pln") or price),
                         "ingredients_count": 0, "skipped_duplicate": True}, warnings

    menu_row = await sb_post(client, "menu_items", {
        "name": name, "category": p.get("menu_category") or "Inne",
        "price_pln": price, "is_active": True,
    })
    menu_id = menu_row[0]["id"]
    ingredients = p.get("ingredients") or []
    if isinstance(ingredients, list) and ingredients:
        rows = []
        for idx, ing in enumerate(ingredients):
            rows.append({
                "menu_item_id": menu_id,
                "ingredient_name": _whole_product_name(ing.get("ingredient_name") or ""),
                "quantity": float(ing.get("quantity") or 0),
                "unit": ing.get("unit") or "szt",
                "sort_order": idx + 1,
            })
        try:
            await sb_post(client, "recipe_ingredients", rows)
        except httpx.HTTPStatusError as e:
            warnings.append(f"Receptura nie została w pełni zapisana: {e.response.text}")
    return menu_id, {"name": name, "price_pln": price, "ingredients_count": len(ingredients)}, warnings

async def _apply_supplier(client, p, transcript, source):
    name = (p.get("supplier_name") or p.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Supplier: brak nazwy.")
    row = await sb_post(client, "suppliers", {
        "name": name,
        "contact_person": p.get("contact_person"),
        "phone": p.get("phone"),
        "email": p.get("email"),
        "category": p.get("supplier_category") or p.get("category") or "Inne",
        "nip": p.get("nip"),
        "notes": p.get("notes") or transcript,
        "icon_color": "#2563EB",
    })
    return row[0]["id"], {"name": name}, []


async def _apply_supplier_product(client, p, transcript, source):
    warnings: list[str] = []
    supplier_id = p.get("supplier_id")
    if not supplier_id and p.get("supplier_name"):
        rows = await sb_get(client, "suppliers",
                            params={"select": "id,name", "name": f"ilike.%{p['supplier_name']}%", "limit": "1"})
        if rows:
            supplier_id = rows[0]["id"]
        else:
            warnings.append(f"Nie znaleziono dostawcy '{p['supplier_name']}' — tworzę nowego.")
            new_sup = await sb_post(client, "suppliers", {
                "name": p["supplier_name"], "category": "Inne", "icon_color": "#2563EB",
            })
            supplier_id = new_sup[0]["id"]
    if not supplier_id:
        raise HTTPException(status_code=400, detail="Supplier product: brak supplier_id/supplier_name.")
    prod = (p.get("product_name") or "").strip()
    if not prod:
        raise HTTPException(status_code=400, detail="Supplier product: brak product_name.")
    price = float(p.get("price_pln") or 0)
    # `variant` ma w bazie ograniczenie NOT NULL — nigdy nie wysyłamy null.
    volume_label = p.get("volume_label")
    variant = p.get("variant") or volume_label or p.get("unit") or prod
    row = await sb_post(client, "supplier_catalog", {
        "supplier_id": supplier_id, "name": prod,
        "variant": variant,
        "volume_label": volume_label,
        "unit_count": p.get("unit_count") or 1,
        "price_pln": price,
    })
    return row[0]["id"], {"supplier_id": supplier_id, "product": prod, "price_pln": price}, warnings


@app.post("/api/actions/apply", response_model=ApplyResponse)
async def actions_apply(req: ApplyRequest):
    dispatch = {
        "waste": _apply_waste,
        "add_revenue": _apply_revenue,
        "add_fixed_cost": _apply_fixed_cost,
        "add_variable_cost": _apply_variable_cost,
        "add_inventory_item": _apply_inventory_item,
        "add_expiration_batch": _apply_expiration_batch,
        "add_menu_item": _apply_menu_item,
        "add_supplier": _apply_supplier,
        "add_supplier_product": _apply_supplier_product,
    }
    # Nowe intencje CRUD/supplier: delegowane do dedykowanych endpointów przez /voice/dispatch.
    voice_crud = {
        "edit_menu_item_price", "add_recipe_ingredient", "edit_recipe_ingredient_qty",
        "edit_inventory_item", "supplier_flip_order", "budget_cap_order",
        "compare_catalogs_top_savings", "predictive_weekend_restock", "check_minimum_order_value",
        "order_critical_items_by_category", "order_product",
        "bulk_delete_menu", "bulk_delete_suppliers", "bulk_reset_inventory",
        "bulk_delete_inventory", "restore_last_deleted_menu", "restore_deleted_inventory",
        "delete_menu_item", "delete_supplier", "delete_inventory_item",
        "toggle_menu_item_availability",
        "bulk_edit_menu_prices_percentage", "bulk_edit_menu_prices_fixed",
        "bulk_edit_inventory_buffers",
        "edit_menu_item_category", "rename_menu_item", "scale_recipe",
        "navigate_screen", "filter_ui_inventory", "filter_ui_menu_blocked",
        "summarize_custom_period", "compare_two_periods",
        "rank_menu_sales", "rank_inventory_usage",
        "rank_waste_cost", "rank_dead_menu", "list_expiring_soon",
        "rank_supplier_spend", "manager_core_alerts", "haccp_tip",
        "upload_invoice", "upload_offer", "upload_document", "upload_menu",
    }
    if req.intent in voice_crud:
        # Dołącz transcript do payload — resolve okresu (period_1 / hint) gdy AI nic nie wypełnił.
        payload = dict(req.payload or {})
        tr = (req.transcript or "").strip()
        if tr:
            payload.setdefault("_transcript", tr)
            if not payload.get("period_1") and not payload.get("note"):
                payload["period_1"] = tr
            elif payload.get("period_1") and tr and len(str(payload.get("period_1"))) < 8:
                # Krótki period_1 („lipiec”) — dorzuć pełną komendę (może mieć rok).
                if re.search(r"20\d{2}", tr) and not re.search(r"20\d{2}", str(payload.get("period_1"))):
                    payload["period_1"] = tr
        result = await voice_dispatch(VoiceDispatchRequest(intent=req.intent, payload=payload))
        rec_id = result.get("dish_id") or result.get("inventory_id") or None
        return ApplyResponse(intent=req.intent, ok=bool(result.get("ok", True)),
                             id=rec_id, detail=result.get("message") or result.get("action") or "OK",
                             extras=result, warnings=([result["message"]] if result.get("needs_migration") else []))
    if req.intent == "unknown" or req.intent not in dispatch:
        raise HTTPException(status_code=400, detail="Nieznana intencja — anuluj lub popraw ręcznie.")
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        try:
            rec_id, extras, warnings = await dispatch[req.intent](
                client, req.payload, req.transcript, req.source,
            )
        except HTTPException:
            raise
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Supabase: {e.response.text}") from e
    return ApplyResponse(intent=req.intent, ok=True, id=rec_id, detail="OK",
                         extras=extras or {}, warnings=warnings or [])


# ─────────────────────────────────────────────────────────────────────────────
# BC: /api/waste/apply — old shape, wraps new logic
# ─────────────────────────────────────────────────────────────────────────────

class ApplyWasteRequestLegacy(BaseModel):
    item_type: Literal["dish", "ingredient"]
    related_id: Optional[str] = None
    item_name: str
    quantity: float
    unit: str
    reason: str
    transcript: Optional[str] = None
    source: Literal["voice", "manual"] = "voice"


@app.post("/api/waste/apply")
async def apply_waste_legacy(req: ApplyWasteRequestLegacy):
    payload = {
        "item_type": req.item_type,
        "related_id": req.related_id,
        "item_name": req.item_name,
        "quantity": req.quantity,
        "unit": req.unit,
        "reason_text": req.reason,
    }
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        log_id, extras, warnings = await _apply_waste(client, payload, req.transcript, req.source)
    return {
        "waste_log_id": log_id,
        "deductions": extras.get("deductions", []),
        "warnings": warnings,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 4) Supplier catalog — AI Vision scan (GPT-4o) + confirm upsert
# ─────────────────────────────────────────────────────────────────────────────

class CatalogProduct(BaseModel):
    product_name: str
    price_netto: float = 0.0
    unit: str = "szt"
    volume_label: str = ""
    product_code: Optional[str] = None


class CatalogExtractionResponse(BaseModel):
    supplier_id: str
    supplier_name: Optional[str] = None
    product_count: int
    products: list[CatalogProduct]
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


class ConfirmCatalogRequest(BaseModel):
    products: list[CatalogProduct]


_CATALOG_JSON_SCHEMA = {
    "name": "SupplierCatalogExtraction",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["products"],
        "properties": {
            "products": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["product_name", "price_netto", "unit", "volume_label", "product_code"],
                    "properties": {
                        "product_name": {"type": "string"},
                        "price_netto": {"type": "number"},
                        "unit": {"type": "string"},
                        "volume_label": {"type": "string"},
                        "product_code": {"type": ["string", "null"]},
                    },
                },
            },
        },
    },
}

_CATALOG_SYSTEM_PROMPT = (
    "Jesteś ekspertem od digitalizacji cenników i ofert handlowych hurtowni "
    "gastronomicznych. Otrzymujesz zdjęcie(a) lub strony PDF cennika od dostawcy. "
    "Wyodrębnij WSZYSTKIE pozycje produktowe do tablicy `products`. Dla każdej pozycji:\n"
    "- product_name: pełna nazwa produktu (np. 'Mąka Tipo 00').\n"
    "- price_netto: cena NETTO za opakowanie jako liczba (przecinek zamień na kropkę, "
    "usuń symbol PLN/zł). Jeśli widoczna jest tylko cena brutto, przelicz na netto dla "
    "VAT 23% (brutto/1.23), ale preferuj kolumnę netto jeśli istnieje. Gdy brak ceny → 0.\n"
    "- unit: jednostka miary (np. 'kg', 'l', 'szt', 'opak').\n"
    "- volume_label: opis opakowania widoczny na cenniku (np. 'worek 5kg', 'butelka 1L', "
    "'karton 12szt'). Jeśli brak → pusty string.\n"
    "- product_code: kod artykułu / indeks z hurtowni jeśli widoczny (np. 'MK-500'), "
    "w przeciwnym razie null.\n"
    "Nie wymyślaj produktów, których nie ma na dokumencie. Zwróć wyłącznie poprawny JSON "
    "zgodny ze schematem."
)


def _images_from_upload(
    contents: bytes,
    mime: str,
    filename: str,
    *,
    max_pages: Optional[int] = None,
) -> tuple[list[str], dict[str, Any]]:
    """Render upload to base64 data-URIs for GPT-4o Vision.

    Returns ``(uris, meta)`` where meta contains:
    ``pages_total``, ``pages_rendered``, ``truncated``.

    PDFs: PyMuPDF JPEG ~108 dpi, up to ``PDF_MAX_PAGES`` (default 40).
    Short docs (etykiety) can pass a lower ``max_pages``.
    """
    limit = PDF_MAX_PAGES if max_pages is None else max(1, int(max_pages))
    name = (filename or "").lower()
    is_pdf = "pdf" in (mime or "").lower() or name.endswith(".pdf")
    if is_pdf:
        try:
            import fitz  # PyMuPDF
        except Exception as e:  # pragma: no cover
            raise HTTPException(status_code=500, detail=f"Brak biblioteki PDF: {e}") from e
        uris: list[str] = []
        try:
            doc = fitz.open(stream=contents, filetype="pdf")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Nie udało się otworzyć PDF: {e}") from e
        pages_total = int(doc.page_count or 0)
        zoom = fitz.Matrix(1.5, 1.5)
        for page in doc[:limit]:
            pix = page.get_pixmap(matrix=zoom)
            try:
                img_bytes = pix.tobytes("jpeg")
                uris.append("data:image/jpeg;base64," + base64.b64encode(img_bytes).decode())
            except Exception:
                png = pix.tobytes("png")
                uris.append("data:image/png;base64," + base64.b64encode(png).decode())
        doc.close()
        if not uris:
            raise HTTPException(status_code=400, detail="PDF nie zawiera stron.")
        meta = {
            "pages_total": pages_total,
            "pages_rendered": len(uris),
            "truncated": pages_total > len(uris),
        }
        return uris, meta
    # image
    img_mime = mime if (mime or "").startswith("image/") else "image/jpeg"
    return (
        [f"data:{img_mime};base64," + base64.b64encode(contents).decode()],
        {"pages_total": 1, "pages_rendered": 1, "truncated": False},
    )


def _page_surcharge_credits(pages_rendered: int) -> int:
    """Deprecated: billing jest wyłącznie z OpenAI usage (tokeny). Zawsze 0."""
    return 0


def _norm_product_key(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def _merge_supplier_meta_dicts(*parts: Any) -> dict:
    out: dict = {}
    for p in parts:
        if not isinstance(p, dict):
            continue
        for k, v in p.items():
            if v is None or v == "" or v == []:
                continue
            if out.get(k) in (None, "", []):
                out[k] = v
    return out


def _merge_document_vision_batches(parts: list[dict]) -> dict:
    """Scala wyniki Vision z kolejnych partii stron PDF."""
    if not parts:
        return {
            "document_type": "OFERTA_HANDLOWA",
            "supplier_name": None,
            "total_amount": 0,
            "supplier": {},
            "products": [],
        }
    types = [str(p.get("document_type") or "") for p in parts]
    if "FAKTURA_ZAKUPOWA" in types:
        doc_type = "FAKTURA_ZAKUPOWA"
    elif "MENU_RESTAURACYJNE" in types:
        doc_type = "MENU_RESTAURACYJNE"
    else:
        doc_type = types[0] or "OFERTA_HANDLOWA"

    supplier_name = None
    for p in parts:
        sn = (p.get("supplier_name") or "").strip() if isinstance(p.get("supplier_name"), str) else None
        if sn:
            supplier_name = sn
            break

    total_amount = 0.0
    for p in parts:
        try:
            total_amount = max(total_amount, float(p.get("total_amount") or 0))
        except (TypeError, ValueError):
            pass

    supplier = _merge_supplier_meta_dicts(*[p.get("supplier") for p in parts])

    products: list[dict] = []
    seen: set[str] = set()
    for p in parts:
        for row in p.get("products") or []:
            if not isinstance(row, dict):
                continue
            key = _norm_product_key(str(row.get("product_name") or ""))
            if not key or key in seen:
                continue
            seen.add(key)
            products.append(row)

    return {
        "document_type": doc_type,
        "supplier_name": supplier_name,
        "total_amount": total_amount,
        "supplier": supplier,
        "products": products,
    }


def _merge_catalog_vision_batches(parts: list[dict]) -> dict:
    products: list[dict] = []
    seen: set[str] = set()
    supplier_name = None
    for p in parts:
        if not supplier_name:
            sn = p.get("supplier_name")
            if isinstance(sn, str) and sn.strip():
                supplier_name = sn.strip()
        for row in p.get("products") or []:
            if not isinstance(row, dict):
                continue
            key = _norm_product_key(str(row.get("product_name") or ""))
            if not key or key in seen:
                continue
            seen.add(key)
            products.append(row)
    return {"supplier_name": supplier_name, "products": products}


def _merge_menu_vision_batches(parts: list[dict]) -> dict:
    dishes: list[dict] = []
    seen: set[str] = set()
    for p in parts:
        for row in p.get("dishes") or []:
            if not isinstance(row, dict):
                continue
            key = _norm_product_key(str(row.get("name") or row.get("product_name") or ""))
            if not key or key in seen:
                continue
            seen.add(key)
            dishes.append(row)
    return {"dishes": dishes}


def _merge_recipe_ocr_batches(parts: list[dict]) -> dict:
    chunks = []
    for p in parts:
        t = (p.get("text") or "").strip()
        if t:
            chunks.append(t)
    return {"text": "\n\n".join(chunks)}


async def _openai_vision_json_batches(
    client: Any,
    *,
    image_uris: list[str],
    system_prompt: str,
    json_schema: dict,
    endpoint: str,
    user_text: str,
    cont_text: Optional[str] = None,
    batch_size: Optional[int] = None,
    pages_meta: Optional[dict] = None,
    merge_fn: Any = None,
) -> tuple[dict, dict]:
    """Wywołuje Vision w partiach stron; zwraca (merged_json, billing)."""
    if not image_uris:
        raise HTTPException(status_code=400, detail="Brak stron dokumentu do analizy.")

    bs = max(1, int(batch_size or PDF_VISION_BATCH_SIZE))
    batches = [image_uris[i : i + bs] for i in range(0, len(image_uris), bs)]
    n = len(batches)
    parsed_parts: list[dict] = []
    billing_events: list[dict] = []
    pages_rendered = int((pages_meta or {}).get("pages_rendered") or len(image_uris))

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as httpx_c:
        for bi, batch in enumerate(batches):
            start_page = bi * bs + 1
            end_page = bi * bs + len(batch)
            if bi == 0:
                text = user_text
            else:
                text = cont_text or (
                    f"To KONTYNUACJA tego samego dokumentu — partia {bi + 1}/{n} "
                    f"(strony {start_page}–{end_page} z {pages_rendered}). "
                    "Zachowaj ten sam typ dokumentu. Wyodrębnij pozycje widoczne na TYCH stronach. "
                    "Uzupełnij dane dostawcy / kwoty tylko jeśli widać je na tych stronach."
                )
                if n > 1:
                    text = (
                        f"Partia {bi + 1}/{n}, strony {start_page}–{end_page} z {pages_rendered}. "
                        + text
                    )

            user_content: list[dict] = [{"type": "text", "text": text}]
            for uri in batch:
                user_content.append({"type": "image_url", "image_url": {"url": uri}})

            try:
                resp = await client.chat.completions.create(
                    model=VISION_MODEL,
                    temperature=0.0,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    response_format={"type": "json_schema", "json_schema": json_schema},
                )
            except APIError as e:
                raise HTTPException(status_code=502, detail=f"OpenAI Vision: {e.message}") from e
            except OpenAIError as e:  # pragma: no cover
                raise HTTPException(status_code=502, detail=f"OpenAI: {e}") from e

            raw = (resp.choices[0].message.content or "").strip()
            try:
                part = json.loads(raw)
            except json.JSONDecodeError as e:
                raise HTTPException(
                    status_code=502,
                    detail=f"Model zwrócił nie-JSON (partia {bi + 1}/{n}): {e}: {raw[:200]}",
                ) from e
            if isinstance(part, dict):
                parsed_parts.append(part)

            # Kredyty = wyłącznie tokeny z resp.usage (to, co OpenAI faktycznie pobiera).
            usage = getattr(resp, "usage", None)
            pt, ct, cached, audio = tokens_from_usage(usage) if usage is not None else (0, 0, 0, 0.0)
            billing_events.append(
                await _bill_openai_response(
                    httpx_c,
                    resp,
                    endpoint=endpoint,
                    model=VISION_MODEL,
                    extra_credits=0,
                    extras={
                        "vision_batch": bi + 1,
                        "vision_batches": n,
                        "pages_in_batch": len(batch),
                        "pages_rendered": pages_rendered,
                        "page_from": start_page,
                        "page_to": end_page,
                        "prompt_tokens": pt,
                        "completion_tokens": ct,
                        "cached_tokens": cached,
                    },
                )
            )

    merge = merge_fn or (lambda parts: parts[0] if parts else {})
    merged = merge(parsed_parts) if parsed_parts else {}
    if not isinstance(merged, dict):
        merged = {}
    billing = merge_billing_events(billing_events)
    return merged, billing


@app.post("/api/suppliers/{supplier_id}/upload-catalog", response_model=CatalogExtractionResponse)
async def upload_catalog(supplier_id: str, file: UploadFile = File(...)):
    """Skanuje cennik (obraz lub PDF) GPT-4o Vision i zwraca podgląd produktów.
    Zapis do bazy następuje dopiero po zatwierdzeniu (confirm-catalog)."""
    client = _openai()
    await _guard_ai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    # verify supplier exists + get name
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
        rows = await sb_get(httpx_c, "suppliers",
                            params={"select": "id,name", "id": f"eq.{supplier_id}", "limit": "1"})
    if not rows:
        raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")
    supplier_name = rows[0]["name"]

    image_uris, pages_meta = _images_from_upload(contents, file.content_type or "", file.filename or "")
    contents = b""

    data, billing = await _openai_vision_json_batches(
        client,
        image_uris=image_uris,
        system_prompt=_CATALOG_SYSTEM_PROMPT,
        json_schema=_CATALOG_JSON_SCHEMA,
        endpoint=f"/api/suppliers/{supplier_id}/upload-catalog",
        user_text=(
            "Oto cennik/oferta dostawcy. Wyodrębnij wszystkie produkty z tych stron. "
            f"(Dokument ma {pages_meta.get('pages_total')} stron; "
            f"analizuję {pages_meta.get('pages_rendered')}.)"
        ),
        pages_meta=pages_meta,
        merge_fn=_merge_catalog_vision_batches,
    )
    image_uris = []

    products = [CatalogProduct(**p) for p in (data.get("products") or [])]
    return CatalogExtractionResponse(
        supplier_id=supplier_id,
        supplier_name=data.get("supplier_name") or supplier_name,
        product_count=len(products),
        products=products,
        credits_deducted=int(billing.get("credits_deducted") or 0),
        credits_remaining=billing.get("credits_remaining"),
    )


_catalog_extra_cols: Optional[bool] = None


async def _has_catalog_extra_cols(client: httpx.AsyncClient) -> bool:
    """True jeśli supplier_catalog ma kolumny `unit` i `product_code`.
    Cache'ujemy tylko wynik pozytywny — dzięki temu po dodaniu kolumn (SQL) backend
    automatycznie zacznie ich używać bez restartu."""
    global _catalog_extra_cols
    if _catalog_extra_cols:
        return True
    try:
        await sb_get(client, "supplier_catalog", params={"select": "unit,product_code", "limit": "1"})
        _catalog_extra_cols = True
    except Exception:
        _catalog_extra_cols = False
        logger.warning("supplier_catalog: brak kolumn unit/product_code — zapisuję w trybie zgodności.")
    return bool(_catalog_extra_cols)


def _norm(s: str) -> str:
    return " ".join((s or "").lower().split())


# ─────────────────────────────────────────────────────────────────────────────
# Fuzzy matching (produkty z gazetek ↔ magazyn + składniki receptur)
# ─────────────────────────────────────────────────────────────────────────────

# Próg podobieństwa dla rapidfuzz (0-100). 80 = permisywny, jak wybrał użytkownik.
FUZZY_MATCH_THRESHOLD = 68

# Regex do wycinania jednostek/liczb: "1kg", "500 g", "200ml", "2 szt", "1,5l", "1.5 l"
_UNIT_RE = re.compile(
    r"\b\d+[.,]?\d*\s*"
    r"(?:kg|g|mg|dag|l|ml|cl|dl|szt\.?|opak\.?|op\.?|kartonow?y?|karton|"
    r"sztuk[a-zi]*|opakowa[a-z]*)\b",
    re.IGNORECASE,
)
# Pojedyncze cyfry/liczby, myślniki, przecinki, kropki, znaki specjalne.
_NOISE_RE = re.compile(r"[^a-z0-9\s]")


def _strip_accents(text: str) -> str:
    """Usuwa polskie znaki diakrytyczne: ą→a, ć→c, ł→l, ó→o itd."""
    if not text:
        return ""
    # Uwaga: 'ł' nie rozkłada się przez NFKD → obsłużyć osobno.
    text = text.replace("ł", "l").replace("Ł", "L")
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


_TOKEN_SYNONYMS = {
    "filet": "piers", "filety": "piers", "filetem": "piers", "filetu": "piers",
    "piersi": "piers", "piersiami": "piers", "piers": "piers",
    "kurczaka": "kurczak", "kurczakiem": "kurczak", "kurczaki": "kurczak",
    "kurczakowi": "kurczak", "drobiowy": "kurczak", "drobiowa": "kurczak", "drobiowe": "kurczak",
    "indyka": "indyk", "indykiem": "indyk",
    "wolowego": "wolow", "wolowa": "wolow", "wolowy": "wolow", "wolowe": "wolow",
    "wolowina": "wolow", "wolowiny": "wolow",
    "wieprzowego": "wieprz", "wieprzowa": "wieprz", "wieprzowy": "wieprz", "wieprzowina": "wieprz",
    "oliwek": "oliw", "oliwa": "oliw", "oliwy": "oliw", "oliwie": "oliw", "olive": "oliw",
    "cukru": "cukier", "cukrem": "cukier",
    "soli": "sol", "sola": "sol",
    "pieprzu": "pieprz",
    "czosnku": "czosnek", "czosnkiem": "czosnek",
    "cebuli": "cebula",
    "pomidorow": "pomidor", "pomidory": "pomidor", "pomidora": "pomidor",
    "ziemniakow": "ziemniak", "ziemniaki": "ziemniak",
    "majonezu": "majonez", "musztardy": "musztarda",
    "smietany": "smietana", "mleka": "mleko",
    "masla": "maslo", "maslem": "maslo",
    "sera": "ser", "serem": "ser",
    "jajka": "jajko", "jajek": "jajko", "jaja": "jajko",
}


def _canon_token(t: str) -> str:
    """Lekki stem + synonimy kulinarne (filet↔pierś, kurczaka→kurczak)."""
    if t in _TOKEN_SYNONYMS:
        return _TOKEN_SYNONYMS[t]
    for suf in ("ami", "ach", "owi", "iem", "ow", "om", "em", "ie"):
        if len(t) > len(suf) + 3 and t.endswith(suf):
            stem = t[: -len(suf)]
            return _TOKEN_SYNONYMS.get(stem, stem)
    if len(t) >= 6 and t[-1] in "ayiue":
        stem = t[:-1]
        return _TOKEN_SYNONYMS.get(stem, stem)
    return t


def _norm_pl(text: str) -> str:
    """Pełna normalizacja PL dla fuzzy matchingu:
    - lower + usunięcie diakrytyków
    - usunięcie jednostek/miar (1kg, 500g, 200ml, 2 szt...)
    - usunięcie znaków niealfanum.
    - synonimy/stem (filet↔pierś, kurczaka→kurczak)
    - tokenizacja + posortowany join (kolejność słów nie ma znaczenia).
    - usunięcie marek/dostawców (Sokołów, …) by nie blokować matchingu.
    """
    if not text:
        return ""
    s = _strip_accents(str(text)).lower()
    s = _UNIT_RE.sub(" ", s)
    s = _NOISE_RE.sub(" ", s)
    tokens = [t for t in s.split() if len(t) >= 2]
    # Usuwamy typowe słowa-śmieci (przyimki), które nie niosą znaczenia
    stop = {"do", "od", "na", "za", "ze", "we", "po", "pod", "nad", "przy",
            "bez", "dla", "oraz", "lub", "albo", "a", "i", "z", "w"}
    # Marki / szum e-commerce — „Sokołów Schab” ↔ magazyn „Schab”
    brands = {
        "sokolow", "sokolów", "animex", "morliny", "berlinki", "henkel",
        "premium", "bio", "eko", "organic", "light", "classic", "extra",
        "select", "selection", "gourmet", "fresh", "swieze", "swiezy",
        "opak", "opakowanie", "promocja", "virgin", "extra",
        # Formy opakowania / porcji — „ser kozi” ↔ „ser kozi rolka”
        "rolka", "rolki", "rolke", "kostka", "kostki", "blok", "bloki",
        "plastry", "plaster", "krazek", "krazki", "kreg", "kregi",
        "tacka", "tacki", "luz", "luzem", "porcja", "porcje", "paczka",
        "paczk", "szt", "sztuka", "sztuki",
    }
    tokens = [
        _canon_token(t) for t in tokens
        if t not in stop and t not in brands
    ]
    tokens = [t for t in tokens if len(t) >= 2 and t not in stop]
    return " ".join(sorted(set(tokens)))


def _fuzzy_match(query: str, choices: list[str], threshold: int = FUZZY_MATCH_THRESHOLD
                 ) -> tuple[Optional[str], float]:
    """Zwraca (najlepsze_dopasowanie_znormalizowane, score) lub (None, score),
    jeśli poniżej progu. `choices` już znormalizowane przez `_norm_pl`."""
    if not query or not choices:
        return None, 0.0
    # token_set_ratio dobrze radzi sobie z "filet z kurczaka" ↔ "kurczak filet"
    # i różnymi kolejnościami słów.
    best = rf_process.extractOne(
        query, choices, scorer=fuzz.token_set_ratio, score_cutoff=threshold
    )
    if best is None:
        # Spróbujmy jeszcze "partial ratio" jako fallback (np. "filet drobiowy"
        # w bazie recept: "filet z indyka" — częściowe pokrycie).
        best2 = rf_process.extractOne(
            query, choices, scorer=fuzz.partial_ratio, score_cutoff=max(threshold - 5, 62)
        )
        if best2 is None:
            return None, 0.0
        return best2[0], float(best2[1])
    return best[0], float(best[1])


_inv_synonyms_col: Optional[bool] = None


async def _has_inventory_synonyms(client: httpx.AsyncClient) -> bool:
    """True jeśli inventory_items ma kolumnę `synonyms` (JSONB/lista tekstów)."""
    global _inv_synonyms_col
    if _inv_synonyms_col is not None:
        return _inv_synonyms_col
    try:
        await sb_get(client, "inventory_items", params={"select": "synonyms", "limit": "1"})
        _inv_synonyms_col = True
    except Exception:
        _inv_synonyms_col = False
    return _inv_synonyms_col


async def _load_matchable_terms(client: httpx.AsyncClient) -> dict:
    """Ładuje wszystkie normalized-terms z magazynu + składników aktywnych receptur.

    Zwraca:
        {
          "inv_terms": {norm_key: original_name, ...},
          "recipe_terms": {norm_key: original_name, ...},
        }
    Uwaga: recipe_terms zawiera tylko składniki potraw, które są `is_active=true`
    w `menu_items` (jeśli tabela ma tę kolumnę; w przeciwnym razie — wszystkie).
    """
    inv_terms: dict[str, str] = {}
    recipe_terms: dict[str, str] = {}

    # 1) Magazyn (name + opcjonalnie synonyms)
    has_syn = await _has_inventory_synonyms(client)
    select = "id,name,synonyms" if has_syn else "id,name"
    try:
        inv_rows = await sb_get(client, "inventory_items",
                                params={"select": select, "limit": "5000"}) or []
    except Exception as e:
        logger.warning(f"_load_matchable_terms: inventory_items load failed: {e}")
        inv_rows = []
    for r in inv_rows:
        name = (r.get("name") or "").strip()
        if name:
            k = _norm_pl(name)
            if k:
                inv_terms.setdefault(k, name)
        if has_syn:
            syns = r.get("synonyms") or []
            if isinstance(syns, str):
                # Czasami zapisane jako CSV
                syns = [s for s in re.split(r"[,;|]", syns) if s.strip()]
            for s in syns or []:
                s = (str(s) or "").strip()
                if not s:
                    continue
                k = _norm_pl(s)
                if k:
                    inv_terms.setdefault(k, name)

    # 2) Składniki aktywnych receptur
    # Najpierw pobierz aktywne dania (jeśli kolumna is_active istnieje).
    active_ids: Optional[set[str]] = None
    try:
        menu_rows = await sb_get(client, "menu_items",
                                 params={"select": "id", "is_active": "eq.true", "limit": "5000"})
        active_ids = {r["id"] for r in (menu_rows or [])}
    except Exception:
        # Kolumna is_active może nie istnieć — bierzemy wtedy wszystkie potrawy
        active_ids = None

    try:
        # Uwaga: recipe_ingredients ma pole ingredient_name (patrz kod _process_dish/_deduct)
        ri = await sb_get(client, "recipe_ingredients",
                          params={"select": "ingredient_name,menu_item_id", "limit": "20000"}) or []
    except Exception as e:
        logger.warning(f"_load_matchable_terms: recipe_ingredients load failed: {e}")
        ri = []

    for r in ri:
        if active_ids is not None and r.get("menu_item_id") not in active_ids:
            continue
        name = (r.get("ingredient_name") or "").strip()
        if not name:
            continue
        k = _norm_pl(name)
        if k:
            recipe_terms.setdefault(k, name)

    return {"inv_terms": inv_terms, "recipe_terms": recipe_terms}


_PIECE_UNITS = {"szt", "szt.", "sztuka", "sztuki", "op", "op.", "opak", "opakowanie"}


def _is_piece_unit(u: str) -> bool:
    x = (u or "").strip().lower()
    return x in _PIECE_UNITS or x.startswith("szt") or x.startswith("op")


def _yield_available(stock_qty: float, stock_unit: str,
                     uwv: Optional[float], wvu: Optional[str],
                     recipe_unit: str) -> tuple[Optional[float], bool]:
    """Ile surowca (w jednostce receptury) mamy w magazynie.

    - Jeśli jednostki są przeliczalne wprost (g↔kg, ml↔l) → standardowa konwersja.
    - Jeśli magazyn jest w 'szt.'/'op.', a receptura w g/ml → najpierw
      stan * unit_weight_volume (waga/objętość 1 szt.), potem konwersja do jednostki receptury.
    Zwraca (dostępna_ilość_w_jednostce_receptury | None, convertible)."""
    direct = _convert(stock_qty, stock_unit, recipe_unit)
    if direct is not None:
        return direct, True
    if _is_piece_unit(stock_unit) and uwv and wvu:
        total_wv = float(stock_qty) * float(uwv)  # w g lub ml
        conv = _convert(total_wv, wvu, recipe_unit)
        if conv is not None:
            return conv, True
    return None, False


@app.post("/api/suppliers/{supplier_id}/confirm-catalog")
async def confirm_catalog(supplier_id: str, req: ConfirmCatalogRequest):
    """Zapisuje zatwierdzone produkty do supplier_catalog.
    Jeśli produkt (po nazwie) już istnieje u dostawcy → aktualizuje cenę netto."""
    if not req.products:
        raise HTTPException(status_code=400, detail="Brak produktów do zapisania.")

    inserted = 0
    updated = 0
    warnings: list[str] = []

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        sup = await sb_get(client, "suppliers", params={"select": "id", "id": f"eq.{supplier_id}", "limit": "1"})
        if not sup:
            raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")

        has_extra = await _has_catalog_extra_cols(client)

        existing = await sb_get(client, "supplier_catalog",
                                params={"select": "id,name,sort_order", "supplier_id": f"eq.{supplier_id}"})
        by_name = {_norm(r["name"]): r for r in (existing or [])}
        max_sort = max((int(r.get("sort_order") or 0) for r in (existing or [])), default=0)

        for prod in req.products:
            name = (prod.product_name or "").strip()
            if not name:
                continue
            price = float(prod.price_netto or 0)
            volume_label = (prod.volume_label or "").strip()
            unit = (prod.unit or "szt").strip()
            variant = volume_label or unit or name

            payload: dict = {
                "supplier_id": supplier_id,
                "name": name,
                "variant": variant,
                "volume_label": volume_label,
                "price_pln": price,
                "unit_count": 1,
                "liters_total": 0,
            }
            if has_extra:
                payload["unit"] = unit
                payload["product_code"] = (prod.product_code or None)

            match = by_name.get(_norm(name))
            try:
                if match:
                    update_payload = {"price_pln": price, "variant": variant, "volume_label": volume_label}
                    if has_extra:
                        update_payload["unit"] = unit
                        update_payload["product_code"] = (prod.product_code or None)
                    await sb_patch(client, "supplier_catalog", {"id": f"eq.{match['id']}"}, update_payload)
                    updated += 1
                else:
                    max_sort += 1
                    payload["sort_order"] = max_sort
                    row = await sb_post(client, "supplier_catalog", payload)
                    if row:
                        by_name[_norm(name)] = (row[0] if isinstance(row, list) else row)
                    inserted += 1
            except httpx.HTTPStatusError as e:
                warnings.append(f"{name}: {e.response.text[:120]}")

    return {
        "ok": True,
        "inserted": inserted,
        "updated": updated,
        "saved": inserted + updated,
        "warnings": warnings,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 4b) Uniwersalny procesor dokumentów — faktura (ścieżka 1) vs oferta (ścieżka 2)
#     Plik przetwarzany WYŁĄCZNIE w RAM, natychmiast niszczony. Zero zapisu na dysk.
# ─────────────────────────────────────────────────────────────────────────────

DOCUMENT_CATEGORIES = [
    "Mięso i wędliny", "Ryby i owoce morza", "Nabiał", "Warzywa i owoce", "Pieczywo",
    "Suchy magazyn", "Oleje i tłuszcze", "Przyprawy", "Mrożonki", "Napoje", "Alkohole",
    "Wywary i sosy", "Chemia i czystość", "Opakowania", "Inne",
]

_DOCUMENT_JSON_SCHEMA = {
    "name": "DocumentExtraction",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["document_type", "supplier_name", "total_amount", "supplier", "products"],
        "properties": {
            "document_type": {"type": "string", "enum": ["FAKTURA_ZAKUPOWA", "OFERTA_HANDLOWA", "MENU_RESTAURACYJNE"]},
            "supplier_name": {"type": ["string", "null"]},
            "total_amount": {"type": "number"},
            "supplier": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "nip", "phone", "email", "contact_person", "address",
                    "payment_terms", "shipping_cost", "min_order_value",
                    "free_shipping_threshold", "lead_time_days",
                ],
                "properties": {
                    "nip": {"type": ["string", "null"]},
                    "phone": {"type": ["string", "null"]},
                    "email": {"type": ["string", "null"]},
                    "contact_person": {"type": ["string", "null"]},
                    "address": {"type": ["string", "null"]},
                    "payment_terms": {"type": ["string", "null"]},
                    "shipping_cost": {"type": ["number", "null"]},
                    "min_order_value": {"type": ["number", "null"]},
                    "free_shipping_threshold": {"type": ["number", "null"]},
                    "lead_time_days": {"type": ["number", "null"]},
                },
            },
            "products": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["product_name", "quantity", "price_netto", "unit", "volume_label", "product_code", "category"],
                    "properties": {
                        "product_name": {"type": "string"},
                        "quantity": {"type": "number"},
                        "price_netto": {"type": "number"},
                        "unit": {"type": "string"},
                        "volume_label": {"type": "string"},
                        "product_code": {"type": ["string", "null"]},
                        "category": {"type": "string", "enum": DOCUMENT_CATEGORIES},
                    },
                },
            },
        },
    },
}

_DOCUMENT_SYSTEM_PROMPT = (
    "Jesteś ekspertem od dokumentów w gastronomii. Otrzymujesz zdjęcie(a) lub "
    "strony PDF. Najpierw ROZPOZNAJ typ dokumentu:\n"
    "- Jeśli to KARTA DAŃ / MENU RESTAURACJI dla gości (nazwy potraw z cenami dla klienta, "
    "sekcje typu Przystawki/Dania główne/Desery/Napoje, bez NIP nabywcy i bez 'Do zapłaty' "
    "jak na fakturze) — to jest 'MENU_RESTAURACYJNE'. NIE myl z cennikiem hurtowym dostawcy.\n"
    "- Jeśli dokument zawiera dane transakcyjne — słowa: 'Faktura VAT', 'Faktura', 'Nabywca', "
    "'Sprzedawca', 'Do zapłaty', 'Razem do zapłaty', 'Termin płatności', numer faktury, NIP nabywcy "
    "— to jest 'FAKTURA_ZAKUPOWA'.\n"
    "- Jeśli to cennik/oferta HANDLOWA DOSTAWCY (gazetka, lista SKU hurtowych, opakowania zbiorcze, "
    "ceny netto dla restauracji) BEZ danych faktury — to jest 'OFERTA_HANDLOWA'.\n\n"
    "Następnie wypełnij pola:\n"
    "- document_type: 'MENU_RESTAURACYJNE' albo 'FAKTURA_ZAKUPOWA' albo 'OFERTA_HANDLOWA'.\n"
    "- supplier_name: dla oferty/faktury nazwa SPRZEDAWCY / dostawcy (NIE nabywcy); "
    "dla MENU_RESTAURACYJNE → null.\n"
    "- total_amount: dla FAKTURA_ZAKUPOWA → końcowa kwota 'Do zapłaty' (brutto) jako liczba; "
    "dla OFERTA_HANDLOWA i MENU_RESTAURACYJNE → 0.\n"
    "- supplier{}: DANE PROFILU DOSTAWCY (panel Dostawcy). AKTYWNIE szukaj w nagłówku, stopce, "
    "bloku 'Sprzedawca' / 'Dostawca' / 'Sprzedający' / 'Wykonawca' oraz w warunkach handlowych:\n"
    "  * nip — NIP sprzedawcy/dostawcy (nie nabywcy); zachowaj cyfry i myślniki jak na dokumencie.\n"
    "  * phone — telefon kontaktowy / zamówień.\n"
    "  * email — e-mail zamówień / biura.\n"
    "  * contact_person — osoba do kontaktu, jeśli podana.\n"
    "  * address — pełny adres siedziby/magazynu sprzedawcy (ulica, kod, miasto).\n"
    "  * payment_terms — termin płatności / warunki (np. '14 dni', 'przelew 7 dni', 'gotówka').\n"
    "  * shipping_cost — koszt dostawy / transportu / logistyki w PLN (liczba). "
    "null gdy brak na dokumencie; 0 TYLKO gdy dokument wyraźnie mówi 'darmowa dostawa' / 'gratis'.\n"
    "  * min_order_value — minimum logistyczne / min. wartość zamówienia / 'zamówienia od X zł' w PLN.\n"
    "  * free_shipping_threshold — próg darmowej dostawy w PLN (np. 'darmowa dostawa od 500 zł').\n"
    "  * lead_time_days — czas realizacji / dostawy w dniach (liczba, np. '1-2 dni robocze' → 2).\n"
    "  Gdy pola NIE ma na dokumencie → null (NIE zgaduj, NIE wstawiaj 0).\n"
    "  Dla MENU_RESTAURACYJNE wszystkie pola supplier → null.\n"
    "- products[]: dla faktury/oferty pozycje towarowe; dla MENU_RESTAURACYJNE wpisz potrawy "
    "(product_name = nazwa dania, price_netto = cena dla gościa, quantity=0, unit='szt', "
    "category najlepiej dopasuj lub 'Inne').\n\n"
    "KATEGORYZACJA (pole category): dozwolone: 'Mięso i wędliny', 'Ryby i owoce morza', "
    "'Nabiał', 'Warzywa i owoce', 'Pieczywo', 'Suchy magazyn', 'Oleje i tłuszcze', "
    "'Przyprawy', 'Mrożonki', 'Napoje', 'Alkohole', 'Wywary i sosy', 'Chemia i czystość', "
    "'Opakowania', 'Inne'.\n"
    "WAŻNE: oliwa / olive oil / olej / masło klarowane / smalec → 'Oleje i tłuszcze' "
    "(NIGDY 'Alkohole'). Extra Virgin ≠ alkohol.\n"
    "Nie wymyślaj pozycji ani danych dostawcy. Zwróć wyłącznie poprawny JSON zgodny ze schematem."
)


_catalog_visible_col: Optional[bool] = None


async def _has_catalog_visible(client: httpx.AsyncClient) -> bool:
    global _catalog_visible_col
    if _catalog_visible_col:
        return True
    try:
        await sb_get(client, "supplier_catalog", params={"select": "is_visible", "limit": "1"})
        _catalog_visible_col = True
    except Exception:
        _catalog_visible_col = False
    return bool(_catalog_visible_col)


def _nip_digits(value: Optional[str]) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _normalize_supplier_scan_meta(raw: Optional[dict]) -> dict:
    """Normalizuje blok `supplier` z Vision JSON do pól panelu Dostawcy."""
    src = raw if isinstance(raw, dict) else {}

    def _str(key: str) -> Optional[str]:
        v = src.get(key)
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    def _num(key: str) -> Optional[float]:
        v = src.get(key)
        if v is None or v == "":
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    def _int(key: str) -> Optional[int]:
        n = _num(key)
        if n is None:
            return None
        try:
            return int(round(n))
        except (TypeError, ValueError):
            return None

    return {
        "nip": _str("nip"),
        "phone": _str("phone"),
        "email": _str("email"),
        "contact_person": _str("contact_person"),
        "address": _str("address"),
        "payment_terms": _str("payment_terms"),
        "shipping_cost": _num("shipping_cost"),
        "min_order_value": _num("min_order_value"),
        "free_shipping_threshold": _num("free_shipping_threshold"),
        "lead_time_days": _int("lead_time_days"),
    }


def _compose_supplier_notes_from_scan(meta: dict) -> Optional[str]:
    parts: list[str] = []
    addr = (meta.get("address") or "").strip()
    pay = (meta.get("payment_terms") or "").strip()
    if addr:
        parts.append(f"Adres: {addr}")
    if pay:
        parts.append(f"Termin płatności: {pay}")
    return "\n".join(parts) if parts else None


def _merge_supplier_notes(existing: Optional[str], incoming: Optional[str]) -> Optional[str]:
    """Dokłada linie z dokumentu bez kasowania istniejących notatek."""
    ex = (existing or "").strip()
    inc = (incoming or "").strip()
    if not inc:
        return None  # brak aktualizacji
    if not ex:
        return inc
    to_add = []
    for line in inc.split("\n"):
        line = line.strip()
        if line and line not in ex:
            to_add.append(line)
    if not to_add:
        return None  # już jest
    return f"{ex}\n" + "\n".join(to_add)


def _prefer_supplier_str(existing: Optional[str], new: Optional[str], *, kind: str = "text") -> Optional[str]:
    """Zwraca nową wartość do zapisu albo None (= nie zmieniaj).

    - puste z dokumentu → nie nadpisuj
    - puste w DB → uzupełnij
    - obie niepuste → aktualizuj gdy dokument wygląda jaśniej / kompletniej
    """
    n = (new or "").strip()
    e = (existing or "").strip()
    if not n:
        return None
    if not e:
        return n
    if kind == "nip":
        nd, ed = _nip_digits(n), _nip_digits(e)
        if not nd:
            return None
        if len(nd) > len(ed) or (len(nd) == 10 and len(ed) != 10):
            return n
        if nd == ed:
            return None  # ten sam NIP, bez kosmetyki
        return n  # inny NIP z dokumentu — aktualny dokument wygrywa
    if kind == "phone":
        nd = sum(ch.isdigit() for ch in n)
        ed = sum(ch.isdigit() for ch in e)
        if nd > ed:
            return n
        if nd == ed and n != e:
            return n
        return None
    if kind == "email":
        if "@" in n and "@" not in e:
            return n
        if n.lower() != e.lower():
            return n
        return None
    # text / contact: dłuższy lub wyraźnie inny
    if len(n) > len(e) + 2 or n.lower() != e.lower():
        return n
    return None


def _prefer_supplier_num(
    existing,
    new: Optional[float],
    *,
    allow_zero: bool = False,
) -> Optional[float]:
    """Zwraca liczbę do zapisu albo None (= nie zmieniaj)."""
    if new is None:
        return None
    try:
        v = float(new)
    except (TypeError, ValueError):
        return None
    if allow_zero:
        if v < 0:
            return None
    elif v <= 0:
        return None
    try:
        ex = float(existing) if existing is not None and existing != "" else 0.0
    except (TypeError, ValueError):
        ex = 0.0
    # Uzupełnij brak / zaktualizuj gdy dokument podaje wartość (w tym 0 = darmowa dostawa)
    if allow_zero:
        if ex == v:
            return None
        return v
    if ex <= 0 or abs(ex - v) > 0.009:
        return v
    return None


def build_supplier_patch_from_scan(existing: dict, meta: dict) -> dict:
    """Czysta logika merge — używana przy zapisie i w testach jednostkowych."""
    patch: dict = {}
    for key, kind in (
        ("nip", "nip"),
        ("phone", "phone"),
        ("email", "email"),
        ("contact_person", "text"),
    ):
        chosen = _prefer_supplier_str(existing.get(key), meta.get(key), kind=kind)
        if chosen is not None:
            patch[key] = chosen

    notes_in = _compose_supplier_notes_from_scan(meta)
    notes_merged = _merge_supplier_notes(existing.get("notes"), notes_in)
    if notes_merged is not None:
        patch["notes"] = notes_merged

    ship = _prefer_supplier_num(
        existing.get("shipping_cost"), meta.get("shipping_cost"), allow_zero=True,
    )
    if ship is not None:
        patch["shipping_cost"] = ship

    min_o = _prefer_supplier_num(
        existing.get("min_order_value"), meta.get("min_order_value"), allow_zero=False,
    )
    if min_o is not None:
        patch["min_order_value"] = min_o

    free_th = _prefer_supplier_num(
        existing.get("free_shipping_threshold"),
        meta.get("free_shipping_threshold"),
        allow_zero=False,
    )
    if free_th is not None:
        patch["free_shipping_threshold"] = free_th

    lead = meta.get("lead_time_days")
    if lead is not None:
        try:
            lead_i = int(lead)
        except (TypeError, ValueError):
            lead_i = None
        if lead_i is not None and lead_i > 0:
            ex_lead = existing.get("lead_time_days")
            try:
                ex_i = int(ex_lead) if ex_lead is not None and ex_lead != "" else None
            except (TypeError, ValueError):
                ex_i = None
            if ex_i is None or ex_i <= 0 or ex_i != lead_i:
                patch["lead_time_days"] = lead_i

    return patch


def supplier_meta_preview(meta: dict) -> dict:
    """Kompaktowy podgląd pól dostawcy dla FE (pomija puste)."""
    out: dict = {}
    for k in (
        "nip", "phone", "email", "contact_person", "address", "payment_terms",
        "shipping_cost", "min_order_value", "free_shipping_threshold", "lead_time_days",
    ):
        v = meta.get(k)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        out[k] = v
    return out


async def _find_or_create_supplier(
    client: httpx.AsyncClient,
    name: Optional[str],
    *,
    nip: Optional[str] = None,
) -> tuple[str, str]:
    """Zwraca (supplier_id, supplier_name). Tworzy dostawcę jeśli nie istnieje.

    Dopasowanie: najpierw NIP (cyfry), potem nazwa (znormalizowana).
    """
    clean = (name or "").strip() or "Nieznany dostawca"
    nip_d = _nip_digits(nip)
    existing = await sb_get(
        client, "suppliers",
        params={"select": "id,name,nip", "limit": "1000"},
    )
    if nip_d and len(nip_d) >= 8:
        for r in (existing or []):
            if _nip_digits(r.get("nip")) == nip_d:
                return r["id"], r["name"]
    for r in (existing or []):
        if _norm(r["name"]) == _norm(clean):
            return r["id"], r["name"]
    colors = ["#2563EB", "#DC2626", "#16A34A", "#D97706", "#7C3AED", "#0891B2"]
    color = colors[len(existing or []) % len(colors)]
    payload: dict = {
        "name": clean, "category": "Dodany ze skanu", "icon_color": color,
    }
    if nip and str(nip).strip():
        payload["nip"] = str(nip).strip()
    row = await sb_post(client, "suppliers", payload)
    created = row[0] if isinstance(row, list) else row
    return created["id"], created["name"]


async def _apply_supplier_scan_meta(
    client: httpx.AsyncClient,
    supplier_id: str,
    meta: Optional[dict],
) -> dict:
    """Inteligentny upsert pól panelu Dostawcy po skanie. Nie nadpisuje pustym."""
    normalized = _normalize_supplier_scan_meta(meta)
    if not any(v is not None for v in normalized.values()):
        return {"updated_fields": [], "supplier_meta": {}}

    select_cols = (
        "id,name,nip,phone,email,contact_person,notes,"
        "min_order_value,shipping_cost,free_shipping_threshold,lead_time_days"
    )
    rows = None
    try:
        rows = await sb_get(
            client, "suppliers",
            params={"select": select_cols, "id": f"eq.{supplier_id}", "limit": "1"},
        )
    except Exception:
        # Graceful: migracje shipping/lead_time mogą nie być uruchomione
        for cols in (
            "id,name,nip,phone,email,contact_person,notes,min_order_value,shipping_cost,free_shipping_threshold",
            "id,name,nip,phone,email,contact_person,notes,min_order_value",
            "id,name,nip,phone,email,contact_person,notes",
        ):
            try:
                rows = await sb_get(
                    client, "suppliers",
                    params={"select": cols, "id": f"eq.{supplier_id}", "limit": "1"},
                )
                break
            except Exception:
                continue
    if not rows:
        return {"updated_fields": [], "supplier_meta": supplier_meta_preview(normalized)}

    existing = rows[0]
    patch = build_supplier_patch_from_scan(existing, normalized)
    if not patch:
        return {"updated_fields": [], "supplier_meta": supplier_meta_preview(normalized)}

    # Próby zapisu z fallbackiem na brakujące kolumny
    attempts = [dict(patch)]
    if "lead_time_days" in patch:
        p2 = dict(patch)
        del p2["lead_time_days"]
        attempts.append(p2)
    if any(k in patch for k in ("shipping_cost", "free_shipping_threshold")):
        p3 = {k: v for k, v in patch.items()
              if k not in ("shipping_cost", "free_shipping_threshold", "lead_time_days")}
        if p3:
            attempts.append(p3)
    # Tylko podstawowe pola kontaktowe
    p4 = {k: v for k, v in patch.items()
          if k in ("nip", "phone", "email", "contact_person", "notes")}
    if p4 and p4 not in attempts:
        attempts.append(p4)

    saved_keys: list[str] = []
    last_err: Optional[Exception] = None
    for attempt in attempts:
        if not attempt:
            continue
        try:
            await sb_patch(client, "suppliers", {"id": f"eq.{supplier_id}"}, attempt)
            saved_keys = list(attempt.keys())
            last_err = None
            break
        except Exception as e:
            last_err = e
            continue
    if last_err and not saved_keys:
        logger.warning(f"_apply_supplier_scan_meta failed: {last_err}")

    return {
        "updated_fields": saved_keys,
        "supplier_meta": supplier_meta_preview(normalized),
    }


async def _resolve_category_id_cached(client: httpx.AsyncClient, cat_name: str, cache: dict) -> Optional[str]:
    """Mapuje nazwę kategorii (tekst z AI) na inventory_categories.id. Tworzy kategorię jeśli brak.
    Wersja z cache (używana przy imporcie faktur — wiele produktów naraz)."""
    name = (cat_name or "Inne").strip() or "Inne"
    if not cache.get("_loaded"):
        rows = await sb_get(client, "inventory_categories", params={"select": "id,name,sort_order"})
        cache["_rows"] = list(rows or [])
        for r in (rows or []):
            cache[_norm(r["name"])] = r["id"]
            cache[_norm_pl(r["name"])] = r["id"]
        cache["_max_sort"] = max((int(r.get("sort_order") or 0) for r in (rows or [])), default=0)
        cache["_loaded"] = True
    # 1) exact
    for key in (_norm(name), _norm_pl(name)):
        if key and key in cache and isinstance(cache[key], str):
            return cache[key]
    # 2) fuzzy do istniejących kategorii użytkownika (bez tworzenia duplikatów „Warzywa”/„Warzywa i owoce”)
    user_rows = cache.get("_rows") or []
    if user_rows:
        hit, score = _resolve_by_fuzzy(name, user_rows, key="name", threshold=72)
        if hit and hit.get("id"):
            cache[_norm(name)] = hit["id"]
            return hit["id"]
    # 3) twórz tylko gdy naprawdę nowa
    cache["_max_sort"] = int(cache.get("_max_sort", 0)) + 1
    try:
        row = await sb_post(client, "inventory_categories", {
            "name": name, "color": "#64748B", "sort_order": cache["_max_sort"],
        })
        created = row[0] if isinstance(row, list) else row
        cache[_norm(name)] = created["id"]
        cache.setdefault("_rows", []).append(created)
        return created["id"]
    except httpx.HTTPStatusError:
        return None


# Słowa kluczowe → kategoria magazynowa (bezpłatna heurystyka, bez LLM).
# UWAGA: dopasowanie tokenowe (nie substring) — „gin” NIE łapie się w „virgin”.
_CAT_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("Oleje i tłuszcze", (
        "oliwa", "oliw", "olive", "olej", "oleju", "olejem", "rzepak", "slonecznik",
        "smalec", "tluszcz", "frytur", "ghee", "klarowan", "oil",
    )),
    ("Warzywa i owoce", (
        "pomidor", "cebula", "czosnek", "salat", "ogorek", "baklazan", "jabl", "banan",
        "cytryn", "marchew", "ziemniak", "papryk", "brokul", "kalafior", "burak", "kapust",
        "szpinak", "awokado", "grzyb", "pieczark", "owoc", "warzyw", "por", "seler", "pietruszk",
        "koperek", "bazyl", "natk", "rzodkiew", "cukini", "dyni", "gruszk", "truskawk", "malin",
        "borowk", "jagod", "winogron", "arbuz", "melon", "ananas", "mango", "kiwi", "batat",
    )),
    ("Nabiał", (
        "mleko", "ser", "smietan", "jogurt", "maslo", "twarog", "mozarella", "mozzarella",
        "parmezan", "jajk", "jajec", "kefir", "maslank", "ricotta", "feta",
        "goud", "cheddar", "camembert",
    )),
    ("Mięso i wędliny", (
        "kurczak", "wolow", "wieprz", "indyk", "schab", "karkow", "wedlin", "boczek", "kielbas",
        "szynk", "filet", "udziec", "mieso", "wolovina", "kaczka", "ges", "baranin",
        "cielecin", "mielon", "parowk", "kabanos", "salami", "prosciutto",
    )),
    ("Ryby i owoce morza", (
        "ryba", "ryby", "losos", "dorsz", "krewet", "tuna", "tunczyk", "sledz", "makrel",
        "kalmar", "osmiornic", "malz", "krewetki", "owoc morza", "mintaj", "pstrag",
    )),
    ("Pieczywo", (
        "chleb", "bulka", "bagiet", "ciabatta", "tortilla", "wrap", "pieczyw", "croissant",
        "rogal", "focacci", "pita",
    )),
    ("Przyprawy", (
        "przypraw", "pieprz", "papryka mielona", "curry", "oregano", "tymianek", "kminek",
        "cynamon", "kurkum", "chili", "przyprawa", "ziola", "lisc laurowy",
    )),
    ("Wywary i sosy", (
        "bulion", "wywar", "fond", "sos ", "sosy", "demi-glace", "demi glace", "passata",
        "koncentrat pomidor", "musztard", "ketchup", "majonez",
    )),
    ("Alkohole", (
        "wino", "piwo", "wodka", "whisky", "whiskey", "rum", "gin", "likier", "prosecco",
        "szampan", "cydr", "aperol", "campari", "alkohol", "tequila", "brandy", "koniak",
        "cognac", "wermut", "porto", "martini",
    )),
    ("Napoje", (
        "sok", "woda", "cola", "napoj", "kawa", "herbata", "syrop", "tonik", "lemoniad",
        "nektar", "energy", "izoton",
    )),
    ("Mrożonki", (
        "mrozon", "frozen", "lody", "mrozonka", "mrozone", "mrozony",
    )),
    ("Chemia i czystość", (
        "detergent", "plyn do naczy", "plyn do podlog", "mydlo", "papier toalet", "recznik papier",
        "folia spozyw", "worki na smieci", "dezynfek", "chlor", "wybielacz", "chem",
    )),
    ("Opakowania", (
        "pojemnik", "tacka", "pudelek", "pudelko", "opakowan", "kubek", "pokrywk", "slomk",
        "serwetk", "talerz jednoraz", "sztucce",
    )),
    ("Suchy magazyn", (
        "maka", "ryz", "makaron", "cukier", "sol", "ocet", "konserw", "fasola such",
        "soczewic", "kasza", "platki", "drozdze", "proszek do pieczenia", "skrobia",
        "pasztet", "cukier puder", "maka pszen",
    )),
]


def _food_match_key(text: str) -> str:
    """Klucz do deduplikacji: pomidor / pomidory / Pomidor świeży → ten sam stem.

    Zachowuje liczby (np. śmietana 18% ≠ 30%).
    UWAGA: krótkich słów nie obcinamy o pojedyncze „a/e/i/y”
    (batat ≠ bata — inaczej batat ↛ bataty).
    """
    s = _norm_pl(text)
    # dołóż gołe liczby z oryginału (procenty tłuszczu itd.), bo _norm_pl bywa je gubi
    raw = _strip_accents(str(text or "")).lower()
    for m in re.findall(r"\d+[.,]?\d*", raw):
        num = m.replace(",", ".")
        if num and num not in s:
            s = f"{s} {num}".strip()
    # Stopwords jednostek / łączników — nie wchodzą do klucza
    stop = {"z", "ze", "do", "w", "we", "na", "i", "oraz", "bez", "typ", "luz"}
    out: list[str] = []
    for t in s.split():
        if t in stop:
            continue
        if t.isdigit() or re.match(r"^\d+[.]?\d*$", t):
            out.append(t)
            continue
        base = t
        # Dłuższe końcówki fleksyjne (bezpieczne)
        for suf in ("ami", "ach", "owie", "owi", "ow", "om"):
            if len(t) >= 5 and t.endswith(suf):
                base = t[: -len(suf)]
                break
        else:
            # Pojedyncze a/e/i/y tylko gdy słowo ≥6 znaków (bataty→batat, nie batat→bata)
            for suf in ("y", "i", "e", "a"):
                if len(t) >= 6 and t.endswith(suf):
                    base = t[: -len(suf)]
                    break
        if len(base) >= 3:
            out.append(base)
    return " ".join(sorted(set(out)))


def _keyword_token_hit(word: str, key: str) -> bool:
    """Tokenowe dopasowanie słowa kluczowego.

    - exact token: „gin” ↔ „gin”
    - stem (len≥4): „oliw” ↔ „oliwa” / „oliwek” (token zaczyna się od stemu)
    - NIE substring w środku tokenu: „gin” ↛ „virgin”
    - NIE odwrotny stem: „winogron” ↛ „wino”
    """
    w = (word or "").strip().lower()
    if not w or not key:
        return False
    if " " in w:
        return f" {w} " in f" {key} " or key.startswith(w) or key.endswith(w)
    for t in key.split():
        if t == w:
            return True
        if len(w) >= 4 and t.startswith(w):
            return True
    return False


def _guess_category_free(
    product_name: str,
    *,
    ai_category: Optional[str] = None,
    user_categories: Optional[list[dict]] = None,
    neighbor_category: Optional[str] = None,
) -> str:
    """Bezpłatne przypisanie kategorii: słowa kluczowe + kategorie użytkownika + AI hint."""
    user_cats = user_categories or []
    user_names = [(c.get("name") or "").strip() for c in user_cats if (c.get("name") or "").strip()]

    def _map_to_user(wanted: str) -> str:
        if not wanted:
            return "Inne"
        if not user_names:
            return wanted
        # exact / fuzzy do kategorii użytkownika
        for un in user_names:
            if _norm(un) == _norm(wanted) or _norm_pl(un) == _norm_pl(wanted):
                return un
        hit, score = _resolve_by_fuzzy(wanted, [{"name": n} for n in user_names], key="name", threshold=70)
        if hit:
            return hit["name"]
        # częściowe: „Warzywa” w „Warzywa i owoce”
        wn = _norm_pl(wanted)
        for un in user_names:
            unp = _norm_pl(un)
            if wn and unp and (wn in unp or unp in wn):
                return un
        return wanted if wanted != "Inne" else "Inne"

    # 1) kategoria z podobnego produktu już w magazynie
    if neighbor_category and neighbor_category.strip() and _norm(neighbor_category) != "inne":
        return _map_to_user(neighbor_category.strip())

    # 2) słowa kluczowe — najdłuższy stem wygrywa remisy (oliwa > gin-w-virgin)
    key = _food_match_key(product_name) + " " + _norm_pl(product_name)
    best_cat = None
    best_score = 0
    for cat_label, words in _CAT_KEYWORDS:
        hits = [(w, len(w)) for w in words if _keyword_token_hit(w, key)]
        if not hits:
            continue
        score = len(hits) * 10 + max(L for _, L in hits)
        if score > best_score:
            best_score = score
            best_cat = cat_label
    if best_cat and best_score > 0:
        return _map_to_user(best_cat)

    # 3) hint z AI — korekta oczywistych pomyłek olej ↔ alkohol
    ai = (ai_category or "").strip()
    if ai and _norm(ai) != "inne":
        oilish = any(_keyword_token_hit(w, key) for w in (
            "oliwa", "oliw", "olive", "olej", "oil", "smalec", "frytur", "ghee",
        ))
        if oilish and _norm_pl(ai) == "alkohole":
            return _map_to_user("Oleje i tłuszcze")
        return _map_to_user(ai)

    return _map_to_user("Inne")


def _find_inventory_duplicate(
    name: str,
    inv_rows: list[dict],
    *,
    threshold: int = 82,
) -> Optional[dict]:
    """Szuka istniejącego produktu (pomidor ≈ Pomidory świeże)."""
    if not name or not inv_rows:
        return None
    # 1) exact _norm
    n = _norm(name)
    for r in inv_rows:
        if _norm(r.get("name") or "") == n:
            return r
    # 2) ten sam food stem
    fk = _food_match_key(name)
    if fk:
        stem_hits = [r for r in inv_rows if _food_match_key(r.get("name") or "") == fk]
        if len(stem_hits) == 1:
            return stem_hits[0]
        if len(stem_hits) > 1:
            # najkrótsza kanoniczna nazwa
            return min(stem_hits, key=lambda r: len(r.get("name") or ""))
    # 3) rapidfuzz
    hit, score = _resolve_by_fuzzy(name, inv_rows, key="name", threshold=threshold)
    if hit and score >= threshold:
        return hit
    # 4) luźniej dla krótkich nazw warzyw (pomidor/pomidory)
    if len(_norm_pl(name).split()) <= 2:
        hit2, score2 = _resolve_by_fuzzy(name, inv_rows, key="name", threshold=74)
        if hit2 and score2 >= 74:
            return hit2
    return None


async def _load_user_inventory_categories(client: httpx.AsyncClient) -> list[dict]:
    return await sb_get(client, "inventory_categories", params={
        "select": "id,name,sort_order",
        "order": "sort_order.asc",
        "limit": "200",
    }) or []


async def _load_menu_lista_for_classification(client: httpx.AsyncClient) -> list[dict]:
    """LISTA_MENU: dania aktywne + kluczowe składniki z recipe_ingredients."""
    active_ids: Optional[set[str]] = None
    try:
        menu_rows = await sb_get(client, "menu_items", params={
            "select": "id,name,category",
            "is_active": "eq.true",
            "limit": "2000",
        }) or []
        active_ids = {r["id"] for r in menu_rows}
    except Exception:
        menu_rows = await sb_get(client, "menu_items", params={
            "select": "id,name,category", "limit": "2000",
        }) or []
        active_ids = None

    ri = []
    try:
        ri = await sb_get(client, "recipe_ingredients", params={
            "select": "menu_item_id,ingredient_name,quantity,unit",
            "limit": "30000",
        }) or []
    except Exception as e:
        logger.warning(f"_load_menu_lista: recipe_ingredients failed: {e}")

    by_menu: dict[str, list[dict]] = {}
    for r in ri:
        mid = r.get("menu_item_id")
        if not mid:
            continue
        if active_ids is not None and mid not in active_ids:
            continue
        name = (r.get("ingredient_name") or "").strip()
        if not name:
            continue
        by_menu.setdefault(mid, []).append({
            "name": name,
            "quantity": r.get("quantity"),
            "unit": r.get("unit") or "g",
        })

    out: list[dict] = []
    for m in menu_rows:
        ings = by_menu.get(m["id"], [])
        out.append({
            "danie": m.get("name") or "",
            "kategoria": m.get("category") or "",
            "skladniki": [i["name"] for i in ings],
            "skladniki_szczegoly": ings[:40],
        })
    return out


def _fuzzy_match_token_only(
    query: str, choices: list[str], threshold: int = 82
) -> tuple[Optional[str], float]:
    """Ścisłe fuzzy (bez partial_ratio) — do weryfikacji „występuje w menu”."""
    if not query or not choices:
        return None, 0.0
    best = rf_process.extractOne(
        query, choices, scorer=fuzz.token_set_ratio, score_cutoff=threshold
    )
    if best is None:
        return None, 0.0
    return best[0], float(best[1])


def _recipe_ingredient_keys(menu_lista: list[dict]) -> tuple[list[str], dict[str, str]]:
    """Zwraca (keys_norm, map norm→oryginał) wyłącznie ze składników receptur."""
    terms: dict[str, str] = {}
    for m in menu_lista:
        for s in (m.get("skladniki") or []):
            k = _norm_pl(s)
            if k:
                terms.setdefault(k, s)
    return list(terms.keys()), terms


async def _classify_offer_vs_menu_ai(
    menu_lista: list[dict],
    products: list[dict],
) -> dict[str, dict]:
    """Klasyfikacja produktów oferty vs MENU (tylko składniki dań — bez magazynu).

    Zwraca mapę: _norm_pl(nazwa) → {
      is_visible: bool, matched_to, matched_via, score, reason
    }
    """
    if not products:
        return {}

    # Kompaktowa LISTA_MENU (limit tokenów)
    menu_compact = []
    for m in menu_lista[:120]:
        ings = (m.get("skladniki") or [])[:25]
        menu_compact.append({
            "danie": m.get("danie"),
            "skladniki": ings,
        })

    prod_compact = []
    for p in products:
        name = (p.get("product_name") or "").strip()
        if not name:
            continue
        prod_compact.append({
            "nazwa": name,
            "cena": float(p.get("price_netto") or 0),
            "jednostka": (p.get("unit") or "").strip(),
        })

    if not prod_compact:
        return {}

    system = (
        "Jesteś precyzyjnym systemem kulinarno-magazynowym dla aplikacji Gastro Manager. "
        "Twój cel to przeanalizowanie listy produktów ze skanu oferty dostawcy i przypisanie "
        "ich do jednej z DWÓCH kategorii na podstawie aktualnego MENU restauracji.\n\n"
        "Otrzymujesz LISTA_MENU (dania + składniki z receptur) oraz PRODUKTY_DOSTAWCY.\n\n"
        "Kategoria wystepujace_w_menu:\n"
        "- Produkt MUSI być bezpośrednim, niezbędnym składnikiem do przygotowania przynajmniej "
        "jednego dania — nazwa musi odpowiadać wpisowi ze `skladniki` (np. burger wołowy → "
        "mięso mielone wołowe / bułki, JEŚLI te nazwy są na liście składników).\n"
        "- Jeśli danie NIE MA żadnych składników na liście, NIE zgaduj — idź do dodatkowe.\n"
        "- Bądź precyzyjny: baza dania lub kluczowy półprodukt → tu TYLKO gdy wynika ze składników.\n\n"
        "Kategoria dodatkowe:\n"
        "- WSZYSTKIE POZOSTAŁE produkty.\n"
        "- Jeśli produkt NIE jest bezpośrednio w recepturze/składzie dań.\n"
        "- Wątpliwości lub dopasowanie naciągane → dodatkowe "
        "(np. sok pomarańczowy ≠ świeża pomarańcza z herbaty zimowej).\n"
        "- Chemia, opakowania, kartony, produkty niezwiązane z menu → zawsze dodatkowe.\n\n"
        "BŁĄD DO UNIKNIĘCIA: Nie stosuj ogólnych skojarzeń. Fakt, że coś jest jedzeniem "
        "(np. makaron / kiełbasa śląska), nie oznacza, że występuje w menu, jeśli restauracja "
        "tego nie ma w `skladniki`!\n\n"
        "KAŻDY produkt z PRODUKTY_DOSTAWCY musi trafić DOKŁADNIE do jednej kategorii "
        "(preferuj dodatkowe przy wątpliwościach).\n\n"
        "Zwróć WYŁĄCZNIE czysty JSON:\n"
        '{"wystepujace_w_menu":[{"nazwa_dostawcy":"...","cena":0.0,"pasuje_do_dania":"...",'
        '"powod_dopasowania":"..."}],'
        '"dodatkowe":[{"nazwa_dostawcy":"...","cena":0.0}]}'
    )
    user = (
        f"LISTA_MENU ({len(menu_compact)} dań):\n{json.dumps(menu_compact, ensure_ascii=False)}\n\n"
        f"PRODUKTY_DOSTAWCY ({len(prod_compact)} poz.):\n{json.dumps(prod_compact, ensure_ascii=False)}"
    )

    result_map: dict[str, dict] = {}
    try:
        client = _openai()
        resp = await client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
        parsed = json.loads(raw) if raw else {}
        for item in (parsed.get("wystepujace_w_menu") or []):
            nazwa = (item.get("nazwa_dostawcy") or "").strip()
            if not nazwa:
                continue
            result_map[_norm_pl(nazwa)] = {
                "is_visible": True,
                "matched_via": "menu_ai",
                "matched_to": item.get("pasuje_do_dania") or "",
                "score": 95.0,
                "reason": item.get("powod_dopasowania") or "",
            }
        for item in (parsed.get("dodatkowe") or []):
            nazwa = (item.get("nazwa_dostawcy") or "").strip()
            if not nazwa:
                continue
            key = _norm_pl(nazwa)
            if key not in result_map:
                result_map[key] = {
                    "is_visible": False,
                    "matched_via": None,
                    "matched_to": None,
                    "score": 0.0,
                    "reason": "dodatkowe",
                }
    except Exception as e:
        logger.warning(f"_classify_offer_vs_menu_ai failed: {e}")
        return {}

    return result_map


async def _process_offer(client: httpx.AsyncClient, supplier_id: str, data: dict) -> dict:
    """Ścieżka 2: oferta handlowa → zapis do supplier_catalog.

    Widoczność (`is_visible` = „Występujące w menu”) wg precyzyjnej klasyfikacji
    względem MENU (dania + składniki receptur), NIE względem całego magazynu.
    Magazyn często zawiera produkty z ofert / onboarding — to NIE oznacza użycia w menu.
    """
    warnings: list[str] = []
    products = data.get("products") or []

    has_extra = await _has_catalog_extra_cols(client)
    has_visible = await _has_catalog_visible(client)

    # LISTA_MENU + klasyfikacja AI
    menu_lista = await _load_menu_lista_for_classification(client)
    recipe_keys, recipe_terms = _recipe_ingredient_keys(menu_lista)
    if products and not recipe_keys:
        warnings.append(
            "Brak składników w recepturach menu — wszystkie pozycje oferty trafią do „Dodatkowe”. "
            "Dodaj receptury w zakładce Menu (lub zaproponuj AI)."
        )
    # Bez receptur AI i tak wrzuci wszystko do „dodatkowe” — pomijamy kosztowny call.
    # Z recepturami: twardy timeout, żeby cały /documents/process mieścił się w ~20–40 s.
    ai_map: dict = {}
    if recipe_keys and products:
        try:
            ai_map = await asyncio.wait_for(
                _classify_offer_vs_menu_ai(menu_lista, products),
                timeout=18.0,
            )
        except asyncio.TimeoutError:
            logger.warning("_classify_offer_vs_menu_ai timed out — fuzzy fallback")
            ai_map = {}
            # Bez ostrzeżenia UI — fallback na receptury jest domyślną ścieżką.
        except Exception as e:
            logger.warning(f"_classify_offer_vs_menu_ai error: {e}")
            ai_map = {}
            # Bez ostrzeżenia UI — użytkownik i tak widzi wynik segregacji katalogu.

    # Fallback + weryfikacja AI: TYLKO składniki receptur (bez magazynu)
    RECIPE_VERIFY_THRESHOLD = 74
    RECIPE_FALLBACK_THRESHOLD = 78

    existing = await sb_get(client, "supplier_catalog",
                            params={"select": "id,name,sort_order", "supplier_id": f"eq.{supplier_id}"})
    by_name = {_norm(r["name"]): r for r in (existing or [])}
    max_sort = max((int(r.get("sort_order") or 0) for r in (existing or [])), default=0)

    visible_count = 0
    hidden_count = 0
    match_debug: list[dict] = []

    for p in products:
        name = (p.get("product_name") or "").strip()
        if not name:
            continue
        try:
            from product_name_validation import is_valid_product_name
            if not is_valid_product_name(name):
                warnings.append(f"Pominięto niepoprawną nazwę: {name!r}")
                continue
        except Exception:
            pass
        norm_key = _norm_pl(name)

        matched_via: Optional[str] = None
        matched_to: Optional[str] = None
        matched_score: float = 0.0
        reason = ""
        is_visible = False

        ai_hit = ai_map.get(norm_key)
        if ai_hit is None and ai_map:
            # Tylko ścisłe fuzzy po kluczach AI (bez substring „ser”∈„deser”)
            ak_hit, ak_score = _fuzzy_match_token_only(norm_key, list(ai_map.keys()), threshold=90)
            if ak_hit is not None:
                ai_hit = ai_map[ak_hit]
                matched_score = ak_score

        if ai_hit is not None and bool(ai_hit.get("is_visible")):
            # Bramka: AI może zaproponować „w menu” tylko jeśli produkt
            # pokrywa się ze składnikiem receptury (kiełbasa ≠ menu sushi).
            rec_hit, rec_score = _fuzzy_match_token_only(
                norm_key, recipe_keys, threshold=RECIPE_VERIFY_THRESHOLD
            )
            if rec_hit is not None:
                is_visible = True
                matched_via = "menu_ai+recipe"
                matched_to = ai_hit.get("matched_to") or recipe_terms.get(rec_hit, rec_hit)
                matched_score = max(float(ai_hit.get("score") or 0), rec_score)
                reason = ai_hit.get("reason") or ""
            else:
                is_visible = False
                matched_via = "menu_ai_rejected"
                matched_to = ai_hit.get("matched_to")
                reason = (
                    "AI wskazało menu, ale brak dopasowania do składników receptur — dodatkowe"
                )
        elif ai_hit is not None:
            is_visible = False
            matched_via = ai_hit.get("matched_via")
            reason = ai_hit.get("reason") or "dodatkowe"
        else:
            # Ścisły fallback: tylko receptury, bez partial_ratio
            rec_hit, rec_score = _fuzzy_match_token_only(
                norm_key, recipe_keys, threshold=RECIPE_FALLBACK_THRESHOLD
            )
            if rec_hit is not None:
                is_visible = True
                matched_via = "recipe_strict"
                matched_to = recipe_terms.get(rec_hit, rec_hit)
                matched_score = rec_score
            else:
                is_visible = False

        if is_visible:
            visible_count += 1
        else:
            hidden_count += 1

        if len(match_debug) < 40:
            match_debug.append({
                "product": name,
                "is_visible": is_visible,
                "matched_via": matched_via,
                "matched_to": matched_to,
                "score": round(matched_score, 1),
                "reason": reason,
            })

        price = float(p.get("price_netto") or 0)
        volume_label = (p.get("volume_label") or "").strip()
        unit = (p.get("unit") or "szt").strip()
        variant = volume_label
        if not variant and unit and unit.lower() not in ("szt", "szt.", "sztuki"):
            variant = unit
        if not variant:
            variant = name

        payload: dict = {
            "supplier_id": supplier_id, "name": name, "variant": variant,
            "volume_label": volume_label, "price_pln": price,
            "unit_count": 1, "liters_total": 0,
        }
        if has_extra:
            payload["unit"] = unit
            payload["product_code"] = (p.get("product_code") or None)
        if has_visible:
            payload["is_visible"] = is_visible

        match = by_name.get(_norm(name))
        try:
            if match:
                upd = {"price_pln": price, "variant": variant, "volume_label": volume_label}
                if has_extra:
                    upd["unit"] = unit
                    upd["product_code"] = (p.get("product_code") or None)
                if has_visible:
                    upd["is_visible"] = is_visible
                await sb_patch(client, "supplier_catalog", {"id": f"eq.{match['id']}"}, upd)
            else:
                max_sort += 1
                payload["sort_order"] = max_sort
                row = await sb_post(client, "supplier_catalog", payload)
                if row:
                    by_name[_norm(name)] = (row[0] if isinstance(row, list) else row)
        except httpx.HTTPStatusError as e:
            warnings.append(f"{name}: {e.response.text[:100]}")

    if not has_visible:
        warnings.append("Kolumna is_visible nie istnieje — wszystkie produkty widoczne (uruchom migrację SQL).")

    return {
        "products_total": len(products),
        "visible_count": visible_count,
        "hidden_count": hidden_count,
        "menu_dishes": len(menu_lista),
        "classification": "menu_ai" if ai_map else "recipe_strict_fallback",
        "match_preview": match_debug,
        "warnings": warnings,
    }


class InvoiceBatchIn(BaseModel):
    quantity: float = 0.0
    expiration_date: Optional[str] = None  # YYYY-MM-DD


class InvoiceProductIn(BaseModel):
    product_name: str
    quantity: float = 0.0
    price_netto: float = 0.0
    unit: str = "szt"
    category: str = "Inne"
    batches: list[InvoiceBatchIn] = Field(default_factory=list)
    alert_days: list[int] = Field(default_factory=lambda: [7, 3, 1])


class ConfirmInvoiceRequest(BaseModel):
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    total_amount: float = 0.0
    products: list[InvoiceProductIn]
    # inventory = magazyn+koszt materiałów (domyślnie)
    # variable_cost = tylko koszt zmienny
    # fixed_cost = tylko koszt stały
    destination: str = "inventory"
    # Pola panelu Dostawcy wyodrębnione ze skanu (opcjonalne — merge przy zapisie)
    supplier: Optional[dict] = None
    supplier_nip: Optional[str] = None
    supplier_phone: Optional[str] = None
    supplier_email: Optional[str] = None
    supplier_contact_person: Optional[str] = None
    supplier_address: Optional[str] = None
    supplier_payment_terms: Optional[str] = None
    supplier_shipping_cost: Optional[float] = None
    supplier_min_order_value: Optional[float] = None
    supplier_free_shipping_threshold: Optional[float] = None
    supplier_lead_time_days: Optional[int] = None


async def _upsert_supplier_catalog_from_invoice(
    client: httpx.AsyncClient,
    supplier_id: str,
    products: list[dict],
) -> int:
    """Dodaje/aktualizuje pozycje faktury w supplier_catalog danego dostawcy."""
    if not supplier_id or not products:
        return 0
    has_extra = await _has_catalog_extra_cols(client)
    existing = await sb_get(
        client,
        "supplier_catalog",
        params={"select": "id,name,sort_order", "supplier_id": f"eq.{supplier_id}"},
    ) or []
    by_name = {_norm(r["name"]): r for r in existing}
    max_sort = max((int(r.get("sort_order") or 0) for r in existing), default=0)
    saved = 0
    for p in products:
        name = (p.get("product_name") or "").strip()
        if not name:
            continue
        price = float(p.get("price_netto") or 0)
        unit = (p.get("unit") or "szt").strip() or "szt"
        variant = unit or name
        payload: dict = {
            "supplier_id": supplier_id,
            "name": name,
            "variant": variant,
            "volume_label": "",
            "price_pln": price,
            "unit_count": 1,
            "liters_total": 0,
        }
        if has_extra:
            payload["unit"] = unit
        match = by_name.get(_norm(name))
        try:
            if match:
                upd = {"price_pln": price, "variant": variant}
                if has_extra:
                    upd["unit"] = unit
                await sb_patch(client, "supplier_catalog", {"id": f"eq.{match['id']}"}, upd)
            else:
                max_sort += 1
                payload["sort_order"] = max_sort
                row = await sb_post(client, "supplier_catalog", payload)
                if row:
                    by_name[_norm(name)] = (row[0] if isinstance(row, list) else row)
            saved += 1
        except httpx.HTTPStatusError:
            continue
    return saved


async def _save_invoice(client: httpx.AsyncClient, supplier_id: str, supplier_name: str,
                        products: list[dict], total: float,
                        destination: str = "inventory") -> dict:
    """Zapis faktury: magazyn / koszt zmienny / koszt stały — zależnie od destination.
    Przy inventory: opcjonalne partie dat ważności → warehouse_inventory + invoices."""
    warnings: list[str] = []
    dest = (destination or "inventory").strip().lower()
    if dest not in ("inventory", "variable_cost", "fixed_cost"):
        dest = "inventory"

    updated: list[dict] = []
    created: list[dict] = []
    batches_saved = 0
    cost_id = None
    invoice_id: Optional[str] = None

    if dest == "inventory":
        # Nagłówek faktury (best-effort — tabela może nie istnieć przed migracją)
        try:
            inv_row = await sb_post(client, "invoices", {
                "supplier_id": supplier_id or None,
                "supplier_name": supplier_name or None,
                "total_cost": float(total or 0),
                "note": "Skan faktury AI",
            })
            invoice_id = (inv_row[0] if isinstance(inv_row, list) else inv_row).get("id")
        except Exception as e:
            warnings.append(f"Tabela invoices niedostępna (uruchom migrację ADD_INVOICE_EXPIRY_BATCHES): {e}")
            invoice_id = None

        cat_cache: dict = {}
        await _ensure_warehouse_categories(client)
        user_cats = await _load_user_inventory_categories(client)
        cat_cache["_rows"] = list(user_cats)
        for r in user_cats:
            cat_cache[_norm(r["name"])] = r["id"]
            cat_cache[_norm_pl(r["name"])] = r["id"]
        cat_cache["_max_sort"] = max((int(r.get("sort_order") or 0) for r in user_cats), default=0)
        cat_cache["_loaded"] = True

        # id → nazwa kategorii (do dziedziczenia z dopasowanego produktu)
        cat_id_to_name = {str(c["id"]): c["name"] for c in user_cats if c.get("id")}
        inv_all = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,unit,unit_cost,category_id",
            "limit": "5000",
        }) or []
        inv_rows = list(inv_all)

        for p in products:
            name = (p.get("product_name") or "").strip()
            if not name:
                continue
            qty = float(p.get("quantity") or 0)
            unit = (p.get("unit") or "szt").strip()
            price = float(p.get("price_netto") or 0)
            ai_cat = (p.get("category") or "").strip() or "Inne"
            alert_days = p.get("alert_days") or [7, 3, 1]
            if not isinstance(alert_days, list) or not alert_days:
                alert_days = [7, 3, 1]
            alert_days = [int(x) for x in alert_days if str(x).isdigit() or isinstance(x, (int, float))]
            if not alert_days:
                alert_days = [7, 3, 1]

            inv = _find_inventory_duplicate(name, inv_rows, threshold=82)
            item_id: Optional[str] = None
            if inv:
                item_id = str(inv["id"])
                conv = _convert(qty, unit, inv["unit"])
                delta = conv if conv is not None else qty
                if conv is None and _norm(unit) != _norm(inv["unit"]):
                    warnings.append(f"{name}: dodano {qty} {unit} bez konwersji do {inv['unit']} (połączono z „{inv['name']}”).")
                new_qty = float(inv["quantity"] or 0) + float(delta)
                patch_payload: dict = {"quantity": new_qty}
                # odśwież unit_cost gdy znamy cenę z faktury
                if price > 0:
                    patch_payload["unit_cost"] = price
                # jeśli produkt był w „Inne” / bez kategorii — popraw kategorię
                neighbor_cat = cat_id_to_name.get(str(inv.get("category_id") or ""))
                guessed = _guess_category_free(
                    name, ai_category=ai_cat, user_categories=user_cats,
                    neighbor_category=neighbor_cat if neighbor_cat and _norm(neighbor_cat) != "inne" else None,
                )
                if guessed and _norm(guessed) != "inne":
                    if not neighbor_cat or _norm(neighbor_cat) == "inne":
                        new_cat_id = await _resolve_category_id_cached(client, guessed, cat_cache)
                        if new_cat_id:
                            patch_payload["category_id"] = new_cat_id
                            inv["category_id"] = new_cat_id
                try:
                    await sb_patch(
                        client, "inventory_items", {"id": f"eq.{item_id}"},
                        {**patch_payload, "default_alert_days": alert_days},
                    )
                except httpx.HTTPStatusError:
                    # bez default_alert_days / unit_cost jeśli kolumna nie istnieje
                    soft = {k: v for k, v in patch_payload.items() if k in ("quantity", "category_id", "unit_cost")}
                    try:
                        await sb_patch(client, "inventory_items", {"id": f"eq.{item_id}"}, soft)
                    except httpx.HTTPStatusError:
                        await sb_patch(client, "inventory_items", {"id": f"eq.{item_id}"}, {"quantity": new_qty})
                updated.append({
                    "name": inv["name"],
                    "added": float(delta),
                    "unit": inv["unit"],
                    "new_quantity": new_qty,
                    "merged_from": name if _norm(name) != _norm(inv["name"]) else None,
                })
                inv["quantity"] = new_qty
                if price > 0:
                    inv["unit_cost"] = price
            else:
                guessed = _guess_category_free(
                    name, ai_category=ai_cat, user_categories=user_cats,
                )
                category = guessed
                cat_id = await _resolve_category_id_cached(client, category, cat_cache)
                payload = {
                    "name": name, "quantity": qty, "unit": unit,
                    "min_quantity": 0, "unit_cost": price, "category_id": cat_id,
                    "is_combo_polprodukt": False, "safety_buffer_percent": 20,
                    "default_alert_days": alert_days,
                }
                try:
                    row = await sb_post(client, "inventory_items", payload)
                except httpx.HTTPStatusError as e:
                    body = e.response.text or ""
                    if "default_alert_days" in body or "safety_buffer_percent" in body:
                        payload.pop("default_alert_days", None)
                        if "safety_buffer_percent" in body:
                            payload.pop("safety_buffer_percent", None)
                        try:
                            row = await sb_post(client, "inventory_items", payload)
                        except httpx.HTTPStatusError as e2:
                            warnings.append(f"{name}: nie dodano do magazynu ({e2.response.text[:80]}).")
                            continue
                    else:
                        warnings.append(f"{name}: nie dodano do magazynu ({body[:80]}).")
                        continue
                item_id = str((row[0] if isinstance(row, list) else row).get("id"))
                created.append({"name": name, "quantity": qty, "unit": unit, "category": category})
                new_row = {"id": item_id, "name": name, "quantity": qty, "unit": unit, "category_id": cat_id, "unit_cost": price}
                inv_rows.append(new_row)

            # Partie dat ważności
            raw_batches = p.get("batches") or []
            if isinstance(raw_batches, list):
                for b in raw_batches:
                    if not isinstance(b, dict):
                        continue
                    bqty = float(b.get("quantity") or 0)
                    edate = str(b.get("expiration_date") or "").strip()
                    if bqty <= 0 or not re.match(r"^\d{4}-\d{2}-\d{2}$", edate):
                        continue
                    status = _expiry_status(edate)
                    # Widen warning window to 7 days for invoice batches
                    try:
                        from datetime import date as _date
                        exp = _date.fromisoformat(edate)
                        if 0 <= (exp - _date.today()).days <= 7 and status == "fresh":
                            status = "warning"
                    except Exception:
                        pass
                    batch_payload = {
                        "restaurant_id": None,
                        "inventory_item_id": item_id,
                        "invoice_id": invoice_id,
                        "product_name": name,
                        "quantity": bqty,
                        "unit": unit,
                        "expiration_date": edate,
                        "status": status,
                        "alert_triggers": alert_days,
                        "confidence_score": None,
                        "source": "invoice_review",
                    }
                    try:
                        await sb_post(client, "warehouse_inventory", batch_payload)
                        batches_saved += 1
                    except httpx.HTTPStatusError as e:
                        # retry bez nowych kolumn
                        for drop in ("invoice_id", "alert_triggers"):
                            batch_payload.pop(drop, None)
                        try:
                            await sb_post(client, "warehouse_inventory", batch_payload)
                            batches_saved += 1
                        except Exception:
                            warnings.append(
                                f"{name}: nie zapisano partii {edate} "
                                f"(migracja ADD_WAREHOUSE_INVENTORY_EXPIRY / ADD_INVOICE_EXPIRY_BATCHES). "
                                f"{(e.response.text or '')[:60]}"
                            )

        if total > 0:
            cost_name = f"Faktura — {supplier_name}".strip(" —") or "Zakup towaru (faktura)"
            line_payload = {
                "v": 1,
                "kind": "invoice_lines",
                "supplier_id": supplier_id,
                "supplier_name": supplier_name,
                "total": float(total or 0),
                "lines": [
                    {
                        "name": (p.get("product_name") or "").strip(),
                        "qty": float(p.get("quantity") or 0),
                        "unit": (p.get("unit") or "szt").strip(),
                        "price_netto": float(p.get("price_netto") or 0),
                    }
                    for p in products
                    if (p.get("product_name") or "").strip()
                ],
            }
            try:
                import json as _json
                note_body = (
                    f"Skan faktury · supplier:{supplier_id}\n"
                    f"GM_INVOICE_LINES:{_json.dumps(line_payload, ensure_ascii=False)}"
                )
            except Exception:
                note_body = f"Skan faktury · supplier:{supplier_id}"
            try:
                cost_row = await sb_post(client, "variable_cost_entries", {
                    "year_month": _current_year_month(),
                    "type": "materials",
                    "name": cost_name,
                    "amount_pln": total,
                    "note": note_body,
                })
                cost_id = (cost_row[0] if isinstance(cost_row, list) else cost_row)["id"]
            except httpx.HTTPStatusError as e:
                warnings.append(f"Nie udało się dopisać kosztu: {e.response.text[:80]}")

        # Katalog własny dostawcy — produkty z faktury (nowy lub istniejący dostawca)
        if supplier_id and (updated or created or products):
            try:
                catalog_saved = await _upsert_supplier_catalog_from_invoice(
                    client, supplier_id, products
                )
                if catalog_saved:
                    warnings.append(
                        f"Dodano/zaktualizowano {catalog_saved} poz. w katalogu dostawcy."
                    )
            except Exception as ce:  # noqa: BLE001
                warnings.append(f"Katalog dostawcy: nie udało się zsynchronizować ({ce}).")

        if updated or created:
            try:
                await _recompute_menu_availability(client)
            except Exception as e:
                logger.debug(f"_recompute_menu_availability skipped: {e}")

    elif dest == "variable_cost":
        if total <= 0:
            # suma z pozycji jeśli total pusty
            total = sum(float(p.get("quantity") or 0) * float(p.get("price_netto") or 0) for p in products)
        cost_name = f"Faktura (koszt zmienny) — {supplier_name}".strip(" —") or "Koszt zmienny (skan)"
        try:
            import json as _json
            line_payload = {
                "v": 1,
                "kind": "invoice_lines",
                "supplier_id": supplier_id,
                "supplier_name": supplier_name,
                "total": float(total or 0),
                "lines": [
                    {
                        "name": (p.get("product_name") or "").strip(),
                        "qty": float(p.get("quantity") or 0),
                        "unit": (p.get("unit") or "szt").strip(),
                        "price_netto": float(p.get("price_netto") or 0),
                    }
                    for p in products
                    if (p.get("product_name") or "").strip()
                ],
            }
            note_body = (
                f"Skan faktury → koszt zmienny · supplier:{supplier_id}\n"
                f"GM_INVOICE_LINES:{_json.dumps(line_payload, ensure_ascii=False)}"
            )
        except Exception:
            note_body = f"Skan faktury → koszt zmienny · supplier:{supplier_id} · {len(products)} poz."
        try:
            cost_row = await sb_post(client, "variable_cost_entries", {
                "year_month": _current_year_month(),
                "type": "materials",
                "name": cost_name,
                "amount_pln": float(total),
                "note": note_body,
            })
            cost_id = (cost_row[0] if isinstance(cost_row, list) else cost_row)["id"]
        except httpx.HTTPStatusError as e:
            warnings.append(f"Nie udało się dopisać kosztu zmiennego: {e.response.text[:80]}")

    elif dest == "fixed_cost":
        if total <= 0:
            total = sum(float(p.get("quantity") or 0) * float(p.get("price_netto") or 0) for p in products)
        cost_name = f"Faktura (koszt stały) — {supplier_name}".strip(" —") or "Koszt stały (skan)"
        try:
            cost_row = await sb_post(client, "fixed_costs", {
                "year_month": _current_year_month(),
                "type": "other",
                "name": cost_name,
                "amount_pln": float(total),
                "note": f"Skan faktury → koszt stały · supplier:{supplier_id} · {len(products)} poz.",
            })
            cost_id = (cost_row[0] if isinstance(cost_row, list) else cost_row)["id"]
        except httpx.HTTPStatusError as e:
            warnings.append(f"Nie udało się dopisać kosztu stałego: {e.response.text[:80]}")

    return {
        "supplier_id": supplier_id,
        "supplier_name": supplier_name,
        "destination": dest,
        "items_updated": len(updated),
        "items_created": len(created),
        "batches_saved": batches_saved if dest == "inventory" else 0,
        "invoice_id": invoice_id,
        "updated": updated,
        "created": created,
        "total_amount": total,
        "cost_id": cost_id,
        "warnings": warnings,
    }


@app.post("/api/documents/process")
async def process_document(supplier_id: Optional[str] = Form(None), file: UploadFile = File(...)):
    """Uniwersalny procesor: GPT-4o rozpoznaje typ dokumentu.
    - FAKTURA → zwraca podgląd (bez zapisu) do zatwierdzenia z edycją kategorii.
    - OFERTA → od razu zapisuje do katalogu dostawcy.
    supplier_id jest opcjonalny — jeśli brak, dostawca zostanie rozpoznany/utworzony z dokumentu.
    Plik żyje wyłącznie w RAM i jest niszczony po zakończeniu funkcji."""
    require_tenant_account_key()
    client = _openai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    if supplier_id:
        async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as httpx_c:
            sup = await sb_get(httpx_c, "suppliers",
                               params={"select": "id,name", "id": f"eq.{supplier_id}", "limit": "1"})
            if not sup:
                raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")

    image_uris, pages_meta = _images_from_upload(contents, file.content_type or "", file.filename or "")
    contents = b""  # zwolnij bajty pliku

    data, billing = await _openai_vision_json_batches(
        client,
        image_uris=image_uris,
        system_prompt=_DOCUMENT_SYSTEM_PROMPT,
        json_schema=_DOCUMENT_JSON_SCHEMA,
        endpoint="/api/documents/process",
        user_text=(
            "Rozpoznaj typ tego dokumentu i wyodrębnij dane zgodnie ze schematem. "
            f"Dokument PDF/zdjęcie: {pages_meta.get('pages_rendered')} stron"
            f"{' (z ' + str(pages_meta.get('pages_total')) + ')' if pages_meta.get('truncated') else ''}."
        ),
        pages_meta=pages_meta,
        merge_fn=_merge_document_vision_batches,
    )
    image_uris = []

    doc_type = data.get("document_type") or "OFERTA_HANDLOWA"
    supplier_name = data.get("supplier_name")
    supplier_meta = _normalize_supplier_scan_meta(data.get("supplier"))
    pages_info = {
        "pages_total": pages_meta.get("pages_total"),
        "pages_processed": pages_meta.get("pages_rendered"),
        "pages_truncated": bool(pages_meta.get("truncated")),
    }

    if doc_type == "MENU_RESTAURACYJNE":
        # Menu restauracji → NIE twórz dostawcy / katalogu. FE otworzy skaner menu.
        dishes_preview = []
        for p in (data.get("products") or [])[:80]:
            nm = (p.get("product_name") or "").strip()
            if not nm:
                continue
            dishes_preview.append({
                "name": nm,
                "price_pln": float(p.get("price_netto") or 0),
                "category": p.get("category") or "Inne",
            })
        return _with_billing({
            "document_type": "MENU_RESTAURACYJNE",
            "open_menu_scan": True,
            "dishes_preview": dishes_preview,
            **pages_info,
            "message": (
                "Rozpoznano kartę dań (menu restauracji). "
                "Otwórz „Skanuj menu”, aby wgrać potrawy — nie dodano dostawcy ani katalogu."
            ),
        }, billing)

    if doc_type == "FAKTURA_ZAKUPOWA":
        # PODGLĄD — nic nie zapisujemy; darmowa kategoryzacja pod kategorie użytkownika
        raw_products = data.get("products") or []
        enriched: list[dict] = []
        user_cat_names: list[str] = []
        async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client_db:
            await _ensure_warehouse_categories(client_db)
            user_cats = await _load_user_inventory_categories(client_db)
            user_cat_names = [c.get("name") for c in user_cats if c.get("name")]
            inv_all = await sb_get(client_db, "inventory_items", params={
                "select": "id,name,category_id", "limit": "5000",
            }) or []
            cat_id_to_name = {str(c["id"]): c["name"] for c in user_cats if c.get("id")}
            for p in raw_products:
                if not isinstance(p, dict):
                    continue
                pname = (p.get("product_name") or "").strip()
                if not pname:
                    continue
                neighbor = _find_inventory_duplicate(pname, inv_all, threshold=82)
                neighbor_cat = None
                if neighbor and neighbor.get("category_id"):
                    neighbor_cat = cat_id_to_name.get(str(neighbor["category_id"]))
                guessed = _guess_category_free(
                    pname,
                    ai_category=p.get("category"),
                    user_categories=user_cats,
                    neighbor_category=neighbor_cat,
                )
                out = dict(p)
                out["category"] = guessed
                if neighbor:
                    out["matched_inventory_name"] = neighbor.get("name")
                enriched.append(out)
        return _with_billing({
            "document_type": doc_type,
            "supplier_id": supplier_id,
            "supplier_name": supplier_name,
            "supplier": supplier_meta_preview(supplier_meta),
            "total_amount": float(data.get("total_amount") or 0),
            "products": enriched or raw_products,
            "user_categories": user_cat_names,
            **pages_info,
        }, billing)

    # OFERTA → rozpoznaj/utwórz dostawcę, uzupełnij panel Dostawcy, zapisz katalog
    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client_db:
        if supplier_id:
            resolved_id, resolved_name = supplier_id, (data.get("supplier_name") or "")
        else:
            resolved_id, resolved_name = await _find_or_create_supplier(
                client_db, supplier_name, nip=supplier_meta.get("nip"),
            )
        meta_result = await _apply_supplier_scan_meta(client_db, resolved_id, supplier_meta)
        result = await _process_offer(client_db, resolved_id, data)
        return _with_billing({
            "document_type": doc_type,
            "supplier_id": resolved_id,
            "supplier_name": resolved_name or supplier_name,
            "supplier": meta_result.get("supplier_meta") or supplier_meta_preview(supplier_meta),
            "supplier_fields_updated": meta_result.get("updated_fields") or [],
            **pages_info,
            **result,
        }, billing)


@app.post("/api/documents/confirm-invoice")
async def confirm_invoice(req: ConfirmInvoiceRequest):
    """Zatwierdzenie faktury z podglądu (po ewentualnej korekcie kategorii).
    Zawsze: aktualizacja/utworzenie produktów w magazynie + koszt zmienny (materiały).
    Tworzy dostawcę jeśli podano tylko nazwę; dopisuje pozycje do katalogu dostawcy;
    uzupełnia pola panelu Dostawcy (NIP, telefon, dostawa, min. zamówienie itd.)."""
    require_tenant_account_key()
    if not req.products:
        raise HTTPException(status_code=400, detail="Brak pozycji do zaksięgowania.")

    # Złóż meta z obiektu `supplier` lub płaskich pól FE
    flat_meta = {
        "nip": req.supplier_nip,
        "phone": req.supplier_phone,
        "email": req.supplier_email,
        "contact_person": req.supplier_contact_person,
        "address": req.supplier_address,
        "payment_terms": req.supplier_payment_terms,
        "shipping_cost": req.supplier_shipping_cost,
        "min_order_value": req.supplier_min_order_value,
        "free_shipping_threshold": req.supplier_free_shipping_threshold,
        "lead_time_days": req.supplier_lead_time_days,
    }
    if isinstance(req.supplier, dict):
        merged_src = {**flat_meta, **{k: v for k, v in req.supplier.items() if v is not None}}
    else:
        merged_src = flat_meta
    supplier_meta = _normalize_supplier_scan_meta(merged_src)

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        if req.supplier_id:
            sup = await sb_get(client, "suppliers",
                               params={"select": "id,name", "id": f"eq.{req.supplier_id}", "limit": "1"})
            if not sup:
                raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")
            supplier_id, supplier_name = sup[0]["id"], sup[0]["name"]
        else:
            supplier_id, supplier_name = await _find_or_create_supplier(
                client, req.supplier_name, nip=supplier_meta.get("nip"),
            )

        meta_result = await _apply_supplier_scan_meta(client, supplier_id, supplier_meta)

        products = [p.model_dump() for p in req.products]
        # Zakupy: magazyn + koszt zmienny (ignorujemy stare destination tiles z FE).
        result = await _save_invoice(
            client, supplier_id, supplier_name, products, float(req.total_amount or 0),
            destination="inventory",
        )
    return {
        "document_type": "FAKTURA_ZAKUPOWA",
        "supplier": meta_result.get("supplier_meta") or supplier_meta_preview(supplier_meta),
        "supplier_fields_updated": meta_result.get("updated_fields") or [],
        **result,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 5) Dynamic Portions Yield — na ile porcji każdej potrawy wystarczy zapas
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/inventory/{item_id}/portions-yield")
async def portions_yield(item_id: str):
    """Dla danego surowca liczy, na ile porcji każdej powiązanej potrawy wystarczy
    aktualny stan magazynowy (stan / gramatura z receptury)."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        try:
            rows = await sb_get(client, "inventory_items",
                                params={"select": "id,name,quantity,unit,unit_weight_volume,weight_volume_unit",
                                        "id": f"eq.{item_id}", "limit": "1"})
        except httpx.HTTPStatusError as e:
            # kolumny unit_weight_volume/weight_volume_unit jeszcze nie dodane
            if "unit_weight_volume" in (e.response.text or "") or "weight_volume_unit" in (e.response.text or ""):
                rows = await sb_get(client, "inventory_items",
                                    params={"select": "id,name,quantity,unit", "id": f"eq.{item_id}", "limit": "1"})
            else:
                raise
        if not rows:
            raise HTTPException(status_code=404, detail="Nie znaleziono produktu.")
        item = rows[0]
        item_name = item["name"]
        stock_qty = float(item["quantity"] or 0)
        stock_unit = item["unit"] or ""
        uwv = item.get("unit_weight_volume")
        wvu = item.get("weight_volume_unit")

        # recipe_ingredients łączy się z magazynem po NAZWIE (fuzzy)
        try:
            recipes = await sb_get(client, "recipe_ingredients",
                                   params={"select": "menu_item_id,ingredient_name,quantity,unit,piece_weight_g"})
        except httpx.HTTPStatusError as e:
            if "piece_weight_g" in (e.response.text or ""):
                recipes = await sb_get(client, "recipe_ingredients",
                                       params={"select": "menu_item_id,ingredient_name,quantity,unit"})
            else:
                raise
        key = _norm(item_name)
        key_pl = _norm_pl(item_name)
        matched = []
        for r in (recipes or []):
            ing = r.get("ingredient_name") or ""
            if (
                _norm(ing) == key
                or key in _norm(ing)
                or _norm(ing) in key
                or _norm_pl(ing) == key_pl
            ):
                matched.append(r)
                continue
            # Lekki fuzzy token-set (bez partial) — filet↔pierś
            hit, _score = _fuzzy_match_token_only(key_pl, [_norm_pl(ing)], threshold=74)
            if hit is not None:
                matched.append(r)

        # nazwy potraw
        menu_ids = list({r["menu_item_id"] for r in matched})
        menu_map: dict = {}
        if menu_ids:
            id_filter = "in.(" + ",".join(menu_ids) + ")"
            menu_rows = await sb_get(client, "menu_items",
                                     params={"select": "id,name,is_active", "id": id_filter})
            menu_map = {m["id"]: m for m in (menu_rows or [])}

    dishes = []
    for r in matched:
        per_portion = float(r["quantity"] or 0)
        recipe_unit = r["unit"] or stock_unit
        if per_portion <= 0:
            continue
        # Gdy receptura w szt a mamy wzorcową wagę — użyj jej jako unit_size
        piece_wt = r.get("piece_weight_g")
        use_uwv = uwv
        use_wvu = wvu
        try:
            if piece_wt is not None and float(piece_wt) > 0 and _is_piece_unit(recipe_unit):
                use_uwv = float(piece_wt)
                use_wvu = "g"
        except (TypeError, ValueError):
            pass
        available, convertible = _yield_available(stock_qty, stock_unit, use_uwv, use_wvu, recipe_unit)
        portions = int(available // per_portion) if available is not None else 0
        menu = menu_map.get(r["menu_item_id"])
        dishes.append({
            "menu_item_id": r["menu_item_id"],
            "dish_name": (menu or {}).get("name") or "Danie",
            "is_active": (menu or {}).get("is_active", True),
            "per_portion_qty": per_portion,
            "unit": recipe_unit,
            "portions": max(0, portions),
            "convertible": convertible,
        })

    dishes.sort(key=lambda d: d["portions"])
    return {
        "item_id": item_id,
        "item_name": item_name,
        "stock_quantity": stock_qty,
        "stock_unit": stock_unit,
        "dishes": dishes,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 6) Menu scan (GPT-4o Vision) — czyta menu restauracji, wyciąga potrawy
#    Trzy endpointy: /scan (podgląd), /suggest-recipe (AI składniki/gramatura),
#    /confirm-scan (zapis do menu_items + recipe_ingredients).
# ─────────────────────────────────────────────────────────────────────────────

MENU_CATEGORIES = [
    "Przystawki", "Zupy", "Sałatki", "Burgery", "Dania główne",
    "Makarony", "Pizza", "Desery", "Napoje", "Alkohole", "Półprodukty", "Inne",
]

_MENU_SCAN_JSON_SCHEMA = {
    "name": "MenuExtraction",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["dishes"],
        "properties": {
            "dishes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "name", "category", "price_pln",
                        "portion_weight_value", "portion_weight_unit",
                        "ingredients",
                    ],
                    "properties": {
                        "name": {"type": "string"},
                        "category": {"type": "string", "enum": MENU_CATEGORIES},
                        "price_pln": {"type": "number"},
                        "portion_weight_value": {"type": ["number", "null"]},
                        "portion_weight_unit": {
                            "type": ["string", "null"],
                            "enum": ["g", "ml", "szt", None],
                        },
                        "ingredients": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "quantity", "unit"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "quantity": {"type": ["number", "null"]},
                                    "unit": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            },
        },
    },
}

_MENU_SCAN_SYSTEM_PROMPT = (
    "Jesteś ekspertem od digitalizacji kart menu restauracji. Otrzymujesz zdjęcie(a) "
    "lub strony PDF menu. Wyodrębnij WSZYSTKIE potrawy do tablicy `dishes`.\n\n"
    "Dla każdej pozycji:\n"
    "- name: nazwa dania (bez ceny, bez gramatury; np. 'Burger Podwójny').\n"
    "- category: jedna z dozwolonych kategorii: "
    f"{', '.join(MENU_CATEGORIES)}. Wybierz najbardziej pasującą na podstawie nazwy i sekcji menu. "
    "Pozycje typu półprodukt / mise en place / warzywa grillowane / pieczone / mix sałat "
    "(przygotowywane wewnętrznie, nie danie sprzedażowe) → kategoria 'Półprodukty'.\n"
    "- price_pln: cena w PLN jako liczba dziesiętna (przecinek zamień na kropkę, "
    "usuń symbole '/zł/PLN'). Jeśli brak ceny → 0.\n"
    "- portion_weight_value: gramatura porcji jeśli widoczna na menu (np. '250 g' → 250, "
    "'0,3 l' → 300). Jeśli brak → null.\n"
    "- portion_weight_unit: jednostka gramatury: 'g' (waga), 'ml' (płyny), 'szt' (sztuki). "
    "Jeśli brak wagi → null.\n"
    "- ingredients: lista składników jeśli są WYSZCZEGÓLNIONE pod nazwą dania (np. "
    "'sos pomidorowy, mozzarella, bazylia'). Dla każdego składnika: name (nazwa), "
    "quantity (null jeśli menu nie podaje ilości), unit (jednostka lub 'g' domyślnie). "
    "Jeśli menu nie wypisuje składników danej potrawy → pusta lista [].\n\n"
    "WAŻNE:\n"
    "- Nie wymyślaj składników których nie ma w menu — jeśli menu podaje tylko nazwę, "
    "zwróć puste `ingredients: []`. AI zaproponuje je później osobno.\n"
    "- Nie wymyślaj gramatury — jeśli menu nie podaje, zwróć null.\n"
    "- KATEGORYCZNIE ZAKAZANE: nazwy 'Porcja', 'Porcje', 'Wielkość porcji', "
    "'Gramatura', 'Gramatura porcji' NIE MOGĄ pojawić się w `ingredients`. "
    "Wielkość porcji zapisuj TYLKO w `portion_weight_value` + `portion_weight_unit`.\n"
    "- Zignoruj sekcje: promocje/loga/adres/godziny/opisy restauracji.\n"
    "- Zwróć wyłącznie poprawny JSON zgodny ze schematem."
)


class MenuScanIngredient(BaseModel):
    name: str
    quantity: Optional[float] = None
    unit: str = "g"


class MenuScanDish(BaseModel):
    name: str
    category: str = "Inne"
    price_pln: float = 0.0
    portion_weight_value: Optional[float] = None
    portion_weight_unit: Optional[str] = None
    ingredients: list[MenuScanIngredient] = Field(default_factory=list)
    image_context_tags: list[str] = Field(default_factory=list)


def _norm_pl_tag(raw: str) -> str:
    import unicodedata
    s = (raw or "").lower()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _extract_image_context_tags(name: str) -> list[str]:
    """Heurystyczne tagi grafiki z nazwy dania (bez dodatkowego kosztu OpenAI)."""
    n = _norm_pl_tag(name)
    tags: list[str] = []
    rules = [
        (r"\bkaczk", ["kaczka", "drób", "mięso pieczone"]),
        (r"\b(kurczak|chicken|de volaille)", ["kurczak", "drób"]),
        (r"\bindyk", ["indyk", "drób"]),
        (r"\b(wolow|beef|stek|ribeye|tatar)", ["wołowina", "mięso"]),
        (r"\b(wieprz|schab|golonk|boczek|zeberk)", ["wieprzowina", "mięso"]),
        (r"\b(ryb|losos|dorsz|pstrag|tunczyk|fish)", ["ryba"]),
        (r"\b(wege|vegan|tofu|falafel)", ["wege"]),
        (r"\b(zupa|rosol|barszcz|zurek|gazpacho|ramen|pho)", ["zupa"]),
        (r"\bpomidor|tomato", ["pomidor", "czerwone"]),
        (r"\bburger", ["burger"]),
        (r"\bpizza", ["pizza"]),
        (r"\b(makaron|pasta|spaghetti)", ["makaron"]),
        (r"\bsalatk|salad", ["sałatka"]),
        (r"\b(udko|udo)\b", ["udo", "pieczeń"]),
        (r"\b(pieczon|roast|grill)", ["pieczeń", "mięso pieczone"]),
        (r"\bchrupiac|crispy", ["chrupiące"]),
        (r"\bjablk|apple", ["jabłko"]),
        (r"\bpekin|peking", ["kaczka", "azja"]),
        (r"\bsushi|nigiri|maki", ["sushi", "ryba"]),
        (r"\b(deser|ciasto|lody|tiramisu)", ["deser"]),
    ]
    seen: set[str] = set()
    for pattern, add in rules:
        if re.search(pattern, n):
            for t in add:
                if t not in seen:
                    seen.add(t)
                    tags.append(t)
    return tags


def _attach_image_context_tags(dishes: list[MenuScanDish]) -> None:
    for d in dishes:
        if d.image_context_tags:
            continue
        d.image_context_tags = _extract_image_context_tags(d.name)


class MenuScanResponse(BaseModel):
    dishes: list[MenuScanDish]
    warnings: list[str] = Field(default_factory=list)
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


# ─────────────────────────────────────────────────────────────────────────────
# Vision AI — skaner daty ważności (partie warehouse_inventory)
# ─────────────────────────────────────────────────────────────────────────────

_EXPIRY_SCAN_SYSTEM_PROMPT = (
    "You are a precise data extraction agent for a restaurant inventory system. "
    "Analyze the provided image of a food product.\n"
    "Identify:\n"
    "1. The clean product name (e.g., \"Mleko UHT 3.2%\").\n"
    "2. The exact expiration date. Convert any Polish or international date formats "
    "(e.g., \"Najlepiej spożyć przed: 24.12.2026\", \"EXP 12/26\", \"24-LIS-2026\") "
    "into a standard YYYY-MM-DD format. If only a month/year is visible, set the date "
    "to the last day of that month.\n\n"
    "Respond strict JSON only."
)

_EXPIRY_SCAN_JSON_SCHEMA = {
    "name": "ExpirationScan",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["product_name", "expiration_date", "confidence_score"],
        "properties": {
            "product_name": {"type": "string"},
            "expiration_date": {"type": "string", "description": "YYYY-MM-DD"},
            "confidence_score": {"type": "number"},
        },
    },
}


def _expiry_status(iso_date: str) -> str:
    from datetime import date as _date
    try:
        exp = _date.fromisoformat(iso_date[:10])
    except ValueError:
        return "warning"
    today = _date.today()
    delta = (exp - today).days
    if delta < 0:
        return "expired"
    if delta <= 7:
        return "warning"
    return "fresh"


class ExpiryScanResponse(BaseModel):
    ok: bool = True
    product_name: str
    expiration_date: str
    confidence_score: float
    status: str
    quantity: float
    unit: str = "szt"
    inventory_item_id: Optional[str] = None
    inventory_matched_name: Optional[str] = None
    batch_id: Optional[str] = None
    message: str = ""
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


@app.post("/api/inventory/scan-expiration", response_model=ExpiryScanResponse)
async def scan_expiration(
    file: UploadFile = File(...),
    quantity: float = Form(...),
    restaurant_id: Optional[str] = Form(None),
    unit: str = Form("szt"),
):
    """Zdjecie etykiety → GPT-4o Vision → zapis partii w warehouse_inventory (+ bump stanu)."""
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Ilość musi być > 0.")

    client = _openai()
    await _guard_ai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    image_uris, _pages_meta = _images_from_upload(
        contents, file.content_type or "", file.filename or "", max_pages=2,
    )
    contents = b""

    user_content: list[dict] = [
        {"type": "text", "text": "Extract product name and expiration date from this package photo."}
    ]
    for uri in image_uris:
        user_content.append({"type": "image_url", "image_url": {"url": uri}})

    try:
        resp = await client.chat.completions.create(
            model=VISION_MODEL,
            temperature=0.0,
            messages=[
                {"role": "system", "content": _EXPIRY_SCAN_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_schema", "json_schema": _EXPIRY_SCAN_JSON_SCHEMA},
        )
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"OpenAI Vision: {e.message}") from e
    except OpenAIError as e:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"OpenAI: {e}") from e
    finally:
        image_uris = []

    billing = {"credits_deducted": 0, "credits_remaining": None}
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
        billing = await _bill_openai_response(
            httpx_c, resp, endpoint="/api/inventory/scan-expiration", model=VISION_MODEL,
        )

    raw = (resp.choices[0].message.content or "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Model zwrócił nie-JSON: {e}: {raw[:200]}") from e

    product_name = str(data.get("product_name") or "").strip()
    expiration_date = str(data.get("expiration_date") or "").strip()
    confidence = float(data.get("confidence_score") or 0)
    if not product_name or not re.match(r"^\d{4}-\d{2}-\d{2}$", expiration_date):
        raise HTTPException(status_code=422, detail="Nie udało się odczytać nazwy lub daty ważności.")

    status = _expiry_status(expiration_date)
    unit_clean = (unit or "szt").strip() or "szt"

    inventory_item_id: Optional[str] = None
    inventory_matched_name: Optional[str] = None
    batch_id: Optional[str] = None

    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
        inv_all = await sb_get(
            httpx_c, "inventory_items",
            params={"select": "id,name,quantity,unit", "limit": "2000"},
        ) or []
        best_id = None
        best_score = 0.0
        best_name = None
        best_qty = 0.0
        qn = _norm_pl(product_name)
        for row in inv_all:
            cand = _norm_pl(str(row.get("name") or ""))
            if not cand:
                continue
            score = max(
                float(fuzz.token_set_ratio(qn, cand)),
                float(fuzz.partial_ratio(qn, cand)),
            )
            if score > best_score:
                best_score = score
                best_id = row.get("id")
                best_name = row.get("name")
                best_qty = float(row.get("quantity") or 0)
        if best_id and best_score >= FUZZY_MATCH_THRESHOLD:
            inventory_item_id = str(best_id)
            inventory_matched_name = str(best_name or "")
            try:
                await sb_patch(
                    httpx_c,
                    "inventory_items",
                    {"id": f"eq.{inventory_item_id}"},
                    {"quantity": best_qty + float(quantity)},
                )
            except Exception:
                logging.exception("expiry scan: failed to bump inventory quantity")

        payload = {
            "restaurant_id": restaurant_id or None,
            "inventory_item_id": inventory_item_id,
            "product_name": product_name,
            "quantity": float(quantity),
            "unit": unit_clean,
            "expiration_date": expiration_date,
            "status": status,
            "confidence_score": confidence,
            "source": "vision_scan",
        }
        try:
            inserted = await sb_post(httpx_c, "warehouse_inventory", payload)
            if isinstance(inserted, list) and inserted:
                batch_id = inserted[0].get("id")
            elif isinstance(inserted, dict):
                batch_id = inserted.get("id")
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Nie zapisano partii — uruchom migrację ADD_WAREHOUSE_INVENTORY_EXPIRY.sql. "
                    f"Szczegóły: {e}"
                ),
            ) from e

    msg = (
        f"Dodano {quantity:g} {unit_clean} · {product_name} "
        f"(ważne do {expiration_date}, status: {status})"
    )
    if inventory_matched_name:
        msg += f". Dopasowano do magazynu: {inventory_matched_name}."

    return ExpiryScanResponse(
        product_name=product_name,
        expiration_date=expiration_date,
        confidence_score=confidence,
        status=status,
        quantity=float(quantity),
        unit=unit_clean,
        inventory_item_id=inventory_item_id,
        inventory_matched_name=inventory_matched_name,
        batch_id=batch_id,
        message=msg,
        credits_deducted=int(billing.get("credits_deducted") or 0),
        credits_remaining=billing.get("credits_remaining"),
    )


@app.get("/api/inventory/expiry-daily-job")
async def expiry_daily_job():
    """Scheduler: odśwież statusy; alert gdy days_left ∈ alert_triggers (domyślnie 7/3/1)."""
    from datetime import date as _date, timedelta

    today = _date.today()
    warn_until = today + timedelta(days=14)  # max look-ahead for custom triggers
    alerts: list[dict] = []
    dish: Optional[str] = None

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as httpx_c:
        try:
            # Refresh endpoint: PostgREST RPC. Use sb_post() so we validate
            # the rest path (prevents SSRF-style URL construction findings).
            await sb_post(httpx_c, "rpc/warehouse_inventory_refresh_status", {})
        except Exception:
            logging.exception("expiry job: refresh_status RPC failed")

        rows = await sb_get(
            httpx_c,
            "warehouse_inventory",
            params={
                "select": "id,restaurant_id,product_name,quantity,unit,expiration_date,status,alert_triggers",
                "expiration_date": f"lte.{warn_until.isoformat()}",
                "quantity": "gt.0",
                "limit": "500",
            },
        ) or []

        batches = []
        for r in rows:
            try:
                exp = _date.fromisoformat(str(r.get("expiration_date"))[:10])
            except Exception:
                continue
            if exp < today:
                continue
            if float(r.get("quantity") or 0) <= 0:
                continue
            batches.append(r)

        names = [str(b.get("product_name") or "") for b in batches if b.get("product_name")]
        if names:
            try:
                await _guard_ai(needs_credits=False)
                client = _openai()
                resp = await client.chat.completions.create(
                    model=CHAT_MODEL,
                    temperature=0.4,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "Jesteś szefem kuchni. Na podstawie produktów kończących ważność "
                                "zaproponuj jedno konkretne „Danie dnia” po polsku "
                                "(nazwa + 1 zdanie). Odpowiedz samym tekstem."
                            ),
                        },
                        {"role": "user", "content": f"Produkty do wykorzystania: {', '.join(names)}"},
                    ],
                )
                dish = (resp.choices[0].message.content or "").strip() or None
            except Exception:
                logging.exception("expiry job: dish suggestion failed")

        for i, b in enumerate(batches):
            exp = _date.fromisoformat(str(b["expiration_date"])[:10])
            days_left = (exp - today).days
            triggers = b.get("alert_triggers") or [7, 3, 1]
            if not isinstance(triggers, list):
                triggers = [7, 3, 1]
            triggers_i = {int(x) for x in triggers if str(x).lstrip('-').isdigit() or isinstance(x, (int, float))}
            if days_left not in triggers_i and days_left != 0:
                continue
            message = (
                f"Produkt {b['product_name']} kończy ważność DZIŚ! Użyj go!"
                if days_left == 0
                else f"Produkt {b['product_name']} kończy ważność za {days_left} dni! Użyj go!"
            )
            # Expo Push + log
            logging.info("EXPIRY_ALERT %s", message)
            alerts.append({
                "restaurant_id": b.get("restaurant_id"),
                "batch_id": b.get("id"),
                "product_name": b.get("product_name"),
                "days_left": days_left,
                "alert_day": days_left,
                "message": message,
                "dish_of_the_day": dish if i == 0 else None,
            })
        if alerts:
            try:
                await sb_post(httpx_c, "warehouse_expiry_alerts", alerts)
            except Exception:
                # retry without alert_day if column missing
                for a in alerts:
                    a.pop("alert_day", None)
                try:
                    await sb_post(httpx_c, "warehouse_expiry_alerts", alerts)
                except Exception:
                    logging.exception("expiry job: alert insert failed")

            # Wyślij Expo Push do zarejestrowanych urządzeń
            try:
                tokens = await sb_get(
                    httpx_c,
                    "device_push_tokens",
                    params={"select": "token", "limit": "500"},
                ) or []
                push_msgs = []
                for t in tokens:
                    tok = str(t.get("token") or "").strip()
                    if not tok:
                        continue
                    for a in alerts[:20]:
                        push_msgs.append({
                            "to": tok,
                            "title": "Termin przydatności",
                            "body": a["message"],
                            "sound": "default",
                            "data": {"type": "expiry", "product_name": a.get("product_name")},
                        })
                # Expo accepts arrays up to ~100
                for i in range(0, len(push_msgs), 80):
                    chunk = push_msgs[i:i + 80]
                    if not chunk:
                        continue
                    await httpx_c.post(
                        "https://exp.host/--/api/v2/push/send",
                        json=chunk,
                        headers={"Accept": "application/json", "Content-Type": "application/json"},
                        timeout=30.0,
                    )
            except Exception:
                logging.exception("expiry job: Expo Push failed")

    return {
        "ok": True,
        "alert_count": len(alerts),
        "dish_of_the_day": dish,
        "reminders": [a["message"] for a in alerts],
    }


@app.get("/api/manager/core-alerts-job")
async def manager_core_alerts_job(push: bool = True):
    """Cron: policz alerty CORE i opcjonalnie wyślij push (severity critical/warn)."""
    res = await _run_manager_core_alerts(period_type="week", limit_days=7)
    alerts = [a for a in (res.get("alerts") or []) if a.get("severity") in ("critical", "warn")]
    pushed = 0
    if push and alerts:
        async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as httpx_c:
            try:
                tokens = await sb_get(
                    httpx_c,
                    "device_push_tokens",
                    params={"select": "token", "limit": "500"},
                ) or []
                push_msgs = []
                for a in alerts[:8]:
                    body = f"[{a.get('pair')}] {a.get('name')}: {a.get('detail', '')}"[:180]
                    for t in tokens:
                        tok = t.get("token")
                        if not tok:
                            continue
                        push_msgs.append({
                            "to": tok,
                            "title": "Manager AI — alert",
                            "body": body,
                            "sound": "default",
                            "data": {"type": "manager_core", "pair": a.get("pair")},
                        })
                for i in range(0, len(push_msgs), 80):
                    chunk = push_msgs[i:i + 80]
                    if not chunk:
                        continue
                    await httpx_c.post(
                        "https://exp.host/--/api/v2/push/send",
                        json=chunk,
                        headers={"Accept": "application/json", "Content-Type": "application/json"},
                        timeout=30.0,
                    )
                    pushed += len(chunk)
            except Exception:
                logging.exception("manager core alerts: Expo Push failed")
    return {
        "ok": True,
        "alert_count": len(res.get("alerts") or []),
        "pushed_messages": pushed,
        "speech": res.get("assistant_speech"),
        "alerts": res.get("alerts") or [],
    }


@app.post("/api/menu/scan", response_model=MenuScanResponse)
async def menu_scan(file: UploadFile = File(...)):
    """Skanuje wgrane menu (obraz lub PDF) modelem GPT-4o Vision i zwraca podgląd potraw.
    Nic nie zapisuje — użytkownik zatwierdza po edycji (potwierdzenie w /menu/confirm-scan)."""
    require_tenant_account_key()
    client = _openai()
    await _guard_ai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    image_uris, pages_meta = _images_from_upload(contents, file.content_type or "", file.filename or "")
    contents = b""

    data, billing = await _openai_vision_json_batches(
        client,
        image_uris=image_uris,
        system_prompt=_MENU_SCAN_SYSTEM_PROMPT,
        json_schema=_MENU_SCAN_JSON_SCHEMA,
        endpoint="/api/menu/scan",
        user_text=(
            "Wyodrębnij WSZYSTKIE potrawy z tego menu zgodnie ze schematem. "
            f"Strony {pages_meta.get('pages_rendered')}"
            f"{'/' + str(pages_meta.get('pages_total')) if pages_meta.get('truncated') else ''}."
        ),
        pages_meta=pages_meta,
        merge_fn=_merge_menu_vision_batches,
    )
    image_uris = []

    dishes_raw = data.get("dishes") or []
    dishes: list[MenuScanDish] = []
    for d in dishes_raw:
        try:
            dishes.append(MenuScanDish(**d))
        except Exception:
            continue

    warnings: list[str] = []
    if not dishes:
        warnings.append("Nie udało się rozpoznać żadnej potrawy na wgranym menu.")
    if pages_meta.get("truncated"):
        warnings.append(
            f"PDF ma {pages_meta.get('pages_total')} stron — przeanalizowano pierwsze "
            f"{pages_meta.get('pages_rendered')} (limit {PDF_MAX_PAGES})."
        )
    # Ujednolić jednostki: ten sam składnik = ta sama jednostka we wszystkich potrawach.
    _canonicalize_ingredient_units(dishes)
    _attach_image_context_tags(dishes)
    return MenuScanResponse(
        dishes=dishes, warnings=warnings,
        credits_deducted=int(billing.get("credits_deducted") or 0),
        credits_remaining=billing.get("credits_remaining"),
    )


# --- 6a2) OCR tekstu receptury (notatki / odręczne) ----------------------------

_RECIPE_OCR_JSON_SCHEMA = {
    "name": "RecipeOcrText",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["text"],
        "properties": {
            "text": {
                "type": "string",
                "description": "Pełny tekst przepisu odczytany z obrazu, po polsku.",
            },
        },
    },
}


class RecipeOcrResponse(BaseModel):
    text: str
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


@app.post("/api/recipes/ocr-text", response_model=RecipeOcrResponse)
async def recipe_ocr_text(file: UploadFile = File(...)):
    """Odczytuje tekst przepisu z zdjęcia notatek (odręczne lub drukowane)."""
    client = _openai()
    await _guard_ai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    image_uris, pages_meta = _images_from_upload(
        contents, file.content_type or "", file.filename or "", max_pages=12,
    )
    contents = b""

    data, billing = await _openai_vision_json_batches(
        client,
        image_uris=image_uris,
        system_prompt=(
            "Jesteś asystentem kuchennym. Odczytujesz przepisy z notatek i zdjęć. "
            "Zwracasz wyłącznie JSON ze schematem."
        ),
        json_schema=_RECIPE_OCR_JSON_SCHEMA,
        endpoint="/api/recipes/ocr-text",
        user_text=(
            "Przeczytaj CAŁY tekst przepisu / receptury z tych stron notatek. "
            "Zachowaj kolejność kroków i ilości. Zwróć wyłącznie treść przepisu po polsku, "
            "bez komentarzy ani wstępów. Jeśli tekst jest nieczytelny — oddaj to, co da się odczytać."
        ),
        cont_text=(
            "Kontynuacja przepisu z kolejnych stron. Dopisz wyłącznie tekst z TYCH stron "
            "(kolejne kroki / składniki), bez powtarzania wcześniejszych."
        ),
        pages_meta=pages_meta,
        merge_fn=_merge_recipe_ocr_batches,
    )
    image_uris = []

    text = (data.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Nie udało się odczytać tekstu przepisu ze zdjęcia.")

    return RecipeOcrResponse(
        text=text,
        credits_deducted=int(billing.get("credits_deducted") or 0),
        credits_remaining=billing.get("credits_remaining"),
    )


# --- 6b) Sugestie receptury (AI) ---------------------------------------------

_MENU_SUGGEST_JSON_SCHEMA = {
    "name": "MenuRecipeSuggestions",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["dishes"],
        "properties": {
            "dishes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "name",
                        "suggested_portion_weight_value",
                        "suggested_portion_weight_unit",
                        "suggested_ingredients",
                    ],
                    "properties": {
                        "name": {"type": "string"},
                        "suggested_portion_weight_value": {"type": ["number", "null"]},
                        "suggested_portion_weight_unit": {
                            "type": ["string", "null"],
                            "enum": ["g", "ml", "szt", None],
                        },
                        "suggested_ingredients": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "quantity", "unit"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "quantity": {"type": "number"},
                                    "unit": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            },
        },
    },
}


class SuggestRecipeDishIn(BaseModel):
    name: str
    category: Optional[str] = None
    ingredients: list[MenuScanIngredient] = Field(default_factory=list)
    portion_weight_value: Optional[float] = None
    portion_weight_unit: Optional[str] = None


class SuggestRecipeRequest(BaseModel):
    dishes: list[SuggestRecipeDishIn]


class SuggestedDishOut(BaseModel):
    name: str
    suggested_ingredients: list[MenuScanIngredient] = Field(default_factory=list)
    suggested_portion_weight_value: Optional[float] = None
    suggested_portion_weight_unit: Optional[str] = None


class SuggestRecipeResponse(BaseModel):
    dishes: list[SuggestedDishOut]
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


_MENU_SUGGEST_BATCH_SIZE = 4
_MENU_SUGGEST_BATCH_TIMEOUT_S = 55.0

_MENU_SUGGEST_SYSTEM_PROMPT = (
    "Jesteś doświadczonym szefem kuchni. Dla listy potraw restauracyjnych proponujesz "
    "receptury na 1 porcję zgodnie z powszechnie stosowanymi standardami gastronomicznymi.\n\n"
    "Dla KAŻDEJ potrawy zwróć obiekt z polami:\n"
    "- name: dokładnie taka sama nazwa jak wejściowa.\n"
    "- suggested_portion_weight_value: łączna wzorcowa waga/objętość porcji "
    "(np. burger ≈ 350, spaghetti ≈ 400, latte ≈ 250). Jeśli wejście `has_portion_weight=true`, "
    "zwróć null (użytkownik już podał gramaturę).\n"
    "- suggested_portion_weight_unit: 'g' (dania stałe), 'ml' (napoje), 'szt' (jeżeli liczone w sztukach). "
    "Null jeśli suggested_portion_weight_value=null.\n"
    "- suggested_ingredients: lista składników z realistycznymi gramaturami wzorcowymi "
    "(np. bułka 80g, kotlet wołowy 150g, ser 20g, sałata 20g, sos 30g). Zasady:\n"
    "   * Jeśli `has_ingredients=true` (użytkownik już podał składniki), UŻYJ dokładnie tych nazw "
    "     (pole name musi być identyczne) — możesz jedynie doszacować ilości.\n"
    "   * Jeśli `has_ingredients=false`, wygeneruj kompletny wzorcowy skład (5–10 pozycji).\n"
    "   * Jednostki: 'g' (waga), 'ml' (płyny), 'szt' (jajko, plaster itp.).\n"
    "   * SPÓJNOŚĆ JEDNOSTEK (KRYTYCZNE): ten sam składnik musi mieć IDENTYCZNĄ "
    "jednostkę we WSZYSTKICH potrawach naraz. Jeśli 'śmietana' jest w ml w jednym "
    "daniu, MUSI być w ml we wszystkich. Płyny/nabiał/oleje/sosy (śmietana, mleko, "
    "olej, sos, bulion, woda, sok, krem) ZAWSZE w 'ml'; produkty stałe ZAWSZE w 'g'; "
    "liczone na sztuki (jajko, plaster, bułka) w 'szt'. Nigdy nie mieszaj g i ml dla "
    "tego samego produktu.\n"
    "   * Ilości > 0 — WYŁĄCZNIE liczby całkowite (integer). Zakaz ułamków typu 0.25.\n"
    "   * KAŻDY składnik MUSI mieć quantity > 0 (nigdy null / 0) — typowe gramatury porcji: "
    "mięso 120–180 g, warzywa 40–80 g, sos 20–40 ml, przyprawy 1–3 g.\n"
    "   * Przyprawy / małe ilości (sól, pieprz, przyprawy): minimum 1–2 jednostki na porcję "
    "(np. 1 g lub 2 g), nigdy ułamki gramów.\n"
    "   * CAŁY PRODUKT (KRYTYCZNE): jeśli przepis używa części (żółtko, białko, skórka cytryny, "
    "sok z cytryny, ząbek czosnku, miąższ awokado), podaj nazwę CAŁEGO produktu magazynowego "
    "(jajko, cytryna, czosnek, awokado) — nie części.\n"
    "   * LICZBA POJEDYNCZA (KRYTYCZNE): zapisuj składniki w formie kanonicznej liczby pojedynczej "
    "(pomidor nie pomidory, jajko nie jajka, ziemniak nie ziemniaki).\n"
    "   * SKŁADNIKI KUPOWANE, NIE DANIA: nie twórz pozycji magazynowej o nazwie gotowego dania "
    "(risotto, paella). Zamiast tego podaj surowiec (ryż arborio / ryż do risotto).\n"
    "   * PÓŁPRODUKT COMBO: jeśli pozycja to przetworzona mieszanka bez jednego SKU "
    "(warzywa grillowane, mix sałat, pieczone warzywa), nadal wymień osobne surowce w recepturze "
    "dania; nie wstawiaj samej nazwy mieszanki jako jedynego składnika.\n"
    "   * KATEGORYCZNIE ZAKAZANE: 'Porcja', 'Porcje', 'Wielkość porcji', 'Gramatura', "
    "'Gramatura porcji' NIE MOGĄ pojawić się w `suggested_ingredients`. Wielkość porcji "
    "zapisuj TYLKO w `suggested_portion_weight_value` + `suggested_portion_weight_unit`.\n\n"
    "Zwróć wyłącznie poprawny JSON zgodny ze schematem."
)


@app.post("/api/menu/suggest-recipe", response_model=SuggestRecipeResponse)
async def menu_suggest_recipe(req: SuggestRecipeRequest):
    """Dla listy potraw AI proponuje brakujące składniki i/lub gramaturę.
    Dla każdej potrawy:
    - jeśli `ingredients` puste → proponuje pełny wzorcowy skład + gramatury,
    - jeśli `ingredients` niepuste, ale bez ilości LUB brak `portion_weight_value` →
      proponuje gramatury wzorcowe (nie zmienia nazw składników użytkownika).
    Zwraca WYŁĄCZNIE sugestie — decyduje frontend, czy je zastosować.

    Przetwarzanie partiami (max 4 dania / call OpenAI), żeby uniknąć timeoutów proxy Railway.
    """
    if not req.dishes:
        raise HTTPException(status_code=400, detail="Brak potraw do przetworzenia.")

    client = _openai()
    await _guard_ai()

    payload_dishes = [
        {
            "name": d.name,
            "category": d.category or "Inne",
            "has_ingredients": bool(d.ingredients),
            "ingredients": [
                {"name": i.name, "has_quantity": i.quantity is not None, "unit": i.unit or "g"}
                for i in d.ingredients
            ],
            "has_portion_weight": d.portion_weight_value is not None,
            "portion_weight_unit_hint": d.portion_weight_unit,
        }
        for d in req.dishes
    ]

    out: list[SuggestedDishOut] = []
    credits_deducted = 0
    credits_remaining = None

    async def _suggest_batch(batch: list[dict]) -> tuple[list[SuggestedDishOut], dict]:
        try:
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=CHAT_MODEL,
                    temperature=0.2,
                    messages=[
                        {"role": "system", "content": _MENU_SUGGEST_SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps({"dishes": batch}, ensure_ascii=False)},
                    ],
                    response_format={"type": "json_schema", "json_schema": _MENU_SUGGEST_JSON_SCHEMA},
                ),
                timeout=_MENU_SUGGEST_BATCH_TIMEOUT_S,
            )
        except asyncio.TimeoutError as e:
            raise HTTPException(
                status_code=504,
                detail=(
                    "Sugestie AI przekroczyły limit czasu. "
                    "Spróbuj ponownie lub uruchom sugestie dla mniejszej liczby potraw."
                ),
            ) from e
        except APIError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Serwis AI chwilowo niedostępny: {e.message}",
            ) from e
        except OpenAIError as e:  # pragma: no cover
            raise HTTPException(
                status_code=502,
                detail=f"Serwis AI chwilowo niedostępny: {e}",
            ) from e

        billing = {"credits_deducted": 0, "credits_remaining": None}
        async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
            billing = await _bill_openai_response(
                httpx_c, resp, endpoint="/api/menu/suggest-recipe", model=CHAT_MODEL,
                extras={"dishes_count": len(batch)},
            )

        raw = (resp.choices[0].message.content or "").strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=502,
                detail="Model AI zwrócił niepoprawną odpowiedź. Spróbuj ponownie.",
            ) from e

        batch_out: list[SuggestedDishOut] = []
        for d in data.get("dishes") or []:
            try:
                batch_out.append(SuggestedDishOut(**d))
            except Exception:
                continue
        return batch_out, billing

    for i in range(0, len(payload_dishes), _MENU_SUGGEST_BATCH_SIZE):
        batch = payload_dishes[i : i + _MENU_SUGGEST_BATCH_SIZE]
        batch_out, billing = await _suggest_batch(batch)
        out.extend(batch_out)
        credits_deducted += int(billing.get("credits_deducted") or 0)
        if billing.get("credits_remaining") is not None:
            credits_remaining = billing.get("credits_remaining")

    # Ujednolić jednostki: ten sam składnik = ta sama jednostka we wszystkich potrawach.
    _canonicalize_ingredient_units(out)
    # Części produktu (żółtko…) → cały produkt magazynowy (jajko).
    _apply_whole_product_names_to_dishes(out)
    # Ilości: zawsze całkowite ≥ 1 (bez 0.25 g pieprzu).
    _apply_integer_quantities_to_dishes(out)
    return SuggestRecipeResponse(
        dishes=out,
        credits_deducted=credits_deducted,
        credits_remaining=credits_remaining,
    )


# --- 6b2) Inspiracje Kulinarne — pełny przepis AI + cache --------------------

_INSPIRATION_CACHE_FILE = Path(__file__).parent / ".inspiration_recipe_cache.json"

_INSPIRATION_SYSTEM = (
    "You are a professional Head Chef and Food Technologist acting as an AI assistant "
    "for a culinary mobile application's \"Inspirations\" section. Your task is to generate "
    "a comprehensive, restaurant-quality recipe based ONLY on the Polish dish name provided "
    "by the user.\n\n"
    "CRITICAL RULES:\n"
    "1. Language: You must always respond in Polish.\n"
    "2. Output Format: You must return the data strictly as a valid JSON object. "
    "Do not include any markdown formatting (like ```json) in the raw API response.\n"
    "3. Scaling: Default measurements must be calculated for exactly 2 portions "
    "(except for shared platters/boards, which should be scaled for 4-6 portions). "
    "All ingredients must use strict metric units (g, ml, pcs, tbsp, tsp) as separate "
    "numeric values and text labels to allow frontend scaling. "
    "Use Polish unit labels: g, ml, szt, łyżeczka, łyżka.\n"
    "3b. QUANTITIES (CRITICAL): base_quantity MUST be whole integers ≥ 1. "
    "Never use fractions like 0.25. For spices/salt/pepper use at least 1–2 units "
    "PER PORTION (so for 2 portions: base_quantity ≥ 2–4).\n"
    "4. Tone: Impersonal verbs for steps (e.g., \"Pokroić\", \"Rozgrzać\")."
)

_INSPIRATION_JSON_SCHEMA = {
    "name": "InspirationRecipe",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "dish_name",
            "prep_time_minutes",
            "difficulty",
            "default_portions",
            "short_teaser",
            "ingredients_sections",
            "steps",
            "chef_tip",
        ],
        "properties": {
            "dish_name": {"type": "string"},
            "prep_time_minutes": {"type": "integer"},
            "difficulty": {"type": "string", "enum": ["Łatwy", "Średni", "Trudny"]},
            "default_portions": {"type": "integer"},
            "short_teaser": {"type": "string"},
            "ingredients_sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["section_name", "ingredients"],
                    "properties": {
                        "section_name": {"type": "string"},
                        "ingredients": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "base_quantity", "unit"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "base_quantity": {"type": "number"},
                                    "unit": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            },
            "steps": {"type": "array", "items": {"type": "string"}},
            "chef_tip": {"type": "string"},
        },
    },
}


def _inspiration_cache_key(slug: str, dish_name: str) -> str:
    raw = (slug or "").strip().lower() or (dish_name or "").strip().lower()
    return re.sub(r"\s+", "_", raw)


def _read_inspiration_cache() -> dict:
    try:
        if _INSPIRATION_CACHE_FILE.exists():
            return json.loads(_INSPIRATION_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _write_inspiration_cache(cache: dict) -> None:
    try:
        _INSPIRATION_CACHE_FILE.write_text(
            json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8"
        )
    except Exception as e:
        logger.warning("inspiration cache write failed: %s", e)


class InspirationRecipeRequest(BaseModel):
    dish_name: str
    slug: Optional[str] = None
    force_refresh: bool = False


class InspirationIngredient(BaseModel):
    name: str
    base_quantity: float
    unit: str


class InspirationIngredientSection(BaseModel):
    section_name: str
    ingredients: list[InspirationIngredient] = Field(default_factory=list)


class InspirationRecipeResponse(BaseModel):
    dish_name: str
    prep_time_minutes: int
    difficulty: str
    default_portions: int
    short_teaser: str
    ingredients_sections: list[InspirationIngredientSection]
    steps: list[str]
    chef_tip: str
    cached: bool = False
    slug: Optional[str] = None
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


@app.post("/api/inspirations/recipe", response_model=InspirationRecipeResponse)
async def inspiration_recipe(req: InspirationRecipeRequest):
    """Pełny przepis JSON dla modułu Inspiracje — z cache po slug/nazwie."""
    # Wymuś prawdziwy tenant (X-Account-Key / JWT) — nigdy nie debituj shared „default”.
    require_tenant_account_key()
    dish_name = (req.dish_name or "").strip()
    if not dish_name:
        raise HTTPException(status_code=400, detail="Podaj nazwę potrawy.")
    slug = (req.slug or "").strip() or None
    key = _inspiration_cache_key(slug or "", dish_name)

    if not req.force_refresh:
        cache = _read_inspiration_cache()
        hit = cache.get(key)
        if isinstance(hit, dict) and hit.get("dish_name"):
            try:
                cached_recipe = InspirationRecipeResponse(
                    **{**hit, "cached": True, "slug": slug,
                       "credits_deducted": 0, "credits_remaining": None}
                )
                _normalize_inspiration_quantities(cached_recipe)
                return cached_recipe
            except Exception:
                pass

    client = _openai()
    await _guard_ai()

    try:
        resp = await client.chat.completions.create(
            model=INSPIRATIONS_MODEL,
            temperature=0.35,
            messages=[
                {"role": "system", "content": _INSPIRATION_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Wygeneruj przepis dla potrawy: {dish_name}. "
                        "Zwróć wyłącznie JSON zgodny ze schematem."
                    ),
                },
            ],
            response_format={"type": "json_schema", "json_schema": _INSPIRATION_JSON_SCHEMA},
        )
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"OpenAI: {e.message}") from e
    except OpenAIError as e:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"OpenAI: {e}") from e

    billing = {"credits_deducted": 0, "credits_remaining": None}
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
        billing = await _bill_openai_response(
            httpx_c, resp, endpoint="/api/inspirations/recipe", model=INSPIRATIONS_MODEL,
            extras={"dish_name": dish_name, "slug": slug},
        )

    raw = (resp.choices[0].message.content or "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Model zwrócił nie-JSON: {e}: {raw[:200]}") from e

    try:
        recipe = InspirationRecipeResponse(
            **data,
            cached=False,
            slug=slug,
            credits_deducted=int(billing.get("credits_deducted") or 0),
            credits_remaining=billing.get("credits_remaining"),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Niepoprawna struktura przepisu: {e}") from e

    _normalize_inspiration_quantities(recipe)

    cache = _read_inspiration_cache()
    cache[key] = recipe.model_dump(exclude={"cached", "credits_deducted", "credits_remaining"})
    _write_inspiration_cache(cache)
    return recipe


# --- 6c) Zapis zatwierdzonych potraw -----------------------------------------

class ConfirmMenuIngredient(BaseModel):
    name: str
    quantity: Optional[float] = None
    unit: str = "g"
    piece_weight_g: Optional[float] = None


class ConfirmMenuDish(BaseModel):
    name: str
    category: str = "Inne"
    price_pln: float = 0.0
    portion_weight_value: Optional[float] = None
    portion_weight_unit: Optional[str] = None
    ingredients: list[ConfirmMenuIngredient] = Field(default_factory=list)


class ConfirmMenuScanRequest(BaseModel):
    dishes: list[ConfirmMenuDish]
    # True tylko gdy użytkownik wybrał TAK w dialogu AI — NIE = zapis bez uzupełnień.
    fill_empty_with_ai: bool = False


def _make_pos_id_for_category(category: str, offset: int) -> str:
    prefix_map = {
        "Burgery": "BRG", "Dania główne": "DAN", "Sałatki": "SAL",
        "Makarony": "MAK", "Zupy": "ZUP", "Pizza": "PIZ",
        "Przystawki": "PRZ", "Desery": "DESR", "Napoje": "NAP",
        "Alkohole": "ALK", "Inne": "INN",
    }
    return f"{prefix_map.get(category, 'INN')}-{str(offset).zfill(3)}"


# Sztywne kategorie systemowe (Menu-to-Inventory Onboarding).
MENU_CATEGORIES = ['Burgery', 'Pizze', 'Zupy', 'Dania obiadowe', 'Sałatki',
                   'Desery', 'Napoje', 'Półprodukty', 'Inne']
WAREHOUSE_CATEGORIES = [
    'Mięso i wędliny', 'Ryby i owoce morza', 'Nabiał', 'Warzywa i owoce', 'Pieczywo',
    'Suchy magazyn', 'Oleje i tłuszcze', 'Przyprawy', 'Mrożonki', 'Napoje', 'Alkohole',
    'Wywary i sosy', 'Półprodukty', 'Chemia i czystość', 'Opakowania', 'Inne',
]
_WAREHOUSE_CAT_COLORS = {
    'Mięso i wędliny': '#DC2626', 'Ryby i owoce morza': '#0284C7', 'Nabiał': '#F59E0B',
    'Warzywa i owoce': '#16A34A', 'Pieczywo': '#78716C', 'Suchy magazyn': '#B45309',
    'Oleje i tłuszcze': '#CA8A04', 'Przyprawy': '#D97706', 'Mrożonki': '#0EA5E9',
    'Napoje': '#0891B2', 'Alkohole': '#7C3AED', 'Wywary i sosy': '#EA580C',
    'Półprodukty': '#A855F7',
    'Chemia i czystość': '#6366F1', 'Opakowania': '#64748B', 'Inne': '#94A3B8',
}


async def _ensure_warehouse_categories(client: httpx.AsyncClient) -> dict:
    """Zapewnia istnienie sztywnych kategorii magazynowych. Zwraca mapę {norm_name: id}."""
    existing = await sb_get(client, "inventory_categories", params={"select": "id,name,sort_order"}) or []
    by_norm = {_norm(r["name"]): r["id"] for r in existing}
    max_sort = max((int(r.get("sort_order") or 0) for r in existing), default=0)
    for cat in WAREHOUSE_CATEGORIES:
        if _norm(cat) in by_norm:
            continue
        max_sort += 1
        try:
            row = await sb_post(client, "inventory_categories", {
                "name": cat, "color": _WAREHOUSE_CAT_COLORS.get(cat, "#94A3B8"),
                "sort_order": max_sort,
            })
            created = row[0] if isinstance(row, list) else row
            by_norm[_norm(cat)] = created["id"]
        except httpx.HTTPStatusError:
            pass
    return by_norm


async def _gpt_categorize_ingredients(names: list[str],
                                      httpx_c: Optional[httpx.AsyncClient] = None) -> dict:
    """GPT-4o-mini przypisuje każdy składnik do jednej ze sztywnych kategorii magazynowych.
    Zwraca {name: category}. Best-effort — brakujące → 'Inne'."""
    result = {n: "Inne" for n in names}
    if not names:
        return result
    try:
        client = _openai()
        cats = ", ".join(WAREHOUSE_CATEGORIES)
        prompt = (
            "Przypisz każdy produkt spożywczy/gastronomiczny do JEDNEJ kategorii magazynowej.\n"
            f"Dozwolone kategorie (użyj DOKŁADNIE tych nazw): {cats}.\n"
            "Zwróć JSON: {\"items\": [{\"name\": <nazwa>, \"category\": <kategoria>}]}.\n"
            f"Produkty: {json.dumps(names, ensure_ascii=False)}"
        )
        resp = await client.chat.completions.create(
            model=CHAT_MODEL, temperature=0.0,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        if httpx_c is not None:
            await _bill_openai_response(
                httpx_c, resp,
                endpoint="/api/menu/confirm-scan",
                model=CHAT_MODEL,
                extras={"categorize_count": len(names)},
            )
        data = json.loads(resp.choices[0].message.content or "{}")
        for it in (data.get("items") or []):
            nm = (it.get("name") or "").strip()
            cat = (it.get("category") or "Inne").strip()
            if cat not in WAREHOUSE_CATEGORIES:
                cat = "Inne"
            # dopasuj do oryginalnej nazwy (case-insensitive)
            for orig in names:
                if _norm(orig) == _norm(nm):
                    result[orig] = cat
                    break
    except Exception as e:  # noqa: BLE001
        logger.warning(f"_gpt_categorize_ingredients failed: {e}")
    return result


async def _auto_onboard_inventory(client: httpx.AsyncClient, ingredient_names: list[str]):
    """Dla każdego składnika receptury, którego NIE MA w aktywnym magazynie, tworzy produkt
    (stan 0, min 5, bufor 20%) z kategorią GPT — jak w gastro-manager-15.

    Soft-deleted (`is_active=false`) NIE blokują: najpierw przywracamy po nazwie, potem tworzymy.
    Soft-deleted wczytywane RAZ na start (bez N×5000 przy każdym UNIQUE).
    """
    warnings: list[str] = []
    seen: dict[str, str] = {}
    for n in ingredient_names:
        nm = _normalize_ingredient_name((n or "").strip())
        if not nm or _is_porcja_row(nm):
            continue
        key = _food_match_key(nm) or _norm_name(nm)
        if key and key not in seen:
            seen[key] = nm
    if not seen:
        return 0, [], warnings

    has_active_col = True
    try:
        active = await sb_get(client, "inventory_items", params={
            "select": "id,name,is_combo_polprodukt",
            "is_active": "eq.true",
            "limit": "5000",
        }) or []
    except httpx.HTTPStatusError as e:
        if "is_active" not in (e.response.text or ""):
            raise
        has_active_col = False
        active = await sb_get(client, "inventory_items", params={
            "select": "id,name,is_combo_polprodukt", "limit": "5000",
        }) or []

    inactive: list[dict] = []
    if has_active_col:
        try:
            inactive = await sb_get(client, "inventory_items", params={
                "select": "id,name,is_combo_polprodukt",
                "is_active": "eq.false",
                "limit": "5000",
            }) or []
        except httpx.HTTPStatusError:
            inactive = []

    created: list[dict] = []
    to_create: list[str] = []

    async def _reactivate(row: dict, label: str) -> dict:
        await sb_patch(
            client, "inventory_items", {"id": f"eq.{row['id']}"},
            {"is_active": True},
        )
        info = {
            "name": row.get("name") or label,
            "category": "Przywrócony",
            "is_combo_polprodukt": bool(row.get("is_combo_polprodukt")),
            "restored": True,
        }
        active.append({"id": row.get("id"), "name": info["name"],
                       "is_combo_polprodukt": info["is_combo_polprodukt"]})
        # Bez żółtych komunikatów „było usunięte / przywrócono” — to szum dla użytkownika.
        return info

    for _k, orig in seen.items():
        if _find_inventory_duplicate(orig, active, threshold=86):
            continue
        dead = _find_inventory_duplicate(orig, inactive, threshold=86) if inactive else None
        if dead and dead.get("id"):
            try:
                created.append(await _reactivate(dead, orig))
                inactive = [r for r in inactive if r.get("id") != dead.get("id")]
            except Exception as re:  # noqa: BLE001
                logger.warning("%s: nie przywrócono (%s) — spróbuję utworzyć.", orig, re)
                to_create.append(orig)
            continue
        to_create.append(orig)

    if not to_create:
        return len(created), created, warnings

    await _ensure_warehouse_categories(client)
    cat_map = await _gpt_categorize_ingredients(to_create, client)
    cat_cache: dict = {}

    for name in to_create:
        is_combo = _is_combo_polprodukt_name(name)
        cat_name = "Półprodukty" if is_combo else cat_map.get(name, "Inne")
        if cat_name not in WAREHOUSE_CATEGORIES:
            cat_name = "Inne"
        cat_id = await _resolve_category_id_cached(client, cat_name, cat_cache)
        payload = {
            "name": name, "category_id": cat_id, "quantity": 0,
            "unit": "porcja" if is_combo else "szt",
            "min_quantity": 5, "safety_buffer_percent": 20,
            "is_combo_polprodukt": is_combo, "unit_cost": 0,
        }
        try:
            row = await sb_post(client, "inventory_items", payload)
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")
            body_l = body.lower()
            if "safety_buffer_percent" in body:
                payload.pop("safety_buffer_percent", None)
                try:
                    row = await sb_post(client, "inventory_items", payload)
                except httpx.HTTPStatusError as e2:
                    body2 = (e2.response.text or "")
                    if any(x in body2.lower() for x in ("duplicate", "unique", "23505")):
                        # Dokładne dopasowanie po nazwie (także soft-deleted).
                        try:
                            hit_rows = await sb_get(client, "inventory_items", params={
                                "select": "id,name,is_combo_polprodukt,is_active",
                                "name": f"eq.{name}",
                                "limit": "5",
                            }) or []
                        except httpx.HTTPStatusError:
                            hit_rows = []
                        restored_ok = False
                        for hr in hit_rows:
                            if hr.get("is_active") is False and hr.get("id"):
                                try:
                                    created.append(await _reactivate(hr, name))
                                    restored_ok = True
                                    break
                                except Exception:
                                    pass
                        if not restored_ok:
                            warnings.append(f"{name}: nie utworzono w magazynie ({body2[:100]}).")
                        continue
                    warnings.append(f"{name}: nie utworzono w magazynie ({body2[:100]}).")
                    continue
            elif any(x in body_l for x in ("duplicate", "unique", "23505")):
                try:
                    hit_rows = await sb_get(client, "inventory_items", params={
                        "select": "id,name,is_combo_polprodukt,is_active",
                        "name": f"eq.{name}",
                        "limit": "5",
                    }) or []
                except httpx.HTTPStatusError:
                    hit_rows = []
                restored_ok = False
                for hr in hit_rows:
                    if hr.get("is_active") is False and hr.get("id"):
                        try:
                            created.append(await _reactivate(hr, name))
                            restored_ok = True
                            break
                        except Exception:
                            pass
                if not restored_ok:
                    warnings.append(f"{name}: nie utworzono w magazynie ({body[:100]}).")
                continue
            else:
                warnings.append(f"{name}: nie utworzono w magazynie ({body[:100]}).")
                continue
        inv_id = None
        try:
            inv_id = (row[0] if isinstance(row, list) else row).get("id")
        except Exception:
            inv_id = None
        item_info: dict = {"name": name, "category": cat_name, "is_combo_polprodukt": is_combo}
        if is_combo and inv_id:
            combo_ings = _combo_default_ingredients(name)
            item_info["combo_ingredients_proposed"] = combo_ings
            for i, cname in enumerate(combo_ings):
                cname_n = _normalize_ingredient_name(cname)
                try:
                    await sb_post(client, "inventory_combo_ingredients", {
                        "inventory_item_id": inv_id,
                        "ingredient_name": cname_n,
                        "quantity": 1,
                        "unit": "szt",
                        "sort_order": i + 1,
                    })
                except Exception as ce:  # noqa: BLE001
                    warnings.append(f"{name}: składnik combo „{cname_n}” nie zapisany ({ce}).")
            warnings.append(
                f"„{name}” oznaczono jako półprodukt combo — zaproponowano składniki "
                f"({', '.join(combo_ings) if combo_ings else 'edytuj w Magazynie'})."
            )
        created.append(item_info)
        active.append({"id": inv_id, "name": name, "is_combo_polprodukt": is_combo})
    return len(created), created, warnings


async def _fill_empty_ingredients_for_confirm(
    dishes: list,
    *,
    warnings: list[str],
) -> None:
    """Jak gastro-manager-15: gdy potrawa nie ma składników, AI proponuje recepturę
    zanim confirm-scan zbierze listę do magazynu. In-place na `dishes`."""
    need = [
        d for d in dishes
        if (d.name or "").strip() and not any(
            (getattr(i, "name", None) or "").strip() for i in (d.ingredients or [])
        )
    ]
    if not need:
        return
    warnings.append(
        f"Uzupełniam receptury AI dla {len(need)} potraw bez składników "
        f"(wymagane do zapełnienia magazynu)."
    )
    client = _openai()
    by_lower: dict[str, list] = {}
    portion_by: dict[str, tuple] = {}
    for i in range(0, len(need), _MENU_SUGGEST_BATCH_SIZE):
        batch_dishes = need[i:i + _MENU_SUGGEST_BATCH_SIZE]
        batch = [
            {
                "name": d.name,
                "category": d.category or "Inne",
                "has_ingredients": False,
                "ingredients": [],
                "has_portion_weight": d.portion_weight_value is not None,
                "portion_weight_unit_hint": d.portion_weight_unit,
            }
            for d in batch_dishes
        ]
        try:
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=CHAT_MODEL,
                    temperature=0.2,
                    messages=[
                        {"role": "system", "content": _MENU_SUGGEST_SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps({"dishes": batch}, ensure_ascii=False)},
                    ],
                    response_format={"type": "json_schema", "json_schema": _MENU_SUGGEST_JSON_SCHEMA},
                ),
                timeout=_MENU_SUGGEST_BATCH_TIMEOUT_S,
            )
        except Exception as e:  # noqa: BLE001
            warnings.append(f"Sugestie AI (batch) pominięte: {e}")
            continue
        try:
            async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
                await _bill_openai_response(
                    httpx_c, resp, endpoint="/api/menu/confirm-scan", model=CHAT_MODEL,
                    extras={"fill_empty_ingredients": len(batch)},
                )
        except Exception:
            pass
        try:
            data = json.loads((resp.choices[0].message.content or "").strip() or "{}")
        except json.JSONDecodeError:
            warnings.append("Sugestie AI: niepoprawny JSON — pominięto partię.")
            continue
        for raw in data.get("dishes") or []:
            nm = (raw.get("name") or "").strip().lower()
            if not nm:
                continue
            ings = raw.get("suggested_ingredients") or []
            if ings:
                by_lower[nm] = ings
            pw = raw.get("suggested_portion_weight_value")
            pu = raw.get("suggested_portion_weight_unit")
            if pw is not None and pu:
                portion_by[nm] = (pw, pu)

    for d in need:
        key = (d.name or "").strip().lower()
        ings = by_lower.get(key)
        if not ings:
            continue
        filled: list[ConfirmMenuIngredient] = []
        for si in ings:
            iname = (si.get("name") if isinstance(si, dict) else getattr(si, "name", None)) or ""
            iname = str(iname).strip()
            if not iname or _is_porcja_row(iname):
                continue
            qty = si.get("quantity") if isinstance(si, dict) else getattr(si, "quantity", None)
            unit = (si.get("unit") if isinstance(si, dict) else getattr(si, "unit", None)) or "g"
            try:
                qf = float(qty) if qty is not None else 1.0
            except (TypeError, ValueError):
                qf = 1.0
            filled.append(ConfirmMenuIngredient(
                name=_normalize_ingredient_name(iname),
                quantity=max(1.0, qf),
                unit=str(unit) or "g",
            ))
        if filled:
            d.ingredients = filled
        portion = portion_by.get(key)
        if (
            portion
            and (d.portion_weight_value is None or not d.portion_weight_unit)
        ):
            try:
                d.portion_weight_value = float(portion[0])
                d.portion_weight_unit = str(portion[1])
            except (TypeError, ValueError):
                pass


@app.post("/api/menu/confirm-scan")
async def menu_confirm_scan(req: ConfirmMenuScanRequest):
    """Zapisuje zatwierdzone potrawy do bazy (menu_items + recipe_ingredients).
    Wielkość porcji jest zapisywana jako parametr nadrzędny w
    `menu_items.portion_size_grams` (i opcjonalnie `portion_size_unit`), NIGDY
    jako wiersz 'Porcja' w recipe_ingredients ani jako produkt w inventory_items."""
    require_tenant_account_key()
    if not req.dishes:
        raise HTTPException(status_code=400, detail="Brak potraw do zapisania.")

    # Ostatnia bramka spójności jednostek przed zapisem receptur.
    _canonicalize_ingredient_units(req.dishes)
    _apply_whole_product_names_to_dishes(req.dishes)
    _apply_integer_quantities_to_dishes(req.dishes)

    inserted = 0
    skipped = 0
    saved: list[dict] = []
    warnings: list[str] = []
    all_ingredient_names: list[str] = []
    portion_column_missing = False

    # Uzupełnianie AI tylko po świadomym TAK (fill_empty_with_ai). NIE = puste pola zostają.
    if req.fill_empty_with_ai:
        try:
            await _fill_empty_ingredients_for_confirm(req.dishes, warnings=warnings)
            _canonicalize_ingredient_units(req.dishes)
            _apply_whole_product_names_to_dishes(req.dishes)
            _apply_integer_quantities_to_dishes(req.dishes)
        except Exception as e:  # noqa: BLE001
            warnings.append(f"Uzupełnianie receptur AI pominięte: {e}")

    async with httpx.AsyncClient(timeout=180.0, verify=_httpx_verify()) as client:
        try:
            existing_menu = await sb_get(client, "menu_items", params={
                "select": "id,name,is_active,category,price_pln", "limit": "10000",
            }) or []
        except httpx.HTTPStatusError:
            existing_menu = await sb_get(client, "menu_items", params={
                "select": "id,name,category,price_pln", "limit": "10000",
            }) or []
        # Dedup tylko względem AKTYWNYCH dań — usunięte nie są przywracane.
        active_menu = [m for m in existing_menu if m.get("is_active") is not False]
        existing_count_rows = active_menu
        base_offset = len(existing_count_rows or [])

        for idx, dish in enumerate(req.dishes):
            name = (dish.name or "").strip()
            if not name:
                continue
            category = dish.category or "Inne"
            # Półprodukty / combo (mise en place) → kategoria Menu „Półprodukty”
            if _is_combo_polprodukt_name(name):
                category = "Półprodukty"
            price = float(dish.price_pln or 0)

            # Deduplikacja: ta sama AKTYWNA potrawa już w menu → nie twórz drugiego dania,
            # ALE zbierz składniki do onboarding magazynu (brakujące produkty / przywrócenie).
            hit, _sc = _resolve_by_fuzzy(name, active_menu, threshold=88)
            if hit:
                skipped += 1
                warnings.append(f"„{hit.get('name') or name}” już jest w menu — pominięto duplikat.")
                for ing in (dish.ingredients or []):
                    iname = (getattr(ing, "name", None) or "").strip()
                    if not iname or _is_porcja_row(iname):
                        continue
                    all_ingredient_names.append(_normalize_ingredient_name(iname))
                continue

            pos_id = _make_pos_id_for_category(category, base_offset + idx + 1)

            # Wielkość porcji → parametr nadrzędny (baza g/ml: 1 ml == 1 g dla płynów gastro).
            portion_grams: Optional[float] = None
            portion_unit: Optional[str] = None
            if dish.portion_weight_value and dish.portion_weight_unit:
                try:
                    pv = float(dish.portion_weight_value)
                except (TypeError, ValueError):
                    pv = 0.0
                pu = _norm_name(dish.portion_weight_unit)
                if pv > 0:
                    if pu == "kg":
                        portion_grams, portion_unit = pv * 1000.0, "g"
                    elif pu in ("l", "litr", "litry"):
                        portion_grams, portion_unit = pv * 1000.0, "ml"
                    elif pu in ("g", "gram", "gramy"):
                        portion_grams, portion_unit = pv, "g"
                    elif pu == "ml":
                        portion_grams, portion_unit = pv, "ml"
                    else:  # szt / opak / porcja itp. — przelicznik domyślny
                        portion_grams, portion_unit = pv * _PIECE_DEFAULT_SIZE, "szt"

            menu_payload: dict = {
                "name": name, "category": category, "price_pln": price,
                "pos_id": pos_id, "is_active": True,
            }
            if portion_grams is not None:
                menu_payload["portion_size_grams"] = portion_grams
                menu_payload["portion_size_unit"] = portion_unit

            try:
                row = await sb_post(client, "menu_items", menu_payload)
            except httpx.HTTPStatusError as e:
                body = e.response.text or ""
                # Fallback: baza bez kolumn portion_size_* → zapisz bez nich i ostrzeż.
                if ("portion_size_grams" in body or "portion_size_unit" in body) and portion_grams is not None:
                    portion_column_missing = True
                    menu_payload.pop("portion_size_grams", None)
                    menu_payload.pop("portion_size_unit", None)
                    try:
                        row = await sb_post(client, "menu_items", menu_payload)
                    except httpx.HTTPStatusError as e2:
                        warnings.append(f"{name}: nie zapisano ({e2.response.text[:120]}).")
                        continue
                else:
                    warnings.append(f"{name}: nie zapisano ({body[:120]}).")
                    continue
            menu_id = (row[0] if isinstance(row, list) else row)["id"]

            recipe_rows: list[dict] = []
            for i, ing in enumerate(dish.ingredients):
                iname = (ing.name or "").strip()
                if not iname:
                    continue
                # Pomiń wielkość porcji — to parametr nadrzędny, nie składnik.
                if _is_porcja_row(iname):
                    continue
                qty_raw = getattr(ing, "quantity", None)
                qty_norm = _normalize_recipe_quantity(qty_raw, ing.unit or "g") if qty_raw is not None else None
                # Brak gramatury z OCR/AI → minimum 1 (użytkownik może edytować), nigdy 0.
                row_ing: dict = {
                    "menu_item_id": menu_id,
                    "ingredient_name": _normalize_ingredient_name(iname),
                    "quantity": float(qty_norm if qty_norm is not None else 1),
                    "unit": ing.unit or "g",
                    "sort_order": i + 1,
                }
                pw = getattr(ing, "piece_weight_g", None)
                if pw is not None:
                    try:
                        pw_f = float(pw)
                        if pw_f > 0:
                            row_ing["piece_weight_g"] = pw_f
                    except (TypeError, ValueError):
                        pass
                recipe_rows.append(row_ing)
                all_ingredient_names.append(str(row_ing["ingredient_name"]))

            if recipe_rows:
                try:
                    await sb_post(client, "recipe_ingredients", recipe_rows)
                except httpx.HTTPStatusError as e:
                    body = e.response.text or ""
                    if "piece_weight_g" in body:
                        for r in recipe_rows:
                            r.pop("piece_weight_g", None)
                        try:
                            await sb_post(client, "recipe_ingredients", recipe_rows)
                        except httpx.HTTPStatusError as e2:
                            warnings.append(f"{name}: składniki niezapisane ({e2.response.text[:120]}).")
                    else:
                        warnings.append(f"{name}: składniki niezapisane ({body[:120]}).")

            inserted += 1
            saved.append({"id": menu_id, "name": name, "category": category, "price_pln": price, "action": "inserted"})
            active_menu.append({"id": menu_id, "name": name, "is_active": True, "category": category, "price_pln": price})

        # Automatyczny onboarding magazynu: utwórz brakujące składniki jako produkty (stan 0).
        inv_created_count = 0
        inv_created_items: list[dict] = []
        try:
            inv_created_count, inv_created_items, inv_warns = await _auto_onboard_inventory(
                client, all_ingredient_names)
            warnings.extend(inv_warns)
        except Exception as e:  # noqa: BLE001
            warnings.append(f"Auto-onboarding magazynu pominięty: {e}")

    if portion_column_missing:
        warnings.append(
            "Uwaga: kolumny `menu_items.portion_size_grams` / `portion_size_unit` "
            "nie istnieją. Uruchom migrację SQL `ADD_PORTION_SIZE.sql`, aby ubytki "
            "płynnych potraw (l/ml) działały poprawnie."
        )

    msg_parts = [f"Dodano {inserted} nowych potraw."]
    if skipped:
        msg_parts.append(f"Pominięto {skipped} duplikatów (już w menu).")

    return {
        "ok": True,
        "inserted": inserted,
        "skipped_duplicates": skipped,
        "restored": 0,
        "saved": saved,
        "inventory_created": inv_created_count,
        "inventory_items": inv_created_items,
        "warnings": warnings,
        "message": " ".join(msg_parts),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 7) POS Webhook — pełen obieg: sprzedaż → magazyn → finanse
# ─────────────────────────────────────────────────────────────────────────────
from datetime import datetime, timezone  # noqa: E402


class PosSaleItem(BaseModel):
    pos_external_id: Optional[str] = None
    dish_name: Optional[str] = None
    quantity_sold: float = Field(gt=0)
    unit_price_pln: Optional[float] = None  # jeśli null → pos_products.price_pln


class PosWebhookRequest(BaseModel):
    external_order_id: Optional[str] = None
    items: list[PosSaleItem]


@app.get("/api/pos/providers")
async def pos_providers_list():
    """Lista adapterów popularnych POS (PL) — do pickera w Ustawieniach."""
    from pos_adapters import PROVIDERS
    return {"providers": PROVIDERS}


@app.post("/api/pos/webhook")
async def pos_webhook(request: Request, provider: Optional[str] = None):
    """Odbiera uderzenie POS (kanoniczny JSON lub format konkretnego providera).

    Query: ?provider=gopos|posbistro|dotykacka|… — normalizacja w pos_adapters.
    Dla każdej pozycji: pos_products → recipes → inventory → revenue.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Oczekiwano JSON body.")

    from pos_adapters import normalize_pos_payload
    from pydantic import ValidationError

    canonical = normalize_pos_payload(provider, body if isinstance(body, dict) else {})
    try:
        req = PosWebhookRequest(**canonical)
    except ValidationError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Niepoprawny payload POS po normalizacji ({provider or 'generic'}): {e.errors()[:3]}",
        )

    if not req.items:
        raise HTTPException(status_code=400, detail="Brak pozycji w zamówieniu.")

    now = datetime.now(timezone.utc)
    year_month = now.strftime("%Y-%m")

    processed: list[dict] = []
    inventory_updates: list[dict] = []
    warnings: list[str] = []
    revenue_total = 0.0
    sale_log_ids: list[str] = []

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        for it in req.items:
            product: Optional[dict] = None

            if it.pos_external_id:
                rows = await sb_get(client, "pos_products", params={
                    "select": "id,name,pos_external_id,price_pln",
                    "pos_external_id": f"eq.{it.pos_external_id}",
                    "limit": "1",
                })
                if rows:
                    product = rows[0]
            if product is None and it.dish_name:
                rows = await sb_get(client, "pos_products", params={
                    "select": "id,name,pos_external_id,price_pln",
                    "name": f"ilike.{it.dish_name}",
                    "limit": "1",
                })
                if rows:
                    product = rows[0]

            if (product is None):
                key = it.pos_external_id or it.dish_name or "?"
                # Fallback: menu_items.pos_id + recipe_ingredients (mapowanie w Ustawieniach)
                menu_row = None
                if it.pos_external_id:
                    mrows = await sb_get(client, "menu_items", params={
                        "select": "id,name,pos_id,price_pln",
                        "pos_id": f"eq.{it.pos_external_id}",
                        "is_active": "eq.true",
                        "limit": "1",
                    })
                    if mrows:
                        menu_row = mrows[0]
                if menu_row is None and it.dish_name:
                    mrows = await sb_get(client, "menu_items", params={
                        "select": "id,name,pos_id,price_pln",
                        "name": f"ilike.{it.dish_name}",
                        "is_active": "eq.true",
                        "limit": "1",
                    })
                    if mrows:
                        menu_row = mrows[0]

                if menu_row is None:
                    warnings.append(f"Pominięto '{key}' — brak dopasowania w pos_products ani menu_items.")
                    continue

                qty = float(it.quantity_sold)
                unit_price = float(it.unit_price_pln) if it.unit_price_pln is not None else float(menu_row.get("price_pln") or 0)
                line_total = round(unit_price * qty, 2)
                ings = await sb_get(client, "recipe_ingredients", params={
                    "select": "id,ingredient_name,quantity,unit,warehouse_product_id",
                    "menu_item_id": f"eq.{menu_row['id']}",
                }) or []
                item_consumed: list[dict] = []
                mapped = [r for r in ings if r.get("warehouse_product_id")]
                if not mapped:
                    warnings.append(
                        f"'{menu_row['name']}': brak zmapowanych składników (warehouse_product_id) — magazyn nie zaktualizowany."
                    )
                else:
                    for r in mapped:
                        inv_id = r["warehouse_product_id"]
                        consume = float(r.get("quantity") or 0) * qty
                        inv_rows = await sb_get(client, "inventory_items", params={
                            "select": "id,name,quantity,unit,min_quantity",
                            "id": f"eq.{inv_id}",
                            "limit": "1",
                        })
                        if not inv_rows:
                            warnings.append(f"'{menu_row['name']}': brak inventory_items id={inv_id}.")
                            continue
                        inv = inv_rows[0]
                        before = float(inv["quantity"])
                        after = round(before - consume, 4)
                        try:
                            await sb_patch(client, "inventory_items", {"id": f"eq.{inv['id']}"}, {"quantity": after})
                        except httpx.HTTPStatusError as e:
                            warnings.append(f"'{inv['name']}': nie zaktualizowano stanu ({e.response.text[:100]}).")
                            continue
                        min_qty = float(inv.get("min_quantity") or 0)
                        status = "ok"
                        if after <= 0:
                            status = "out_of_stock"
                        elif min_qty > 0 and after <= min_qty:
                            status = "below_minimum"
                        upd = {
                            "inventory_id": inv["id"],
                            "name": inv["name"],
                            "unit": inv.get("unit") or r.get("unit") or "kg",
                            "consumed": consume,
                            "quantity_before": before,
                            "quantity_after": after,
                            "min_quantity": min_qty,
                            "status": status,
                        }
                        inventory_updates.append(upd)
                        item_consumed.append(upd)

                processed.append({
                    "pos_external_id": menu_row.get("pos_id") or it.pos_external_id,
                    "name": menu_row["name"],
                    "quantity": qty,
                    "unit_price_pln": unit_price,
                    "line_total_pln": line_total,
                    "inventory_consumed": item_consumed,
                })
                revenue_total = round(revenue_total + line_total, 2)
                continue

            qty = float(it.quantity_sold)
            unit_price = float(it.unit_price_pln) if it.unit_price_pln is not None else float(product.get("price_pln") or 0)
            line_total = round(unit_price * qty, 2)

            recipes = await sb_get(client, "recipes", params={
                "select": "id,warehouse_product_id,quantity_per_portion,unit",
                "pos_product_id": f"eq.{product['id']}",
            })
            item_consumed: list[dict] = []

            if not recipes:
                warnings.append(f"'{product['name']}': brak receptury (recipes) — magazyn nie zaktualizowany.")
            else:
                for r in recipes:
                    inv_id = r["warehouse_product_id"]
                    consume = float(r["quantity_per_portion"]) * qty
                    inv_rows = await sb_get(client, "inventory_items", params={
                        "select": "id,name,quantity,unit,min_quantity",
                        "id": f"eq.{inv_id}",
                        "limit": "1",
                    })
                    if not inv_rows:
                        warnings.append(f"'{product['name']}': brak inventory_items id={inv_id}.")
                        continue
                    inv = inv_rows[0]
                    before = float(inv["quantity"])
                    after = round(before - consume, 4)
                    try:
                        await sb_patch(client, "inventory_items", {"id": f"eq.{inv['id']}"}, {"quantity": after})
                    except httpx.HTTPStatusError as e:
                        warnings.append(f"'{inv['name']}': nie zaktualizowano stanu ({e.response.text[:100]}).")
                        continue

                    min_qty = float(inv.get("min_quantity") or 0)
                    status = "ok"
                    if after <= 0:
                        status = "out_of_stock"
                    elif min_qty > 0 and after <= min_qty:
                        status = "below_minimum"

                    upd = {
                        "inventory_id": inv["id"],
                        "name": inv["name"],
                        "unit": inv.get("unit") or r.get("unit") or "kg",
                        "consumed": consume,
                        "quantity_before": before,
                        "quantity_after": after,
                        "min_quantity": min_qty,
                        "status": status,
                    }
                    inventory_updates.append(upd)
                    item_consumed.append(upd)

            try:
                log_rows = await sb_post(client, "pos_sales_log", {
                    "pos_external_id": product["pos_external_id"],
                    "pos_product_id": product["id"],
                    "quantity_sold": qty,
                })
                log_id = (log_rows[0] if isinstance(log_rows, list) else log_rows).get("id")
                if log_id:
                    sale_log_ids.append(log_id)
            except httpx.HTTPStatusError as e:
                warnings.append(f"'{product['name']}': pos_sales_log — {e.response.text[:100]}")

            processed.append({
                "pos_external_id": product["pos_external_id"],
                "name": product["name"],
                "quantity": qty,
                "unit_price_pln": unit_price,
                "line_total_pln": line_total,
                "inventory_consumed": item_consumed,
            })
            revenue_total = round(revenue_total + line_total, 2)

        revenue_id: Optional[str] = None
        if revenue_total > 0:
            def _fmt_qty(q: float) -> str:
                return str(int(q)) if float(q).is_integer() else f"{q:g}"
            summary_items = ", ".join(f"{p['name']} × {_fmt_qty(p['quantity'])}" for p in processed)
            desc = f"POS: {summary_items}"
            if req.external_order_id:
                desc = f"[{req.external_order_id}] {desc}"
            try:
                rev_rows = await sb_post(client, "revenue_entries", {
                    "year_month": year_month,
                    "description": desc[:255],
                    "amount_pln": revenue_total,
                })
                revenue_id = (rev_rows[0] if isinstance(rev_rows, list) else rev_rows).get("id")
            except httpx.HTTPStatusError as e:
                warnings.append(f"revenue_entries: {e.response.text[:120]}")

        # POS Bottleneck Engine: przelicz dostępność dań po zjeździe stanu z POS.
        if inventory_updates:
            try:
                await _recompute_menu_availability(client, changed_inventory_ids={u["inventory_id"] for u in inventory_updates})
            except Exception as e:
                logger.debug(f"_recompute_menu_availability skipped: {e}")

    return {
        "ok": True,
        "external_order_id": req.external_order_id,
        "processed_items": processed,
        "inventory_updates": inventory_updates,
        "revenue_added_pln": revenue_total,
        "revenue_entry_id": revenue_id,
        "sale_log_ids": sale_log_ids,
        "warnings": warnings,
    }


@app.get("/api/pos/products")
async def pos_products_list():
    """Helper dla generatora ruchu i debugowania: lista produktów POS."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        rows = await sb_get(client, "pos_products", params={
            "select": "id,pos_external_id,name,price_pln",
            "order": "name.asc",
            "limit": "500",
        })
    return {"products": rows or []}



# ═════════════════════════════════════════════════════════════════════════════
# ŁOWCY OKAZJI — inteligentny system zamówień + porównywarka ofert
# ═════════════════════════════════════════════════════════════════════════════

RESEND_API_KEY = _resend_api_key()
RESEND_FROM_EMAIL = _resend_from_email()

# --- Profil restauracji (dane kontaktowe dla dostawców) ----------------------
# Przechowujemy w Supabase (tabela restaurant_profile, singleton). Jeśli tabela
# nie istnieje, korzystamy z lokalnego pliku fallback, aby funkcja działała od razu.
PROFILE_FALLBACK_FILE = Path(__file__).parent / ".restaurant_profile.json"


def _read_profile_disk() -> dict:
    try:
        if PROFILE_FALLBACK_FILE.exists():
            data = json.loads(PROFILE_FALLBACK_FILE.read_text(encoding="utf-8"))
            return {"contact_email": data.get("contact_email", "") or "",
                    "contact_phone": data.get("contact_phone", "") or ""}
    except Exception:  # noqa: BLE001
        pass
    return {"contact_email": "", "contact_phone": ""}


def _write_profile_disk(email: str, phone: str) -> None:
    try:
        PROFILE_FALLBACK_FILE.write_text(
            json.dumps({"contact_email": email, "contact_phone": phone}), encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        logger.warning("Nie udało się zapisać profilu na dysku: %s", e)


async def get_restaurant_profile(client: httpx.AsyncClient) -> dict:
    try:
        rows = await sb_get(client, "restaurant_profile",
                            params={"select": "contact_email,contact_phone", "limit": "1"})
        if rows:
            return {"contact_email": rows[0].get("contact_email") or "",
                    "contact_phone": rows[0].get("contact_phone") or ""}
        disk = _read_profile_disk()
        if disk["contact_email"] or disk["contact_phone"]:
            return disk
        return {"contact_email": "", "contact_phone": ""}
    except httpx.HTTPError:
        return _read_profile_disk()


async def set_restaurant_profile(client: httpx.AsyncClient, email: str, phone: str) -> None:
    payload = {"contact_email": email, "contact_phone": phone,
               "updated_at": datetime.now(timezone.utc).isoformat()}
    try:
        rows = await sb_get(client, "restaurant_profile", params={"select": "id", "limit": "1"})
        if rows:
            await sb_patch(client, "restaurant_profile", {"id": f"eq.{rows[0]['id']}"}, payload)
        else:
            await sb_post(client, "restaurant_profile", payload)
    except httpx.HTTPError:
        _write_profile_disk(email, phone)


def _order_footer(profile: dict) -> str:
    email = (profile.get("contact_email") or "").strip() or "(brak)"
    phone = (profile.get("contact_phone") or "").strip() or "(brak)"
    return ("--- Wiadomość wygenerowana automatycznie przez asystenta AI Gastro-Manager. "
            "Prosimy NIE ODPOWIADAĆ na tego maila. Kontakt z restauracją wyłącznie pod adresem: "
            f"{email} lub numerem telefonu: {phone}. ---")


class ProfilePayload(BaseModel):
    contact_email: str = ""
    contact_phone: str = ""


@app.get("/api/restaurant/profile")
async def get_profile_endpoint():
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        p = await get_restaurant_profile(client)
    complete = bool((p.get("contact_email") or "").strip() and (p.get("contact_phone") or "").strip())
    return {**p, "complete": complete}


@app.put("/api/restaurant/profile")
async def put_profile_endpoint(payload: ProfilePayload):
    email = (payload.contact_email or "").strip()
    phone = (payload.contact_phone or "").strip()
    if not email or not phone:
        raise HTTPException(status_code=400, detail="Podaj e-mail oraz telefon kontaktowy.")
    if "@" not in email or "." not in email:
        raise HTTPException(status_code=400, detail="Podaj poprawny adres e-mail.")
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        await set_restaurant_profile(client, email, phone)
    return {"ok": True, "contact_email": email, "contact_phone": phone, "complete": True}

# --- Jednostki: przeliczanie do wspólnej jednostki bazowej (kg / l / szt) ----
# dim -> (base_dim, factor_do_bazowej)
_UNIT_MAP = {
    "g": ("kg", 0.001), "gram": ("kg", 0.001), "gramy": ("kg", 0.001),
    "kg": ("kg", 1.0), "kilogram": ("kg", 1.0),
    "ml": ("l", 0.001), "mililitr": ("l", 0.001),
    "l": ("l", 1.0), "litr": ("l", 1.0), "litry": ("l", 1.0),
    "szt": ("szt", 1.0), "sztuka": ("szt", 1.0), "sztuk": ("szt", 1.0),
    "opak": ("szt", 1.0), "opakowanie": ("szt", 1.0),
    "porcja": ("szt", 1.0), "porcje": ("szt", 1.0),
}


def _norm_unit(u: str):
    """Zwraca (base_dim, factor). Domyślnie traktujemy jak 'szt'."""
    key = (u or "").strip().lower().rstrip(".")
    return _UNIT_MAP.get(key, ("szt", 1.0))


def _slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9 ]", " ", s.lower())


def _tokens(s: str):
    """Tokeny do matchingu katalogu — bez form opakowania (rolka/kostka…)."""
    pack_noise = {
        "rolka", "rolki", "rolke", "kostka", "kostki", "blok", "bloki",
        "plastry", "plaster", "krazek", "krazki", "kreg", "kregi",
        "tacka", "tacki", "luz", "luzem", "porcja", "porcje", "paczka",
        "paczk", "opak", "opakowanie", "szt", "sztuka", "sztuki",
        "premium", "bio", "eko", "fresh", "swiezy", "swieze",
    }
    return [
        t for t in _slug(s).split()
        if len(t) > 2 and t not in pack_noise
    ]


def _match_score(req_name: str, cand_name: str) -> float:
    """Ułamek istotnych tokenów zapytania obecnych w nazwie z katalogu (0..1).

    Bonus: krótsze zapytanie w pełni zawarte w dłuższej ofercie
    („ser kozi” ⊂ „ser kozi rolka” → ~1.0).
    """
    rt = set(_tokens(req_name))
    ct = set(_tokens(cand_name))
    if not rt or not ct:
        # fallback: znormalizowane klucze (_norm_pl też stripuje opakowania)
        kn = _norm_pl(req_name)
        cn = _norm_pl(cand_name)
        if kn and cn and (kn == cn or kn in cn or cn in kn):
            return 0.92 if kn != cn else 1.0
        return 0.0
    inter = rt & ct
    if not inter:
        return 0.0
    cover = len(inter) / len(rt)
    # Wszystkie tokeny zapytania w ofercie + oferta nieco dłuższa → near-exact
    if cover >= 0.999 and len(ct) >= len(rt):
        return 1.0
    if cover >= 0.8 and len(inter) >= 2:
        return max(cover, 0.85)
    return cover


# Auto-accept bez AI — tylko bardzo pewne (np. ser kozi ⊂ ser kozi rolka)
LOCAL_CATALOG_MATCH_MIN = 0.88
# Prefilter kandydatów dla agenta AI (luźniej — AI odrzuci śmieci)
AI_CATALOG_CANDIDATE_MIN = 0.22
AI_CATALOG_MAX_CANDIDATES = 45
AI_CATALOG_MAX_ITEM_CALLS = 24  # ile pozycji zamówienia max. przez agenta na 1 compare


def _food_names_compatible(req_name: str, cand_name: str) -> bool:
    """Czy nazwy mogą być tym samym towarem (stem / kolejność słów / prefiks).

    Przykłady OK: batat↔bataty, filet z kurczaka↔kurczak filet, pomidor↔pomidory.
    Blokuje luźne literówki bez wspólnego rdzenia (grzanek ↛ granulat).
    """
    ka = _food_match_key(req_name or "")
    kb = _food_match_key(cand_name or "")
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    ta, tb = set(ka.split()), set(kb.split())
    if not ta or not tb:
        return False
    # Wspólny stem ≥4 LUB pełne pokrycie tokenów zapytania w ofercie
    shared = ta & tb
    if shared and any(len(t) >= 4 for t in shared):
        return True
    if ta.issubset(tb) or tb.issubset(ta):
        return True
    # Prefiks stemów: batat ⊂ bataty / cukin ⊂ cukinia (po key)
    for a in ta:
        for b in tb:
            if len(a) >= 4 and len(b) >= 4 and (a.startswith(b) or b.startswith(a)):
                return True
    # Jednoznaczne zawieranie całych kluczy
    if len(ka) >= 5 and len(kb) >= 5 and (ka in kb or kb in ka):
        return True
    return False


def _local_catalog_match_score(req_name: str, cand_name: str) -> float:
    """Lokalne dopasowanie oferty katalogowej (0..1) — bez agresywnego partial_ratio.

    „ser kozi” ↔ „ser kozi rolka”: token coverage + token_set + ostrożne zawieranie.
    Krótkie / przypadkowe podobieństwa literowe NIE dostają wysokiego score.
    """
    a = _norm_pl(req_name or "")
    b = _norm_pl(cand_name or "")
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    token_cov = _match_score(req_name, cand_name)
    # Zawieranie tylko gdy wspólne tokeny (nie „grz” w środku losowego słowa)
    if len(a) >= 5 and len(b) >= 5 and (a in b or b in a) and token_cov >= 0.5:
        shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
        # Granica tokenowa: krótsza jako pełny zestaw tokenów w dłuższej
        st, lt = set(_tokens(shorter) or shorter.split()), set(_tokens(longer) or longer.split())
        if st and st.issubset(lt):
            ratio = len(shorter) / max(len(longer), 1)
            return max(0.9, min(0.99, 0.8 + 0.2 * ratio))
    try:
        # NIE używamy partial_ratio jako głównego sygnału — generował FP na krótkich nazwach.
        fuzz_sc = float(fuzz.token_set_ratio(a, b)) / 100.0
    except Exception:
        fuzz_sc = 0.0
    combined = max(token_cov, fuzz_sc * 0.92)
    if token_cov >= 0.8 and fuzz_sc >= 0.78:
        combined = max(combined, 0.9)
    food_ok = _food_names_compatible(req_name, cand_name)
    if food_ok and fuzz_sc >= 0.78:
        # batat↔bataty / pomidor↔pomidory — podnieś do auto-accept
        combined = max(combined, 0.9)
    if not food_ok:
        # Bez wspólnego rdzenia — mocno obetnij (AI może jeszcze potwierdzić)
        combined = min(combined, 0.45)
    return combined


def _strict_local_catalog_accept(primary_names: list[str], cand_name: str) -> bool:
    """Auto-accept bez AI tylko dla prawie pewnych trafień w katalogu dostawcy."""
    if not primary_names or not (cand_name or "").strip():
        return False
    score = max(
        (_local_catalog_match_score(n, cand_name) for n in primary_names if n),
        default=0.0,
    )
    if score < LOCAL_CATALOG_MATCH_MIN:
        return False
    # Musi być kompatybilne z PRIMARną nazwą zamówienia (nie tylko ze złym synonimem)
    primary = next((n for n in primary_names if n and str(n).strip()), "")
    if not primary:
        return False
    if not _food_names_compatible(primary, cand_name):
        return False
    # Wysoki token cover ALBO exact/near-exact ALBO odmiana PL (batat↔bataty)
    if _norm_pl(primary) == _norm_pl(cand_name):
        return True
    if _match_score(primary, cand_name) >= 0.8:
        return True
    if _food_match_key(primary) == _food_match_key(cand_name):
        return True
    return score >= 0.95


def _catalog_base_price(row: dict):
    """(base_dim, cena_za_jednostke_bazowa) na podstawie wiersza supplier_catalog."""
    try:
        price = float(row.get("price_pln") or 0)
    except (TypeError, ValueError):
        price = 0.0
    if price <= 0:
        return None
    try:
        liters = float(row.get("liters_total") or 0)
    except (TypeError, ValueError):
        liters = 0.0
    # Produkty płynne mają wypełnione liters_total → cena za litr
    if liters > 0:
        return ("l", price / liters)
    # Produkty sztukowe/opakowaniowe z podaną wagą (kg_total) → cena za kg.
    try:
        kg = float(row.get("kg_total") or 0)
    except (TypeError, ValueError):
        kg = 0.0
    if kg > 0:
        return ("kg", price / kg)
    base_dim, _ = _norm_unit(row.get("unit"))
    if base_dim in ("kg", "l"):
        # W tym katalogu cena dla jednostek wagowych/objętościowych jest za 1 kg / 1 l
        return (base_dim, price)
    # Sztuki / opakowania: dzielimy cenę paczki przez liczbę sztuk
    try:
        count = float(row.get("unit_count") or 1) or 1.0
    except (TypeError, ValueError):
        count = 1.0
    return ("szt", price / count)


def _catalog_pack_base_qty(row: dict, base_dim: str) -> float:
    """Wielkość jednego opakowania katalogowego w jednostce bazowej (kg/l/szt)."""
    try:
        liters = float(row.get("liters_total") or 0)
    except (TypeError, ValueError):
        liters = 0.0
    if liters > 0 and base_dim == "l":
        return liters
    try:
        kg = float(row.get("kg_total") or 0)
    except (TypeError, ValueError):
        kg = 0.0
    if kg > 0 and base_dim == "kg":
        return kg
    try:
        count = float(row.get("unit_count") or 0)
    except (TypeError, ValueError):
        count = 0.0
    if count > 0 and base_dim == "szt":
        return count
    return 1.0


def _catalog_available_base_qty(row: dict, base_dim: str) -> Optional[float]:
    """Max. dostępna ilość oferty w jednostce bazowej (kg/l/szt).

    Dla hurtowników (brak stocku w katalogu) → None (= bez limitu).
    Dla lokalnych dostawców `available_stock` / `stock` jest w jednostce produktu.
    """
    raw = row.get("available_stock")
    if raw is None:
        raw = row.get("stock")
    if raw is None:
        return None
    try:
        stock = float(raw)
    except (TypeError, ValueError):
        return None
    if stock <= 0:
        return 0.0

    unit_raw = (row.get("unit") or "szt").strip() or "szt"
    stock_dim, stock_factor = _norm_unit(unit_raw)
    stock_in_unit_dim = stock * stock_factor

    try:
        kg_pack = float(row.get("kg_total") or 0)
    except (TypeError, ValueError):
        kg_pack = 0.0
    try:
        l_pack = float(row.get("liters_total") or 0)
    except (TypeError, ValueError):
        l_pack = 0.0

    if base_dim == stock_dim:
        return round(stock_in_unit_dim, 6)
    # Opakowania sztukowe z wagą/objętością → przelicz na kg/l
    if base_dim == "kg" and kg_pack > 0 and stock_dim == "szt":
        return round(stock * kg_pack, 6)
    if base_dim == "l" and l_pack > 0 and stock_dim == "szt":
        return round(stock * l_pack, 6)
    if base_dim == "szt" and stock_dim == "szt":
        return round(stock, 6)
    # Brak bezpiecznej konwersji — traktuj stock jako już w base_dim (np. unit=kg)
    if stock_dim in ("kg", "l", "szt") and base_dim in ("kg", "l", "szt"):
        return None
    return round(stock_in_unit_dim, 6)


def _cap_order_qty_to_available_stock(
    order_base: float,
    pack: float,
    row: dict,
    base_dim: str,
) -> Tuple[float, bool]:
    """Ogranicza ilość zamówienia do stocku lokalnego dostawcy.

    Przykład: potrzeba 5 kg, stock 3 kg → zamów 3 kg (nawet poniżej pasma ±10%).
    Zwraca (qty, stock_capped).
    """
    import math

    avail = _catalog_available_base_qty(row, base_dim)
    if avail is None:
        return float(order_base or 0), False
    if avail <= 0:
        return 0.0, True

    qty = float(order_base or 0)
    if qty <= avail + 1e-9:
        return qty, False

    pack_v = float(pack or 0) or 0.0
    # Ciągłe / jednostkowe (kg luzem, litry) — utnij do stocku
    if pack_v <= 1.0001:
        return round(avail, 4), True

    # Pełne opakowania mieszczące się w stocku
    n = int(math.floor(avail / pack_v + 1e-9))
    if n >= 1:
        return round(n * pack_v, 4), True
    # Stock mniejszy niż 1 opakowanie, ale > 0 — sprzedaj dostępne (np. 0.5 kg z worka 1 kg)
    return round(avail, 4), True


def _qty_in_band(target: float, lo: float, hi: float, pack: float) -> Tuple[float, bool]:
    """Dobiera ilość w paśmie [lo, hi] (±10% wokół targetu), preferując pełne opakowania.

    Zwraca (qty, pack_adjusted). pack_adjusted=True gdy żadne opakowanie nie dało
    dokładnie żądanej ilości / nie mieściło się w paśmie — wybrano najmniejsze
    pełne opakowanie pokrywające zapotrzebowanie (może być powyżej hi).
    """
    import math
    t = max(0.0, float(target or 0))
    lo_v = max(0.0, float(lo if lo is not None else t * 0.9))
    hi_v = max(lo_v, float(hi if hi is not None else t * 1.1))
    if t <= 0:
        return 0.0, False
    pack_v = float(pack or 1.0)
    if pack_v <= 0:
        pack_v = 1.0
    # ciągłe / jednostkowe — trzymaj target w paśmie
    if pack_v <= 1.0001 and abs(pack_v - 1.0) < 1e-6:
        return round(min(hi_v, max(lo_v, t)), 4), False
    # pełne paczki w paśmie
    n_lo = max(1, int(math.ceil(lo_v / pack_v - 1e-9)))
    n_hi = max(n_lo, int(math.floor(hi_v / pack_v + 1e-9)))
    best_n = None
    best_score = None
    for n in range(n_lo, n_hi + 1):
        qty = n * pack_v
        if qty < lo_v - 1e-9 or qty > hi_v + 1e-9:
            continue
        under = max(0.0, t - qty)
        dist = abs(qty - t)
        score = (under, dist, qty)
        if best_score is None or score < best_score:
            best_score = score
            best_n = n
    if best_n is not None:
        qty = round(best_n * pack_v, 4)
        adjusted = abs(qty - t) > max(0.001, t * 0.02)
        return qty, adjusted
    # Żadna paczka w paśmie — zaokrąglij w górę do pokrycia targetu (nawet powyżej hi)
    n_need = max(1, int(math.ceil(t / pack_v - 1e-9)))
    qty_up = round(n_need * pack_v, 4)
    return qty_up, True


def _fmt_base_qty(q: float, dim: str) -> str:
    """Czytelna PL etykieta ilości w jednostce bazowej kg/l/szt."""
    qq = float(q or 0)
    if dim == "kg":
        if qq >= 1:
            return f"{_fmt_qty(qq)} kg"
        return f"{_fmt_qty(qq * 1000)} g"
    if dim == "l":
        if qq >= 1:
            return f"{_fmt_qty(qq)} l"
        return f"{_fmt_qty(qq * 1000)} ml"
    return f"{_fmt_qty(qq)} szt"


def _piece_mass_base(pieces: float, unit_weight_volume, weight_volume_unit: Optional[str]):
    """Przelicza sztuki → (base_dim, qty) przez gramaturę 1 szt. (unit_weight_volume)."""
    try:
        uwv = float(unit_weight_volume) if unit_weight_volume is not None else 0.0
    except (TypeError, ValueError):
        uwv = 0.0
    if uwv <= 0:
        uwv = _PIECE_DEFAULT_SIZE
    wvu = (weight_volume_unit or "g").strip().lower().rstrip(".")
    pcs = float(pieces or 0)
    if wvu in ("kg", "kilogram"):
        return "kg", pcs * uwv
    if wvu in ("l", "litr", "litry"):
        return "l", pcs * uwv
    if wvu in ("ml", "mililitr"):
        return "l", pcs * uwv * 0.001
    # domyślnie g
    return "kg", pcs * uwv * 0.001


def _convert_req_to_catalog_dim(
    req_base_qty: float,
    req_dim: str,
    catalog_dim: str,
    unit_weight_volume=None,
    weight_volume_unit: Optional[str] = None,
) -> Optional[float]:
    """Przelicza zapotrzebowanie do wymiaru oferty katalogowej (kg/l/szt)."""
    if req_dim == catalog_dim:
        return float(req_base_qty)
    if req_dim == "szt" and catalog_dim in ("kg", "l"):
        dim, qty = _piece_mass_base(req_base_qty, unit_weight_volume, weight_volume_unit)
        if dim != catalog_dim:
            return None
        return qty
    if catalog_dim == "szt" and req_dim in ("kg", "l"):
        try:
            uwv = float(unit_weight_volume) if unit_weight_volume is not None else 0.0
        except (TypeError, ValueError):
            uwv = 0.0
        if uwv <= 0:
            uwv = _PIECE_DEFAULT_SIZE
        wvu = (weight_volume_unit or "g").strip().lower().rstrip(".")
        if req_dim == "kg":
            per = uwv if wvu in ("kg", "kilogram") else uwv * 0.001
        else:
            per = uwv if wvu in ("l", "litr", "litry") else uwv * 0.001
        if per <= 0:
            return None
        import math
        return float(math.ceil(float(req_base_qty) / per - 1e-9))
    return None


def _pack_mismatch_note(product: str, needed_base: float, ordered_base: float, dim: str) -> Optional[str]:
    """Polska notatka gdy opakowanie nie daje dokładnie żądanej ilości."""
    if ordered_base <= 0 or needed_base <= 0:
        return None
    if abs(ordered_base - needed_base) <= max(0.001, needed_base * 0.02):
        return None
    need_s = _fmt_base_qty(needed_base, dim)
    got_s = _fmt_base_qty(ordered_base, dim)
    return (
        f"{product}: dostawcy nie mają opakowań dających dokładnie {need_s} — "
        f"dodano {got_s} jako najmniejszą / najlepszą opcję pokrywającą zapotrzebowanie."
    )


def _fmt_pln(v: float) -> str:
    return f"{v:.2f}".replace(".", ",") + " zł"


def _fmt_qty(q: float) -> str:
    return (f"{q:.0f}" if float(q).is_integer() else f"{q:.2f}".replace(".", ","))


# --- Schematy ----------------------------------------------------------------

class CompareItem(BaseModel):
    product_name_or_id: str
    quantity: float
    unit: str
    # Pasmo ±10% wokół deficytu do progu optymalnego — tańsze opakowanie w paśmie wygrywa
    quantity_min: Optional[float] = None
    quantity_max: Optional[float] = None
    # Gramatura 1 sztuki (g/ml) — gdy zamówienie w szt. i magazyn nie ma unit_weight_volume
    unit_weight_volume: Optional[float] = None
    weight_volume_unit: Optional[str] = None


class CompareOffersRequest(BaseModel):
    items: list[CompareItem]
    restaurant_name: Optional[str] = None
    # Strategia koszyka: fast_delivery | min_deliveries | lowest_price
    cart_objective: Optional[str] = None
    # Gdzie Łowca szuka ofert: suppliers_only | local_producers_only | both
    search_scope: Optional[str] = "suppliers_only"


class MessageSupplierGroup(BaseModel):
    supplier_id: Optional[str] = None
    supplier_name: str
    supplier_email: Optional[str] = None
    subtotal_pln: float = 0.0
    items: list[dict] = Field(default_factory=list)


class GenerateMessagesRequest(BaseModel):
    suppliers: list[MessageSupplierGroup]
    restaurant_name: Optional[str] = None
    notes: Optional[str] = None


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    html: Optional[str] = None
    body_text: Optional[str] = None
    supplier_name: Optional[str] = None
    # nadpisania (opcjonalne, domyślnie centralny klucz/adres systemowy)
    api_key: Optional[str] = None
    from_email: Optional[str] = None


class InterpretOrderRequest(BaseModel):
    text: str


# --- Algorytm porównywania ---------------------------------------------------

async def _fetch_catalog_and_suppliers(client: httpx.AsyncClient):
    """Katalog + dostawcy TYLKO bieżącego tenanta.

    `supplier_catalog` często nie ma kolumny account_key (tenant przez supplier_id).
    Service role omija RLS — bez filtra `in.(supplier_ids)` matchowałoby obce
    katalogi → puste nazwy dostawców i pusty picker w FE.
    """
    supplier_select = (
        "id,name,email,contact_person,phone,min_order_value,"
        "shipping_cost,free_shipping_threshold,lead_time_days"
    )
    try:
        await sb_get(client, "suppliers", params={
            "select": "min_order_value,shipping_cost,free_shipping_threshold,lead_time_days",
            "limit": "1",
        })
    except Exception:
        try:
            await sb_get(client, "suppliers", params={
                "select": "min_order_value,shipping_cost,free_shipping_threshold",
                "limit": "1",
            })
            supplier_select = (
                "id,name,email,contact_person,phone,min_order_value,"
                "shipping_cost,free_shipping_threshold"
            )
        except Exception:
            try:
                await sb_get(client, "suppliers", params={"select": "min_order_value", "limit": "1"})
                supplier_select = "id,name,email,contact_person,phone,min_order_value"
            except Exception:
                supplier_select = "id,name,email,contact_person,phone"
    suppliers = await sb_get(client, "suppliers", params={
        "select": supplier_select, "limit": "500",
    }) or []
    allowed_ids = [str(s["id"]) for s in suppliers if s.get("id")]
    if not allowed_ids:
        return [], suppliers

    select_full = (
        "id,supplier_id,name,variant,unit,price_pln,liters_total,kg_total,unit_count,is_visible"
    )
    select_no_kg = (
        "id,supplier_id,name,variant,unit,price_pln,liters_total,unit_count,is_visible"
    )
    catalog: list = []
    # Chunk — limity długości URL PostgREST
    for i in range(0, len(allowed_ids), 40):
        chunk = allowed_ids[i : i + 40]
        id_filter = f"in.({','.join(chunk)})"
        try:
            rows = await sb_get(client, "supplier_catalog", params={
                "select": select_full,
                "supplier_id": id_filter,
                "limit": "2000",
            }) or []
        except httpx.HTTPStatusError as e:
            if "kg_total" in (e.response.text or ""):
                rows = await sb_get(client, "supplier_catalog", params={
                    "select": select_no_kg,
                    "supplier_id": id_filter,
                    "limit": "2000",
                }) or []
            else:
                raise
        catalog.extend(rows)

    allowed_set = set(allowed_ids)
    catalog = [r for r in catalog if str(r.get("supplier_id") or "") in allowed_set]
    return catalog, suppliers


def _normalize_deal_hunter_search_scope(raw: Optional[str]) -> str:
    v = (raw or "suppliers_only").strip().lower().replace("-", "_").replace(" ", "_")
    if v in (
        "local_producers_only", "local", "producers", "lokalni", "lp",
        "local_suppliers", "local_producers", "dystrybutorzy", "lokalni_dostawcy",
        "tylko_lokalni", "tylko_lokalne",
    ):
        return "local_producers_only"
    if v in (
        "both", "all", "wszystkie", "oba", "compare", "porownaj",
        "hurtownicy_i_lokalni", "suppliers_and_local",
    ):
        return "both"
    # Explicit hurtownicy / default
    return "suppliers_only"


async def _fetch_local_producer_catalog(client: httpx.AsyncClient):
    """Mapuje marketplace Lokalni Przetworcy -> format supplier_catalog dla Lowcy.

    HARD RULE: active + verified + approved + nie zarchiwizowany (+ Connect gdy kolumna jest).
    Fail-soft: brak tabel / migracji → puste listy.
    """
    producers = []
    select_full = (
        "id,company_name,email,phone,owner_name,min_order_value,city,voivodeship,"
        "pickup_available,courier_available,active,verified,verification_status,"
        "archived_at,stripe_connect_id"
    )
    select_no_connect = (
        "id,company_name,email,phone,owner_name,min_order_value,city,voivodeship,"
        "pickup_available,courier_available,active,verified,verification_status,"
        "archived_at"
    )
    try:
        producers = await sb_get(client, "local_producers", params={
            "select": select_full,
            "active": "eq.true",
            "verified": "eq.true",
            "limit": "500",
        }) or []
    except Exception as e:
        logger.warning("local_producers fetch (connect) failed: %s — retry", e)
        try:
            producers = await sb_get(client, "local_producers", params={
                "select": select_no_connect,
                "active": "eq.true",
                "verified": "eq.true",
                "limit": "500",
            }) or []
        except Exception as e2:
            logger.warning("local_producers fetch for Deal Hunter failed: %s", e2)
            return [], []

    visible = []
    for p in producers:
        if p.get("archived_at"):
            continue
        status = str(p.get("verification_status") or "").lower()
        if status and status != "approved":
            continue
        if "stripe_connect_id" in p:
            connect = (p.get("stripe_connect_id") or "").strip()
            if not connect.startswith("acct_"):
                continue
        visible.append(p)

    if not visible:
        return [], []

    producer_ids = [str(p["id"]) for p in visible if p.get("id")]
    products: list = []
    for i in range(0, len(producer_ids), 40):
        chunk = producer_ids[i : i + 40]
        id_filter = f"in.({','.join(chunk)})"
        try:
            rows = await sb_get(client, "producer_products", params={
                "select": "id,producer_id,title,description,price,unit,available,stock,weight_g",
                "producer_id": id_filter,
                "available": "eq.true",
                "limit": "2000",
            }) or []
        except Exception as e:
            logger.warning("producer_products fetch failed: %s", e)
            rows = []
        products.extend(rows)

    suppliers = []
    for p in visible:
        name = (p.get("company_name") or "Lokalny producent").strip()
        city = (p.get("city") or "").strip()
        if p.get("pickup_available"):
            lead = 0.0
        elif p.get("courier_available"):
            lead = 1.0
        else:
            lead = 1.0
        if city and city.lower() not in name.lower():
            display = f"{name} · Lokalny · {city}"
        else:
            display = f"{name} · Lokalny"
        suppliers.append({
            "id": str(p["id"]),
            "name": display,
            "email": p.get("email"),
            "contact_person": p.get("owner_name") or p.get("phone"),
            "phone": p.get("phone"),
            "min_order_value": float(p.get("min_order_value") or 0),
            "shipping_cost": 0.0,
            "free_shipping_threshold": 0.0,
            "lead_time_days": lead,
            "is_local_producer": True,
            "city": city or None,
            "voivodeship": (p.get("voivodeship") or None),
            "source": "local_producer",
        })

    by_producer = {str(p["id"]) for p in visible if p.get("id")}
    catalog = []
    for row in products:
        pid = str(row.get("producer_id") or "")
        if pid not in by_producer:
            continue
        try:
            stock = float(row.get("stock") or 0)
        except (TypeError, ValueError):
            stock = 0.0
        if stock <= 0:
            continue
        try:
            price = float(row.get("price") or 0)
        except (TypeError, ValueError):
            price = 0.0
        if price <= 0:
            continue
        title = (row.get("title") or "").strip()
        if not title:
            continue
        unit_raw = (row.get("unit") or "szt").strip() or "szt"
        unit_dim, _ = _norm_unit(unit_raw)
        # weight_g → kg_total tylko dla produktów sztukowych (opakowanie),
        # nie dla towaru sprzedawanego luzem w kg/l (tam stock = dostępne kg/l).
        kg_total = None
        if unit_dim == "szt":
            try:
                wg = float(row.get("weight_g") or 0)
                if wg > 0:
                    kg_total = round(wg / 1000.0, 6)
            except (TypeError, ValueError):
                kg_total = None
        entry = {
            "id": str(row.get("id")),
            "supplier_id": pid,
            "name": title,
            "variant": (row.get("description") or "")[:80] or None,
            "unit": unit_raw,
            "price_pln": price,
            "liters_total": None,
            "unit_count": 1,
            "is_visible": True,
            "is_local_producer": True,
            "producer_product_id": str(row.get("id")),
            "source": "local_producer",
            # Dostępny stan w jednostce produktu — Łowca ucina zamówienie do stocku
            "available_stock": stock,
            "stock": stock,
        }
        if kg_total:
            entry["kg_total"] = kg_total
        catalog.append(entry)

    logger.info(
        "Deal Hunter: loaded %s local producers, %s products (search scope)",
        len(suppliers),
        len(catalog),
    )
    return catalog, suppliers


async def _load_catalog_for_search_scope(client: httpx.AsyncClient, search_scope: Optional[str]):
    """Łączy katalogi hurtowników i/lub lokalnych producentów wg search_scope."""
    scope = _normalize_deal_hunter_search_scope(search_scope)
    catalog: list = []
    suppliers: list = []

    if scope in ("suppliers_only", "both"):
        c, s = await _fetch_catalog_and_suppliers(client)
        for row in c:
            row = dict(row)
            row.setdefault("source", "supplier")
            catalog.append(row)
        for srow in s:
            srow = dict(srow)
            srow.setdefault("source", "supplier")
            suppliers.append(srow)

    if scope in ("local_producers_only", "both"):
        c, s = await _fetch_local_producer_catalog(client)
        catalog.extend(c)
        suppliers.extend(s)

    return catalog, suppliers, scope


async def _load_supplier_reliability_scores(client: httpx.AsyncClient) -> dict[str, float]:
    """
    Agreguje Reliability Score z supplier_orders (received_ok) / reviews.
    Fail-soft: pusty dict gdy kolumny / tabela jeszcze nie istnieją.

    TODO(Phase 4 FE): post-delivery rating form → received_ok / missing_count
    na supplier_orders lub wiersze w supplier_delivery_reviews.
    """
    from collections import defaultdict
    from smart_basket_optimizer import compute_reliability_score

    ok_map: dict[str, int] = defaultdict(int)
    bad_map: dict[str, int] = defaultdict(int)
    miss_map: dict[str, int] = defaultdict(int)
    review_map: dict[str, int] = defaultdict(int)

    try:
        rows = await sb_get(client, "supplier_orders", params={
            "select": "supplier_id,received_ok,missing_count",
            "received_ok": "not.is.null",
            "limit": "2000",
        }) or []
        for r in rows:
            sid = r.get("supplier_id")
            if not sid:
                continue
            if r.get("received_ok") is True:
                ok_map[sid] += 1
            elif r.get("received_ok") is False:
                bad_map[sid] += 1
            try:
                miss_map[sid] += int(r.get("missing_count") or 0)
            except (TypeError, ValueError):
                pass
            review_map[sid] += 1
    except Exception as e:
        logger.debug(f"reliability from supplier_orders skipped: {e}")

    try:
        revs = await sb_get(client, "supplier_delivery_reviews", params={
            "select": "supplier_id,received_ok,missing_count",
            "limit": "2000",
        }) or []
        for r in revs:
            sid = r.get("supplier_id")
            if not sid:
                continue
            if r.get("received_ok") is True:
                ok_map[sid] += 1
            else:
                bad_map[sid] += 1
            try:
                miss_map[sid] += int(r.get("missing_count") or 0)
            except (TypeError, ValueError):
                pass
            review_map[sid] += 1
    except Exception as e:
        logger.debug(f"reliability from delivery_reviews skipped: {e}")

    out: dict[str, float] = {}
    for sid in set(list(ok_map) + list(bad_map) + list(review_map)):
        score = compute_reliability_score(
            received_ok_count=ok_map.get(sid, 0),
            received_bad_count=bad_map.get(sid, 0),
            missing_total=miss_map.get(sid, 0),
            review_count=review_map.get(sid, 0),
        )
        if score is not None:
            out[sid] = score
    return out


# ── AI Catalog Agent (świadome wyszukiwanie w katalogach dostawców) ────────────
AI_SYNONYM_SIM_MIN = 40      # token_set do puli AI (plurale / inna kolejność słów)
AI_SYNONYM_CONF_MIN = 0.72   # min. pewność AI, by uznać dopasowanie / zapisać synonim
AI_MAX_PER_ITEM = 3          # legacy pairwise (fallback)
AI_MAX_CHECKS = 12           # legacy global cap (fallback pairwise)


async def _ai_confirm_synonym(
    httpx_c: httpx.AsyncClient,
    warehouse_name: str,
    supplier_name: str,
    *,
    request_id: Optional[str] = None,
) -> tuple[bool, float, dict]:
    """GPT-4o-mini (fallback): para magazyn ↔ jedna oferta. Preferuj _ai_catalog_agent_match."""
    try:
        client = _openai()
        prompt = (
            f"Czy produkt z hurtowni '{supplier_name}' to JEST TEN SAM TOWAR "
            f"co produkt z magazynu kuchni '{warehouse_name}'? "
            "Dopuszczalne: synonim, wariant opakowania, marka. "
            "Odrzuć podobieństwo tylko literowe / inny produkt. "
            'Odpowiedz wyłącznie JSON: {"is_match": boolean, "confidence": float}.'
        )
        resp = await client.chat.completions.create(
            model=CHAT_MODEL, temperature=0.0,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        usage = getattr(resp, "usage", None)
        billing = {"credits_deducted": 0}
        if usage:
            extras = {"synonym_check": f"{warehouse_name} ~ {supplier_name}"}
            if request_id:
                extras["request_id"] = request_id
            billing = await _bill_openai_response(
                httpx_c, resp,
                endpoint="/api/orders/compare-offers",
                model=CHAT_MODEL,
                extras=extras,
            )
        data = json.loads((resp.choices[0].message.content or "{}").strip())
        return bool(data.get("is_match")), float(data.get("confidence") or 0.0), billing
    except Exception as e:  # noqa: BLE001
        logger.warning(f"_ai_confirm_synonym failed: {e}")
        return False, 0.0, {"credits_deducted": 0}


async def _ai_catalog_agent_match(
    httpx_c: httpx.AsyncClient,
    warehouse_name: str,
    candidates: list[dict],
    *,
    request_id: Optional[str] = None,
) -> tuple[set[str], float, dict]:
    """Agent OpenAI: wyszukaj w REALNYCH wierszach katalogów dostawców.

    candidates: [{id, name, supplier_name, variant?, sim?}]
    Zwraca (matched_catalog_ids, confidence, billing).
    Pusta lista = produktu NIE MA u dostawców (found=false) — bez zgadywania.
    """
    if not warehouse_name or not candidates:
        return set(), 0.0, {"credits_deducted": 0}
    # Deduplikuj po id, limituj długość promptu
    seen: set[str] = set()
    lines: list[str] = []
    id_by_norm: dict[str, str] = {}
    for c in candidates[:AI_CATALOG_MAX_CANDIDATES]:
        cid = str(c.get("id") or "").strip()
        name = str(c.get("name") or "").strip()
        if not cid or not name or cid in seen:
            continue
        seen.add(cid)
        sup = str(c.get("supplier_name") or "Dostawca").strip()
        variant = str(c.get("variant") or "").strip()
        vbit = f" | wariant={variant}" if variant else ""
        # Tag informacyjny: czy produkt występuje też w recepturach menu użytkownika.
        # NIE oznacza dostępności — obie grupy są pełnoprawnymi ofertami dostawcy.
        tag = "w_recepturach_menu" if c.get("in_menu") else "dodatkowa_oferta"
        lines.append(f"- id={cid} | dostawca={sup} | nazwa={name}{vbit} | tag={tag}")
        id_by_norm[_norm_pl(name)] = cid
    if not lines:
        return set(), 0.0, {"credits_deducted": 0}

    catalog_block = "\n".join(lines)
    prompt = (
        "Jesteś agentem zakupowym restauracji (Łowca Okazji). "
        "Masz dostęp do ofert z katalogów dostawców wgranych przez użytkownika. "
        "Zadanie: znaleźć oferty, które są TYM SAMYM towarem co zamówienie z magazynu.\n\n"
        f"ZAMÓWIENIE Z MAGAZYNU: \"{warehouse_name}\"\n\n"
        "OFERTY Z KATALOGÓW (wyłącznie te — nic spoza listy):\n"
        f"{catalog_block}\n\n"
        "ZNACZENIE TAGÓW:\n"
        "• w_recepturach_menu = produkt pojawia się też w recepturach menu użytkownika.\n"
        "• dodatkowa_oferta = produkt w katalogu dostawcy, ale niepowiązany z recepturami.\n"
        "OBA tagi to REALNE oferty do zamówienia. Tag NIE oznacza braku towaru.\n"
        "Jeśli zamówienie z magazynu pasuje do oferty z tagiem dodatkowa_oferta — DOPASUJ ją.\n\n"
        "ZASADY:\n"
        "1. Dopasuj gdy to TEN SAM towar — także przy:\n"
        "   • liczbie mnogiej/pojedynczej (batat = bataty, pomidor = pomidory),\n"
        "   • innej kolejności słów (filet z kurczaka = kurczak filet),\n"
        "   • synonimie / wariancie opakowania / marce / gramaturze.\n"
        "2. NIE odrzucaj oferty tylko dlatego, że ma tag dodatkowa_oferta.\n"
        "3. NIE dopasowuj tylko podobieństwa literowego "
        "(np. „grzanek” ≠ „granulat czosnkowy”).\n"
        "4. Jeśli ŻADNA oferta nie jest tym towarem — matched_ids = [].\n"
        "5. Nie wymyślaj produktów spoza listy. Zwracaj wyłącznie id z listy.\n"
        "6. Możesz zwrócić wiele id (różni dostawcy / warianty).\n\n"
        "Odpowiedz WYŁĄCZNIE JSON:\n"
        '{"matched_ids": ["..."], "confidence": 0.0, "reason": "krótko"}'
    )
    try:
        client = _openai()
        resp = await client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.0,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Jesteś precyzyjnym agentem matchingu katalogów B2B gastronomii PL. "
                        "Rozpoznajesz synonimy, odmiany i kolejność słów. "
                        "False positive (zły produkt w koszyku) jest gorszy niż false negative, "
                        "ale typowe pary jak batat/bataty albo filet z kurczaka/kurczak filet "
                        "MUSISZ uznać za match z wysoką pewnością."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        billing = {"credits_deducted": 0}
        usage = getattr(resp, "usage", None)
        if usage:
            extras = {
                "catalog_agent": warehouse_name,
                "candidates": len(lines),
            }
            if request_id:
                extras["request_id"] = request_id
            billing = await _bill_openai_response(
                httpx_c, resp,
                endpoint="/api/orders/compare-offers",
                model=CHAT_MODEL,
                extras=extras,
            )
        data = json.loads((resp.choices[0].message.content or "{}").strip())
        conf = float(data.get("confidence") or 0.0)
        raw_ids = data.get("matched_ids") or []
        allowed = set(seen)
        matched: set[str] = set()
        if isinstance(raw_ids, list):
            for x in raw_ids:
                cid = str(x or "").strip()
                if cid in allowed:
                    matched.add(cid)
        # Guard: niska pewność → odrzuć (lepiej „nie znaleziono”)
        if conf < AI_SYNONYM_CONF_MIN:
            return set(), conf, billing
        return matched, conf, billing
    except Exception as e:  # noqa: BLE001
        logger.warning(f"_ai_catalog_agent_match failed: {e}")
        return set(), 0.0, {"credits_deducted": 0}


async def _persist_synonyms(httpx_c: httpx.AsyncClient, additions: dict) -> None:
    """Dopisuje nowe (potwierdzone przez AI) synonimy do inventory_items.synonyms,
    aby kolejne porównania działały natychmiast, bez zużywania tokenów AI.
    additions: {inv_id: {"existing": list[str], "new": set[str]}}"""
    for inv_id, slot in additions.items():
        merged = list(slot.get("existing") or [])
        low = {str(x).strip().lower() for x in merged}
        changed = False
        for name in slot.get("new") or set():
            key = str(name).strip().lower()
            if key and key not in low:
                merged.append(name)
                low.add(key)
                changed = True
        if changed:
            try:
                await sb_patch(httpx_c, "inventory_items", {"id": f"eq.{inv_id}"},
                               {"synonyms": merged})
            except Exception as e:  # noqa: BLE001
                logger.warning(f"_persist_synonyms patch failed for {inv_id}: {e}")


_LONG_SHELF_KEYWORDS = (
    "mąka", "maka", "cukier", "sól", "sol ", "olej", "ocet", "ryż", "ryz",
    "makaron", "kasza", "pelati", "puszka", "konserwa", "bulion", "przypraw",
)


async def _load_long_shelf_fillers(client: httpx.AsyncClient, limit: int = 18) -> list[dict]:
    """Produkty magazynowe / katalogowe o długiej dacie — wypełniacze progów."""
    out: list[dict] = []
    try:
        inv = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,unit,min_quantity",
            "limit": "800",
        }) or []
        for row in inv:
            name = (row.get("name") or "").lower()
            if any(k in name for k in _LONG_SHELF_KEYWORDS):
                out.append({
                    "name": row.get("name"),
                    "stock": float(row.get("quantity") or 0),
                    "unit": row.get("unit") or "szt",
                    "source": "warehouse",
                })
            if len(out) >= limit:
                break
    except Exception as e:
        logger.warning(f"_load_long_shelf_fillers: {e}")
    return out


async def _load_deal_hunter_kitchen_signals(
    client: httpx.AsyncClient,
    *,
    days: int = 30,
) -> dict:
    """
    Sygnały kuchni (ostatnie ~30 dni) dla priority score + suggestions.
    Zwraca:
      kitchen_priorities: { inventory_id | norm_name → {score, class_a, reasons, ...} }
      waste_top: [{name, cost_pln?, qty?}, ...]
      fillers: long-shelf candidates
    Fail-soft — puste mapy gdy brak danych / błąd.
    """
    from smart_basket_optimizer import compute_priority_score, _product_norm_key

    kitchen_priorities: dict[str, dict] = {"_by_name": {}}
    waste_top: list[dict] = []
    fillers: list[dict] = []

    try:
        fillers = await _load_long_shelf_fillers(client)
    except Exception as e:
        logger.warning(f"deal_hunter fillers: {e}")

    # ── POS / menu sales (30d) ──
    sales_by_ing: dict[str, float] = {}
    try:
        dish_sales = await _aggregate_menu_sales(client, days)
        # Map dish sales → ingredients via recipes (same idea as rank_inventory_usage)
        ri = await sb_get(client, "recipe_ingredients", params={
            "select": "menu_item_id,ingredient_name,quantity,unit",
            "limit": "30000",
        }) or []
        by_menu: dict[str, list] = {}
        for r in ri:
            by_menu.setdefault(r["menu_item_id"], []).append(r)
        for d in dish_sales:
            sold = float(d.get("qty_sold") or 0)
            if sold <= 0:
                continue
            # dish-level sales score (for menu items that are also ordered as products)
            dname = _product_norm_key(str(d.get("name") or ""))
            if dname:
                sales_by_ing[dname] = sales_by_ing.get(dname, 0.0) + sold
            for ing in by_menu.get(d["menu_item_id"], []):
                iname = _product_norm_key(str(ing.get("ingredient_name") or ""))
                if not iname:
                    continue
                used = float(ing.get("quantity") or 0) * sold
                sales_by_ing[iname] = sales_by_ing.get(iname, 0.0) + used
    except Exception as e:
        logger.warning(f"deal_hunter menu sales: {e}")

    # ── Waste TOP (30d) ──
    waste_qty: dict[str, float] = {}
    try:
        from datetime import datetime, timezone, timedelta
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        logs = await sb_get(client, "waste_logs", params={
            "select": "item_name,quantity,unit,created_at,item_id",
            "created_at": f"gte.{_pg_ts(since)}",
            "order": "created_at.desc",
            "limit": "5000",
        }) or []
        for w in logs:
            key = _product_norm_key(str(w.get("item_name") or ""))
            if not key:
                continue
            waste_qty[key] = waste_qty.get(key, 0.0) + float(w.get("quantity") or 0)
        ranked_waste = sorted(waste_qty.items(), key=lambda kv: -kv[1])
        waste_top = [{"name": k, "qty": v} for k, v in ranked_waste[:15]]
    except Exception as e:
        logger.warning(f"deal_hunter waste: {e}")

    # ── Inventory stock vs min (low stock) ──
    inv_rows: list[dict] = []
    try:
        inv_rows = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,min_quantity,unit",
            "limit": "5000",
        }) or []
    except Exception as e:
        logger.warning(f"deal_hunter inventory: {e}")

    max_sales = max(sales_by_ing.values()) if sales_by_ing else 0.0
    max_waste = max(waste_qty.values()) if waste_qty else 0.0

    for row in inv_rows:
        name = str(row.get("name") or "")
        key = _product_norm_key(name)
        iid = str(row.get("id") or "")
        qty = float(row.get("quantity") or 0)
        try:
            min_q = float(row.get("min_quantity") or 0)
        except (TypeError, ValueError):
            min_q = 0.0
        low_stock = min_q > 0 and qty <= min_q
        sales_rank = (sales_by_ing.get(key, 0.0) / max_sales) if max_sales > 0 else 0.0
        # usage ≈ sales_by_ing (recipe×POS) — reuse as usage_rank
        usage_rank = sales_rank
        waste_rank = (waste_qty.get(key, 0.0) / max_waste) if max_waste > 0 else 0.0
        pri = compute_priority_score(
            sales_rank=sales_rank,
            usage_rank=usage_rank,
            waste_rank=waste_rank,
            low_stock=low_stock,
            critical_shortage=False,
        )
        pri["name"] = name
        pri["inventory_id"] = iid
        if iid:
            kitchen_priorities[iid] = pri
        if key:
            kitchen_priorities["_by_name"][key] = pri
            kitchen_priorities[key] = pri

    # Also stamp pure waste/sales keys not in inventory
    for key, val in sales_by_ing.items():
        if key in kitchen_priorities:
            continue
        sales_rank = (val / max_sales) if max_sales > 0 else 0.0
        waste_rank = (waste_qty.get(key, 0.0) / max_waste) if max_waste > 0 else 0.0
        pri = compute_priority_score(
            sales_rank=sales_rank,
            usage_rank=sales_rank,
            waste_rank=waste_rank,
        )
        kitchen_priorities[key] = pri
        kitchen_priorities["_by_name"][key] = pri

    return {
        "kitchen_priorities": kitchen_priorities,
        "waste_top": waste_top,
        "fillers": fillers,
    }


async def _enrich_deal_hunter_ai_tips(
    client: httpx.AsyncClient,
    result: dict,
    per_item: list[dict],
) -> dict:
    """LLM jako analityk biznesowy — NIE liczy koszyków, tylko smart_tip + summary.

    Koszty API: jedno wywołanie na porównanie, kompaktowy JSON wejściowy.
    """
    scenarios = result.get("scenarios") or []
    if not scenarios:
        scenarios = [
            result.get("scenario_split_max"),
            result.get("scenario_monolith"),
            result.get("scenario_smart_hybrid"),
        ]
        scenarios = [s for s in scenarios if isinstance(s, dict)]
    if not scenarios:
        return result

    needed = [p.get("product_name") for p in per_item if p.get("product_name")]
    compact_scenarios = []
    for sc in scenarios:
        compact_scenarios.append({
            "id": sc.get("id"),
            "label": sc.get("label"),
            "products_pln": sc.get("products_pln"),
            "shipping_pln": sc.get("shipping_pln"),
            "total_pln": sc.get("total_pln"),
            "supplier_count": sc.get("supplier_count"),
            "viable": sc.get("viable"),
            "meets_all_minimums": sc.get("meets_all_minimums"),
            "missing": (sc.get("missing") or [])[:8],
            "logistics_hints": sc.get("logistics_hints") or [],
            "math_tip": sc.get("smart_tip") or "",
            "split": {
                (g.get("supplier_name") or "?"): [
                    i.get("product_name") for i in (g.get("items") or [])[:12]
                ]
                for g in (sc.get("suppliers") or [])
            },
        })

    fillers = await _load_long_shelf_fillers(client)
    # Structured evidence from math suggestions — LLM must not invent tips
    math_suggestions = result.get("suggestions") or []
    decision_log = result.get("decision_log") or []
    prompt = (
        "Jesteś 'Łowcą Okazji' – doradcą zakupowym Gastro Manager. "
        "Koszyki i kwoty są JUŻ WYLICZONE matematycznie — NIE zmieniaj liczb. "
        "Twoje zadanie: napisać krótkie, praktyczne tipy po polsku.\n\n"
        f"Produkty potrzebne: {json.dumps(needed, ensure_ascii=False)}\n"
        f"Scenariusze (math): {json.dumps(compact_scenarios, ensure_ascii=False)}\n"
        f"Wypełniacze długoterminowe z magazynu: {json.dumps(fillers, ensure_ascii=False)}\n"
        f"Sugestie matematyczne (evidence — bazuj na nich, nie wymyślaj): "
        f"{json.dumps(math_suggestions[:12], ensure_ascii=False)}\n"
        f"Decision log (fragment): {json.dumps((decision_log or [])[:8], ensure_ascii=False)}\n\n"
        "Zwróć WYŁĄCZNIE JSON:\n"
        "{"
        '"analysis_summary":"2-3 zdania podsumowania dla szefa kuchni",'
        '"recommended_variant_id":"split_max|monolith|smart_hybrid",'
        '"recommended_reason":"jedno zdanie dlaczego",'
        '"tips":[{"scenario_id":"...","smart_tip":"konkretna rada (minima/dostawa/wypełniacz)"}],'
        '"suggestion_rewrites":[{"type":"...","message":"opcjonalnie dopracowana treść sugestii"}]'
        "}"
    )
    try:
        oai = _openai()
        resp = await oai.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.3,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Analityk finansowy gastronomii. Nie wymyślaj cen ani faktów. "
                        "Opieraj tipy na logistics_hints, sugestiach matematycznych i wypełniaczach."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        )
        bill = await _bill_openai_response(
            client, resp, endpoint="/api/orders/compare-offers/tips",
            model=CHAT_MODEL, extras={"scenarios": len(scenarios)},
        )
        raw = (resp.choices[0].message.content or "").strip()
        parsed = json.loads(raw) if raw else {}
    except Exception as e:
        logger.warning(f"_enrich_deal_hunter_ai_tips LLM failed: {e}")
        return result

    tips_by_id = {
        (t.get("scenario_id") or ""): (t.get("smart_tip") or "").strip()
        for t in (parsed.get("tips") or [])
        if isinstance(t, dict)
    }

    def _apply(sc: Optional[dict]) -> Optional[dict]:
        if not isinstance(sc, dict):
            return sc
        tip = tips_by_id.get(sc.get("id") or "")
        if tip:
            sc = dict(sc)
            sc["smart_tip"] = tip
        return sc

    result["scenario_split_max"] = _apply(result.get("scenario_split_max"))
    result["scenario_monolith"] = _apply(result.get("scenario_monolith"))
    result["scenario_smart_hybrid"] = _apply(result.get("scenario_smart_hybrid"))
    result["scenarios"] = [_apply(s) for s in (result.get("scenarios") or [])]

    summary = (parsed.get("analysis_summary") or "").strip()
    if summary:
        result["analysis_summary"] = summary
        result["assistant_speech"] = summary
    rec = (parsed.get("recommended_variant_id") or "").strip()
    if rec in ("split_max", "monolith", "smart_hybrid"):
        result["recommended_scenario_id"] = rec
        reason = (parsed.get("recommended_reason") or "").strip()
        if reason:
            result["recommended_reason"] = reason

    # Optional LLM wording polish for math suggestions (keep evidence intact)
    rewrites = {
        (r.get("type") or ""): (r.get("message") or "").strip()
        for r in (parsed.get("suggestion_rewrites") or [])
        if isinstance(r, dict) and (r.get("message") or "").strip()
    }
    if rewrites and isinstance(result.get("suggestions"), list):
        polished = []
        for s in result["suggestions"]:
            s2 = dict(s)
            t = s2.get("type") or ""
            if t in rewrites:
                s2["message"] = rewrites[t]
                s2["llm_polished"] = True
            polished.append(s2)
        result["suggestions"] = polished
    if bill:
        result.setdefault("_tips_billing", bill)
        # Dołącz do głównego rozliczenia jeśli merge_billing nie był wywołany
        if bill.get("credits_deducted"):
            result["credits_deducted"] = int(result.get("credits_deducted") or 0) + int(
                bill.get("credits_deducted") or 0
            )
            if bill.get("credits_remaining") is not None:
                result["credits_remaining"] = bill.get("credits_remaining")
    return result


def _food_keys_same_product(ka: str, kb: str, name_a: str, name_b: str) -> bool:
    """Czy dwa food_key wskazują ten sam produkt (rukola ≈ sałata rukola).

    Krótkie 1-tokenowe stem'y (np. „ser”) NIE łączą różnych serów.
    """
    ka, kb = (ka or "").strip(), (kb or "").strip()
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    ta, tb = set(ka.split()), set(kb.split())
    if not ta or not tb:
        return False
    if ta <= tb or tb <= ta:
        smaller = ta if len(ta) <= len(tb) else tb
        if len(smaller) >= 2:
            return True
        only = next(iter(smaller))
        if len(only) >= 5 and float(fuzz.token_set_ratio(_norm_pl(name_a), _norm_pl(name_b))) >= 80:
            return True
    return float(fuzz.token_set_ratio(_norm_pl(name_a), _norm_pl(name_b))) >= 92


def _merge_duplicate_compare_items(per_item: list[dict]) -> list[dict]:
    """Łączy linie porównania, które to ten sam produkt magazynowy / ten sam food_key.

    Chroni przed podwójnym zamówieniem (np. „filet z kurczaka” + „kurczak filet” → 2× 6 kg).
    Różne cięcia (filet vs pierś) mają inny food_key i zostają osobno.
    """
    if len(per_item) <= 1:
        return per_item

    def _group_key(pi: dict) -> str:
        inv = pi.get("inventory_id")
        if inv:
            return f"inv:{inv}"
        fk = (pi.get("food_key") or _food_match_key(pi.get("product_name") or "")).strip()
        unit = (pi.get("unit") or "").strip().lower()
        return f"fk:{fk}|{unit}" if fk else f"name:{_norm_pl(pi.get('product_name') or '')}|{unit}"

    # Najpierw scal po kompatybilnym food_key (rukola / sałata rukola)
    coalesced: list[dict] = []
    used = [False] * len(per_item)
    for i, a in enumerate(per_item):
        if used[i]:
            continue
        cluster = [a]
        used[i] = True
        ka = (a.get("food_key") or _food_match_key(a.get("product_name") or "")).strip()
        ua = (a.get("unit") or "").strip().lower()
        ia = a.get("inventory_id")
        for j in range(i + 1, len(per_item)):
            if used[j]:
                continue
            b = per_item[j]
            if ia and b.get("inventory_id") and str(ia) == str(b.get("inventory_id")):
                cluster.append(b)
                used[j] = True
                continue
            ub = (b.get("unit") or "").strip().lower()
            if ua and ub and ua != ub:
                continue
            kb = (b.get("food_key") or _food_match_key(b.get("product_name") or "")).strip()
            if _food_keys_same_product(
                ka, kb, a.get("product_name") or "", b.get("product_name") or "",
            ):
                cluster.append(b)
                used[j] = True
        merge_token = id(cluster[0])
        for c in cluster:
            c["_merge_into"] = merge_token
        coalesced.extend(cluster)

    buckets: dict[str, list[dict]] = {}
    for pi in coalesced:
        mk = pi.get("_merge_into")
        key = f"merge:{mk}" if mk is not None else _group_key(pi)
        buckets.setdefault(key, []).append(pi)

    merged: list[dict] = []
    for group in buckets.values():
        if len(group) == 1:
            merged.append(group[0])
            continue
        # Dodatkowo: wymagaj podobieństwa nazw jeśli tylko food_key (uniknij przypadkowych zderzeń)
        if not group[0].get("inventory_id") and len(group) > 1:
            refined: list[list[dict]] = []
            for pi in group:
                placed = False
                for cluster in refined:
                    ref = cluster[0].get("product_name") or ""
                    cand = pi.get("product_name") or ""
                    if fuzz.token_set_ratio(_norm_pl(ref), _norm_pl(cand)) >= 86:
                        cluster.append(pi)
                        placed = True
                        break
                if not placed:
                    refined.append([pi])
            subgroups = refined
        else:
            subgroups = [group]

        for cluster in subgroups:
            if len(cluster) == 1:
                merged.append(cluster[0])
                continue
            base = dict(cluster[0])
            total_qty = sum(float(x.get("quantity") or 0) for x in cluster)
            total_base = sum(float(x.get("base_quantity") or x.get("quantity") or 0) for x in cluster)
            total_target = sum(float(x.get("target_quantity") or x.get("quantity") or 0) for x in cluster)
            names = [str(x.get("product_name") or "") for x in cluster]
            # Preferuj najdłuższą / najbardziej opisową nazwę
            best_name = max(names, key=lambda n: (len(n), n))
            # Połącz oferty: per dostawca najtańsza linia, przeliczona do nowej ilości
            bbs: dict[str, dict] = {}
            for x in cluster:
                for sid, q in (x.get("best_by_supplier") or {}).items():
                    prev = bbs.get(sid)
                    up = float(q.get("unit_price_base") or 0)
                    if prev is None or up < float(prev.get("unit_price_base") or 1e18):
                        bbs[sid] = dict(q)
            for sid, q in bbs.items():
                up = float(q.get("unit_price_base") or 0)
                q["line_total"] = round(up * total_base, 2)
                q["order_base_qty"] = round(total_base, 4)
            base["product_name"] = best_name
            base["quantity"] = round(total_qty, 4)
            base["base_quantity"] = round(total_base, 4)
            base["target_quantity"] = round(total_target, 4)
            base["quantity_min"] = round(total_target * 0.9, 4)
            base["quantity_max"] = round(total_target * 1.1, 4)
            base["best_by_supplier"] = bbs
            base["merged_from"] = names
            base.pop("_merge_into", None)
            merged.append(base)
    for m in merged:
        m.pop("_merge_into", None)
    return merged


def _dedupe_products_across_supplier_groups(groups: list[dict]) -> list[dict]:
    """Jeden produkt może być tylko u jednego dostawcy — zostaw najtańszą linię."""
    if not groups:
        return groups
    best: dict[str, tuple[float, int, dict]] = {}
    for gi, g in enumerate(groups):
        for it in g.get("items") or []:
            key = _norm_pl(it.get("product_name") or it.get("matched_name") or "")
            if not key:
                continue
            lt = float(it.get("line_total") or 0)
            prev = best.get(key)
            if prev is None or lt < prev[0] - 1e-9:
                best[key] = (lt, gi, it)
    out: list[dict] = []
    for gi, g in enumerate(groups):
        kept = []
        for it in g.get("items") or []:
            key = _norm_pl(it.get("product_name") or it.get("matched_name") or "")
            hit = best.get(key)
            if hit and hit[1] == gi:
                kept.append(it)
        if not kept:
            continue
        ng = dict(g)
        ng["items"] = kept
        ng["subtotal_pln"] = round(sum(float(x.get("line_total") or 0) for x in kept), 2)
        min_v = float(ng.get("min_order_value") or 0)
        ng["meets_minimum_order"] = (min_v <= 0) or (ng["subtotal_pln"] >= min_v)
        if min_v > 0:
            ng["gap_to_minimum_pln"] = round(max(0.0, min_v - ng["subtotal_pln"]), 2)
        out.append(ng)
    return out


def _recompute_scenario_totals(sc: dict) -> None:
    if not isinstance(sc, dict):
        return
    groups = sc.get("suppliers") or []
    sc["supplier_count"] = len(groups)
    sc["products_pln"] = round(sum(float(g.get("subtotal_pln") or 0) for g in groups), 2)
    ship = float(sc.get("shipping_pln") or 0)
    sc["total_pln"] = round(float(sc["products_pln"]) + ship, 2)


def _sanitize_optimize_unique_products(result: dict) -> dict:
    """Po optymalizacji: zero podwójnych SKU między dostawcami w scenariuszach."""
    if not isinstance(result, dict):
        return result
    for key in ("scenario_split_max", "scenario_monolith", "scenario_smart_hybrid"):
        sc = result.get(key)
        if isinstance(sc, dict) and isinstance(sc.get("suppliers"), list):
            sc["suppliers"] = _dedupe_products_across_supplier_groups(sc["suppliers"])
            _recompute_scenario_totals(sc)
    scenarios = result.get("scenarios")
    if isinstance(scenarios, list):
        for sc in scenarios:
            if isinstance(sc, dict) and isinstance(sc.get("suppliers"), list):
                sc["suppliers"] = _dedupe_products_across_supplier_groups(sc["suppliers"])
                _recompute_scenario_totals(sc)
    for key in ("variant_split", "option_optimized"):
        vs = result.get(key)
        if isinstance(vs, dict) and isinstance(vs.get("suppliers"), list):
            vs["suppliers"] = _dedupe_products_across_supplier_groups(vs["suppliers"])
            vs["total_pln"] = round(
                sum(float(g.get("subtotal_pln") or 0) for g in vs["suppliers"]), 2,
            )
    best = result.get("best_option")
    if isinstance(best, dict):
        if isinstance(best.get("suppliers"), list):
            best["suppliers"] = _dedupe_products_across_supplier_groups(best["suppliers"])
    return result


def _filter_compare_to_requested_products(result: dict, allowed_names: list[str]) -> dict:
    """Usuń z koszyków dostawców pozycje spoza listy zamówionych braków (anti-bleed)."""
    if not isinstance(result, dict) or not allowed_names:
        return result
    allowed_norm = {_norm_pl(n) for n in allowed_names if n and str(n).strip()}
    allowed_food = {_food_match_key(n) for n in allowed_names if n and str(n).strip()}

    def _ok(name: str) -> bool:
        raw = (name or "").strip()
        if not raw:
            return False
        n = _norm_pl(raw)
        if n in allowed_norm:
            return True
        fk = _food_match_key(raw)
        if fk and fk in allowed_food:
            return True
        for an in allowed_names:
            if _food_keys_same_product(fk, _food_match_key(an), raw, an):
                return True
        return False

    def _filter_groups(groups: list) -> list:
        out = []
        for g in groups or []:
            if not isinstance(g, dict):
                continue
            items = [
                it for it in (g.get("items") or [])
                if _ok(str(it.get("product_name") or it.get("matched_name") or ""))
            ]
            if not items:
                continue
            ng = dict(g)
            ng["items"] = items
            ng["subtotal_pln"] = round(sum(float(x.get("line_total") or 0) for x in items), 2)
            min_v = float(ng.get("min_order_value") or 0)
            ng["meets_minimum_order"] = (min_v <= 0) or (ng["subtotal_pln"] >= min_v)
            if min_v > 0:
                ng["gap_to_minimum_pln"] = round(max(0.0, min_v - ng["subtotal_pln"]), 2)
            out.append(ng)
        return out

    for key in ("scenario_split_max", "scenario_monolith", "scenario_smart_hybrid"):
        sc = result.get(key)
        if isinstance(sc, dict) and isinstance(sc.get("suppliers"), list):
            sc["suppliers"] = _filter_groups(sc["suppliers"])
            _recompute_scenario_totals(sc)
    if isinstance(result.get("scenarios"), list):
        for sc in result["scenarios"]:
            if isinstance(sc, dict) and isinstance(sc.get("suppliers"), list):
                sc["suppliers"] = _filter_groups(sc["suppliers"])
                _recompute_scenario_totals(sc)
    for key in ("variant_split", "option_optimized"):
        vs = result.get(key)
        if isinstance(vs, dict) and isinstance(vs.get("suppliers"), list):
            vs["suppliers"] = _filter_groups(vs["suppliers"])
            vs["total_pln"] = round(
                sum(float(g.get("subtotal_pln") or 0) for g in vs["suppliers"]), 2,
            )
    best = result.get("best_option")
    if isinstance(best, dict):
        if isinstance(best.get("suppliers"), list):
            best["suppliers"] = _filter_groups(best["suppliers"])
        if isinstance(best.get("items"), list):
            best["items"] = [
                it for it in best["items"]
                if _ok(str(it.get("product_name") or it.get("matched_name") or ""))
            ]
            best["subtotal_pln"] = round(
                sum(float(x.get("line_total") or 0) for x in best["items"]), 2,
            )
            best["total_pln"] = best.get("total_pln") or best["subtotal_pln"]
    return result


@app.post("/api/orders/compare-offers")
async def compare_offers(req: CompareOffersRequest):
    if not req.items:
        raise HTTPException(status_code=400, detail="Brak pozycji do porównania.")

    request_id = str(uuid.uuid4())
    per_item = []

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        await _check_ai_access(client, needs_credits=True, needs_deal_hunter=True)
        catalog, suppliers, search_scope = await _load_catalog_for_search_scope(
            client, req.search_scope,
        )
        lp_suppliers = [s for s in suppliers if s.get("is_local_producer")]
        wholesaler_suppliers = [s for s in suppliers if not s.get("is_local_producer")]
        # Twarda bramka zakresu — nigdy nie mieszaj hurtowników przy „tylko lokalni”
        # i odwrotnie (obrona przed regresją / złym cache).
        if search_scope == "local_producers_only":
            suppliers = list(lp_suppliers)
            catalog = [
                r for r in catalog
                if r.get("is_local_producer") or r.get("source") == "local_producer"
            ]
        elif search_scope == "suppliers_only":
            suppliers = list(wholesaler_suppliers)
            catalog = [
                r for r in catalog
                if not (r.get("is_local_producer") or r.get("source") == "local_producer")
            ]
        sup_by_id = {str(s["id"]): s for s in suppliers if s.get("id")}

        if search_scope == "local_producers_only" and not catalog:
            return {
                "ok": True,
                "optimizer_version": 2,
                "search_scope": search_scope,
                "includes_local_producers": False,
                "items_requested": [
                    {
                        "product_name": it.product_name_or_id,
                        "quantity": it.quantity,
                        "unit": it.unit,
                        "found": False,
                    }
                    for it in req.items
                ],
                "best_option": None,
                "option_optimized": {"suppliers": [], "total_pln": 0},
                "scenarios": [],
                "assistant_speech": (
                    "Brak ofert u lokalnych dostawców (Lokalni Przetwórcy). "
                    "Sprawdź, czy dystrybutorzy są active/verified/approved "
                    "i mają Stripe Connect, oraz czy produkty mają stan > 0."
                ),
                "message": (
                    "Nie znaleziono katalogu lokalnych dostawców dla wybranego zakresu."
                ),
            }

        # Magazyn (nazwa + synonimy + gramatura 1 szt.) — natychmiastowe dopasowanie bez AI.
        has_syn = await _has_inventory_synonyms(client)
        inv_select = (
            "id,name,synonyms,unit,unit_weight_volume,weight_volume_unit"
            if has_syn else
            "id,name,unit,unit_weight_volume,weight_volume_unit"
        )
        try:
            inv_rows = await sb_get(client, "inventory_items",
                                    params={
                                        "select": inv_select + ",is_active",
                                        "is_active": "eq.true",
                                        "limit": "2000",
                                    }) or []
        except httpx.HTTPStatusError as e:
            text = (e.response.text if e.response is not None else "") or ""
            if "is_active" in text:
                inv_rows = await sb_get(client, "inventory_items",
                                        params={"select": inv_select, "limit": "2000"}) or []
            elif "unit_weight_volume" in text or "weight_volume_unit" in text:
                inv_select = "id,name,synonyms" if has_syn else "id,name"
                try:
                    inv_rows = await sb_get(client, "inventory_items",
                                            params={
                                                "select": inv_select + ",is_active",
                                                "is_active": "eq.true",
                                                "limit": "2000",
                                            }) or []
                except httpx.HTTPStatusError:
                    inv_rows = await sb_get(client, "inventory_items",
                                            params={"select": inv_select, "limit": "2000"}) or []
            else:
                raise
        inv_rows = [r for r in inv_rows if r.get("is_active") is not False]

        ai_item_budget = AI_CATALOG_MAX_ITEM_CALLS  # agent katalogowy (1 call / pozycja)
        ai_budget = AI_MAX_CHECKS  # legacy pairwise fallback
        synonym_additions: dict = {}   # inv_id -> {"existing": [...], "new": set()}
        billing_events: list[dict] = []
        pack_notes: list[str] = []

        def _consider(bbs: dict, row: dict, price_base: float, base_dim: str,
                      order_base_qty: float, target_base_qty: float, via: str,
                      pack_base_qty: float = 0.0, band_hi_base: float = 0.0,
                      stock_capped: bool = False) -> None:
            sid = row.get("supplier_id")
            if not sid:
                return
            # Lokalny dostawca: nigdy nie zamawiaj więcej niż ma na stanie
            capped_qty, did_cap = _cap_order_qty_to_available_stock(
                order_base_qty, pack_base_qty, row, base_dim,
            )
            if capped_qty <= 0:
                return
            stock_capped = bool(stock_capped or did_cap)
            order_base_qty = capped_qty
            line_total = round(price_base * order_base_qty, 2)
            prev = bbs.get(sid)
            # Tańsza linia wygrywa; przy remisie — ilość bliżej targetu
            better = False
            if prev is None:
                better = True
            elif line_total < prev["line_total"] - 1e-9:
                better = True
            elif abs(line_total - prev["line_total"]) < 1e-9:
                if abs(order_base_qty - target_base_qty) < abs(
                    float(prev.get("order_base_qty") or 0) - target_base_qty
                ):
                    better = True
            if better:
                sup = sup_by_id.get(sid, {})
                is_lp = bool(
                    row.get("is_local_producer")
                    or sup.get("is_local_producer")
                    or row.get("source") == "local_producer"
                    or sup.get("source") == "local_producer"
                )
                entry = {
                    "supplier_id": sid,
                    "supplier_name": (sup.get("name") or "").strip() or "Dostawca",
                    "supplier_email": sup.get("email"),
                    "matched_name": row.get("name"),
                    "matched_variant": row.get("variant"),
                    "unit_price_base": round(price_base, 2),
                    "base_dim": base_dim,
                    "line_total": line_total,
                    "matched_via": via,
                    "order_base_qty": round(order_base_qty, 4),
                    "target_base_qty": round(target_base_qty, 4),
                    "pack_base_qty": round(float(pack_base_qty or 0), 4),
                    "band_hi_base": round(float(band_hi_base or 0), 4),
                }
                if stock_capped:
                    entry["stock_capped"] = True
                    avail = _catalog_available_base_qty(row, base_dim)
                    if avail is not None:
                        entry["available_stock_base"] = round(float(avail), 4)
                if is_lp:
                    entry["is_local_producer"] = True
                    if row.get("producer_product_id") or row.get("id"):
                        entry["catalog_product_id"] = str(
                            row.get("producer_product_id") or row.get("id")
                        )
                bbs[sid] = entry

        for it in req.items:
            req_dim, req_factor = _norm_unit(it.unit)
            req_base_qty = float(it.quantity) * req_factor
            qty_lo_base = (
                float(it.quantity_min) * req_factor
                if it.quantity_min is not None else req_base_qty * 0.9
            )
            qty_hi_base = (
                float(it.quantity_max) * req_factor
                if it.quantity_max is not None else req_base_qty * 1.1
            )
            if qty_hi_base < qty_lo_base:
                qty_lo_base, qty_hi_base = qty_hi_base, qty_lo_base

            # Rozpoznaj produkt w magazynie → id + istniejące synonimy + gramatura 1 szt.
            inv_row, _ = _resolve_by_fuzzy(it.product_name_or_id, inv_rows, threshold=70)
            inv_id = inv_row.get("id") if inv_row else None
            existing_syn = list(inv_row.get("synonyms") or []) if inv_row else []
            # Preferuj gramaturę z requestu (UI „gramatura 1 sztuki”), potem magazyn
            uwv = it.unit_weight_volume
            if uwv is None:
                uwv = (inv_row or {}).get("unit_weight_volume")
            wvu = it.weight_volume_unit
            if not wvu:
                wvu = (inv_row or {}).get("weight_volume_unit")
            # Primary = nazwa z zamówienia (+ ewentualnie kanoniczna z magazynu).
            # Synonimy pomagają score'ować, ale NIE otwierają auto-accept bez zgodności z primary.
            primary_names = [it.product_name_or_id]
            if inv_row and inv_row.get("name"):
                primary_names.append(inv_row.get("name"))
            primary_names = [n for n in primary_names if n and str(n).strip()]
            known_names = list(primary_names)
            known_names.extend(existing_syn)
            known_names = [n for n in known_names if n]
            known_norm = [_norm_pl(n) for n in known_names]
            warehouse_name = (inv_row.get("name") if inv_row else None) or it.product_name_or_id

            best_by_supplier: dict[str, dict] = {}
            # Pula do agenta AI: realne wiersze katalogu (nie wymyślone)
            ai_pool: list[tuple] = []  # (score, row, base_dim, price_base, order_base, pack, target, hi)
            item_pack_adjusted = False
            match_dim_used = req_dim
            match_target_base = req_base_qty
            accepted_catalog_ids: set[str] = set()

            for row in catalog:
                # is_visible = „występuje w recepturach menu” — NIE „dostępny u dostawcy”.
                # Zamówienia braków muszą szukać w CAŁYM katalogu (W menu + poza menu).
                row_name = row.get("name", "")
                bp = _catalog_base_price(row)
                if bp is None:
                    continue
                base_dim, price_base = bp
                # Ten sam wymiar LUB konwersja przez gramaturę 1 szt. (magazyn szt ↔ oferta kg/g)
                target_in_dim = _convert_req_to_catalog_dim(
                    req_base_qty, req_dim, base_dim, uwv, wvu,
                )
                # Brak przeliczenia jednostek NIE blokuje matchingu nazw
                # (warzywa kg↔szt bez gramatury i tak muszą trafić do agenta AI).
                unit_fallback = target_in_dim is None
                if target_in_dim is None:
                    target_in_dim = float(req_base_qty)
                lo_in_dim = _convert_req_to_catalog_dim(
                    qty_lo_base, req_dim, base_dim, uwv, wvu,
                )
                hi_in_dim = _convert_req_to_catalog_dim(
                    qty_hi_base, req_dim, base_dim, uwv, wvu,
                )
                if lo_in_dim is None:
                    lo_in_dim = target_in_dim * 0.9
                if hi_in_dim is None:
                    hi_in_dim = target_in_dim * 1.1
                if hi_in_dim < lo_in_dim:
                    lo_in_dim, hi_in_dim = hi_in_dim, lo_in_dim
                pack = _catalog_pack_base_qty(row, base_dim)
                if unit_fallback:
                    order_base = max(float(pack or 0), float(target_in_dim), 1.0)
                    adjusted = True
                else:
                    order_base, adjusted = _qty_in_band(
                        target_in_dim, lo_in_dim, hi_in_dim, pack,
                    )
                order_base, stock_capped = _cap_order_qty_to_available_stock(
                    order_base, pack, row, base_dim,
                )
                if order_base <= 0:
                    continue
                if stock_capped:
                    adjusted = True
                if adjusted:
                    item_pack_adjusted = True
                    match_dim_used = base_dim
                    match_target_base = target_in_dim
                score = max(
                    (_local_catalog_match_score(n, row_name) for n in known_names),
                    default=0.0,
                )
                food_ok = any(_food_names_compatible(n, row_name) for n in primary_names)
                # Auto-accept TYLKO prawie pewne + kompatybilne z primary (anty-FP)
                if _strict_local_catalog_accept(primary_names, row_name):
                    _consider(best_by_supplier, row, price_base, base_dim,
                              order_base, target_in_dim, "fuzzy",
                              pack_base_qty=pack, band_hi_base=hi_in_dim,
                              stock_capped=stock_capped)
                    cid = str(row.get("id") or "")
                    if cid:
                        accepted_catalog_ids.add(cid)
                    continue
                rn = _norm_pl(row_name)
                try:
                    sim = max(
                        (
                            max(
                                float(fuzz.token_set_ratio(kn, rn)),
                                float(fuzz.token_sort_ratio(kn, rn)),
                            )
                            for kn in known_norm
                        ),
                        default=0.0,
                    )
                except Exception:
                    sim = 0.0
                sim = max(sim, score * 100.0)
                # Do agenta: score / token_set / zgodność stemów (batat↔bataty)
                if (
                    score >= AI_CATALOG_CANDIDATE_MIN
                    or sim >= AI_SYNONYM_SIM_MIN
                    or food_ok
                ):
                    ai_pool.append(
                        (score, row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, sim, stock_capped)
                    )

            # Agent OpenAI: przeszukaj REALNE oferty z katalogów dostawców
            # (W menu + poza menu). Preferuj zgodność stemów, potem score.
            ai_pool.sort(
                key=lambda t: (
                    1 if any(
                        _food_names_compatible(n, (t[1].get("name") or ""))
                        for n in primary_names
                    ) else 0,
                    t[0],
                    t[8],
                ),
                reverse=True,
            )
            # Gdy już mamy pewne lokalne trafienia — agent może dociągnąć innych dostawców
            # (synonimy). Gdy brak — agent decyduje, czy cokolwiek pasuje.
            run_agent = bool(ai_pool and ai_item_budget > 0)
            if run_agent:
                ai_item_budget -= 1
                # Top kandydaci spoza już zaakceptowanych id
                agent_candidates: list[dict] = []
                by_id: dict[str, tuple] = {}
                for score, row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, sim, stock_capped in ai_pool:
                    cid = str(row.get("id") or "")
                    if not cid or cid in accepted_catalog_ids:
                        continue
                    if cid in by_id:
                        continue
                    by_id[cid] = (row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, stock_capped)
                    sup = sup_by_id.get(row.get("supplier_id"), {})
                    agent_candidates.append({
                        "id": cid,
                        "name": row.get("name") or "",
                        "supplier_name": sup.get("name") or "Dostawca",
                        "variant": row.get("variant") or "",
                        "sim": sim,
                        # Tag UI — nie filtr dostępności
                        "in_menu": row.get("is_visible") is not False,
                    })
                    if len(agent_candidates) >= AI_CATALOG_MAX_CANDIDATES:
                        break
                if agent_candidates:
                    matched_ids, conf, bill = await _ai_catalog_agent_match(
                        client, warehouse_name, agent_candidates, request_id=request_id,
                    )
                    billing_events.append(bill)
                    for cid in matched_ids:
                        slot = by_id.get(cid)
                        if not slot:
                            continue
                        row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, stock_capped = slot
                        # Agent AI już potwierdził (conf ≥ AI_SYNONYM_CONF_MIN) —
                        # nie odrzucaj batat/bataty ani filet↔kurczak filet drugim filtrem.
                        row_name = row.get("name") or ""
                        _consider(best_by_supplier, row, price_base, base_dim,
                                  order_base, target_in_dim, "ai",
                                  pack_base_qty=pack, band_hi_base=hi_in_dim,
                                  stock_capped=stock_capped)
                        accepted_catalog_ids.add(cid)
                        if inv_id and conf >= AI_SYNONYM_CONF_MIN:
                            syn_slot = synonym_additions.setdefault(
                                inv_id, {"existing": existing_syn, "new": set()})
                            syn_slot["new"].add(row_name)

            # II pass: gdy nadal brak oferty — szersza pula z całego katalogu tenanta
            # (token_sort + stem), żeby AI zobaczył bataty / kurczak filet mimo luźnego fuzzy.
            if not best_by_supplier and ai_item_budget > 0:
                wide: list[tuple] = []
                for row in catalog:
                    cid = str(row.get("id") or "")
                    if not cid or cid in accepted_catalog_ids:
                        continue
                    bp = _catalog_base_price(row)
                    if bp is None:
                        continue
                    base_dim, price_base = bp
                    row_name = row.get("name") or ""
                    if not row_name:
                        continue
                    rn = _norm_pl(row_name)
                    try:
                        sim = max(
                            (
                                max(
                                    float(fuzz.token_set_ratio(kn, rn)),
                                    float(fuzz.token_sort_ratio(kn, rn)),
                                )
                                for kn in known_norm
                            ),
                            default=0.0,
                        )
                    except Exception:
                        sim = 0.0
                    food_ok = any(_food_names_compatible(n, row_name) for n in primary_names)
                    if sim < 35 and not food_ok:
                        continue
                    target_in_dim = _convert_req_to_catalog_dim(
                        req_base_qty, req_dim, base_dim, uwv, wvu,
                    )
                    if target_in_dim is None:
                        target_in_dim = float(req_base_qty)
                    pack = _catalog_pack_base_qty(row, base_dim)
                    order_base = max(float(pack or 0), float(target_in_dim), 1.0)
                    order_base, stock_capped = _cap_order_qty_to_available_stock(
                        order_base, pack, row, base_dim,
                    )
                    if order_base <= 0:
                        continue
                    wide.append(
                        (sim, row, base_dim, price_base, order_base, pack, target_in_dim, target_in_dim * 1.1, sim, stock_capped)
                    )
                wide.sort(key=lambda t: t[0], reverse=True)
                if wide:
                    ai_item_budget -= 1
                    agent_candidates = []
                    by_id = {}
                    for sim, row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, _s, stock_capped in wide:
                        cid = str(row.get("id") or "")
                        if cid in by_id:
                            continue
                        by_id[cid] = (row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, stock_capped)
                        sup = sup_by_id.get(row.get("supplier_id"), {})
                        agent_candidates.append({
                            "id": cid,
                            "name": row.get("name") or "",
                            "supplier_name": sup.get("name") or "Dostawca",
                            "variant": row.get("variant") or "",
                            "sim": sim,
                            "in_menu": row.get("is_visible") is not False,
                        })
                        if len(agent_candidates) >= AI_CATALOG_MAX_CANDIDATES:
                            break
                    matched_ids, conf, bill = await _ai_catalog_agent_match(
                        client, warehouse_name, agent_candidates, request_id=request_id,
                    )
                    billing_events.append(bill)
                    for cid in matched_ids:
                        slot = by_id.get(cid)
                        if not slot:
                            continue
                        row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, stock_capped = slot
                        _consider(best_by_supplier, row, price_base, base_dim,
                                  order_base, target_in_dim, "ai",
                                  pack_base_qty=pack, band_hi_base=hi_in_dim,
                                  stock_capped=stock_capped)
                        if inv_id and conf >= AI_SYNONYM_CONF_MIN:
                            syn_slot = synonym_additions.setdefault(
                                inv_id, {"existing": existing_syn, "new": set()})
                            syn_slot["new"].add(row.get("name") or "")

            # Ilość zamówienia: mediana order_base z dopasowań (albo target)
            ordered_bases = [
                float(v.get("order_base_qty") or req_base_qty)
                for v in best_by_supplier.values()
            ]
            chosen_dim = req_dim
            if ordered_bases:
                ordered_bases.sort()
                chosen_base = ordered_bases[len(ordered_bases) // 2]
                # wymiar z najlepszej oferty (po konwersji może być kg mimo req szt)
                sample = next(iter(best_by_supplier.values()), None)
                if sample and sample.get("base_dim"):
                    chosen_dim = sample["base_dim"]
                    match_target_base = float(sample.get("target_base_qty") or match_target_base)
            else:
                chosen_base = req_base_qty

            # Notatka PL gdy opakowanie ≠ dokładne zapotrzebowanie
            note_target = match_target_base if item_pack_adjusted else req_base_qty
            note_dim = match_dim_used if item_pack_adjusted else chosen_dim
            if best_by_supplier:
                note = _pack_mismatch_note(
                    it.product_name_or_id, note_target, chosen_base, note_dim,
                )
                if note:
                    pack_notes.append(note)
                    item_pack_adjusted = True

            # Wyświetl ilość w jednostce żądania gdy da się przeliczyć z powrotem
            if chosen_dim == req_dim:
                display_qty = chosen_base / req_factor if req_factor else chosen_base
                display_unit = it.unit
            else:
                display_qty = chosen_base
                display_unit = chosen_dim

            per_item.append({
                "product_name": it.product_name_or_id,
                "quantity": round(display_qty, 4),
                "unit": display_unit,
                "base_dim": chosen_dim,
                "base_quantity": round(chosen_base, 4),
                "target_quantity": float(it.quantity),
                "quantity_min": float(it.quantity_min) if it.quantity_min is not None else round(float(it.quantity) * 0.9, 4),
                "quantity_max": float(it.quantity_max) if it.quantity_max is not None else round(float(it.quantity) * 1.1, 4),
                "best_by_supplier": best_by_supplier,
                "inventory_id": inv_id,
                "pack_adjusted": item_pack_adjusted,
                "unit_weight_volume": uwv,
                "weight_volume_unit": wvu,
                "food_key": _food_match_key(it.product_name_or_id),
            })

        # Scal warianty tej samej pozycji (filet z kurczaka / kurczak filet) → 1 linia w koszyku
        per_item = _merge_duplicate_compare_items(per_item)

        # Zapamiętaj potwierdzone synonimy (kolejne porównania bez tokenów AI).
        if has_syn and synonym_additions:
            await _persist_synonyms(client, synonym_additions)

        reliability_by_sid: dict = {}
        try:
            reliability_by_sid = await _load_supplier_reliability_scores(client)
        except Exception as e:
            logger.debug(f"reliability scores skipped: {e}")

        suppliers_meta = {
            sid: {
                "name": (s.get("name") or "").strip() or "Dostawca",
                "email": s.get("email"),
                "min_order_value": float(s.get("min_order_value") or 0),
                "shipping_cost": float(s.get("shipping_cost") or 0),
                "free_shipping_threshold": float(s.get("free_shipping_threshold") or 0),
                **({"lead_time_days": float(s["lead_time_days"])}
                   if s.get("lead_time_days") is not None else {}),
                **({"reliability_score": float(reliability_by_sid[sid])}
                   if sid in reliability_by_sid else {}),
                **({"is_local_producer": True}
                   if (s.get("is_local_producer") or s.get("source") == "local_producer") else {}),
                **({"city": s["city"]} if s.get("city") else {}),
                **({"voivodeship": s["voivodeship"]} if s.get("voivodeship") else {}),
            }
            for sid, s in sup_by_id.items()
        }
        # Kitchen priority signals (POS/usage/waste/stock) — fail-soft
        kitchen_priorities: dict = {}
        waste_top: list = []
        fillers: list = []
        try:
            signals = await _load_deal_hunter_kitchen_signals(client, days=30)
            kitchen_priorities = signals.get("kitchen_priorities") or {}
            waste_top = signals.get("waste_top") or []
            fillers = signals.get("fillers") or []
        except Exception as e:
            logger.warning(f"deal_hunter kitchen signals skipped: {e}")

        from smart_basket_optimizer import build_smart_optimize_response, apply_cart_objective
        result = build_smart_optimize_response(
            per_item,
            suppliers_meta,
            kitchen_priorities=kitchen_priorities,
            waste_top=waste_top,
            fillers=fillers,
        )
        result = apply_cart_objective(result, req.cart_objective, suppliers_meta)
        result = _sanitize_optimize_unique_products(result)
        # Flaga: czy w ofercie / koszykach są lokalni przetwórcy
        lp_in_quotes = any(
            bool((q or {}).get("is_local_producer"))
            for pi in per_item
            for q in ((pi.get("best_by_supplier") or {}).values())
        )
        result["includes_local_producers"] = bool(lp_in_quotes or lp_suppliers)
        result["search_scope"] = search_scope
        if lp_in_quotes or (search_scope != "suppliers_only" and lp_suppliers):
            speech = (result.get("assistant_speech") or "").strip()
            if search_scope == "local_producers_only":
                note = "Szukam wyłącznie wśród Lokalnych Przetwórców (aktywni i zweryfikowani)."
            elif search_scope == "both":
                note = (
                    "W porównaniu uwzględniam hurtowników i Lokalnych Przetwórców "
                    "(aktywnych i zweryfikowanych)."
                )
            else:
                note = ""
            if note and note not in speech:
                result["assistant_speech"] = f"{speech} {note}".strip() if speech else note
        if pack_notes:
            result["pack_adjustment_notes"] = pack_notes
            # Dołącz do speech, żeby FE / Jarvis widziały od razu
            speech = (result.get("assistant_speech") or "").strip()
            extra = " ".join(pack_notes)
            result["assistant_speech"] = f"{speech} {extra}".strip() if speech else extra
        # Warstwa AI: tylko interpretacja tipów (koszyki już policzone matematycznie)
        try:
            result = await _enrich_deal_hunter_ai_tips(client, result, per_item)
        except Exception as e:
            logger.warning(f"deal_hunter AI tips skipped: {e}")
        if billing_events:
            result.update(merge_billing_events(billing_events))
        else:
            result.setdefault("credits_deducted", 0)
        return result


@app.post("/api/bargain-hunter/optimize")
async def bargain_hunter_optimize(req: CompareOffersRequest):
    return await compare_offers(req)


class CriticalOrderRequest(BaseModel):
    """Zamów wszystkie braki krytyczne (opcjonalnie filtr kategorii) — Smart Optimizer v2."""
    categories: list[str] = Field(default_factory=lambda: ["all"])
    restaurant_name: Optional[str] = None
    force_refresh: bool = False
    # suppliers_only | local_producers_only | both
    search_scope: Optional[str] = "suppliers_only"


@app.post("/api/optimizer/critical-order")
async def optimizer_critical_order(req: CriticalOrderRequest):
    """
    Łowca Okazji v2 — krytyczne braki → do 3 scenariuszy koszyka.
    Cache 2h po fingerprintcie listy krytycznej (soft).
    """
    from smart_basket_optimizer import cache_get, cache_set, fingerprint_critical, make_cache_key

    cats = req.categories or ["all"]
    det = await orders_critical_by_category(CriticalByCategoryRequest(
        categories=cats,
        restaurant_name=req.restaurant_name,
        skip_compare=True,
    ))
    critical = det.get("critical_products") or []
    if not critical:
        return {
            "ok": bool(det.get("ok", True)),
            "optimizer_version": 2,
            "message": det.get("message") or "Brak produktów krytycznych.",
            "critical_products": [],
            "matched_categories": det.get("matched_categories"),
            "unmatched_categories": det.get("unmatched_categories"),
            "compare": None,
            "from_cache": False,
        }

    crit_fp = fingerprint_critical(critical)
    scope = _normalize_deal_hunter_search_scope(req.search_scope)
    soft_key = make_cache_key(f"{crit_fp}|scope:{scope}", "soft")
    if not req.force_refresh:
        cached = cache_get(soft_key)
        if cached and cached.get("compare"):
            return cached

    compare_req = CompareOffersRequest(
        items=[
            CompareItem(
                product_name_or_id=c["name"],
                quantity=c["deficit"],
                unit=c["unit"],
                quantity_min=c.get("order_qty_min"),
                quantity_max=c.get("order_qty_max"),
            )
            for c in critical
        ],
        restaurant_name=req.restaurant_name,
        search_scope=scope,
    )
    try:
        compare_result = await compare_offers(compare_req)
    except HTTPException as e:
        return {
            "ok": False,
            "optimizer_version": 2,
            "message": f"Optymalizacja nieudana: {e.detail}",
            "critical_products": critical,
            "compare": None,
            "from_cache": False,
        }

    payload = {
        "ok": True,
        "optimizer_version": 2,
        "action": "critical_order",
        "matched_categories": det.get("matched_categories"),
        "unmatched_categories": det.get("unmatched_categories"),
        "critical_products": critical,
        "compare": compare_result,
        "is_multivariable": compare_result.get("is_multivariable"),
        "savings_amount": compare_result.get("savings_amount"),
        "message": (
            f"Przeliczono {len(critical)} krytycznych pozycji · "
            f"{'3 scenariusze' if compare_result.get('is_multivariable') else '1 optymalny koszyk'}."
        ),
        "from_cache": False,
    }
    cache_set(soft_key, payload)
    return payload


# --- Bulk Category-Targeted Orders (Łowca Okazji na braki) ------------------

# Potoczne słowa KATEGORII → sztywne nazwy (BEZ nazw pojedynczych produktów!).
# „ser"/"kurczak" w synonimach powodowało, że MIX wrzucał nazwę produktu do categories
# i wciągał całą kategorię Nabiał/Mięso zamiast tylko nazwanej pozycji.
_CATEGORY_SYNONYMS: dict[str, list[str]] = {
    'Mięso i wędliny':   ['mieso', 'mięso', 'wedliny', 'wędliny', 'mieso i wedliny',
                          'mięso i wędliny'],
    'Ryby i owoce morza': ['ryby', 'ryba', 'owoce morza', 'ryby i owoce morza'],
    'Nabiał':            ['nabial', 'nabiał', 'nabialowe', 'nabiałowe'],
    'Warzywa i owoce':   ['warzywa', 'owoce', 'jarzyny', 'warzywa i owoce', 'warzywo'],
    'Pieczywo':          ['pieczywo'],
    'Alkohole':          ['alkohol', 'alkohole'],
    'Napoje':            ['napoje', 'napoj', 'napój'],
    'Mrożonki':          ['mrozonki', 'mrożonki', 'mrozone', 'mrożone'],
    'Suchy magazyn':     ['suchy', 'suchy magazyn', 'sucha pantry', 'pantry'],
    'Oleje i tłuszcze':  ['olej', 'oleje', 'oliwa', 'oliwy', 'tluszcze', 'tłuszcze',
                          'oleje i tluszcze', 'oleje i tłuszcze'],
    'Przyprawy':         ['przyprawy', 'przyprawa', 'ziola', 'zioła'],
    'Wywary i sosy':     ['wywary', 'sosy', 'wywar', 'sos', 'wywary i sosy'],
    'Chemia i czystość': ['chemia', 'srodki czystosci', 'środki czystości',
                          'chemia i czystosc', 'chemia i czystość'],
    'Opakowania':        ['opakowania', 'opakowanie'],
    'Inne':              ['inne', 'pozostale', 'pozostałe'],
}


_CATEGORY_STOPWORDS = frozenset({
    "brakujace", "brakujacych", "brakujacy", "braki", "wszystkie",
    "wszystkich", "kategoria", "kategorii", "z", "i", "oraz", "a", "też",
    "tez", "plus", "zamow", "zamów", "prosze", "proszę",
})


def _category_syn_index() -> dict[str, str]:
    syn_index: dict[str, str] = {}
    for canon, syns in _CATEGORY_SYNONYMS.items():
        for x in syns:
            syn_index[_norm_pl(x)] = canon
        syn_index[_norm_pl(canon)] = canon
    return syn_index


def _resolve_warehouse_categories(raw: list[str]) -> tuple[list[str], list[str]]:
    """Zwraca (matched_canonical, unmatched_raw) — dopasowuje potoczne nazwy do
    sztywnych kategorii z `WAREHOUSE_CATEGORIES`.

    Tylko exact / token-exact / fuzzy do nazwy kategorii — BEZ substring
    („ser" ∈ „ser kozi" NIE może stać się Nabiałem).

    Gdy w jednym stringu jest kategoria + nazwy produktów
    („warzywa oraz ser kozi i borowiki"), kategoria trafia do matched,
    a reszta tokenów do unmatched (później → named products).
    """
    matched: list[str] = []
    unmatched: list[str] = []
    canonical_norm = {_norm_pl(c): c for c in WAREHOUSE_CATEGORIES}
    syn_index = _category_syn_index()

    def _cat_tokens_for(canon: str) -> set[str]:
        toks = {_norm_pl(canon)}
        for syn in _CATEGORY_SYNONYMS.get(canon, []):
            toks.add(_norm_pl(syn))
            for part in _norm_pl(syn).split():
                if part:
                    toks.add(part)
        for part in _norm_pl(canon).split():
            if part:
                toks.add(part)
        return toks

    for r in raw or []:
        s = (r or "").strip()
        if not s:
            continue
        if s.lower() == "all":
            return ["all"], []
        key = _norm_pl(s)
        # 1) exact canonical
        if key in canonical_norm:
            if canonical_norm[key] not in matched:
                matched.append(canonical_norm[key])
            continue
        # 2) exact synonym (cały string)
        if key in syn_index:
            canon = syn_index[key]
            if canon not in matched:
                matched.append(canon)
            continue
        # 3) token-exact: WSZYSTKIE kategorie w frazie
        #    „mieso i nabial" → Mięso + Nabiał (nie tylko pierwsza!)
        #    „warzywa oraz ser kozi" → Warzywa + unmatched „ser kozi"
        tokens = [
            t for t in key.replace(",", " ").replace("+", " ").split()
            if t and t not in _CATEGORY_STOPWORDS
        ]
        found_cats: list[str] = []
        for t in tokens:
            hit = syn_index.get(t) or canonical_norm.get(t)
            if hit and hit not in found_cats:
                found_cats.append(hit)
        if found_cats:
            for found in found_cats:
                if found not in matched:
                    matched.append(found)
            cat_toks: set[str] = set()
            for found in found_cats:
                cat_toks |= _cat_tokens_for(found)
            leftover = [t for t in tokens if t not in cat_toks]
            if leftover:
                unmatched.append(" ".join(leftover))
            continue
        # 4) rapidfuzz tylko do pełnych nazw kategorii (wysoki próg)
        best = None
        best_score = 0.0
        for canon_norm, canon in canonical_norm.items():
            score = float(fuzz.token_set_ratio(key, canon_norm))
            if score > best_score:
                best_score, best = score, canon
        if best and best_score >= 82:
            if best not in matched:
                matched.append(best)
        else:
            unmatched.append(s)
    return matched, unmatched


def _product_in_wanted_categories(
    effective_cat: str,
    category_id: Optional[str],
    wanted_set: set[str],
    wanted_ids: set[str],
) -> bool:
    """True gdy produkt należy do wybranej kategorii — bez fuzzy bleed.

    Matching: category_id ∈ wanted_ids LUB nazwa kategorii ∈ wanted_set
    (po resolve synonimów). Gdy użytkownik WYBRAŁ „Inne" — produkty z „Inne"
    wchodzą. Gdy nie wybrał — „Inne"/pusta nie bleedują do Mięso/Nabiał itd.
    """
    if not wanted_set and not wanted_ids:
        return False
    cid = str(category_id) if category_id else ""
    if wanted_ids and cid and cid in wanted_ids:
        return True
    ec = (effective_cat or "").strip() or "Inne"
    ec_norm = _norm_pl(ec)
    # Najpierw positive match (także gdy wybrano „Inne")
    if ec_norm in wanted_set:
        return True
    resolved, _ = _resolve_warehouse_categories([ec])
    for r in resolved:
        if r == "all":
            continue
        if _norm_pl(r) in wanted_set:
            return True
    # Bez wyboru „Inne": puste / Inne nie wchodzą do innych kategorii
    if ec_norm in {"inne", "pozostale", "pozostałe", ""}:
        return False
    return False


def _dedupe_critical_products(critical: list[dict]) -> list[dict]:
    """Jedna pozycja na inventory_id / znormalizowaną nazwę (max deficit)."""
    by_key: dict[str, dict] = {}
    order: list[str] = []
    for c in critical:
        iid = str(c.get("id") or "").strip()
        nk = _norm_pl(c.get("name") or "")
        key = f"id:{iid}" if iid else f"n:{nk}"
        if not nk and not iid:
            continue
        prev = by_key.get(key)
        if prev is None:
            by_key[key] = c
            order.append(key)
            continue
        if float(c.get("deficit") or 0) > float(prev.get("deficit") or 0):
            by_key[key] = {**c, "source": c.get("source") or prev.get("source")}
        else:
            # zachowaj silniejsze source (named > category)
            if c.get("source") in ("named", "named+category") and prev.get("source") == "category_shortage":
                by_key[key] = {**prev, "source": c.get("source")}
    return [by_key[k] for k in order]


class ExtraOrderItem(BaseModel):
    """Nazwany produkt do dorzucenia do koszyka braków (voice MIX)."""
    product_name: str = ""
    quantity: Optional[float] = None
    unit: str = "szt"
    unit_weight_volume: Optional[float] = None
    weight_volume_unit: Optional[str] = None


class CriticalByCategoryRequest(BaseModel):
    categories: list[str] = Field(default_factory=list)
    restaurant_name: Optional[str] = None
    skip_compare: bool = False  # True = tylko detekcja braków (bez Łowcy)
    # critical = qty <= min (domyślne dla „brakujące”); optimal = poniżej progu optymalnego
    stock_target: str = "critical"
    # MIX: konkretne produkty z nazwy (np. ser kozi) + braki z categories
    items: list[ExtraOrderItem] = Field(default_factory=list)
    # Strategia koszyka Łowcy: fast_delivery | min_deliveries | lowest_price
    cart_objective: Optional[str] = None
    # suppliers_only | local_producers_only | both
    search_scope: Optional[str] = "suppliers_only"


@app.post("/api/orders/critical-by-category")
async def orders_critical_by_category(req: CriticalByCategoryRequest):
    """Zbiorcze zamówienie braków magazynowych z filtrem kategorii.

    Krok po kroku:
      1. Rozpoznaj żądane kategorie (`['all']` = wszystkie).
      2. Pobierz z `inventory_items` produkty krytyczne (quantity <= min_quantity).
      3. Filtruj po kategoriach (jeśli != ['all']).
      4. Wylicz deficyt: `deficit = min_quantity * (1 + safety_buffer_percent/100) - quantity`.
      5. Przekaż listę pozycji do `/api/orders/compare-offers` (algorytm Łowcy Okazji).
      6. Zwróć wynik + `matched_categories`, `critical_products`, `unmatched_categories`.
    """
    matched, unmatched = _resolve_warehouse_categories(req.categories or [])
    # Nazwane produkty z komendy (MIX: „ser kozi … i brakujące warzywa”)
    named_raw: list[dict] = []
    for it in (req.items or []):
        if isinstance(it, ExtraOrderItem):
            n = (it.product_name or "").strip()
            if not n:
                continue
            try:
                q = float(it.quantity) if it.quantity is not None else None
            except (TypeError, ValueError):
                q = None
            if q is not None and q <= 0:
                q = None
            named_raw.append({
                "name": n,
                "quantity": q,
                "unit": (it.unit or "szt").strip() or "szt",
                "unit_weight_volume": it.unit_weight_volume,
                "weight_volume_unit": it.weight_volume_unit,
            })
        elif isinstance(it, dict):
            n = str(it.get("product_name") or it.get("name") or "").strip()
            if not n:
                continue
            try:
                raw_q = it.get("quantity")
                q = float(raw_q) if raw_q is not None and raw_q != "" else None
            except (TypeError, ValueError):
                q = None
            if q is not None and q <= 0:
                q = None
            try:
                raw_uwv = it.get("unit_weight_volume")
                uwv = float(raw_uwv) if raw_uwv is not None and raw_uwv != "" else None
            except (TypeError, ValueError):
                uwv = None
            named_raw.append({
                "name": n,
                "quantity": q,
                "unit": str(it.get("unit") or "szt").strip() or "szt",
                "unit_weight_volume": uwv,
                "weight_volume_unit": (str(it.get("weight_volume_unit") or "").strip() or None),
            })

    # LLM często wrzuca nazwę produktu do categories[] („ser kozi”).
    # Nierozpoznane „kategorie” → traktuj jako nazwiane produkty, NIE jako „all”.
    if unmatched:
        already = {_norm_pl(x["name"]) for x in named_raw}
        kept_unmatched: list[str] = []
        for u in unmatched:
            uk = _norm_pl(u)
            if not uk or uk in already:
                continue
            # Krótkie / ogólne tokeny zostaw jako unmatched (nie produkt)
            if uk in {"inne", "all", "wszystko", "braki"}:
                kept_unmatched.append(u)
                continue
            named_raw.append({"name": u.strip(), "quantity": None, "unit": "szt",
                              "unit_weight_volume": None, "weight_volume_unit": None})
            already.add(uk)
        unmatched = kept_unmatched

    if not matched and not named_raw:
        return {
            "ok": False,
            "action": "order_critical_items_by_category",
            "matched_categories": [],
            "unmatched_categories": unmatched,
            "critical_products": [],
            "named_products": [],
            "compare": None,
            "message": ("Nie rozpoznano kategorii ani produktów. Powiedz np. "
                        "'zamów wszystkie braki', 'zamów mięso i nabiał', "
                        "lub 'zamów ser kozi i brakujące warzywa'."),
        }

    named_added: list[dict] = []
    critical: list[dict] = []
    category_total = 0
    want_all = matched == ["all"]

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        # Pobierz magazyn wraz z powiązaną kategorią — TYLKO aktywne (is_active).
        inv_all: list[dict] = []
        base_sel = (
            "id,name,quantity,unit,min_quantity,optimal_quantity,safety_buffer_percent,"
            "unit_weight_volume,weight_volume_unit,is_active,"
            "category_id,inventory_categories(name)"
        )
        try:
            inv_all = await sb_get(
                client, "inventory_items",
                params={
                    "select": base_sel,
                    "is_active": "eq.true",
                    "limit": "5000",
                },
            ) or []
        except httpx.HTTPStatusError as e:
            # Fallback: bez optimal_quantity / safety_buffer / joina / gramatury / is_active
            text = (e.response.text if e.response is not None else "") or ""
            if "is_active" in text:
                try:
                    inv_all = await sb_get(
                        client, "inventory_items",
                        params={
                            "select": base_sel.replace("is_active,", ""),
                            "limit": "5000",
                        },
                    ) or []
                except httpx.HTTPStatusError:
                    inv_all = []
            if "unit_weight_volume" in text or "weight_volume_unit" in text:
                try:
                    inv_all = await sb_get(
                        client, "inventory_items",
                        params={
                            "select": ("id,name,quantity,unit,min_quantity,optimal_quantity,safety_buffer_percent,"
                                       "is_active,category_id,inventory_categories(name)"),
                            "is_active": "eq.true",
                            "limit": "5000",
                        },
                    ) or []
                except httpx.HTTPStatusError:
                    inv_all = []
            if not inv_all and "optimal_quantity" in text:
                try:
                    inv_all = await sb_get(
                        client, "inventory_items",
                        params={
                            "select": ("id,name,quantity,unit,min_quantity,safety_buffer_percent,"
                                       "is_active,category_id,inventory_categories(name)"),
                            "is_active": "eq.true",
                            "limit": "5000",
                        },
                    ) or []
                except httpx.HTTPStatusError:
                    inv_all = []
            if not inv_all:
                inv_all = await sb_get(
                    client, "inventory_items",
                    params={"select": "id,name,quantity,unit,min_quantity,category_id",
                            "limit": "5000"},
                ) or []
                cat_rows = await sb_get(client, "inventory_categories",
                                        params={"select": "id,name", "limit": "500"}) or []
                cat_by_id = {c["id"]: c.get("name") for c in cat_rows}
                for r in inv_all:
                    r["inventory_categories"] = {"name": cat_by_id.get(r.get("category_id"))}
        # Twardy filtr po stronie (gdy kolumna jest, a filtr query nie zadziałał)
        inv_all = [r for r in inv_all if r.get("is_active") is not False]

        want_all = matched == ["all"]
        target_mode = (req.stock_target or "critical").strip().lower()
        if target_mode not in ("critical", "optimal"):
            target_mode = "critical"

        # Dowolna kategoria z magazynu użytkownika (nie tylko sztywne WAREHOUSE_CATEGORIES).
        # FE wysyła nazwy z inventory_categories — mapuj 1:1 po norm + synonimach.
        wanted_ids: set[str] = set()
        raw_cat_norms = {
            _norm_pl(x) for x in (req.categories or [])
            if isinstance(x, str) and x.strip() and x.strip().lower() != "all"
        }
        try:
            cat_rows = await sb_get(
                client, "inventory_categories",
                params={"select": "id,name", "limit": "500"},
            ) or []
        except Exception:
            cat_rows = []
        user_cat_by_norm = {
            _norm_pl((c.get("name") or "").strip()): c
            for c in cat_rows
            if (c.get("name") or "").strip()
        }

        # Nierozpoznane przez synonimy, ale istniejące w magazynie użytkownika → matched
        if not want_all:
            still_unmatched: list[str] = []
            for u in unmatched:
                uk = _norm_pl(u)
                hit = user_cat_by_norm.get(uk)
                if hit:
                    cname = (hit.get("name") or "").strip()
                    if cname and cname not in matched:
                        matched.append(cname)
                else:
                    still_unmatched.append(u)
            unmatched = still_unmatched
            # Surowy wybór z FE (nazwa pilla) też musi trafić do matched
            for rn in raw_cat_norms:
                hit = user_cat_by_norm.get(rn)
                if not hit:
                    continue
                cname = (hit.get("name") or "").strip()
                if cname and cname not in matched:
                    matched.append(cname)

        wanted_set = {_norm_pl(x) for x in matched} if matched and not want_all else set()
        # Dołącz też surowe normy z FE (gdy FE wysłał dokładną nazwę z DB)
        if not want_all:
            wanted_set |= raw_cat_norms

        if matched and not want_all:
            for cr in cat_rows:
                cname = (cr.get("name") or "").strip()
                if not cname:
                    continue
                cn = _norm_pl(cname)
                if cn in wanted_set or cn in raw_cat_norms:
                    wanted_ids.add(str(cr["id"]))
                    continue
                resolved, _ = _resolve_warehouse_categories([cname])
                if any(_norm_pl(r) in wanted_set for r in resolved if r != "all"):
                    wanted_ids.add(str(cr["id"]))

        # Nazwy kategorii NIE mogą zostać „produktami nazwanymi” (to wciągało warzywa).
        if not want_all:
            syn_idx = _category_syn_index()
            cat_block = set(wanted_set) | set(raw_cat_norms) | {_norm_pl(m) for m in matched}
            named_raw = [
                n for n in named_raw
                if _norm_pl(n.get("name") or "") not in cat_block
                and _norm_pl(n.get("name") or "") not in syn_idx
            ]

        # Ile produktów jest w wybranych kategoriach (mianownik do X/Y)
        category_total = 0
        critical = []
        # Braki z kategorii — pomiń skan gdy brak categories (tylko named items)
        if matched:
            # Stabilna kolejność skanu magazynu
            inv_all_sorted = sorted(
                inv_all,
                key=lambda r: (_norm_pl((r.get("name") or "").strip()), str(r.get("id") or "")),
            )
            for r in inv_all_sorted:
                name = (r.get("name") or "").strip()
                if not name or "(dup)" in name.lower():
                    continue
                if r.get("is_active") is False:
                    continue
                try:
                    qty = float(r.get("quantity") or 0)
                    minq = float(r.get("min_quantity") or 0)
                except (TypeError, ValueError):
                    continue
                cat_obj = r.get("inventory_categories") or {}
                cat_name = (cat_obj.get("name") if isinstance(cat_obj, dict) else None) or ""
                # FE: brak category_id → wyświetla „Inne” (mapDbRow). Backend musi robić to samo.
                effective_cat = (cat_name or "").strip() or "Inne"
                if not want_all:
                    if not _product_in_wanted_categories(
                        effective_cat,
                        r.get("category_id"),
                        wanted_set,
                        wanted_ids,
                    ):
                        continue
                category_total += 1
                buf_pct = float(r.get("safety_buffer_percent") or 20.0)
                try:
                    opt_user = float(r.get("optimal_quantity") or 0)
                except (TypeError, ValueError):
                    opt_user = 0.0
                if opt_user > 0:
                    optimal = opt_user
                elif minq > 0:
                    optimal = minq * (1.0 + buf_pct / 100.0)
                else:
                    optimal = 0.0

                if target_mode == "critical":
                    # Brak: poniżej min (gdy ustawione) ALBO stan < 1 gdy brak progu
                    if minq > 0:
                        is_short = qty <= minq
                    else:
                        is_short = qty < 1.0
                    if not is_short:
                        continue
                    if optimal <= 0:
                        optimal = max(minq, 1.0)
                else:
                    # optimal: wszystko poniżej progu; pusty stan bez progu → zamów 1
                    if optimal <= 0:
                        if qty > 0:
                            continue
                        optimal = 1.0
                    if qty >= optimal:
                        continue

                deficit = max(0.0, round(optimal - qty, 4))
                if deficit <= 0:
                    if qty <= 0:
                        deficit = max(1.0, optimal or 1.0)
                    else:
                        continue
                qty_lo = round(deficit * 0.9, 4)
                qty_hi = round(deficit * 1.1, 4)
                critical.append({
                    "id": r["id"],
                    "name": name,
                    "unit": r.get("unit") or "szt",
                    "current_quantity": qty,
                    "min_quantity": minq,
                    "safety_buffer_percent": buf_pct,
                    "optimal_quantity": round(optimal, 4),
                    "deficit": deficit,
                    "order_qty_min": qty_lo,
                    "order_qty_max": qty_hi,
                    "category": effective_cat,
                    "category_id": r.get("category_id"),
                    "source": "category_shortage",
                    "unit_weight_volume": r.get("unit_weight_volume"),
                    "weight_volume_unit": r.get("weight_volume_unit"),
                })

        # MIX: dorzuć nazwiane produkty (ser kozi, filet…) — dedupe po nazwie
        named_added = []
        seen = {_norm_pl(c["name"]) for c in critical}
        inv_by_norm = {
            _norm_pl((r.get("name") or "").strip()): r
            for r in inv_all
            if (r.get("name") or "").strip()
        }
        for nr in named_raw:
            key = _norm_pl(nr["name"])
            # Fuzzy match do magazynu (lepsza nazwa / jednostka)
            hit = inv_by_norm.get(key)
            if not hit:
                best_score, best_row = 0.0, None
                for nk, row in inv_by_norm.items():
                    sc = float(fuzz.token_set_ratio(key, nk))
                    if sc > best_score:
                        best_score, best_row = sc, row
                if best_row and best_score >= 78:
                    hit = best_row
            display_name = (hit.get("name") if hit else nr["name"]).strip()
            unit = (hit.get("unit") if hit else None) or nr["unit"]
            qty_order = nr.get("quantity")
            # Brak jawnej ilości + produkt w magazynie → dopełnij do stanu optymalnego
            if hit is not None and qty_order is None:
                try:
                    cur = float(hit.get("quantity") or 0)
                    minq = float(hit.get("min_quantity") or 0)
                except (TypeError, ValueError):
                    cur, minq = 0.0, 0.0
                buf_pct = float(hit.get("safety_buffer_percent") or 20.0)
                try:
                    opt_user = float(hit.get("optimal_quantity") or 0)
                except (TypeError, ValueError):
                    opt_user = 0.0
                if opt_user > 0:
                    optimal = opt_user
                elif minq > 0:
                    optimal = minq * (1.0 + buf_pct / 100.0)
                else:
                    optimal = 1.0
                qty_order = max(0.0, round(optimal - cur, 4))
            if qty_order is None:
                qty_order = 1.0
            qty_order = float(qty_order)
            if qty_order <= 0:
                # Już na optymalnym — nie dodawaj pustej pozycji
                continue
            nkey = _norm_pl(display_name)
            if nkey in seen:
                # Już w brakach kategorii — podnieś qty do max(deficit, żądane)
                for c in critical:
                    if _norm_pl(c["name"]) == nkey:
                        if qty_order > float(c.get("deficit") or 0):
                            c["deficit"] = qty_order
                            c["order_qty_min"] = round(qty_order * 0.9, 4)
                            c["order_qty_max"] = round(qty_order * 1.1, 4)
                        c["source"] = "named+category"
                        named_added.append(c)
                        break
                continue
            seen.add(nkey)
            entry = {
                "id": (hit or {}).get("id"),
                "name": display_name,
                "unit": unit or "szt",
                "current_quantity": float((hit or {}).get("quantity") or 0) if hit else None,
                "min_quantity": float((hit or {}).get("min_quantity") or 0) if hit else None,
                "deficit": qty_order,
                "order_qty_min": round(qty_order * 0.9, 4),
                "order_qty_max": round(qty_order * 1.1, 4),
                "category": (
                    ((hit.get("inventory_categories") or {}) if hit else {}).get("name")
                    if hit else None
                ) or "—",
                "source": "named",
                "unit_weight_volume": (
                    nr.get("unit_weight_volume")
                    if nr.get("unit_weight_volume") is not None
                    else (hit or {}).get("unit_weight_volume")
                ),
                "weight_volume_unit": (
                    nr.get("weight_volume_unit")
                    or (hit or {}).get("weight_volume_unit")
                ),
            }
            critical.append(entry)
            named_added.append(entry)

        # Twarda bramka zakresu: braki z kategorii NIE mogą wypłynąć poza matched
        if matched and not want_all:
            kept: list[dict] = []
            for c in critical:
                src = str(c.get("source") or "")
                if src in ("named", "named+category"):
                    kept.append(c)
                    continue
                if _product_in_wanted_categories(
                    str(c.get("category") or "Inne"),
                    c.get("category_id"),
                    wanted_set,
                    wanted_ids,
                ):
                    kept.append(c)
            critical = kept

        critical = _dedupe_critical_products(critical)

        # Deterministyczna kolejność (powtarzalność koszyka)
        critical.sort(key=lambda c: (_norm_pl(c.get("name") or ""), str(c.get("id") or "")))

        if not critical:
            return {
                "ok": True,
                "action": "order_critical_items_by_category",
                "matched_categories": matched,
                "unmatched_categories": unmatched,
                "category_total": category_total,
                "critical_products": [],
                "named_products": [],
                "compare": None,
                "message": (
                    f"Brak produktów do zamówienia w kategoriach: {', '.join(matched)} "
                    f"(w kategorii: {category_total} pozycji)."
                    if matched and not want_all else
                    "Nie znaleziono braków w magazynie."
                    if matched else
                    "Nie udało się dodać nazwanych produktów do koszyka."
                ),
            }

    if req.skip_compare:
        return {
            "ok": True,
            "action": "order_critical_items_by_category",
            "matched_categories": matched,
            "unmatched_categories": unmatched,
            "category_total": category_total,
            "critical_products": critical,
            "named_products": named_added,
            "critical_count": len(critical),
            "compare": None,
            "message": (
                f"Znaleziono {len(critical)} pozycji do zamówienia "
                f"(w kategorii łącznie {category_total} pozycji)."
            ),
        }

    # Wywołaj Łowcę Okazji na wyliczonym koszyku (własny async client w środku).
    compare_req = CompareOffersRequest(
        items=[
            CompareItem(
                product_name_or_id=c["name"],
                quantity=c["deficit"],
                unit=c["unit"],
                quantity_min=c.get("order_qty_min"),
                quantity_max=c.get("order_qty_max"),
                unit_weight_volume=c.get("unit_weight_volume"),
                weight_volume_unit=c.get("weight_volume_unit"),
            )
            for c in critical
        ],
        restaurant_name=req.restaurant_name,
        cart_objective=req.cart_objective,
        search_scope=req.search_scope,
    )
    compare_result: Optional[dict] = None
    compare_error: Optional[str] = None
    try:
        compare_result = await compare_offers(compare_req)
    except HTTPException as e:
        compare_error = f"compare-offers HTTP {e.status_code}: {e.detail}"
    except Exception as e:  # noqa: BLE001
        compare_error = f"compare-offers: {str(e)[:120]}"

    found_in_offers = 0
    not_found_names: list[str] = []
    if isinstance(compare_result, dict):
        # Twarda bramka: koszyki dostawców TYLKO z zamówionych braków (bez warzyw „znikąd”)
        allowed_names = [str(c.get("name") or "").strip() for c in critical if c.get("name")]
        compare_result = _filter_compare_to_requested_products(compare_result, allowed_names)
        compare_result = _sanitize_optimize_unique_products(compare_result)

        req_items = compare_result.get("items_requested") or []
        found_in_offers = sum(1 for it in req_items if it.get("found"))
        not_found_names = [
            str(it.get("product_name") or "").strip()
            for it in req_items
            if not it.get("found") and str(it.get("product_name") or "").strip()
        ]
        # Metadane zakresu — FE Łowca pokazuje rozpiskę (nie panel Jarvisa)
        compare_result["scope_categories"] = matched
        compare_result["scope_products"] = [
            {
                "name": c.get("name"),
                "category": c.get("category"),
                "quantity": c.get("deficit"),
                "unit": c.get("unit"),
                "source": c.get("source"),
            }
            for c in critical
        ]
        compare_result["scope_summary"] = (
            f"Zakres: {', '.join(matched) if matched and not want_all else 'wszystkie kategorie'}"
            f" · {len(critical)} poz. do zamówienia"
            f" · w ofertach {found_in_offers}/{len(critical) if critical else 0}."
        )
        if not_found_names:
            speech = (compare_result.get("assistant_speech") or "").strip()
            listed = ", ".join(not_found_names[:12])
            if len(not_found_names) > 12:
                listed += "…"
            miss_msg = (
                f"W ofertach dostawców nie znaleziono {len(not_found_names)} "
                f"z {len(req_items)} zamówionych produktów: {listed}."
            )
            compare_result["assistant_speech"] = f"{speech} {miss_msg}".strip() if speech else miss_msg
            compare_result["not_found_products"] = not_found_names
            compare_result["not_found_count"] = len(not_found_names)

    # Krótki komunikat do panelu Jarvisa — bez listy nazw produktów.
    # Pełna rozpiska found/missing jest w compare → Deal Hunter (scope_*).
    denom = len(critical) if critical else 0
    named_n = sum(1 for c in critical if c.get("source") in ("named", "named+category"))
    msg_parts = [
        f"Otworzono Łowcę Okazji · {len(critical)} pozycji"
        + (f" · {', '.join(matched)}" if matched and not want_all else
           " · wszystkie kategorie" if matched else "")
        + (f" · w tym {named_n} nazwanych" if named_n else "")
        + "."
    ]
    if denom > 0:
        msg_parts.append(
            f"W ofertach: {found_in_offers}/{denom}."
            " Szczegóły pozycji są w Łowcy Okazji."
        )
    if unmatched:
        msg_parts.append(f"Nierozpoznane kategorie: {', '.join(unmatched)}.")
    if compare_error:
        msg_parts.append(compare_error)

    return {
        "ok": True,
        "action": "order_critical_items_by_category",
        "matched_categories": matched,
        "unmatched_categories": unmatched,
        "category_total": category_total,
        "critical_products": critical,
        "named_products": [c for c in critical if c.get("source") in ("named", "named+category")],
        "critical_count": len(critical),
        "found_in_offers_count": found_in_offers,
        "not_found_count": len(not_found_names),
        "not_found_products": not_found_names,
        "compare": compare_result,
        "message": " ".join(msg_parts),
    }


def _is_internal_order_note(notes: Optional[str]) -> bool:
    """Notatki wewnętrzne (koszyk / draft) — nie trafiają do maila do dostawcy."""
    t = (notes or "").strip().lower()
    if not t:
        return True
    markers = (
        "łowca okazji",
        "lowca okazji",
        "zapisane na później",
        "zapisane na pozniej",
        "na później",
        "na pozniej",
        "[internal]",
    )
    return any(m in t for m in markers)

@app.post("/api/orders/generate-messages")
async def generate_messages(req: GenerateMessagesRequest):
    if not req.suppliers:
        raise HTTPException(status_code=400, detail="Brak dostawców do wygenerowania wiadomości.")
    restaurant = (req.restaurant_name or "Nasza restauracja").strip()
    today = datetime.now(timezone.utc).strftime("%d.%m.%Y")
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as _c:
        profile = await get_restaurant_profile(_c)
        # Uzupełnij nazwy/e-maile dostawców z DB (FE czasem wysyła puste / „Dostawca”)
        resolved_suppliers: dict[str, dict] = {}
        for g in req.suppliers:
            sid = (g.supplier_id or "").strip()
            if not sid or sid in resolved_suppliers:
                continue
            try:
                rows = await sb_get(
                    _c, "suppliers",
                    params={"select": "id,name,email,contact_person", "id": f"eq.{sid}", "limit": "1"},
                ) or []
                if rows:
                    resolved_suppliers[sid] = rows[0]
            except Exception as e:  # noqa: BLE001
                logger.warning(f"generate-messages resolve supplier {sid}: {e}")
    footer = _order_footer(profile)
    contact_email = (profile.get("contact_email") or "").strip()
    contact_phone = (profile.get("contact_phone") or "").strip()
    contact_block = ""
    if contact_email or contact_phone:
        parts = []
        if contact_email:
            parts.append(f"e-mail: {contact_email}")
        if contact_phone:
            parts.append(f"tel.: {contact_phone}")
        contact_block = "W razie pytań prosimy o kontakt: " + ", ".join(parts) + "."

    messages = []
    for g in req.suppliers:
        items = g.items or []
        subtotal = g.subtotal_pln or round(sum(float(i.get("line_total") or 0) for i in items), 2)
        sid = (g.supplier_id or "").strip()
        db_sup = resolved_suppliers.get(sid) if sid else None
        supplier_hello = (
            ((db_sup or {}).get("name") or "").strip()
            or (g.supplier_name or "").strip()
            or "Państwa firmę"
        )
        if supplier_hello == "Dostawca" and (db_sup or {}).get("name"):
            supplier_hello = str(db_sup.get("name")).strip()
        supplier_email = (
            ((db_sup or {}).get("email") or "").strip()
            or (g.supplier_email or "").strip()
            or None
        )

        rows_html = ""
        for i in items:
            qty = _fmt_qty(float(i.get("quantity") or 0))
            unit = i.get("unit", "")
            name = i.get("matched_name") or i.get("product_name", "")
            line = float(i.get("line_total") or 0)
            rows_html += (
                f"<tr>"
                f"<td style='padding:8px 10px;border:1px solid #E2E8F0'>{name}</td>"
                f"<td style='padding:8px 10px;border:1px solid #E2E8F0;text-align:center'>{qty} {unit}</td>"
                f"<td style='padding:8px 10px;border:1px solid #E2E8F0;text-align:right'>{_fmt_pln(line)}</td>"
                f"</tr>"
            )

        safe_notes = (req.notes or "").strip()
        if _is_internal_order_note(safe_notes):
            safe_notes = ""
        notes_html = (
            f'<p style="margin-top:12px"><strong>Uwagi do zamówienia:</strong> {safe_notes}</p>'
            if safe_notes else ""
        )
        email_html = f"""<div style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;max-width:640px;line-height:1.5">
  <p>Szanowni Państwo (<strong>{supplier_hello}</strong>),</p>
  <p>
    w imieniu restauracji <strong>{restaurant}</strong> przesyłamy do firmy
    <strong>{supplier_hello}</strong> zamówienie towaru z prośbą o potwierdzenie realizacji.
  </p>
  <p style="margin:0 0 4px 0;color:#64748B;font-size:13px">Data zamówienia: {today}</p>
  <p style="margin:0 0 14px 0;color:#64748B;font-size:13px">Odbiorca / hurtownia: <strong>{supplier_hello}</strong></p>
  <table style="border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:14px">
    <thead>
      <tr style="background:#F1F5F9">
        <th style="padding:10px 12px;border:1px solid #E2E8F0;text-align:left">Pozycja</th>
        <th style="padding:10px 12px;border:1px solid #E2E8F0;text-align:center">Ilość</th>
        <th style="padding:10px 12px;border:1px solid #E2E8F0;text-align:right">Wartość orientacyjna</th>
      </tr>
    </thead>
    <tbody>{rows_html}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="padding:10px 12px;border:1px solid #E2E8F0;text-align:right;font-weight:700">
          Łączna wartość orientacyjna
        </td>
        <td style="padding:10px 12px;border:1px solid #E2E8F0;text-align:right;font-weight:700">{_fmt_pln(subtotal)}</td>
      </tr>
    </tfoot>
  </table>
  <p>
    Prosimy o potwierdzenie: <strong>dostępności produktów</strong>, ostatecznych cen netto
    oraz <strong>terminu i formy dostawy</strong>.
    Podane kwoty mają charakter orientacyjny (na podstawie aktualnego cennika) —
    wiążące będą ceny potwierdzone przez Państwa.
  </p>
  {notes_html}
  <p>{contact_block}</p>
  <p style="margin-top:20px">
    Z poważaniem,<br/>
    <strong>{restaurant}</strong>
  </p>
  <p style="color:#94A3B8;font-size:12px;border-top:1px solid #E2E8F0;padding-top:12px;margin-top:20px">{footer}</p>
</div>"""

        email_text_lines = [
            f"Szanowni Państwo ({supplier_hello}),",
            "",
            f"W imieniu restauracji {restaurant} przesyłamy do firmy {supplier_hello} "
            f"zamówienie towaru (data: {today}) z prośbą o potwierdzenie realizacji.",
            f"Hurtownia: {supplier_hello}",
            "",
            "Zamawiane pozycje:",
        ]
        for i in items:
            pname = i.get("matched_name") or i.get("product_name", "")
            email_text_lines.append(
                f"• {pname} — {_fmt_qty(float(i.get('quantity') or 0))} {i.get('unit', '')} "
                f"(orient. {_fmt_pln(float(i.get('line_total') or 0))})"
            )
        email_text_lines += [
            "",
            f"Łączna wartość orientacyjna: {_fmt_pln(subtotal)}",
            "",
            "Prosimy o potwierdzenie dostępności, ostatecznych cen netto oraz terminu i formy dostawy.",
            "Podane kwoty mają charakter orientacyjny — wiążące będą ceny potwierdzone przez Państwa.",
        ]
        if safe_notes:
            email_text_lines += ["", f"Uwagi: {safe_notes}"]
        if contact_block:
            email_text_lines += ["", contact_block]
        email_text_lines += ["", "Z poważaniem,", restaurant, "", footer]
        email_text = "\n".join(email_text_lines)

        sms_items = "; ".join(
            f"{_fmt_qty(float(i.get('quantity') or 0))} {i.get('unit', '')} "
            f"{(i.get('matched_name') or i.get('product_name') or '')}"
            for i in items
        )
        sms_text = (
            f"{restaurant} — zamówienie ({today}): {sms_items}. "
            f"Orient. {_fmt_pln(subtotal)}. Prosimy o potwierdzenie dostępności i terminu dostawy."
        )
        if contact_phone:
            sms_text += f" Kontakt: {contact_phone}."

        messages.append({
            "supplier_id": g.supplier_id or sid or None,
            "supplier_name": supplier_hello,
            "supplier_email": supplier_email,
            "email_subject": f"Zamówienie towaru — {restaurant} → {supplier_hello} | {today}",
            "email_html": email_html,
            "email_text": email_text,
            "email_body_text": email_text,
            "sms_text": sms_text,
            "subtotal_pln": subtotal,
        })

    return {"messages": messages, "profile": profile,
            "profile_complete": bool(contact_email and contact_phone)}



# --- Wysyłka e-mail przez Resend ---------------------------------------------

@app.post("/api/orders/send-email")
async def send_order_email(req: SendEmailRequest):
    api_key = (req.api_key or _resend_api_key() or RESEND_API_KEY).strip()
    from_email = (req.from_email or _resend_from_email() or RESEND_FROM_EMAIL).strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Brak klucza Resend (RESEND_API_KEY). "
                "Dodaj go w backend/.env i zrestartuj uvicorn (zmiana .env wymaga pełnego restartu)."
            ),
        )
    if not req.to:
        raise HTTPException(status_code=400, detail="Brak adresu odbiorcy (supplier email).")

    # Treść: jeśli podano edytowalny body_text, budujemy z niego HTML (zachowując
    # łamanie linii). W przeciwnym razie używamy gotowego HTML.
    html = req.html
    if req.body_text:
        safe = (req.body_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
        html = ("<div style=\"font-family:Arial,Helvetica,sans-serif;color:#0F172A;"
                "white-space:pre-wrap;line-height:1.5\">" + safe.replace("\n", "<br>") + "</div>")
    if not html:
        raise HTTPException(status_code=400, detail="Brak treści wiadomości.")

    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        profile = await get_restaurant_profile(client)
        payload = {
            "from": f"Gastro Manager <{from_email}>",
            "to": [req.to],
            "subject": req.subject,
            "html": html,
        }
        # reply_to = e-mail restauratora → odpowiedź hurtowni trafia do niego, nie do nas
        reply_to = (profile.get("contact_email") or "").strip()
        if reply_to:
            payload["reply_to"] = reply_to
        try:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Błąd połączenia z Resend: {e}") from e

    if r.status_code >= 400:
        detail = r.text
        try:
            detail = r.json().get("message", detail)
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=f"Resend odrzucił wysyłkę: {detail}")

    data = r.json() if r.text else {}
    return {"ok": True, "id": data.get("id"), "to": req.to}


# --- Intencja głosowa Jarvisa: order_product ---------------------------------

@app.post("/api/orders/interpret-command")
async def interpret_order_command(req: InterpretOrderRequest):
    """Alias/kompatybilność wsteczna dla frontendu — używa nowego /api/voice/interpret
    i mapuje odpowiedź do starego formatu {intent, items[]}.
    Nowe intencje (edit_menu_item_price, add_recipe_ingredient, edit_recipe_ingredient_qty,
    edit_inventory_item, supplier_*) są przekazywane w polu `payload`, `fuzzy_matches`, `full`."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Brak tekstu komendy.")

    interpretation = await interpret(InterpretRequest(text=text))
    intent = interpretation.intent
    p = interpretation.payload or {}

    # Wsteczna kompatybilność: order_product → items[]
    items = []
    if intent == "order_product":
        raw_items = p.get("items") or []
        for i in raw_items:
            try:
                items.append({
                    "product_name": str(i.get("product_name", "")).strip(),
                    "quantity": float(i.get("quantity") or 1),
                    "unit": str(i.get("unit") or "szt").strip(),
                })
            except (TypeError, ValueError):
                continue
        items = [i for i in items if i["product_name"]]

    return {
        "intent": intent,
        "items": items,
        "payload": p,
        "confidence": interpretation.confidence,
        "reason": interpretation.reason,
    }


# =============================================================================
# VOICE CRUD — endpointy wykonawcze (edycja menu, receptur, magazynu, dostawców)
# =============================================================================

# ─────────────────────────────────────────────────────────────────────────────
# POS Bottleneck Engine — automatyczne blokowanie dań gdy braki w składnikach.
# ─────────────────────────────────────────────────────────────────────────────

_menu_is_available_col: Optional[bool] = None


async def _has_menu_is_available(client: httpx.AsyncClient) -> bool:
    """True jeśli menu_items ma kolumnę is_available (POS Bottleneck flag)."""
    global _menu_is_available_col
    if _menu_is_available_col is not None:
        return _menu_is_available_col
    try:
        await sb_get(client, "menu_items", params={"select": "is_available", "limit": "1"})
        _menu_is_available_col = True
    except Exception:
        _menu_is_available_col = False
        logger.warning("menu_items.is_available NIE istnieje — uruchom migrację "
                       "ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql, żeby włączyć POS Bottleneck Engine.")
    return _menu_is_available_col


async def _recompute_menu_availability(client: httpx.AsyncClient,
                                       changed_inventory_ids: Optional[set[str]] = None
                                       ) -> dict:
    """Przelicza is_available dla dań, których receptury używają zmienionych składników.

    Reguła: danie jest niedostępne, jeśli JAKIKOLWIEK jego składnik ma
    stan magazynowy (`quantity`) < wymagana ilość dla 1 porcji.
    Fuzzy-match po nazwie (recipe_ingredients.ingredient_name ↔ inventory_items.name).
    """
    has_col = await _has_menu_is_available(client)
    if not has_col:
        return {"skipped": True, "reason": "menu_items.is_available nie istnieje — uruchom migrację."}

    inv_all = await sb_get(client, "inventory_items",
                           params={"select": "id,name,quantity,unit", "limit": "5000"}) or []
    inv_by_id = {r["id"]: r for r in inv_all}
    inv_norm_to_id: dict[str, str] = {}
    for r in inv_all:
        k = _norm_pl(r.get("name") or "")
        if k:
            inv_norm_to_id.setdefault(k, r["id"])

    ri = await sb_get(client, "recipe_ingredients",
                      params={"select": "menu_item_id,ingredient_name,quantity,unit", "limit": "20000"}) or []
    by_menu: dict[str, list[dict]] = {}
    for r in ri:
        by_menu.setdefault(r["menu_item_id"], []).append(r)

    menu_rows = await sb_get(client, "menu_items",
                             params={"select": "id,name,is_available,is_active", "limit": "5000"}) or []

    updates: list[dict] = []
    changed = 0
    inv_keys = list(inv_norm_to_id.keys())

    for m in menu_rows:
        mid = m["id"]
        if not m.get("is_active", True):
            continue  # nieaktywne dania: pomijamy (POS ich nie widzi)
        ingredients = by_menu.get(mid, [])
        available = True
        blocker: Optional[str] = None
        for ing in ingredients:
            iname = ing.get("ingredient_name") or ""
            req_qty = float(ing.get("quantity") or 0)
            req_unit = ing.get("unit") or ""
            # Fuzzy match do inventory_items
            hit, score = _fuzzy_match(_norm_pl(iname), inv_keys, threshold=75)
            if not hit:
                # nie umiemy zweryfikować → uznajemy jako blocker (bezpieczna strona)
                available = False
                blocker = f"{iname} (brak w magazynie)"
                break
            inv_id = inv_norm_to_id[hit]
            inv = inv_by_id.get(inv_id, {})
            stock_qty = float(inv.get("quantity") or 0)
            stock_unit = inv.get("unit") or req_unit
            # Konwersja jednostek
            usable, ok = _yield_available(stock_qty, stock_unit, None, None, req_unit)
            if not ok or usable is None:
                usable = stock_qty  # fallback bez konwersji (np. jednostki zgodne)
            if usable < req_qty:
                available = False
                blocker = f"{inv.get('name') or iname}: {usable:.2f}{req_unit} < {req_qty}{req_unit}"
                break

        current = bool(m.get("is_available", True))
        if current != available:
            try:
                await sb_patch(client, "menu_items", {"id": f"eq.{mid}"},
                               {"is_available": available})
                changed += 1
                updates.append({
                    "menu_item_id": mid, "name": m.get("name"),
                    "is_available": available, "blocker": blocker,
                })
            except Exception as e:
                logger.warning(f"is_available update failed for {mid}: {e}")

    return {"scanned": len(menu_rows), "changed": changed, "updates": updates}


@app.post("/api/menu/recompute-availability")
async def menu_recompute_availability():
    """Ręczne przeliczenie POS Bottleneck Engine (blokowanie dań po brakach składników)."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        return await _recompute_menu_availability(client)


# ─────────────────────────────────────────────────────────────────────────────
# CRUD wykonawczy dla intencji głosowych.
# ─────────────────────────────────────────────────────────────────────────────


class SetMenuPriceRequest(BaseModel):
    dish_name: Optional[str] = None
    dish_id: Optional[str] = None
    new_price: float


@app.post("/api/menu/set-price")
async def set_menu_price(req: SetMenuPriceRequest):
    """Zmienia cenę dania. Wymagany dish_id LUB dish_name (fuzzy-matched na backendzie)."""
    if req.new_price is None or req.new_price < 0:
        raise HTTPException(status_code=400, detail="Nieprawidłowa cena.")
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        dish_id = req.dish_id
        matched_name: Optional[str] = None
        matched_score = 0.0
        if not dish_id and req.dish_name:
            rows = await sb_get(client, "menu_items",
                                params={"select": "id,name", "is_active": "eq.true", "limit": "1000"}) or []
            hit, score = _resolve_by_fuzzy(req.dish_name, rows)
            if hit:
                dish_id = hit["id"]
                matched_name = hit["name"]
                matched_score = score
        if not dish_id:
            raise HTTPException(status_code=404, detail="Nie znaleziono dania (brak dish_id i fuzzy).")
        try:
            row = await sb_patch(client, "menu_items", {"id": f"eq.{dish_id}"},
                                 {"price_pln": float(req.new_price)})
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Supabase: {e.response.text[:200]}") from e
        return {
            "ok": True, "dish_id": dish_id, "new_price": float(req.new_price),
            "matched_name": matched_name, "matched_score": round(matched_score, 1),
            "row": row[0] if isinstance(row, list) and row else row,
        }


class SetRecipeIngredientRequest(BaseModel):
    dish_name: Optional[str] = None
    dish_id: Optional[str] = None
    ingredient_name: str
    quantity: float
    unit: Optional[str] = None
    mode: Literal["upsert", "edit_qty"] = "upsert"  # upsert = add or edit


@app.post("/api/recipes/set-ingredient")
async def set_recipe_ingredient(req: SetRecipeIngredientRequest):
    """Dodaje LUB aktualizuje składnik receptury dania.
    mode='upsert' → dodaje jeśli brak, aktualizuje qty/unit jeśli istnieje.
    mode='edit_qty' → tylko aktualizuje qty (błąd 404 gdy brak)."""
    if req.quantity is None or req.quantity < 0:
        raise HTTPException(status_code=400, detail="Nieprawidłowa ilość.")
    if not (req.ingredient_name or "").strip():
        raise HTTPException(status_code=400, detail="Brak nazwy składnika.")
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        dish_id = req.dish_id
        matched_dish: Optional[str] = None
        if not dish_id and req.dish_name:
            rows = await sb_get(client, "menu_items",
                                params={"select": "id,name", "is_active": "eq.true", "limit": "1000"}) or []
            hit, _ = _resolve_by_fuzzy(req.dish_name, rows)
            if hit:
                dish_id = hit["id"]
                matched_dish = hit["name"]
        if not dish_id:
            raise HTTPException(status_code=404, detail="Nie znaleziono dania.")

        # Fuzzy-match ingredient_name do istniejącego składnika w recepturze.
        existing = await sb_get(client, "recipe_ingredients",
                                params={"select": "id,ingredient_name,quantity,unit",
                                        "menu_item_id": f"eq.{dish_id}"}) or []
        hit, _score = _resolve_by_fuzzy(req.ingredient_name, existing,
                                        key="ingredient_name", threshold=70)
        unit = (req.unit or (hit or {}).get("unit") or "g").strip()

        try:
            if hit:
                await sb_patch(client, "recipe_ingredients", {"id": f"eq.{hit['id']}"},
                               {"quantity": float(req.quantity), "unit": unit})
                action = "updated"
            else:
                if req.mode == "edit_qty":
                    raise HTTPException(status_code=404, detail=f"Składnik '{req.ingredient_name}' nie występuje w recepturze.")
                await sb_post(client, "recipe_ingredients", {
                    "menu_item_id": dish_id,
                    "ingredient_name": req.ingredient_name.strip(),
                    "quantity": float(req.quantity),
                    "unit": unit,
                })
                action = "created"
        except HTTPException:
            raise
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Supabase: {e.response.text[:200]}") from e

        # Po zmianie receptury: przelicz dostępność.
        avail = await _recompute_menu_availability(client)
        return {
            "ok": True, "action": action, "dish_id": dish_id,
            "matched_dish": matched_dish, "matched_ingredient": (hit or {}).get("ingredient_name"),
            "quantity": float(req.quantity), "unit": unit,
            "menu_availability": avail,
        }


class SetInventoryThresholdsRequest(BaseModel):
    item_name: Optional[str] = None
    inventory_id: Optional[str] = None
    min_quantity: Optional[float] = None
    current_quantity: Optional[float] = None
    safety_buffer_percent: Optional[float] = None


@app.post("/api/inventory/set-thresholds")
async def set_inventory_thresholds(req: SetInventoryThresholdsRequest):
    """Zmienia parametry produktu w magazynie (min_quantity, current_quantity, safety_buffer_percent)."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        inv_id = req.inventory_id
        matched: Optional[str] = None
        if not inv_id and req.item_name:
            rows = await sb_get(client, "inventory_items",
                                params={"select": "id,name", "limit": "5000"}) or []
            hit, _ = _resolve_by_fuzzy(req.item_name, rows)
            if hit:
                inv_id = hit["id"]
                matched = hit["name"]
        if not inv_id:
            raise HTTPException(status_code=404, detail="Nie znaleziono produktu w magazynie.")

        updates: dict = {}
        if req.min_quantity is not None:
            updates["min_quantity"] = float(req.min_quantity)
        if req.current_quantity is not None:
            updates["quantity"] = float(req.current_quantity)
        if req.safety_buffer_percent is not None:
            updates["safety_buffer_percent"] = float(req.safety_buffer_percent)
        if not updates:
            raise HTTPException(status_code=400, detail="Brak parametrów do aktualizacji.")

        try:
            row = await sb_patch(client, "inventory_items", {"id": f"eq.{inv_id}"}, updates)
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Supabase: {e.response.text[:200]}") from e

        # POS Bottleneck: przelicz dostępność jeżeli zmieniono current_quantity.
        avail = None
        if "quantity" in updates:
            avail = await _recompute_menu_availability(client, changed_inventory_ids={inv_id})

        return {
            "ok": True, "inventory_id": inv_id, "matched_name": matched,
            "updates": updates, "row": row[0] if isinstance(row, list) and row else row,
            "menu_availability": avail,
        }


# ─────────────────────────────────────────────────────────────────────────────
# SUPPLIER INTENTS — 5 endpointów dla intencji dostawców
# ─────────────────────────────────────────────────────────────────────────────


class FlipOrderRequest(BaseModel):
    from_supplier: str
    to_supplier: str
    category: Optional[str] = None
    items: Optional[list[dict]] = None  # opcjonalna lista {product_name, quantity, unit}


@app.post("/api/suppliers/flip-order")
async def supplier_flip_order(req: FlipOrderRequest):
    """Przerzuca koszyk z jednego dostawcy do drugiego (fuzzy match po nazwach produktów).
    Zwraca porównanie cen i sugerowany nowy koszyk u to_supplier."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        await _check_ai_access(client, needs_credits=False, needs_deal_hunter=True)
        suppliers = await sb_get(client, "suppliers", params={"select": "id,name", "limit": "500"}) or []
        src, _ = _resolve_by_fuzzy(req.from_supplier, suppliers)
        dst, _ = _resolve_by_fuzzy(req.to_supplier, suppliers)
        if not src:
            raise HTTPException(status_code=404, detail=f"Nie znaleziono dostawcy: {req.from_supplier}")
        if not dst:
            raise HTTPException(status_code=404, detail=f"Nie znaleziono dostawcy: {req.to_supplier}")

        src_catalog = await sb_get(client, "supplier_catalog", params={
            "select": "id,name,price_pln,variant,unit,volume_label,is_visible",
            "supplier_id": f"eq.{src['id']}",
        }) or []
        dst_catalog = await sb_get(client, "supplier_catalog", params={
            "select": "id,name,price_pln,variant,unit,volume_label,is_visible",
            "supplier_id": f"eq.{dst['id']}",
        }) or []

        # Jeśli podano items — porównaj tylko te, w innym razie: cały koszyk jawny.
        if req.items:
            comparison = []
            for it in req.items:
                pname = (it.get("product_name") or "").strip()
                qty = float(it.get("quantity") or 1)
                src_hit, _ = _resolve_by_fuzzy(pname, src_catalog, key="name")
                dst_hit, _ = _resolve_by_fuzzy(pname, dst_catalog, key="name")
                comparison.append({
                    "product_name": pname, "quantity": qty,
                    "from": {"name": (src_hit or {}).get("name"),
                             "price_pln": float((src_hit or {}).get("price_pln") or 0)} if src_hit else None,
                    "to": {"name": (dst_hit or {}).get("name"),
                           "price_pln": float((dst_hit or {}).get("price_pln") or 0)} if dst_hit else None,
                    "matched_at_target": bool(dst_hit),
                })
        else:
            # Cały jawny koszyk from_supplier → próbujemy zmapować na to_supplier.
            comparison = []
            for r in src_catalog:
                if r.get("is_visible") is False:
                    continue
                dst_hit, _ = _resolve_by_fuzzy(r["name"], dst_catalog, key="name")
                comparison.append({
                    "product_name": r["name"], "quantity": 1,
                    "from": {"name": r["name"], "price_pln": float(r.get("price_pln") or 0)},
                    "to": ({"name": dst_hit["name"], "price_pln": float(dst_hit.get("price_pln") or 0)}
                           if dst_hit else None),
                    "matched_at_target": bool(dst_hit),
                })

        total_from = sum((c["from"] or {}).get("price_pln", 0) * c["quantity"] for c in comparison if c["from"])
        total_to = sum((c["to"] or {}).get("price_pln", 0) * c["quantity"] for c in comparison if c["to"])
        saving = total_from - total_to
        matched = sum(1 for c in comparison if c["matched_at_target"])

        return {
            "from_supplier": {"id": src["id"], "name": src["name"]},
            "to_supplier": {"id": dst["id"], "name": dst["name"]},
            "category": req.category,
            "items_matched": matched, "items_total": len(comparison),
            "total_from_pln": round(total_from, 2),
            "total_to_pln": round(total_to, 2),
            "saving_pln": round(saving, 2),
            "comparison": comparison,
        }


class BudgetCapOrderRequest(BaseModel):
    max_budget: float
    category: Optional[str] = None
    supplier_id: Optional[str] = None


@app.post("/api/suppliers/budget-cap-order")
async def supplier_budget_cap_order(req: BudgetCapOrderRequest):
    """Kompletuje zamówienie priorytetyzując najpilniejsze braki magazynowe (najniższy
    stosunek quantity/min_quantity) do LIMITU KWOTOWEGO."""
    if req.max_budget is None or req.max_budget <= 0:
        raise HTTPException(status_code=400, detail="Nieprawidłowy budżet.")
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        await _check_ai_access(client, needs_credits=False, needs_deal_hunter=True)
        # 1) Ranking produktów magazynowych po pilności (im niższy stan / min, tym pilniej).
        inv = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,min_quantity,safety_buffer_percent,unit",
            "limit": "5000"
        }) or []
        prioritized = []
        for r in inv:
            q = float(r.get("quantity") or 0)
            m = float(r.get("min_quantity") or 0)
            sb = float(r.get("safety_buffer_percent") or 20) / 100.0
            target = m * (1.0 + sb) if m > 0 else max(q * 1.5, 1.0)
            deficit = max(0.0, target - q)
            urgency = (q / m) if m > 0 else 999.0  # niższe = pilniejsze
            prioritized.append({**r, "deficit": deficit, "urgency": urgency, "target": target})
        prioritized = [p for p in prioritized if p["deficit"] > 0]
        prioritized.sort(key=lambda x: x["urgency"])

        # 2) Ceny — bierzemy najtańszą pozycję z supplier_catalog per produkt (fuzzy match).
        cat_params = {"select": "id,supplier_id,name,price_pln,unit,volume_label,is_visible", "limit": "10000"}
        if req.supplier_id:
            cat_params["supplier_id"] = f"eq.{req.supplier_id}"
        catalog = await sb_get(client, "supplier_catalog", params=cat_params) or []
        catalog = [c for c in catalog if c.get("is_visible") is not False]

        # 3) Wybieramy od najpilniejszych, aż wyczerpiemy budżet.
        cart = []
        spent = 0.0
        for p in prioritized:
            hit, _ = _resolve_by_fuzzy(p["name"], catalog, key="name", threshold=70)
            if not hit:
                continue
            unit_price = float(hit.get("price_pln") or 0)
            if unit_price <= 0:
                continue
            qty = p["deficit"]
            line = qty * unit_price
            if spent + line > req.max_budget:
                # dorzuć tyle ile się zmieści
                max_qty = max(0.0, (req.max_budget - spent) / unit_price)
                if max_qty < 0.05:
                    continue
                qty = round(max_qty, 2)
                line = qty * unit_price
            cart.append({
                "inventory_id": p["id"], "product_name": p["name"], "quantity": round(qty, 3),
                "unit": p.get("unit"), "unit_price_pln": unit_price,
                "line_total_pln": round(line, 2), "supplier_id": hit.get("supplier_id"),
                "supplier_product_id": hit.get("id"), "urgency_score": round(p["urgency"], 3),
            })
            spent += line
            if spent >= req.max_budget:
                break

        return {
            "max_budget_pln": req.max_budget,
            "category": req.category,
            "items_count": len(cart),
            "total_pln": round(spent, 2),
            "remaining_pln": round(req.max_budget - spent, 2),
            "cart": cart,
        }


@app.get("/api/suppliers/top-savings")
async def supplier_top_savings(limit: int = 5):
    """Zwraca TOP-{limit} największych rabatów procentowych — porównuje aktualną cenę
    w `supplier_catalog` z historyczną (średnia z `pos_sales_log` / `cost_history` /
    wcześniejsze wpisy tego samego produktu). Fallback: pokazuje najniższe ceny per produkt."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        catalog = await sb_get(client, "supplier_catalog", params={
            "select": "id,supplier_id,name,price_pln,is_visible", "limit": "10000"
        }) or []
        catalog = [c for c in catalog if c.get("is_visible") is not False]
        suppliers = await sb_get(client, "suppliers", params={"select": "id,name", "limit": "500"}) or []
        sup_by_id = {s["id"]: s["name"] for s in suppliers}

        # Grupujemy po norm nazwy produktu; dla każdej grupy liczymy % różnicy vs. mediana.
        groups: dict[str, list[dict]] = {}
        for c in catalog:
            k = _norm_pl(c.get("name") or "")
            if not k:
                continue
            price = float(c.get("price_pln") or 0)
            if price <= 0:
                continue
            groups.setdefault(k, []).append({**c, "_norm_name": k})

        savings = []
        for k, rows in groups.items():
            if len(rows) < 2:
                continue
            prices = sorted(float(r["price_pln"]) for r in rows)
            best = prices[0]
            median = prices[len(prices) // 2]
            if median <= 0:
                continue
            discount_pct = round((median - best) / median * 100.0, 1)
            if discount_pct < 3:
                continue  # nieznaczące
            best_row = min(rows, key=lambda r: float(r["price_pln"]))
            savings.append({
                "product_name": best_row.get("name"),
                "best_price_pln": best,
                "median_price_pln": median,
                "discount_pct": discount_pct,
                "supplier_id": best_row.get("supplier_id"),
                "supplier_name": sup_by_id.get(best_row.get("supplier_id"), "?"),
                "compared_count": len(rows),
            })
        savings.sort(key=lambda x: -x["discount_pct"])
        return {"top": savings[:limit], "compared_products": len(groups)}


class PredictiveRestockRequest(BaseModel):
    weeks_back: int = 4
    day_of_week: Optional[int] = None  # 0=Mon..6=Sun. Domyślnie: dziś.
    supplier_id: Optional[str] = None


@app.post("/api/suppliers/predictive-restock")
async def supplier_predictive_restock(req: PredictiveRestockRequest):
    """Wylicza sugerowane zamówienie na podstawie sprzedaży POS z analogicznych dni tygodnia
    z poprzednich `weeks_back` tygodni. Rozbija dania na składniki (recipe_ingredients)
    i sumuje potrzebne surowce."""
    await _guard_ai(needs_credits=False, needs_deal_hunter=True)
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    target_dow = req.day_of_week if req.day_of_week is not None else now.weekday()
    weeks = max(1, min(int(req.weeks_back or 4), 12))

    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        # Pobieramy sprzedaż z pos_sales_log od `weeks*7 + 3` dni wstecz.
        since = (now - timedelta(days=weeks * 7 + 3)).isoformat()
        sales = await sb_get(client, "pos_sales_log", params={
            "select": "pos_external_id,pos_product_id,quantity_sold,processed_at",
            "processed_at": f"gte.{since}", "limit": "20000",
        }) or []

        # Filtrujemy do analogicznych dni tygodnia (target_dow).
        filtered = []
        for s in sales:
            try:
                dt = datetime.fromisoformat(str(s["processed_at"]).replace("Z", "+00:00"))
                if dt.weekday() == target_dow:
                    filtered.append(s)
            except Exception:
                continue

        # Mapujemy pos_external_id → menu_items.
        menu_all = await sb_get(client, "menu_items",
                                params={"select": "id,name,pos_id", "is_active": "eq.true", "limit": "5000"}) or []
        by_pos = {m.get("pos_id"): m for m in menu_all if m.get("pos_id")}
        by_id = {m["id"]: m for m in menu_all}

        # Sumujemy sprzedaż per menu_item.
        dish_totals: dict[str, float] = {}
        for s in filtered:
            mid = None
            pos_ext = s.get("pos_external_id")
            if pos_ext and pos_ext in by_pos:
                mid = by_pos[pos_ext]["id"]
            elif s.get("pos_product_id") in by_id:
                mid = s["pos_product_id"]
            if not mid:
                continue
            dish_totals[mid] = dish_totals.get(mid, 0.0) + float(s.get("quantity_sold") or 0)

        # Średnia sprzedaż per dzień = suma / weeks.
        forecasts = [{"menu_item_id": mid, "name": by_id[mid]["name"],
                      "avg_daily_qty": round(qty / weeks, 2)}
                     for mid, qty in dish_totals.items()]
        forecasts.sort(key=lambda x: -x["avg_daily_qty"])

        # Rozbicie na składniki (recipe_ingredients).
        ri = await sb_get(client, "recipe_ingredients", params={"select": "menu_item_id,ingredient_name,quantity,unit",
                                                                "limit": "20000"}) or []
        by_menu: dict[str, list[dict]] = {}
        for r in ri:
            by_menu.setdefault(r["menu_item_id"], []).append(r)

        # Sumujemy zapotrzebowanie na składniki (fuzzy do inventory dla obecnego stanu).
        inv = await sb_get(client, "inventory_items",
                           params={"select": "id,name,quantity,unit", "limit": "5000"}) or []
        inv_norm = {_norm_pl(r["name"]): r for r in inv if r.get("name")}

        needs: dict[str, dict] = {}  # klucz = norm ingredient_name
        for f in forecasts:
            for ing in by_menu.get(f["menu_item_id"], []):
                key = _norm_pl(ing.get("ingredient_name") or "")
                if not key:
                    continue
                need_qty = float(ing.get("quantity") or 0) * f["avg_daily_qty"]
                if key not in needs:
                    matched_inv = inv_norm.get(key)
                    if not matched_inv:
                        # fuzzy
                        hit, _ = _fuzzy_match(key, list(inv_norm.keys()), threshold=70)
                        matched_inv = inv_norm.get(hit) if hit else None
                    needs[key] = {
                        "ingredient_name": ing.get("ingredient_name"),
                        "unit": ing.get("unit"),
                        "forecast_qty": 0.0,
                        "current_stock": float((matched_inv or {}).get("quantity") or 0),
                        "inventory_id": (matched_inv or {}).get("id"),
                        "inventory_name": (matched_inv or {}).get("name"),
                    }
                needs[key]["forecast_qty"] = round(needs[key]["forecast_qty"] + need_qty, 3)

        # Sugerowane dorzucenia: forecast - current_stock (jeśli > 0).
        suggestions = []
        for n in needs.values():
            gap = round(n["forecast_qty"] - n["current_stock"], 3)
            if gap > 0:
                suggestions.append({**n, "suggested_order_qty": gap})
        suggestions.sort(key=lambda x: -x["suggested_order_qty"])

        return {
            "day_of_week": target_dow,
            "weeks_analyzed": weeks,
            "sales_records": len(filtered),
            "dish_forecasts": forecasts[:15],
            "ingredient_suggestions": suggestions[:30],
        }


class CheckMinOrderRequest(BaseModel):
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    current_cart_total: float = 0.0
    category: Optional[str] = None


@app.post("/api/suppliers/check-minimum-order")
async def supplier_check_min_order(req: CheckMinOrderRequest):
    """Sprawdza logistyczne minimum dostawy dostawcy (suppliers.min_order_value)
    i sugeruje produkty do dorzucenia (sypkie / napoje) w celu darmowego transportu."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        await _check_ai_access(client, needs_credits=False, needs_deal_hunter=True)
        # Graceful fallback: jeśli kolumna min_order_value nie istnieje w schemacie,
        # wybieramy tylko id,name i przyjmujemy min_order_value=0.
        has_min_col = True
        select_cols = "id,name,min_order_value"
        try:
            await sb_get(client, "suppliers", params={"select": "min_order_value", "limit": "1"})
        except Exception:
            has_min_col = False
            select_cols = "id,name"

        supplier = None
        if req.supplier_id:
            rows = await sb_get(client, "suppliers", params={
                "select": select_cols, "id": f"eq.{req.supplier_id}", "limit": "1"}) or []
            if rows:
                supplier = rows[0]
        if not supplier and req.supplier_name:
            all_sup = await sb_get(client, "suppliers",
                                   params={"select": select_cols, "limit": "500"}) or []
            hit, _ = _resolve_by_fuzzy(req.supplier_name, all_sup)
            supplier = hit
        if not supplier:
            raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")

        min_val = float(supplier.get("min_order_value") or 0) if has_min_col else 0.0
        gap = round(max(0.0, min_val - float(req.current_cart_total or 0)), 2)

        suggestions = []
        if gap > 0:
            catalog = await sb_get(client, "supplier_catalog", params={
                "select": "id,name,price_pln,variant,unit,volume_label,is_visible",
                "supplier_id": f"eq.{supplier['id']}",
            }) or []
            # Preferuj produkty sypkie/napoje (proste dorzucki).
            keywords = ["ryż", "mąka", "sól", "cukier", "olej", "woda", "napój", "sok",
                        "makaron", "ocet", "cola", "sprite", "pepsi"]

            def score(name: str) -> int:
                nl = (name or "").lower()
                return sum(1 for k in keywords if k in nl)

            candidates = sorted(
                [c for c in catalog if c.get("is_visible") is not False and float(c.get("price_pln") or 0) > 0],
                key=lambda c: (-score(c["name"]), float(c["price_pln"] or 0))
            )
            running = 0.0
            for c in candidates:
                price = float(c.get("price_pln") or 0)
                if running >= gap:
                    break
                suggestions.append({
                    "id": c["id"], "name": c["name"], "price_pln": price,
                    "unit": c.get("unit"), "variant": c.get("variant"),
                })
                running += price

        warnings: list[str] = []
        if not has_min_col:
            warnings.append("Kolumna suppliers.min_order_value nie istnieje — "
                            "uruchom migrację ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql. "
                            "Zwracam min_order_value=0.")

        return {
            "supplier": {"id": supplier["id"], "name": supplier["name"], "min_order_value": min_val},
            "current_cart_total": float(req.current_cart_total or 0),
            "gap_to_min": gap,
            "meets_minimum": gap == 0,
            "suggestions": suggestions,
            "warnings": warnings,
        }


# ─────────────────────────────────────────────────────────────────────────────
# BULK / DELETE / AVAILABILITY / SCALING / NAWIGACJA — nowe intencje Voice CRUD v2
# Soft-delete: menu_items.is_active (istnieje), suppliers/inventory_items.is_active
# (wymaga migracji ADD_SOFT_DELETE.sql — fallback z ostrzeżeniem gdy brak kolumny).
# ─────────────────────────────────────────────────────────────────────────────

_ALL_ROWS = {"id": "not.is.null"}  # PostgREST: filtr dopasowujący WSZYSTKIE wiersze


def _is_missing_column_error(exc: httpx.HTTPStatusError) -> bool:
    body = (exc.response.text or "").lower()
    return "is_active" in body or "pgrst204" in body or (
        "column" in body and ("does not exist" in body or "not found" in body))


def _cat_matches(row_cat: str, wanted: str, threshold: int = 72) -> bool:
    """Czy kategoria wiersza pasuje (fuzzy) do żądanej. Pusty `wanted` = pasują wszystkie."""
    if not wanted:
        return True
    a, b = _norm_pl(row_cat or ""), _norm_pl(wanted)
    if not a:
        return False
    return a == b or b in a or a in b or fuzz.WRatio(a, b) >= threshold


async def _menu_id_from_payload(client, p):
    """Zwraca (dish_id, dish_name) z payloadu; fallback ilike po nazwie."""
    dish_id = p.get("dish_id")
    name = p.get("dish_name_resolved") or p.get("dish_name")
    if not dish_id and name:
        rows = await sb_get(client, "menu_items",
                            params={"select": "id,name", "name": f"ilike.%{name}%", "limit": "1"})
        if rows:
            dish_id, name = rows[0]["id"], rows[0]["name"]
    return dish_id, name


async def _exec_bulk_delete_menu(client):
    """Trwałe usunięcie całego menu (bez soft-restore / „przywróć ukryte”)."""
    rows = await sb_get(client, "menu_items", params={"select": "id", "limit": "10000"}) or []
    n = len(rows)
    if n:
        ids = [r["id"] for r in rows if r.get("id")]
        # Najpierw receptury (FK), potem dania.
        for mid in ids:
            try:
                await sb_delete(client, "recipe_ingredients", {"menu_item_id": f"eq.{mid}"})
            except httpx.HTTPStatusError:
                pass
        await sb_delete(client, "menu_items", _ALL_ROWS)
    return {"ok": True, "action": "bulk_delete_menu", "affected": n, "restorable": False,
            "message": f"Usunięto trwale {n} pozycji z menu. Przywrócenie nie jest możliwe."}


async def _exec_restore_menu(client):
    return {
        "ok": False,
        "action": "restore_last_deleted_menu",
        "affected": 0,
        "message": (
            "Przywracanie usuniętego menu zostało wyłączone. "
            "Usunięte dania nie wracają ze skanu ani komendy głosowej — dodaj je ponownie."
        ),
    }


async def _exec_bulk_delete_suppliers(client):
    rows = await sb_get(client, "suppliers", params={"select": "id"}) or []
    n = len(rows)
    if n:
        # Usuń najpierw powiązane katalogi (na wypadek FK), potem dostawców — twarde usunięcie.
        try:
            await sb_delete(client, "supplier_catalog", _ALL_ROWS)
        except httpx.HTTPStatusError:
            pass
        await sb_delete(client, "suppliers", _ALL_ROWS)
    return {"ok": True, "action": "bulk_delete_suppliers", "affected": n,
            "message": f"Usunięto {n} dostawców."}


async def _exec_bulk_delete_inventory(client):
    """Soft-delete: is_active=false (przywracalne). Fallback: twarde usunięcie gdy brak kolumny."""
    try:
        rows = await sb_get(client, "inventory_items", params={
            "select": "id", "is_active": "eq.true", "limit": "10000",
        }) or []
    except httpx.HTTPStatusError:
        rows = await sb_get(client, "inventory_items", params={"select": "id", "limit": "10000"}) or []
        n = len(rows)
        if n:
            await sb_delete(client, "inventory_items", _ALL_ROWS)
        blocked = await _recompute_menu_availability(client)
        return {
            "ok": True, "action": "bulk_delete_inventory", "affected": n,
            "blocked_dishes": blocked, "restorable": False,
            "message": (
                f"Usunięto {n} produktów z magazynu (trwale — baza bez soft-delete). "
                "Przywrócenie niemożliwe."
            ),
        }
    n = len(rows)
    if n:
        await sb_patch(client, "inventory_items", {"is_active": "eq.true"}, {"is_active": False})
    blocked = await _recompute_menu_availability(client)
    return {
        "ok": True, "action": "bulk_delete_inventory", "affected": n,
        "blocked_dishes": blocked, "restorable": True,
        "message": (
            f"Usunięto {n} produktów z magazynu (ukryte). "
            "Powiedz „przywróć magazyn”, aby cofnąć."
        ),
    }


async def _exec_restore_inventory(client):
    try:
        rows = await sb_get(client, "inventory_items", params={
            "select": "id", "is_active": "eq.false", "limit": "10000",
        }) or []
    except httpx.HTTPStatusError:
        return {
            "ok": False, "action": "restore_deleted_inventory", "affected": 0,
            "message": (
                "Nie da się przywrócić magazynu — produkty zostały usunięte trwale "
                "(brak soft-delete). Dodaj je ręcznie lub zeskanuj fakturę."
            ),
        }
    n = len(rows)
    if n:
        await sb_patch(client, "inventory_items", {"is_active": "eq.false"}, {"is_active": True})
    return {
        "ok": True, "action": "restore_deleted_inventory", "affected": n,
        "message": (
            f"Przywrócono {n} produktów magazynu."
            if n else "Brak ukrytych produktów magazynu do przywrócenia."
        ),
    }


async def _exec_bulk_reset_inventory(client):
    rows = await sb_get(client, "inventory_items", params={"select": "id", "limit": "10000"}) or []
    n = len(rows)
    if n:
        await sb_patch(client, "inventory_items", _ALL_ROWS, {"quantity": 0})
    blocked = await _recompute_menu_availability(client)
    return {"ok": True, "action": "bulk_reset_inventory", "affected": n, "blocked_dishes": blocked,
            "message": f"Wyzerowano stany {n} produktów. Zablokowano {blocked} dań (brak składników)."}


async def _exec_delete_menu_item(client, p):
    dish_id, name = await _menu_id_from_payload(client, p)
    if not dish_id:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dania „{name or '?'}” w menu.")
    try:
        await sb_delete(client, "recipe_ingredients", {"menu_item_id": f"eq.{dish_id}"})
    except httpx.HTTPStatusError:
        pass
    await sb_delete(client, "menu_items", {"id": f"eq.{dish_id}"})
    return {"ok": True, "action": "delete_menu_item", "dish_id": dish_id, "restorable": False,
            "message": f"Usunięto trwale danie: {name}."}


async def _exec_delete_supplier(client, p):
    sid = p.get("supplier_name_id") or p.get("supplier_id")
    name = p.get("supplier_name_resolved") or p.get("supplier_name")
    if not sid and name:
        rows = await sb_get(client, "suppliers",
                            params={"select": "id,name", "name": f"ilike.%{name}%", "limit": "1"})
        if rows:
            sid, name = rows[0]["id"], rows[0]["name"]
    if not sid:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dostawcy „{name or '?'}”.")
    try:
        await sb_delete(client, "supplier_catalog", {"supplier_id": f"eq.{sid}"})
    except httpx.HTTPStatusError:
        pass
    await sb_delete(client, "suppliers", {"id": f"eq.{sid}"})
    return {"ok": True, "action": "delete_supplier", "message": f"Usunięto dostawcę: {name}."}


async def _exec_delete_inventory_item(client, p):
    iid = p.get("inventory_id") or p.get("item_name_id")
    name = p.get("item_name_resolved") or p.get("item_name")
    if not iid and name:
        rows = await sb_get(client, "inventory_items",
                            params={"select": "id,name", "name": f"ilike.%{name}%", "limit": "1"})
        if rows:
            iid, name = rows[0]["id"], rows[0]["name"]
    if not iid:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono produktu „{name or '?'}” w magazynie.")
    # Soft-delete jak bulk_delete_inventory — umożliwia „przywróć magazyn”
    try:
        await sb_patch(client, "inventory_items", {"id": f"eq.{iid}"}, {"is_active": False})
        return {
            "ok": True, "action": "delete_inventory_item", "restorable": True,
            "message": f"Usunięto produkt: {name} (ukryty — powiedz „przywróć magazyn”, aby cofnąć).",
        }
    except httpx.HTTPStatusError:
        await sb_delete(client, "inventory_items", {"id": f"eq.{iid}"})
        return {
            "ok": True, "action": "delete_inventory_item", "restorable": False,
            "message": f"Usunięto produkt: {name}.",
        }


async def _exec_toggle_availability(client, p):
    dish_id, name = await _menu_id_from_payload(client, p)
    if not dish_id:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dania „{name or '?'}”.")
    available = bool(p.get("available")) if p.get("available") is not None else False
    await sb_patch(client, "menu_items", {"id": f"eq.{dish_id}"}, {"is_available": available})
    verb = "Włączono" if available else "Wyłączono (zablokowano)"
    return {"ok": True, "action": "toggle_menu_item_availability", "available": available,
            "message": f"{verb} danie: {name}."}


async def _exec_bulk_menu_prices(client, p, mode: str):
    """mode: 'pct' | 'fixed'."""
    category = (p.get("category") or "").strip()
    action = (p.get("action") or "increase").lower()
    sign = -1 if action == "decrease" else 1
    rows = await sb_get(client, "menu_items",
                        params={"select": "id,name,price_pln,category", "is_active": "eq.true"}) or []
    rows = [r for r in rows if _cat_matches(r.get("category", ""), category)]
    if mode == "pct":
        factor = 1 + sign * float(p.get("percentage") or 0) / 100.0
    else:
        delta = sign * float(p.get("amount") or 0)
    changed = []
    for r in rows:
        old = float(r.get("price_pln") or 0)
        new = old * factor if mode == "pct" else old + delta
        new = round(max(0.0, new), 2)
        if new == old:
            continue
        await sb_patch(client, "menu_items", {"id": f"eq.{r['id']}"}, {"price_pln": new})
        changed.append({"name": r["name"], "old": old, "new": new})
    detail = (f"{p.get('percentage')}%" if mode == "pct" else f"{p.get('amount')} zł")
    verb = "Obniżono" if sign < 0 else "Podniesiono"
    scope = f" w kategorii „{category}”" if category else ""
    return {"ok": True, "action": f"bulk_edit_menu_prices_{mode}", "affected": len(changed),
            "changes": changed[:20],
            "message": f"{verb} ceny {len(changed)} dań{scope} o {detail}."}


async def _exec_bulk_inventory_buffers(client, p):
    category = (p.get("category") or "").strip()
    action = (p.get("action") or "increase").lower()
    sign = -1 if action == "decrease" else 1
    pts = sign * float(p.get("percentage") or 0)
    cat_id = None
    if category:
        cats = await sb_get(client, "inventory_categories", params={"select": "id,name"}) or []
        hit, _ = _resolve_by_fuzzy(category, cats, threshold=65)
        cat_id = hit["id"] if hit else None
        if category and not cat_id:
            return {"ok": False, "action": "bulk_edit_inventory_buffers", "affected": 0,
                    "message": f"Nie rozpoznano kategorii magazynu „{category}”."}
    params = {"select": "id,name,safety_buffer_percent,category_id"}
    if cat_id:
        params["category_id"] = f"eq.{cat_id}"
    rows = await sb_get(client, "inventory_items", params=params) or []
    changed = []
    for r in rows:
        old = float(r.get("safety_buffer_percent") or 20)
        new = round(max(10.0, old + pts), 1)
        if new == old:
            continue
        try:
            await sb_patch(client, "inventory_items", {"id": f"eq.{r['id']}"},
                           {"safety_buffer_percent": new})
            changed.append({"name": r["name"], "old": old, "new": new})
        except httpx.HTTPStatusError:
            pass
    verb = "Zmniejszono" if sign < 0 else "Zwiększono"
    scope = f" (kategoria „{category}”)" if category else ""
    return {"ok": True, "action": "bulk_edit_inventory_buffers", "affected": len(changed),
            "changes": changed[:20],
            "message": f"{verb} bufory bezpieczeństwa {len(changed)} produktów{scope} o {abs(pts)} p.p."}


async def _exec_edit_menu_category(client, p):
    dish_id, name = await _menu_id_from_payload(client, p)
    new_cat = (p.get("new_category") or p.get("category") or "").strip()
    if not dish_id:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dania „{name or '?'}”.")
    if not new_cat:
        raise HTTPException(status_code=400, detail="Brak nowej kategorii.")
    await sb_patch(client, "menu_items", {"id": f"eq.{dish_id}"}, {"category": new_cat})
    return {"ok": True, "action": "edit_menu_item_category", "dish_id": dish_id,
            "message": f"Zmieniono kategorię „{name}” → „{new_cat}”."}


async def _exec_rename_menu_item(client, p):
    dish_id, name = await _menu_id_from_payload(client, p)
    new_name = (p.get("new_name") or "").strip()
    if not dish_id:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dania „{name or '?'}”.")
    if not new_name:
        raise HTTPException(status_code=400, detail="Brak nowej nazwy dania.")
    await sb_patch(client, "menu_items", {"id": f"eq.{dish_id}"}, {"name": new_name})
    return {"ok": True, "action": "rename_menu_item", "dish_id": dish_id,
            "message": f"Zmieniono nazwę „{name}” → „{new_name}”."}


async def _exec_scale_recipe(client, p):
    dish_id, name = await _menu_id_from_payload(client, p)
    portions = float(p.get("portions") or 0)
    if not dish_id:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dania „{name or '?'}”.")
    if portions <= 0:
        raise HTTPException(status_code=400, detail="Podaj liczbę porcji > 0.")
    ings = await sb_get(client, "recipe_ingredients", params={
        "select": "ingredient_name,quantity,unit", "menu_item_id": f"eq.{dish_id}"}) or []
    inv = await sb_get(client, "inventory_items", params={"select": "name,quantity,unit"}) or []
    scaled = []
    for ing in ings:
        need = round(float(ing.get("quantity") or 0) * portions, 2)
        hit, _ = _resolve_by_fuzzy(ing.get("ingredient_name"), inv, threshold=70)
        have = float(hit.get("quantity")) if hit else None
        scaled.append({
            "ingredient_name": ing.get("ingredient_name"),
            "unit": ing.get("unit"),
            "per_portion": float(ing.get("quantity") or 0),
            "total_needed": need,
            "in_stock": have,
            "enough": (have is not None and have >= need),
        })
    missing = [s["ingredient_name"] for s in scaled if not s["enough"]]
    return {"ok": True, "action": "scale_recipe", "dish_id": dish_id, "dish_name": name,
            "portions": portions, "ingredients": scaled, "missing": missing,
            "message": f"Przeliczono „{name}” na {int(portions)} porcji "
                       f"({len(scaled)} składników).{' Braki: ' + ', '.join(missing) if missing else ''}"}


async def _recompute_menu_availability(client) -> int:
    """POS Bottleneck: ustaw is_available=false dla dań, których składnik ma stan <= 0.
    Zwraca liczbę zablokowanych dań. Best-effort."""
    try:
        recipes = await sb_get(client, "recipe_ingredients",
                               params={"select": "menu_item_id,ingredient_name,quantity"}) or []
        inv = await sb_get(client, "inventory_items", params={"select": "name,quantity"}) or []
        blocked_ids: set[str] = set()
        for r in recipes:
            need = float(r.get("quantity") or 0)
            hit, _ = _resolve_by_fuzzy(r.get("ingredient_name"), inv, threshold=70)
            have = float(hit.get("quantity")) if hit else 0.0
            if have < max(need, 0.0001):
                if r.get("menu_item_id"):
                    blocked_ids.add(r["menu_item_id"])
        for mid in blocked_ids:
            await sb_patch(client, "menu_items", {"id": f"eq.{mid}"}, {"is_available": False})
        return len(blocked_ids)
    except Exception:
        return 0


async def voice_dispatch_v2(intent: str, p: dict):
    """Router nowych intencji v2. Zwraca dict wyniku lub None jeśli intencja nieobsługiwana tutaj."""
    # Intencje UI — wykonywane na froncie, backend zwraca tylko potwierdzenie.
    if intent == "navigate_screen":
        return {"ok": True, "action": "navigate_screen", "screen": p.get("screen"),
                "message": f"Nawigacja: {p.get('screen')}"}
    if intent == "filter_ui_inventory":
        return {"ok": True, "action": "filter_ui_inventory",
                "category": p.get("category"), "supplier_id": p.get("supplier_id"),
                "message": f"Filtr magazynu: {p.get('category')}"}
    if intent == "filter_ui_menu_blocked":
        return {"ok": True, "action": "filter_ui_menu_blocked", "message": "Filtr menu: zablokowane"}

    async with httpx.AsyncClient(timeout=45.0, verify=_httpx_verify()) as client:
        if intent == "bulk_delete_menu":
            return await _exec_bulk_delete_menu(client)
        if intent == "bulk_delete_suppliers":
            return await _exec_bulk_delete_suppliers(client)
        if intent == "bulk_reset_inventory":
            return await _exec_bulk_reset_inventory(client)
        if intent == "bulk_delete_inventory":
            return await _exec_bulk_delete_inventory(client)
        if intent == "restore_last_deleted_menu":
            return await _exec_restore_menu(client)
        if intent == "restore_deleted_inventory":
            return await _exec_restore_inventory(client)
        if intent == "delete_menu_item":
            return await _exec_delete_menu_item(client, p)
        if intent == "delete_supplier":
            return await _exec_delete_supplier(client, p)
        if intent == "delete_inventory_item":
            return await _exec_delete_inventory_item(client, p)
        if intent == "toggle_menu_item_availability":
            return await _exec_toggle_availability(client, p)
        if intent == "bulk_edit_menu_prices_percentage":
            return await _exec_bulk_menu_prices(client, p, "pct")
        if intent == "bulk_edit_menu_prices_fixed":
            return await _exec_bulk_menu_prices(client, p, "fixed")
        if intent == "bulk_edit_inventory_buffers":
            return await _exec_bulk_inventory_buffers(client, p)
        if intent == "edit_menu_item_category":
            return await _exec_edit_menu_category(client, p)
        if intent == "rename_menu_item":
            return await _exec_rename_menu_item(client, p)
        if intent == "scale_recipe":
            return await _exec_scale_recipe(client, p)
    return None



# ─────────────────────────────────────────────────────────────────────────────
# Voice CRUD DISPATCH — wykonanie intencji z /api/voice/interpret za jednym zamachem.
# ─────────────────────────────────────────────────────────────────────────────


class VoiceDispatchRequest(BaseModel):
    intent: Intent
    payload: dict


@app.post("/api/voice/dispatch")
async def voice_dispatch(req: VoiceDispatchRequest):
    """Wykonanie intencji rozpoznanej przez /api/voice/interpret. Router do właściwego
    endpointu wykonawczego. Frontend może użyć zamiast wywołania /interpret + drugiego call."""
    p = req.payload or {}
    it = req.intent
    def _period_hint_from_payload(pl: dict) -> Optional[str]:
        for k in ("period_1", "note", "_transcript"):
            v = pl.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    if it == "summarize_custom_period":
        sels = _merge_period_sels(p)
        res = await _run_period_analysis(
            p.get("period_type") or "month",
            p.get("limit_days"),
            period_hint=_period_hint_from_payload(p),
            selected_periods=sels,
        )
        res.setdefault("action", "summarize_custom_period")
        res.setdefault("message", res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "compare_two_periods":
        sels = _merge_period_sels(p)
        res = await _run_compare_periods(
            p.get("period_1") or "",
            p.get("period_2") or "",
            selected_periods=sels,
        )
        res.setdefault("action", "compare_two_periods")
        res.setdefault("message", res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "rank_menu_sales":
        sels = _merge_period_sels(p)
        res = await _run_rank_menu_sales(
            rank=p.get("rank") or "best",
            period_type=p.get("period_type") or "year",
            limit_days=p.get("limit_days"),
            top_n=p.get("top_n"),
            category=p.get("category") or p.get("category_name"),
            period_hint=_period_hint_from_payload(p),
            selected_periods=sels,
        )
        res.setdefault("action", "rank_menu_sales")
        res.setdefault("message", res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "rank_inventory_usage":
        sels = _merge_period_sels(p)
        res = await _run_rank_inventory_usage(
            rank=p.get("rank") or "best",
            period_type=p.get("period_type") or "year",
            limit_days=p.get("limit_days"),
            top_n=p.get("top_n"),
            category=p.get("category") or p.get("category_name"),
            period_hint=_period_hint_from_payload(p),
            selected_periods=sels,
        )
        res.setdefault("action", "rank_inventory_usage")
        res.setdefault("message", res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "rank_waste_cost":
        sels = _merge_period_sels(p)
        res = await _run_rank_waste_cost(
            period_type=p.get("period_type") or "year",
            limit_days=p.get("limit_days"),
            top_n=p.get("top_n"),
            period_hint=_period_hint_from_payload(p),
            selected_periods=sels,
        )
        res.setdefault("action", "rank_waste_cost")
        res.setdefault("message", res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "rank_dead_menu":
        sels = _merge_period_sels(p)
        res = await _run_rank_dead_menu(
            period_type=p.get("period_type") or "year",
            limit_days=p.get("limit_days"),
            top_n=p.get("top_n"),
            category=p.get("category") or p.get("category_name"),
            period_hint=_period_hint_from_payload(p),
            selected_periods=sels,
        )
        res.setdefault("action", "rank_dead_menu")
        res.setdefault("message", res.get("message") or res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "list_expiring_soon":
        res = await _run_list_expiring_soon(
            within_days=p.get("limit_days") or 3,
            top_n=p.get("top_n"),
        )
        res.setdefault("action", "list_expiring_soon")
        res.setdefault("message", res.get("assistant_speech", ""))
        return res
    if it == "rank_supplier_spend":
        res = await _run_rank_supplier_spend(
            period_type=p.get("period_type") or "month",
            limit_days=p.get("limit_days"),
            top_n=p.get("top_n"),
            period_hint=p.get("period_1") or p.get("note"),
            supplier_name=p.get("supplier_name") or p.get("item_name"),
        )
        res.setdefault("action", "rank_supplier_spend")
        res.setdefault("message", res.get("assistant_speech", ""))
        return res
    if it == "manager_core_alerts":
        res = await _run_manager_core_alerts(
            period_type=p.get("period_type") or "week",
            limit_days=p.get("limit_days"),
            period_hint=p.get("period_1") or p.get("note"),
        )
        res.setdefault("action", "manager_core_alerts")
        res.setdefault("message", res.get("assistant_speech", ""))
        return res
    if it == "haccp_tip":
        res = _run_haccp_tip(
            p.get("item_name") or p.get("product_name") or p.get("note") or p.get("reason_text") or "",
        )
        res.setdefault("action", "haccp_tip")
        res.setdefault("message", res.get("assistant_speech", ""))
        return res
    if it in ("upload_invoice", "upload_offer", "upload_document", "upload_menu"):
        kind = (
            "menu" if it == "upload_menu"
            else "invoice" if it == "upload_invoice"
            else ("offer" if it == "upload_offer" else "document")
        )
        return {
            "ok": True,
            "action": it,
            "doc_kind": kind,
            "open_scan": True,
            "message": (
                "Otwieram skaner menu restauracji (karta dań)."
                if kind == "menu"
                else (
                    "Otwieram skaner — wgraj ofertę/gazetkę dostawcy."
                    if kind == "offer"
                    else "Otwieram skaner dokumentów — wgraj fakturę lub ofertę."
                )
            ),
        }
    v2 = await voice_dispatch_v2(it, p)
    if v2 is not None:
        return v2
    if it == "edit_menu_item_price":
        return await set_menu_price(SetMenuPriceRequest(
            dish_id=p.get("dish_id"), dish_name=p.get("dish_name") or p.get("dish_name_resolved"),
            new_price=float(p.get("new_price") or 0),
        ))
    if it == "add_recipe_ingredient":
        return await set_recipe_ingredient(SetRecipeIngredientRequest(
            dish_id=p.get("dish_id"), dish_name=p.get("dish_name") or p.get("dish_name_resolved"),
            ingredient_name=(p.get("ingredient_name") or p.get("ingredient_name_resolved") or "").strip(),
            quantity=float(p.get("quantity") or 0),
            unit=p.get("unit"),
            mode="upsert",
        ))
    if it == "edit_recipe_ingredient_qty":
        return await set_recipe_ingredient(SetRecipeIngredientRequest(
            dish_id=p.get("dish_id"), dish_name=p.get("dish_name") or p.get("dish_name_resolved"),
            ingredient_name=(p.get("ingredient_name") or p.get("ingredient_name_resolved") or "").strip(),
            quantity=float(p.get("quantity") or 0),
            unit=p.get("unit"),
            mode="edit_qty",
        ))
    if it == "edit_inventory_item":
        return await set_inventory_thresholds(SetInventoryThresholdsRequest(
            inventory_id=p.get("inventory_id"),
            item_name=p.get("item_name") or p.get("item_name_resolved"),
            min_quantity=(float(p["min_quantity"]) if p.get("min_quantity") is not None else None),
            current_quantity=(float(p["current_quantity"]) if p.get("current_quantity") is not None else None),
            safety_buffer_percent=(float(p["safety_buffer_percent"]) if p.get("safety_buffer_percent") is not None else None),
        ))
    if it == "supplier_flip_order":
        return await supplier_flip_order(FlipOrderRequest(
            from_supplier=p.get("from_supplier") or "",
            to_supplier=p.get("to_supplier") or "",
            category=p.get("category"),
            items=p.get("items"),
        ))
    if it == "budget_cap_order":
        return await supplier_budget_cap_order(BudgetCapOrderRequest(
            max_budget=float(p.get("max_budget") or 0),
            category=p.get("category"),
            supplier_id=p.get("supplier_id"),
        ))
    if it == "compare_catalogs_top_savings":
        return await supplier_top_savings(limit=5)
    if it == "predictive_weekend_restock":
        return await supplier_predictive_restock(PredictiveRestockRequest(
            weeks_back=4, day_of_week=None, supplier_id=p.get("supplier_id"),
        ))
    if it == "check_minimum_order_value":
        return await supplier_check_min_order(CheckMinOrderRequest(
            supplier_id=p.get("supplier_id"),
            supplier_name=p.get("supplier_name") or p.get("supplier_name_resolved"),
            current_cart_total=float(p.get("current_cart_total") or 0),
            category=p.get("category"),
        ))
    if it == "order_product":
        raw_items = p.get("items") or []
        if not isinstance(raw_items, list):
            raw_items = []
        compare_items: list[CompareItem] = []
        for itx in raw_items:
            if not isinstance(itx, dict):
                continue
            name = (itx.get("product_name") or itx.get("name") or "").strip()
            if not name:
                continue
            try:
                qty = float(itx.get("quantity") or 1)
            except (TypeError, ValueError):
                qty = 1.0
            if qty <= 0:
                qty = 1.0
            unit = (itx.get("unit") or "szt").strip() or "szt"
            compare_items.append(CompareItem(
                product_name_or_id=name,
                quantity=qty,
                unit=unit,
            ))
        if not compare_items:
            return {
                "ok": False,
                "action": "order_product",
                "compare": None,
                "message": "Dodaj co najmniej jeden produkt do zamówienia (nazwa + ilość).",
            }
        try:
            compare = await compare_offers(CompareOffersRequest(
                items=compare_items,
                restaurant_name=p.get("restaurant_name"),
                search_scope=p.get("search_scope") or "suppliers_only",
            ))
        except HTTPException as e:
            return {
                "ok": False,
                "action": "order_product",
                "compare": None,
                "message": f"Łowca Okazji: {e.detail}",
            }
        except Exception as e:  # noqa: BLE001
            return {
                "ok": False,
                "action": "order_product",
                "compare": None,
                "message": f"Łowca Okazji: {str(e)[:160]}",
            }
        found = sum(1 for x in (compare.get("items_requested") or []) if x.get("found"))
        return {
            "ok": True,
            "action": "order_product",
            "compare": compare,
            "message": (
                f"Koszyk: {len(compare_items)} pozycji · "
                f"znaleziono oferty dla {found}/{len(compare_items)}. "
                "Otwieram Łowcę Okazji."
            ),
        }
    if it == "order_critical_items_by_category":
        cats = p.get("categories") or []
        if isinstance(cats, str):
            cats = [cats]
        raw_items = p.get("items") or []
        extra: list[ExtraOrderItem] = []
        if isinstance(raw_items, list):
            for itx in raw_items:
                if not isinstance(itx, dict):
                    continue
                pname = str(itx.get("product_name") or itx.get("name") or "").strip()
                if not pname:
                    continue
                try:
                    qty = float(itx.get("quantity")) if itx.get("quantity") is not None else None
                except (TypeError, ValueError):
                    qty = None
                if qty is not None and qty <= 0:
                    qty = None
                uwv_val = None
                try:
                    if itx.get("unit_weight_volume") is not None and str(itx.get("unit_weight_volume")).strip() != "":
                        uwv_val = float(itx["unit_weight_volume"])
                except (TypeError, ValueError):
                    uwv_val = None
                extra.append(ExtraOrderItem(
                    product_name=pname,
                    quantity=qty,
                    unit=str(itx.get("unit") or "szt").strip() or "szt",
                    unit_weight_volume=uwv_val,
                    weight_volume_unit=(
                        str(itx.get("weight_volume_unit") or "").strip() or None
                    ),
                ))
        return await orders_critical_by_category(CriticalByCategoryRequest(
            categories=list(cats),
            restaurant_name=p.get("restaurant_name"),
            stock_target=str(p.get("stock_target") or "critical"),
            items=extra,
            cart_objective=(
                str(p.get("cart_objective")).strip()
                if p.get("cart_objective") else None
            ),
            search_scope=p.get("search_scope") or "suppliers_only",
        ))
    raise HTTPException(status_code=400, detail=f"Intencja {it!r} nie obsługiwana przez /voice/dispatch.")


# ─────────────────────────────────────────────────────────────────────────────
# Migracja info — informacja dla FE o brakujących kolumnach/tabelach Supabase.
# ─────────────────────────────────────────────────────────────────────────────


@app.get("/api/admin/migration-status")
async def admin_migration_status():
    """Sprawdza czy migracja `ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql` została uruchomiona.
    Zwraca listę brakujących kolumn/tabel i pełny SQL do wklejenia w Supabase SQL Editor."""
    async with httpx.AsyncClient(timeout=15.0, verify=_httpx_verify()) as client:
        checks = {}
        try:
            await sb_get(client, "menu_items", params={"select": "is_available", "limit": "1"})
            checks["menu_items.is_available"] = True
        except Exception:
            checks["menu_items.is_available"] = False
        try:
            await sb_get(client, "inventory_items", params={"select": "synonyms", "limit": "1"})
            checks["inventory_items.synonyms"] = True
        except Exception:
            checks["inventory_items.synonyms"] = False
        try:
            await sb_get(client, "token_usage", params={"select": "id", "limit": "1"})
            checks["token_usage table"] = True
        except Exception:
            checks["token_usage table"] = False
        try:
            await sb_get(client, "suppliers", params={"select": "min_order_value", "limit": "1"})
            checks["suppliers.min_order_value"] = True
        except Exception:
            checks["suppliers.min_order_value"] = False

    all_ok = all(checks.values())
    sql_path = Path(__file__).resolve().parent.parent / "supabase_migrations" / "ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql"
    sql_content = sql_path.read_text(encoding="utf-8") if sql_path.exists() else ""
    return {
        "ok": all_ok,
        "checks": checks,
        "instructions": "Otwórz Supabase Dashboard → SQL Editor → New query → wklej poniższy SQL → Run." if not all_ok else "Wszystkie migracje uruchomione.",
        "sql": sql_content if not all_ok else "",
    }


# ─────────────────────────────────────────────────────────────────────────────
# AUTOMATYCZNE RAPORTY DOBOWE (End-of-Day Reports)
# ─────────────────────────────────────────────────────────────────────────────

class CloseDayRequest(BaseModel):
    date: Optional[str] = None           # YYYY-MM-DD; domyślnie dziś (UTC)
    total_revenue: Optional[float] = None
    total_waste_cost: Optional[float] = None
    total_invoice_cost: Optional[float] = None


def _week_of_month(d) -> int:
    return min(5, (int(d.day) - 1) // 7 + 1)


async def _sum_amount_for_day(client, table: str, day: str, extra: dict | None = None) -> float:
    """Best-effort suma amount_pln z tabeli dla danego dnia (po created_at)."""
    from datetime import date as _d, timedelta as _td
    try:
        next_day = (_d.fromisoformat(day) + _td(days=1)).isoformat()
        params = [("select", "amount_pln"),
                  ("created_at", f"gte.{day}T00:00:00"),
                  ("created_at", f"lt.{next_day}T00:00:00")]
        if extra:
            for k, v in extra.items():
                params.append((k, v))
        rows = await sb_get(client, table, params=params) or []
        return round(sum(float(r.get("amount_pln") or 0) for r in rows), 2)
    except Exception:
        return 0.0


async def _generate_day_summary(httpx_c: httpx.AsyncClient,
                                revenue: float, waste: float, invoice: float,
                                day: str) -> tuple[str, dict]:
    profit = round(revenue - waste - invoice, 2)
    try:
        client = _openai()
        prompt = (
            f"Przeanalizuj dzień pracy restauracji ({day}). "
            f"Utarg: {revenue} zł, Straty (waste): {waste} zł, Koszty faktur: {invoice} zł, "
            f"Zysk netto: {profit} zł. "
            "Wygeneruj profesjonalne, dokładnie 3-zdaniowe podsumowanie managerskie po polsku: "
            "co poszło dobrze, gdzie uciekły pieniądze i jedna konkretna rekomendacja na jutro."
        )
        resp = await client.chat.completions.create(
            model=CHAT_MODEL, temperature=0.5,
            messages=[{"role": "user", "content": prompt}],
        )
        billing = await _bill_openai_response(
            httpx_c, resp, endpoint="/api/pos/close-day", model=CHAT_MODEL,
            extras={"date": day},
        )
        return (resp.choices[0].message.content or "").strip(), billing
    except Exception as e:  # noqa: BLE001
        logger.warning(f"_generate_day_summary failed: {e}")
        return (f"Utarg {revenue} zł, straty {waste} zł, koszty faktur {invoice} zł, "
                f"zysk netto {profit} zł.", {"credits_deducted": 0})


# Safety net: zapomniane „Zamknij dzień” — auto-domknięcie po ≥25h od poprzedniego raportu.
DAILY_REPORT_AUTO_CLOSE_HOURS = 25


def _parse_iso_dt(value) -> "datetime | None":
    from datetime import datetime as _dt, timezone as _tz
    if not value:
        return None
    try:
        s = str(value).strip().replace("Z", "+00:00")
        dt = _dt.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_tz.utc)
        return dt
    except Exception:
        return None


async def _persist_daily_report(
    client,
    day: str,
    *,
    revenue: float | None = None,
    waste: float | None = None,
    invoice: float | None = None,
    use_ai: bool = True,
    auto_closed: bool = False,
    allow_overwrite: bool = True,
) -> tuple[dict | None, dict, str | None]:
    """Agregacja + zapis daily_reports (wspólne dla ręcznego i auto zamknięcia).

    Zwraca (record_or_none, billing, skip_reason). skip_reason='exists' gdy dzień
    już zamknięty i allow_overwrite=False (auto-close — bez podwójnego liczenia).
    """
    from datetime import date as _date

    d_obj = _date.fromisoformat(day)
    if revenue is None:
        revenue = await _sum_amount_for_day(client, "revenue_entries", day)
    if invoice is None:
        invoice = await _sum_amount_for_day(
            client, "variable_cost_entries", day, {"type": "eq.materials"}
        )
    if waste is None:
        waste = await _sum_amount_for_day(
            client, "variable_cost_entries", day, {"type": "eq.waste"}
        )

    existing = await sb_get(
        client, "daily_reports",
        params={"select": "id", "date": f"eq.{day}", "limit": "1"},
    )
    if existing and not allow_overwrite:
        return None, {"credits_deducted": 0}, "exists"

    if use_ai:
        summary, billing = await _generate_day_summary(client, revenue, waste, invoice, day)
    else:
        profit = round(float(revenue) - float(waste) - float(invoice), 2)
        # Auto-close: bez GPT (nie spalaj kredytów w tle); treść jak fallback ręcznego zamknięcia.
        summary = (
            f"[Auto] Zamknięto automatycznie po {DAILY_REPORT_AUTO_CLOSE_HOURS}h od poprzedniego raportu. "
            f"Utarg {revenue} zł, straty {waste} zł, koszty faktur {invoice} zł, zysk netto {profit} zł."
        )
        billing = {"credits_deducted": 0}
        if auto_closed:
            pass  # flaga tylko dla czytelności wywołań

    record = {
        "date": day,
        "total_revenue": revenue,
        "total_waste_cost": waste,
        "total_invoice_cost": invoice,
        "ai_summary": summary,
        "year": d_obj.year,
        "month": d_obj.month,
        "week_of_month": _week_of_month(d_obj),
    }
    if existing:
        await sb_patch(client, "daily_reports", {"date": f"eq.{day}"}, record)
        record["id"] = existing[0]["id"]
    else:
        row = await sb_post(client, "daily_reports", record)
        record["id"] = (row[0] if isinstance(row, list) else row).get("id")
    return record, billing, None


async def _auto_close_stale_daily_reports(client) -> list[str]:
    """Domyka brakujące raporty dobowe, gdy od last close minęło ≥25h.

    Trigger: GET /api/reports/daily (ładowanie Raportów / foreground refresh).
    Zakres: dni od (ostatni_raport.date + 1) do wczoraj (UTC), bez nadpisywania istniejących.

    TODO(POS): gdy POS będzie podłączony i stabilny — synchronizuj zamknięcie dnia
    z wydrukiem raportu dobowego z kasy (przy print/close POS wciągaj P&L do rubryk).
    Na razie tylko safety-net w aplikacji, bez integracji POS.
    """
    from datetime import datetime as _dt, timezone as _tz, date as _date, timedelta as _td

    try:
        rows = await sb_get(
            client, "daily_reports",
            params={"select": "date,created_at", "order": "date.desc", "limit": "1"},
        ) or []
    except httpx.HTTPStatusError:
        return []

    if not rows:
        return []

    last = rows[0]
    last_date_s = str(last.get("date") or "")[:10]
    closed_at = _parse_iso_dt(last.get("created_at"))
    if not last_date_s or closed_at is None:
        return []

    now = _dt.now(_tz.utc)
    hours_since = (now - closed_at).total_seconds() / 3600.0
    if hours_since < DAILY_REPORT_AUTO_CLOSE_HOURS:
        return []

    try:
        last_d = _date.fromisoformat(last_date_s)
    except ValueError:
        return []

    yesterday = now.date() - _td(days=1)
    closed_days: list[str] = []
    d = last_d + _td(days=1)
    # Ogranicz kaskadę (np. po dłuższej przerwie) — max 14 dni na jedno wywołanie.
    while d <= yesterday and len(closed_days) < 14:
        day_s = d.isoformat()
        try:
            rec, _billing, skip = await _persist_daily_report(
                client, day_s, use_ai=False, auto_closed=True, allow_overwrite=False,
            )
            if rec and not skip:
                closed_days.append(day_s)
                logger.info(f"daily_reports auto-close: {day_s}")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"daily_reports auto-close failed for {day_s}: {e}")
            break
        d += _td(days=1)
    return closed_days


@app.post("/api/pos/close-day")
async def pos_close_day(req: CloseDayRequest):
    """Zamknięcie dnia: agreguje utarg/straty/koszty, generuje podsumowanie AI (GPT-4o-mini)
    i zapisuje rekord do daily_reports (z rokiem/miesiącem/tygodniem miesiąca)."""
    from datetime import datetime as _dt, timezone as _tz, date as _date
    day = (req.date or _dt.now(_tz.utc).strftime("%Y-%m-%d")).strip()
    try:
        _date.fromisoformat(day)
    except ValueError:
        raise HTTPException(status_code=400, detail="Nieprawidłowa data (YYYY-MM-DD).")

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        try:
            record, billing, _skip = await _persist_daily_report(
                client,
                day,
                revenue=req.total_revenue,
                waste=req.total_waste_cost,
                invoice=req.total_invoice_cost,
                use_ai=True,
                allow_overwrite=True,
            )
        except httpx.HTTPStatusError as e:
            if _is_missing_column_error(e) or "daily_reports" in (e.response.text or "").lower() \
                    or e.response.status_code == 404:
                return {"ok": False, "needs_migration": True,
                        "message": "Uruchom migrację ADD_DAILY_REPORTS.sql w Supabase (tabela daily_reports)."}
            raise HTTPException(status_code=502, detail=f"daily_reports: {e.response.text}") from e

    revenue = float((record or {}).get("total_revenue") or 0)
    waste = float((record or {}).get("total_waste_cost") or 0)
    invoice = float((record or {}).get("total_invoice_cost") or 0)
    return _with_billing({
        "ok": True,
        "id": (record or {}).get("id"),
        "report": record,
        "message": (
            f"Raport dobowy {day} zapisany. "
            f"Zysk netto: {round(revenue - waste - invoice, 2)} zł."
        ),
    }, billing)


@app.get("/api/reports/daily")
async def reports_daily():
    """Zwraca wszystkie raporty dobowe (sort malejąco po dacie) do archiwum w UI.

    Przy okazji uruchamia safety-net auto-close (≥25h od poprzedniego zamknięcia).
    """
    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        try:
            auto_closed = await _auto_close_stale_daily_reports(client)
            rows = await sb_get(client, "daily_reports",
                                params={"select": "*", "order": "date.desc", "limit": "2000"})
            out = {"ok": True, "reports": rows or []}
            if auto_closed:
                out["auto_closed_dates"] = auto_closed
            return out
        except httpx.HTTPStatusError:
            return {"ok": True, "reports": [], "needs_migration": True}


# ─────────────────────────────────────────────────────────────────────────────
# AI TREND & ANALYTICS ORCHESTRATOR — podsumowania i porównania okresowe
# ─────────────────────────────────────────────────────────────────────────────

_PL_MONTHS = {
    "styczen": 1, "stycznia": 1, "luty": 2, "lutego": 2, "marzec": 3, "marca": 3,
    "kwiecien": 4, "kwietnia": 4, "maj": 5, "maja": 5, "czerwiec": 6, "czerwca": 6,
    "lipiec": 7, "lipca": 7, "sierpien": 8, "sierpnia": 8, "wrzesien": 9, "wrzesnia": 9,
    "pazdziernik": 10, "pazdziernika": 10, "listopad": 11, "listopada": 11,
    "grudzien": 12, "grudnia": 12,
}
_PL_MONTH_NAMES = ["", "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
                   "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"]


class AnalyzePeriodRequest(BaseModel):
    period_type: Literal["week", "month", "year", "custom"] = "week"
    limit_days: Optional[int] = None
    selected_periods: Optional[list] = None
    period_hint: Optional[str] = None


class ComparePeriodsRequest(BaseModel):
    period_1: str
    period_2: str


# Domyślny rok finansowy gdy użytkownik nie poda roku („zyski z lipca”).
# Wcześniej na sztywno 2025 (seed SIM) — teraz bieżący rok kalendarzowy.
def _default_finance_year() -> int:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).year


SIM_FINANCE_YEAR = 2025  # legacy alias; nie używaj do nowych fallbacków


def _period_days(period_type: str, limit_days) -> int:
    try:
        if limit_days and int(limit_days) > 0:
            return int(limit_days)
    except (TypeError, ValueError):
        pass
    return {"day": 1, "week": 7, "month": 30, "year": 365, "custom": 7}.get(period_type, 7)


def _period_label(period_type: str, days: int) -> str:
    return {
        "day": "ostatni dzień",
        "week": "ostatni tydzień",
        "month": "ostatni miesiąc",
        "year": "ostatni rok",
        "custom": f"ostatnie {days} dni",
    }.get(period_type, f"ostatnie {days} dni")


_MONTHS_PL = {
    "styczen": 1, "stycznia": 1, "sty": 1,
    "luty": 2, "lutego": 2, "lut": 2,
    "marzec": 3, "marca": 3, "mar": 3,
    "kwiecien": 4, "kwietnia": 4, "kwi": 4,
    "maj": 5, "maja": 5,
    "czerwiec": 6, "czerwca": 6, "cze": 6,
    "lipiec": 7, "lipca": 7, "lip": 7,
    "sierpien": 8, "sierpnia": 8, "sie": 8,
    "wrzesien": 9, "wrzesnia": 9, "wrz": 9,
    "pazdziernik": 10, "pazdziernika": 10, "paz": 10,
    "listopad": 11, "listopada": 11, "lis": 11,
    "grudzien": 12, "grudnia": 12, "grudznia": 12, "gru": 12,
}
_MONTH_NAMES_PL = [
    "", "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
    "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
]


def _strip_pl_month(s: str) -> str:
    t = (s or "").lower().strip()
    for a, b in (("ą", "a"), ("ć", "c"), ("ę", "e"), ("ł", "l"), ("ń", "n"),
                 ("ó", "o"), ("ś", "s"), ("ź", "z"), ("ż", "z")):
        t = t.replace(a, b)
    return t


def _resolve_period_window(
    period_type: Optional[str] = None,
    limit_days=None,
    period_hint: Optional[str] = None,
):
    """Zwraca (since_iso, until_iso, label). Obsługuje miesiące kalendarzowe (lipiec, lipiec 2025, 2026-07)."""
    from datetime import datetime, timezone, timedelta
    from calendar import monthrange

    now = datetime.now(timezone.utc)
    hint = (period_hint or "").strip()

    # YYYY-MM
    m_iso = re.match(r"^(\d{4})-(\d{1,2})$", hint)
    if m_iso:
        y, mo = int(m_iso.group(1)), int(m_iso.group(2))
        if 1 <= mo <= 12:
            last = monthrange(y, mo)[1]
            since = datetime(y, mo, 1, tzinfo=timezone.utc)
            until = datetime(y, mo, last, 23, 59, 59, tzinfo=timezone.utc)
            return since.isoformat(), until.isoformat(), f"{_MONTH_NAMES_PL[mo]} {y}"

    # rok w tekście (np. „lipiec 2025”, „zyski z lipca 2025”)
    y_hint = None
    m_yr = re.search(r"(20\d{2})", hint)
    if m_yr:
        y_hint = int(m_yr.group(1))

    # nazwa miesiąca PL — szukaj w całym tekście (nie tylko exact match)
    # UWAGA: nie używaj 3-literowych skrótów (sie=się→fałszywy sierpień, lip, mar…)
    key = _strip_pl_month(hint)
    mo = None
    month_tokens = sorted(
        ((n, num) for n, num in _MONTHS_PL.items() if len(n) >= 4 or n in ("maj",)),
        key=lambda kv: -len(kv[0]),
    )
    for name, num in month_tokens:
        if name == "sie":
            continue  # „się” po strip → sie
        if len(name) <= 3:
            if re.search(rf"\b{re.escape(name)}\b", key):
                mo = num
                break
        elif name in key:
            mo = num
            break
    if mo is None and key in _MONTHS_PL and key != "sie":
        mo = _MONTHS_PL[key]

    if mo is not None:
        # Bez roku w komendzie → bieżący rok kalendarzowy.
        y = y_hint if y_hint is not None else _default_finance_year()
        last = monthrange(y, mo)[1]
        since = datetime(y, mo, 1, tzinfo=timezone.utc)
        until = datetime(y, mo, last, 23, 59, 59, tzinfo=timezone.utc)
        return since.isoformat(), until.isoformat(), f"{_MONTH_NAMES_PL[mo]} {y}"

    # sam rok: „2025” / „rok 2025” / „w 2025 roku”
    if y_hint is not None and mo is None:
        since = datetime(y_hint, 1, 1, tzinfo=timezone.utc)
        until = datetime(y_hint, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        return since.isoformat(), until.isoformat(), f"rok {y_hint}"

    # period_type z UI (tydzień / miesiąc / rok) — rzeczywiste okno względem „teraz”.
    pt = (period_type or "").strip().lower()

    if pt == "week":
        until = now.replace(hour=23, minute=59, second=59, microsecond=0)
        since = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
        return (
            since.isoformat(),
            until.isoformat(),
            f"ostatnie 7 dni · {_MONTH_NAMES_PL[now.month]} {now.year}",
        )
    if pt == "month":
        y, mo = now.year, now.month
        last = monthrange(y, mo)[1]
        since = datetime(y, mo, 1, tzinfo=timezone.utc)
        until = datetime(y, mo, last, 23, 59, 59, tzinfo=timezone.utc)
        return since.isoformat(), until.isoformat(), f"{_MONTH_NAMES_PL[mo]} {y}"
    if pt == "year":
        y = now.year
        since = datetime(y, 1, 1, tzinfo=timezone.utc)
        until = datetime(y, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        return since.isoformat(), until.isoformat(), f"rok {y}"

    # Hint bez miesiąca/roku (np. „ranking sprzedaży”) — bieżący rok.
    y = _default_finance_year()
    since = datetime(y, 1, 1, tzinfo=timezone.utc)
    until = datetime(y, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    return since.isoformat(), until.isoformat(), f"rok {y}"


async def _pos_sales_in_window(
    client: httpx.AsyncClient,
    days: int = 7,
    *,
    since_iso: Optional[str] = None,
    until_iso: Optional[str] = None,
) -> list[dict]:
    from datetime import datetime, timezone, timedelta

    def _as_aware(iso: str, *, end: bool) -> datetime:
        raw = (iso or "").strip()
        if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
            raw = raw + ("T23:59:59+00:00" if end else "T00:00:00+00:00")
        elif raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    if since_iso:
        since_dt = _as_aware(since_iso, end=False)
        since = _pg_ts(since_dt.isoformat())
    else:
        since_dt = datetime.now(timezone.utc) - timedelta(days=max(1, days))
        since = _pg_ts(since_dt.isoformat())

    until_dt = _as_aware(until_iso, end=True) if until_iso else None
    until_s = _pg_ts(until_dt.isoformat()) if until_dt is not None else None
    # PostgREST: filtr zakresu — dwa parametry processed_at (bez and= + bez '+' w URL)
    params_list: list[tuple[str, str]] = [
        ("select", "pos_external_id,pos_product_id,quantity_sold,processed_at"),
        ("processed_at", f"gte.{since}"),
        ("limit", "30000"),
        ("order", "processed_at.asc"),
    ]
    if until_s:
        params_list.insert(2, ("processed_at", f"lte.{until_s}"))
    try:
        rows = await sb_get(client, "pos_sales_log", params=params_list) or []
    except httpx.HTTPStatusError:
        # Fallback: and= z timestampami Z
        try:
            and_parts = [f"processed_at.gte.{since}"]
            if until_s:
                and_parts.append(f"processed_at.lte.{until_s}")
            rows = await sb_get(client, "pos_sales_log", params={
                "select": "pos_external_id,pos_product_id,quantity_sold,processed_at",
                "and": f"({','.join(and_parts)})",
                "limit": "30000",
                "order": "processed_at.asc",
            }) or []
        except httpx.HTTPStatusError:
            return []
        if until_dt is not None:
            filtered = []
            for r in rows:
                raw = r.get("processed_at") or ""
                try:
                    dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                except Exception:
                    continue
                if dt <= until_dt:
                    filtered.append(r)
            return filtered
    # Client-side until gdy PostgREST złączył dwa processed_at w jeden
    if until_dt is not None and rows:
        filtered = []
        for r in rows:
            raw = r.get("processed_at") or ""
            try:
                dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
            except Exception:
                continue
            if dt <= until_dt:
                filtered.append(r)
        return filtered
    return rows or []


async def _aggregate_menu_sales(
    client: httpx.AsyncClient,
    days: int,
    category: Optional[str] = None,
    *,
    since_iso: Optional[str] = None,
    until_iso: Optional[str] = None,
) -> list[dict]:
    """Sumuje sprzedaż POS → menu_items (qty + revenue).

    Bierze też nieaktywne dania (soft-delete), żeby historyczny POS
    po „usuń menu / przywróć / skan” nadal się sumował po starych id/pos_id.
    """
    sales = await _pos_sales_in_window(client, days, since_iso=since_iso, until_iso=until_iso)
    try:
        menu_all = await sb_get(client, "menu_items", params={
            "select": "id,name,category,pos_id,price_pln,is_active",
            "limit": "8000",
        }) or []
    except httpx.HTTPStatusError:
        menu_all = await sb_get(client, "menu_items", params={
            "select": "id,name,category,pos_id,price_pln",
            "limit": "8000",
        }) or []
    by_pos = {m.get("pos_id"): m for m in menu_all if m.get("pos_id")}
    by_id = {m["id"]: m for m in menu_all}
    by_name = {_norm_name(m.get("name") or ""): m for m in menu_all if m.get("name")}

    totals: dict[str, dict] = {}
    unmatched = 0
    for s in sales:
        mid = None
        pos_ext = s.get("pos_external_id")
        if pos_ext and pos_ext in by_pos:
            mid = by_pos[pos_ext]["id"]
        elif s.get("pos_product_id") in by_id:
            mid = s["pos_product_id"]
        if not mid or mid not in by_id:
            unmatched += 1
            continue
        m = by_id[mid]
        if category and not _cat_matches(m.get("category") or "", category):
            continue
        qty = float(s.get("quantity_sold") or 0)
        price = float(m.get("price_pln") or 0)
        slot = totals.setdefault(mid, {
            "menu_item_id": mid,
            "name": m.get("name"),
            "category": m.get("category"),
            "qty_sold": 0.0,
            "revenue_pln": 0.0,
        })
        slot["qty_sold"] = round(slot["qty_sold"] + qty, 2)
        slot["revenue_pln"] = round(slot["revenue_pln"] + qty * price, 2)
    # Debug hint w loggerze gdy sprzedaż jest, ale nic nie zmapowano (rozjechane pos_id)
    if sales and not totals and unmatched:
        logger.warning(
            "POS: %s wierszy w oknie, 0 dopasowań do menu (pos_id/id) — "
            "uruchom seed_sim_restaurant_2025.py --wipe albo zmapuj POS w Ustawieniach.",
            len(sales),
        )
    return list(totals.values())


def _sels_from_hint(hint: Optional[str]) -> Optional[list[dict]]:
    """Z hintu „zyski z grudnia 2025” zbuduj selected_periods (gdy drzewko puste)."""
    if not hint or not str(hint).strip():
        return None
    since, until, label = _resolve_period_window("month", None, str(hint).strip())
    # Wyciągnij rok/miesiąc z okna
    try:
        y = int(since[:4])
        m = int(since[5:7])
        # cały rok?
        if since[5:10] == "01-01" and until[5:10] == "12-31":
            return [{"kind": "year", "year": y}]
        return [{"kind": "month", "year": y, "month": m}]
    except Exception:
        return None


def _merge_period_sels(p: dict) -> Optional[list[dict]]:
    """Drzewko ma priorytet; gdy puste / niespójne z transcriptem — buduj z hintu."""
    sels = _coerce_selected_periods(p.get("selected_periods"))
    hint = None
    for k in ("period_1", "note", "_transcript"):
        v = p.get(k)
        if isinstance(v, str) and v.strip():
            hint = v.strip()
            break
    from_hint = _sels_from_hint(hint)
    if not sels:
        return from_hint
    if from_hint:
        # Jeśli transcript ma jawny rok, a drzewko inny — bierz transcript (częsty bug 2026 vs 2025)
        hy = from_hint[0].get("year")
        if hy and any(int(s.get("year") or 0) != int(hy) for s in sels):
            y_in_hint = bool(re.search(r"20\d{2}", hint or ""))
            if y_in_hint:
                return from_hint
    return sels


async def _run_rank_menu_sales(
    *,
    rank: str = "best",
    period_type: str = "week",
    limit_days=None,
    top_n=None,
    category: Optional[str] = None,
    period_hint: Optional[str] = None,
    selected_periods: Optional[list] = None,
) -> dict:
    n = 5
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 20)
    except (TypeError, ValueError):
        pass
    want_best = (rank or "best").lower() != "worst"
    days = _period_days(period_type or "week", limit_days)
    sels = _coerce_selected_periods(selected_periods)

    async def _one(since_iso: str, until_iso: str, label: str) -> dict:
        rows = await _aggregate_menu_sales(
            client, days, category=category, since_iso=since_iso, until_iso=until_iso,
        )
        if not rows:
            return {
                "label": label,
                "period_label": label,
                "items": [],
                "message": f"Brak sprzedaży POS za {label}.",
            }
        rows.sort(key=lambda r: (r["qty_sold"], r["revenue_pln"]), reverse=want_best)
        top = rows[:n]
        return {"label": label, "period_label": label, "items": top, "message": ""}

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        periods_out: list[dict] = []
        if sels:
            for sel in sels[:12]:
                s, u, lbl = _window_from_period_sel(sel)
                periods_out.append(await _one(s, u, lbl))
        else:
            s, u, lbl = _resolve_period_window(period_type, limit_days, period_hint)
            periods_out.append(await _one(s, u, lbl))

        kind = "najlepiej" if want_best else "najsłabiej"
        # Bez ściany tekstu — FE pokazuje periods[].items
        return {
            "ok": True,
            "rank": "best" if want_best else "worst",
            "category": category,
            "period_label": " · ".join(p["label"] for p in periods_out),
            "periods": periods_out,
            "items": periods_out[0]["items"] if len(periods_out) == 1 else [],
            "assistant_speech": "",
            "message": f"Ranking {kind} sprzedających się dań — każdy okres osobno.",
        }


def _norm_name_key(s: str) -> str:
    t = (s or "").lower().strip()
    for a, b in (("ą", "a"), ("ć", "c"), ("ę", "e"), ("ł", "l"), ("ń", "n"),
                 ("ó", "o"), ("ś", "s"), ("ź", "z"), ("ż", "z")):
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t)


async def _lookup_unit_cost_pln(
    client: httpx.AsyncClient,
    *,
    inv_row: Optional[dict],
    item_name: str,
    around_iso: Optional[str] = None,
) -> float:
    """Koszt 1 jednostki magazynowej: unit_cost → variable_cost → invoices.note."""
    if inv_row:
        uc = float(inv_row.get("unit_cost") or 0)
        if uc > 0:
            return uc
    name_key = _norm_name_key(item_name)
    # variable_cost_entries — best-effort po nazwie w description/note
    try:
        params: list[tuple[str, str]] = [
            ("select", "amount_pln,note,description,created_at,year_month"),
            ("order", "created_at.desc"),
            ("limit", "300"),
        ]
        if around_iso:
            params.append(("created_at", f"lte.{_pg_ts(around_iso)}"))
        rows = await sb_get(client, "variable_cost_entries", params=params) or []
        for r in rows:
            blob = _norm_name_key(f"{r.get('note') or ''} {r.get('description') or ''}")
            if name_key and name_key in blob:
                amt = float(r.get("amount_pln") or 0)
                m = re.search(r"(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|szt)", blob)
                if m and amt > 0:
                    q = float(m.group(1).replace(",", "."))
                    u = m.group(2)
                    if u == "g":
                        q = q / 1000.0
                    elif u == "ml":
                        q = q / 1000.0
                    if q > 0:
                        return round(amt / q, 4)
                if amt > 0:
                    return round(amt, 4)
    except Exception:
        pass
    # invoices.note często zawiera linie „Burak 10 kg = 50.00 zł”
    try:
        params2: list[tuple[str, str]] = [
            ("select", "total_cost,note,created_at"),
            ("order", "created_at.desc"),
            ("limit", "200"),
        ]
        if around_iso:
            params2.append(("created_at", f"lte.{_pg_ts(around_iso)}"))
        invs = await sb_get(client, "invoices", params=params2) or []
        for inv in invs:
            note = _norm_name_key(inv.get("note") or "")
            if not name_key or name_key not in note:
                continue
            # szukaj fragmentu z ilością i kwotą przy nazwie
            raw = str(inv.get("note") or "")
            for part in re.split(r"[;|]", raw):
                if name_key not in _norm_name_key(part):
                    continue
                m = re.search(
                    r"(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|szt).{0,12}?(\d+(?:[.,]\d+)?)\s*zl",
                    _norm_name_key(part),
                )
                if m:
                    q = float(m.group(1).replace(",", "."))
                    u = m.group(2)
                    amt = float(m.group(3).replace(",", "."))
                    if u == "g":
                        q /= 1000.0
                    elif u == "ml":
                        q /= 1000.0
                    if q > 0 and amt > 0:
                        return round(amt / q, 4)
    except Exception:
        pass
    return 0.0


def _dish_portions_from_waste(qty: float, unit: str, portion_size_grams: float) -> float:
    """Ile porcji reprezentuje strata dania (porcja/szt albo l/ml/kg/g vs gramatura)."""
    u = (unit or "").strip().lower()
    portion_g = float(portion_size_grams or 0)
    if u in ("porcja", "porcje", "szt") or _is_piece_unit(u):
        return float(qty)
    if u in ("l", "ml") and portion_g > 0:
        ml = qty * (1000.0 if u == "l" else 1.0)
        return ml / portion_g
    if u in ("kg", "g") and portion_g > 0:
        g = qty * (1000.0 if u == "kg" else 1.0)
        return g / portion_g
    return float(qty)


def _ingredient_qty_in_inv_unit(
    qty: float,
    from_unit: str,
    inv_row: Optional[dict],
) -> float:
    """Przelicz ilość straty składnika na jednostkę magazynową (pod unit_cost)."""
    if not inv_row:
        return float(qty)
    inv_u = (inv_row.get("unit") or "").strip().lower()
    waste_u = (from_unit or inv_u or "").strip().lower()
    if not inv_u or not waste_u or inv_u == waste_u:
        return float(qty)
    size = inv_row.get("unit_weight_volume") or inv_row.get("portion_size")
    converted = _convert_culinary(float(qty), waste_u, inv_u, size)
    return float(converted) if converted is not None else float(qty)


async def _dish_waste_cost_pln(
    client: httpx.AsyncClient,
    *,
    dish_name: str,
    qty: float,
    unit: str,
    around_iso: Optional[str],
    inv_by_name: dict,
) -> float:
    """Koszt straty dania: receptura × koszt składników × przelicznik porcji/litrów."""
    menu = await sb_get(client, "menu_items", params={
        "select": "id,name,portion_size_grams",
        "limit": "5000",
    }) or []
    hit, _ = _resolve_by_fuzzy(dish_name, menu, threshold=72)
    if not hit:
        return 0.0
    mid = hit["id"]
    ings = await sb_get(client, "recipe_ingredients", params={
        "select": "ingredient_name,quantity,unit",
        "menu_item_id": f"eq.{mid}",
        "limit": "200",
    }) or []
    if not ings:
        return 0.0
    portions = _dish_portions_from_waste(qty, unit, float(hit.get("portion_size_grams") or 0))
    total = 0.0
    for ing in ings:
        iname = (ing.get("ingredient_name") or "").strip()
        if _is_porcja_row(iname):
            continue
        iq = float(ing.get("quantity") or 0) * portions
        iunit = (ing.get("unit") or "g").strip().lower()
        inv = inv_by_name.get(_norm_name_key(iname))
        base_qty = _ingredient_qty_in_inv_unit(iq, iunit, inv)
        uc = await _lookup_unit_cost_pln(
            client, inv_row=inv, item_name=iname, around_iso=around_iso,
        )
        total += base_qty * uc
    return round(total, 2)


async def _waste_log_event_cost_pln(
    client: httpx.AsyncClient,
    w: dict,
    *,
    by_id: dict,
    by_name: dict,
    around_iso: Optional[str],
) -> tuple[float, float]:
    """Koszt jednego wpisu waste_logs → (cost_pln, unit_cost_display)."""
    name = (w.get("item_name") or "Nieznany").strip()
    qty = float(w.get("quantity") or 0)
    if qty <= 0:
        return 0.0, 0.0
    item_type = (w.get("item_type") or "ingredient").strip().lower()
    ca = str(w.get("created_at") or around_iso or "")
    inv_row = None
    iid = w.get("item_id") or (w.get("related_id") if item_type == "ingredient" else None)
    if iid and str(iid) in by_id:
        inv_row = by_id[str(iid)]
    else:
        inv_row = by_name.get(_norm_name_key(name))

    if item_type == "dish":
        cost = await _dish_waste_cost_pln(
            client,
            dish_name=name,
            qty=qty,
            unit=w.get("unit") or "porcja",
            around_iso=ca or around_iso,
            inv_by_name=by_name,
        )
        unit_cost = round(cost / qty, 4) if qty else 0.0
        return cost, unit_cost

    unit_cost = await _lookup_unit_cost_pln(
        client, inv_row=inv_row, item_name=name, around_iso=ca or around_iso,
    )
    base_qty = _ingredient_qty_in_inv_unit(qty, w.get("unit") or "", inv_row)
    return round(base_qty * unit_cost, 2), unit_cost


async def _sum_waste_logs_cost_pln(
    client: httpx.AsyncClient,
    *,
    since_iso: str,
    until_iso: str,
    d0_iso: Optional[str] = None,
    d1_iso: Optional[str] = None,
) -> dict:
    """Suma strat z waste_logs w oknie (dania + składniki, z przeliczeniem jednostek)."""
    logs = await sb_get(client, "waste_logs", params={
        "select": "item_name,quantity,unit,created_at,item_id,item_type,related_id",
        "created_at": f"gte.{_pg_ts(since_iso)}",
        "order": "created_at.desc",
        "limit": "10000",
    }) or []
    until_s = _pg_ts(until_iso) if until_iso else None
    if until_s:
        logs = [r for r in logs if str(r.get("created_at") or "") <= until_s]
    if d0_iso and d1_iso:
        logs = [
            r for r in logs
            if d0_iso <= str(r.get("created_at") or "")[:10] <= d1_iso
        ]

    inv = await sb_get(client, "inventory_items", params={
        "select": "id,name,unit_cost,unit,unit_weight_volume,portion_size",
        "limit": "5000",
    }) or []
    by_id = {str(i["id"]): i for i in inv if i.get("id")}
    by_name = {_norm_name_key(i.get("name") or ""): i for i in inv if i.get("name")}

    total = 0.0
    events = 0
    missing = 0
    for w in logs:
        cost, _uc = await _waste_log_event_cost_pln(
            client, w, by_id=by_id, by_name=by_name, around_iso=since_iso,
        )
        if cost <= 0:
            missing += 1
        else:
            total += cost
            events += 1
    return {
        "total_cost_pln": round(total, 2),
        "events_costed": events,
        "missing_unit_cost_rows": missing,
        "events_total": len(logs),
    }


async def _run_rank_waste_cost(
    *,
    period_type: str = "week",
    limit_days=None,
    top_n=None,
    period_hint: Optional[str] = None,
    selected_periods: Optional[list] = None,
) -> dict:
    """Ranking strat w zł: unit_cost / faktury / receptura dania."""
    n = 5
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 20)
    except (TypeError, ValueError):
        pass
    sels = _coerce_selected_periods(selected_periods)

    async def _one(client, since_iso: str, until_iso: str, label: str) -> dict:
        logs = await sb_get(client, "waste_logs", params={
            "select": "item_name,quantity,unit,created_at,item_id,item_type,related_id",
            "created_at": f"gte.{_pg_ts(since_iso)}",
            "order": "created_at.desc",
            "limit": "5000",
        }) or []
        until_s = _pg_ts(until_iso) if until_iso else None
        if until_s:
            logs = [r for r in logs if str(r.get("created_at") or "") <= until_s]

        inv = await sb_get(client, "inventory_items", params={
            "select": "id,name,unit_cost,unit",
            "limit": "5000",
        }) or []
        by_id = {str(i["id"]): i for i in inv if i.get("id")}
        by_name = {_norm_name_key(i.get("name") or ""): i for i in inv if i.get("name")}

        totals: dict[str, dict] = {}
        missing_cost = 0
        for w in logs:
            name = (w.get("item_name") or "Nieznany").strip()
            qty = float(w.get("quantity") or 0)
            if qty <= 0:
                continue
            ca = str(w.get("created_at") or "") or since_iso
            cost, unit_cost = await _waste_log_event_cost_pln(
                client, w, by_id=by_id, by_name=by_name, around_iso=ca,
            )
            inv_row = None
            iid = w.get("item_id") or w.get("related_id")
            if iid and str(iid) in by_id:
                inv_row = by_id[str(iid)]
            else:
                inv_row = by_name.get(_norm_name_key(name))

            if cost <= 0:
                missing_cost += 1
            key = _norm_name_key(name) or name
            slot = totals.setdefault(key, {
                "name": name,
                "qty": 0.0,
                "unit": w.get("unit") or (inv_row or {}).get("unit") or "",
                "cost_pln": 0.0,
                "unit_cost": unit_cost,
            })
            slot["qty"] = round(slot["qty"] + qty, 2)
            slot["cost_pln"] = round(slot["cost_pln"] + cost, 2)
            if unit_cost > 0:
                slot["unit_cost"] = unit_cost

        rows = sorted(totals.values(), key=lambda r: r["cost_pln"], reverse=True)
        top = rows[:n]
        total_pln = round(sum(r["cost_pln"] for r in rows), 2)
        return {
            "label": label,
            "period_label": label,
            "items": top,
            "total_cost_pln": total_pln,
            "missing_unit_cost_rows": missing_cost,
            "message": "",
        }

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        periods_out: list[dict] = []
        if sels:
            for sel in sels[:12]:
                s, u, lbl = _window_from_period_sel(sel)
                periods_out.append(await _one(client, s, u, lbl))
        else:
            s, u, lbl = _resolve_period_window(period_type, limit_days, period_hint)
            periods_out.append(await _one(client, s, u, lbl))

        return {
            "ok": True,
            "period_label": " · ".join(p["label"] for p in periods_out),
            "periods": periods_out,
            "items": periods_out[0]["items"] if len(periods_out) == 1 else [],
            "total_cost_pln": periods_out[0]["total_cost_pln"] if len(periods_out) == 1 else None,
            "assistant_speech": "",
            "message": "Straty w złotówkach — każdy okres osobno.",
        }


async def _run_rank_dead_menu(
    *,
    period_type: str = "week",
    limit_days=None,
    top_n=None,
    category: Optional[str] = None,
    period_hint: Optional[str] = None,
    selected_periods: Optional[list] = None,
) -> dict:
    """Najsłabiej sprzedające się dania (z qty>0) — nie „zero sprzedaży”."""
    n = 8
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 30)
    except (TypeError, ValueError):
        pass
    days = _period_days(period_type or "week", limit_days)
    sels = _coerce_selected_periods(selected_periods)

    async def _one(client, since_iso: str, until_iso: str, label: str) -> dict:
        sold = await _aggregate_menu_sales(
            client, days, category=category, since_iso=since_iso, until_iso=until_iso,
        )
        rows = [r for r in sold if float(r.get("qty_sold") or 0) > 0]
        if category:
            rows = [r for r in rows if _cat_matches(r.get("category") or "", category)]
        rows.sort(key=lambda r: (float(r.get("qty_sold") or 0), float(r.get("revenue_pln") or 0)))
        top = rows[:n]
        if not top:
            return {
                "label": label,
                "period_label": label,
                "items": [],
                "message": f"Brak sprzedaży POS za {label} — nie da się zbudować rankingu najsłabszych.",
            }
        return {"label": label, "period_label": label, "items": top, "message": ""}

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        periods_out: list[dict] = []
        if sels:
            for sel in sels[:12]:
                s, u, lbl = _window_from_period_sel(sel)
                periods_out.append(await _one(client, s, u, lbl))
        else:
            s, u, lbl = _resolve_period_window(period_type, limit_days, period_hint)
            periods_out.append(await _one(client, s, u, lbl))

        return {
            "ok": True,
            "period_label": " · ".join(p["label"] for p in periods_out),
            "category": category,
            "periods": periods_out,
            "items": periods_out[0]["items"] if len(periods_out) == 1 else [],
            "assistant_speech": "",
            "message": "Najsłabiej sprzedające się dania — każdy okres osobno.",
        }


async def _run_list_expiring_soon(
    *,
    within_days=3,
    top_n=None,
) -> dict:
    """Drabina dat ważności z warehouse_inventory (bez żargonu T-N)."""
    from datetime import date as _date, timedelta

    try:
        horizon = max(1, min(int(within_days or 3), 14))
    except (TypeError, ValueError):
        horizon = 3
    n = 20
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 40)
    except (TypeError, ValueError):
        pass

    today = _date.today()
    until = today + timedelta(days=horizon)

    def _ladder_label(days_left: int) -> str:
        if days_left <= 0:
            return "dziś"
        if days_left == 1:
            return "jutro"
        if days_left == 2:
            return "pojutrze"
        return f"za {days_left} dni"

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        try:
            # Refresh endpoint: PostgREST RPC. Use sb_post() so we validate
            # the rest path (prevents SSRF-style URL construction findings).
            await sb_post(client, "rpc/warehouse_inventory_refresh_status", {})
        except Exception:
            pass

        rows = await sb_get(client, "warehouse_inventory", params={
            "select": "id,product_name,quantity,unit,expiration_date,status",
            "expiration_date": f"lte.{until.isoformat()}",
            "quantity": "gt.0",
            "order": "expiration_date.asc",
            "limit": "500",
        }) or []

        ladder: dict[str, list] = {}
        items = []
        for r in rows:
            try:
                exp = _date.fromisoformat(str(r.get("expiration_date"))[:10])
            except Exception:
                continue
            days_left = (exp - today).days
            if days_left < 0:
                continue
            if days_left > horizon:
                continue
            # Bogate tipy + gry: frontend pickExpiryTips (expiryTipsCatalog).
            # Tu tylko krótki fallback fazy (gdy FE nie podmieni / API klient).
            if days_left <= 1:
                tip_phase = "t1"
                tip = "T-1: ratuj agresywnie (katalog tipów w aplikacji)."
            elif days_left == 2:
                tip_phase = "t2"
                tip = "T-2: Happy Hour / przeróbka (katalog tipów w aplikacji)."
            elif days_left == 3:
                tip_phase = "t3"
                tip = "T-3: łagodna promocja / combo (katalog tipów w aplikacji)."
            else:
                tip_phase = None
                tip = "Monitoruj datę — tipy katalogowe dla T-3/T-2/T-1."
            label = _ladder_label(days_left)
            entry = {
                "id": r.get("id"),
                "name": r.get("product_name"),
                "qty": float(r.get("quantity") or 0),
                "unit": r.get("unit") or "",
                "expiration_date": exp.isoformat(),
                "days_left": days_left,
                "ladder": label,
                "tip": tip,
                "tip_phase": tip_phase,
                "tips_source": "frontend_catalog",
            }
            items.append(entry)
            ladder.setdefault(label, []).append(entry)

        items = items[:n]
        if not items:
            return {
                "ok": True,
                "within_days": horizon,
                "items": [],
                "ladder": ladder,
                "assistant_speech": "",
                "message": (
                    f"Brak partii kończących się w ciągu {horizon} dni. "
                    "Dodawaj daty ważności przy dostawie."
                ),
            }

        return {
            "ok": True,
            "within_days": horizon,
            "items": items,
            "ladder": ladder,
            "assistant_speech": "",
            "message": f"Produkty kończące się w ciągu {horizon} dni — lista poniżej.",
        }


async def _run_rank_supplier_spend(
    *,
    period_type: str = "month",
    limit_days=None,
    top_n=None,
    period_hint: Optional[str] = None,
    supplier_name: Optional[str] = None,
) -> dict:
    """Suma invoices.total_cost per dostawca w oknie."""
    since_iso, until_iso, label = _resolve_period_window(period_type, limit_days, period_hint)
    n = 5
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 20)
    except (TypeError, ValueError):
        pass
    filt = (supplier_name or "").strip().lower()

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        rows = await sb_get(client, "invoices", params={
            "select": "supplier_id,supplier_name,total_cost,created_at",
            "created_at": f"gte.{since_iso}",
            "order": "created_at.desc",
            "limit": "5000",
        }) or []
        if until_iso:
            rows = [r for r in rows if str(r.get("created_at") or "") <= until_iso]

        totals: dict[str, dict] = {}
        for r in rows:
            name = (r.get("supplier_name") or "Nieznany dostawca").strip()
            if filt and filt not in name.lower() and filt not in _norm_name_key(name):
                continue
            key = str(r.get("supplier_id") or _norm_name_key(name) or name)
            slot = totals.setdefault(key, {
                "supplier_id": r.get("supplier_id"),
                "name": name,
                "spend_pln": 0.0,
                "invoice_count": 0,
            })
            slot["spend_pln"] = round(slot["spend_pln"] + float(r.get("total_cost") or 0), 2)
            slot["invoice_count"] += 1

        ranked = sorted(totals.values(), key=lambda x: x["spend_pln"], reverse=True)
        top = ranked[:n]
        total = round(sum(x["spend_pln"] for x in ranked), 2)
        if not ranked:
            return {
                "ok": True,
                "period_label": label,
                "total_spend_pln": 0,
                "items": [],
                "assistant_speech": "",
                "message": f"Brak faktur za {label}. Wgraj faktury zakupowe.",
            }
        return {
            "ok": True,
            "period_label": label,
            "total_spend_pln": total,
            "items": top,
            "assistant_speech": "",
            "message": f"Wydatki u dostawców za {label} — lista poniżej.",
        }


_HACCP_RULES = [
    {
        "id": "fifo",
        "keys": ["fifo", "kolejnosc", "rotacja"],
        "title": "Zasada FIFO",
        "body": (
            "First In, First Out: produkty z najkrótszą datą ważności na przód półki "
            "i zużywane jako pierwsze. Etykietuj każdą partię datą przyjęcia."
        ),
    },
    {
        "id": "ryby",
        "keys": ["ryb", "losos", "dorsz", "krewet", "malz"],
        "title": "Świeże ryby",
        "body": "Lodówka 0–2°C, osobna strefa. Zużyj w 24–48 h. Nie trzymaj na rampie w upale.",
    },
    {
        "id": "mieso",
        "keys": ["mieso", "wolow", "wieprz", "kurczak", "indyk"],
        "title": "Mięso świeże",
        "body": "0–4°C, dolna półka. Surowy kurczak osobno. Po otwarciu 24–48 h lub mrożenie.",
    },
    {
        "id": "nabial",
        "keys": ["mleko", "smietan", "jogurt", "ser", "twarog", "jajk"],
        "title": "Nabiał",
        "body": "2–6°C, nie w drzwiach lodówki. Po otwarciu mleka/śmietany — 2–3 dni.",
    },
    {
        "id": "salata",
        "keys": ["salat", "rukol", "szpinak"],
        "title": "Sałaty",
        "body": "Przed podaniem namocz w zimnej wodzie — będą chrupiące. Osusz, trzymaj 2–5°C.",
    },
    {
        "id": "ryz",
        "keys": ["ryz", "risotto"],
        "title": "Ryż ugotowany",
        "body": "Szybko schłodź. Do sypkości przepłucz zimną wodą. W lodówce max 24 h.",
    },
    {
        "id": "polprodukt",
        "keys": ["sos", "wywar", "bulion", "polprodukt", "gulasz"],
        "title": "Półprodukty / sosy",
        "body": "Schłodź do ≤5°C w max 2 h. Etykieta: data produkcji + ważności. Regeneracja ≥75°C.",
    },
]


def _run_haccp_tip(query: str) -> dict:
    q = _norm_name_key(query or "")
    hits = []
    for rule in _HACCP_RULES:
        if any(k in q for k in rule["keys"]):
            hits.append(rule)
    if not hits:
        hits = [_HACCP_RULES[0], _HACCP_RULES[1], _HACCP_RULES[2]]
    hits = hits[:3]
    lines = " ".join(f"{h['title']}: {h['body']}" for h in hits)
    topic = query.strip() or "ogólne"
    return {
        "ok": True,
        "items": [{"name": h["title"], "tip": h["body"], "id": h["id"]} for h in hits],
        "assistant_speech": f"HACCP / przechowywanie ({topic}): {lines}",
    }


async def _run_manager_core_alerts(
    *,
    period_type: str = "week",
    limit_days=None,
    period_hint: Optional[str] = None,
) -> dict:
    """4 pary CORE: POS↔Mag, Mag↔Waste/expiry, Waste↔zł, Mag↔Dostawy (overstock)."""
    from datetime import date as _date, timedelta

    since_iso, until_iso, label = _resolve_period_window(period_type, limit_days, period_hint)
    days = _period_days(period_type or "week", limit_days)
    alerts: list[dict] = []

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        # 1) POS ↔ Magazyn — top dish coverage in hours (rough)
        sales = await _aggregate_menu_sales(
            client, days, since_iso=since_iso, until_iso=until_iso,
        )
        sales_sorted = sorted(sales, key=lambda r: r.get("qty_sold", 0), reverse=True)[:5]
        inv = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,min_quantity,unit",
            "limit": "3000",
        }) or []
        inv_by_name = {_norm_name_key(i.get("name") or ""): i for i in inv}
        recipes = await sb_get(client, "recipe_ingredients", params={
            "select": "menu_item_id,ingredient_name,quantity,inventory_item_id",
            "limit": "8000",
        }) or []
        by_menu: dict[str, list] = {}
        for ri in recipes:
            mid = ri.get("menu_item_id")
            if mid:
                by_menu.setdefault(mid, []).append(ri)

        hours_open = max(1.0, float(days) * 8.0)  # rough service hours in window
        for dish in sales_sorted:
            mid = dish.get("menu_item_id")
            qty_sold = float(dish.get("qty_sold") or 0)
            if qty_sold < 3:
                continue
            rate = qty_sold / hours_open  # portions per hour
            if rate <= 0:
                continue
            # weakest ingredient coverage
            worst_h = None
            worst_name = None
            for ri in by_menu.get(mid, []):
                iname = ri.get("ingredient_name") or ""
                inv_row = inv_by_name.get(_norm_name_key(iname))
                if not inv_row and ri.get("inventory_item_id"):
                    inv_row = next((x for x in inv if str(x.get("id")) == str(ri.get("inventory_item_id"))), None)
                if not inv_row:
                    continue
                per_portion = float(ri.get("quantity") or 0) or 1.0
                stock = float(inv_row.get("quantity") or 0)
                portions_left = stock / per_portion if per_portion > 0 else 0
                hours_left = portions_left / rate if rate > 0 else 999
                if worst_h is None or hours_left < worst_h:
                    worst_h = hours_left
                    worst_name = inv_row.get("name") or iname
            if worst_h is not None and worst_h < 3:
                alerts.append({
                    "pair": "POS↔Magazyn",
                    "name": dish.get("name"),
                    "detail": (
                        f"Przy obecnym tempie zapas „{worst_name}” wystarczy ~{worst_h:.1f} h "
                        f"({dish.get('qty_sold')} szt sprzedanych w okresie)."
                    ),
                    "severity": "critical" if worst_h < 1.5 else "warn",
                })

        # 2) Magazyn ↔ Waste / expiry — batches ≤48h
        today = _date.today()
        batches = await sb_get(client, "warehouse_inventory", params={
            "select": "product_name,quantity,unit,expiration_date",
            "expiration_date": f"lte.{(today + timedelta(days=2)).isoformat()}",
            "quantity": "gt.0",
            "limit": "200",
        }) or []
        for b in batches[:8]:
            try:
                exp = _date.fromisoformat(str(b.get("expiration_date"))[:10])
            except Exception:
                continue
            left = (exp - today).days
            if left < 0:
                continue
            alerts.append({
                "pair": "Magazyn↔Ważność",
                "name": b.get("product_name"),
                "detail": (
                    f"Partia {b.get('quantity')} {b.get('unit') or ''} kończy się za {left} dni "
                    f"({exp.isoformat()}). Rozważ promocję / przeróbkę."
                ),
                "severity": "critical" if left <= 1 else "warn",
            })

        # 3) Waste ↔ zł — threshold
        waste = await _run_rank_waste_cost(
            period_type=period_type, limit_days=limit_days, top_n=3, period_hint=period_hint,
        )
        total_w = float(waste.get("total_cost_pln") or 0)
        if total_w >= 100:
            top = (waste.get("items") or [{}])[0]
            alerts.append({
                "pair": "Straty↔Zł",
                "name": top.get("name") or "Kosz",
                "detail": (
                    f"Za {label} strata ~{total_w:.0f} zł. Lider: {top.get('name')} "
                    f"({top.get('cost_pln', 0):.0f} zł)."
                ),
                "severity": "critical" if total_w >= 500 else "warn",
            })

        # 4) Magazyn ↔ Dostawy — recent invoice while stock >> min
        invs = await sb_get(client, "invoices", params={
            "select": "supplier_name,total_cost,created_at,note",
            "created_at": f"gte.{(today - timedelta(days=3)).isoformat()}",
            "order": "created_at.desc",
            "limit": "20",
        }) or []
        overstock = [
            i for i in inv
            if float(i.get("min_quantity") or 0) > 0
            and float(i.get("quantity") or 0) >= float(i.get("min_quantity") or 0) * 3
        ][:5]
        if invs and overstock:
            names = ", ".join(o.get("name") or "?" for o in overstock[:3])
            alerts.append({
                "pair": "Magazyn↔Dostawy",
                "name": "Możliwe dublowanie",
                "detail": (
                    f"W ostatnich 3 dniach są nowe faktury, a stany wysokie (×3 próg): {names}. "
                    "Sprawdź, czy nie zamawiasz w nadmiarze."
                ),
                "severity": "info",
            })

        # 5) POS ↔ Waste — dead menu + waste money both present
        dead = await _run_rank_dead_menu(
            period_type=period_type, limit_days=limit_days, top_n=3, period_hint=period_hint,
        )
        weak = dead.get("items") or []
        if len(weak) >= 3 and total_w >= 50:
            dnames = ", ".join(x.get("name") or "?" for x in weak[:3])
            alerts.append({
                "pair": "POS↔Straty",
                "name": "Słaba sprzedaż + kosz",
                "detail": (
                    f"Najsłabsze dania: {dnames}… przy stratach {total_w:.0f} zł. "
                    "Rozważ rotację karty i mniejsze zamówienia składników."
                ),
                "severity": "warn",
            })

    if not alerts:
        return {
            "ok": True,
            "period_label": label,
            "items": [],
            "alerts": [],
            "assistant_speech": (
                f"Za {label} brak krytycznych alertów korelacji CORE. "
                "Magazyn, POS i straty wyglądają stabilnie."
            ),
        }

    alerts.sort(key=lambda a: {"critical": 0, "warn": 1, "info": 2}.get(a.get("severity"), 3))
    lines = "; ".join(f"[{a['pair']}] {a['name']}: {a['detail']}" for a in alerts[:6])
    return {
        "ok": True,
        "period_label": label,
        "items": [{"name": a["name"], "detail": a["detail"], "pair": a["pair"], "severity": a["severity"]} for a in alerts],
        "alerts": alerts,
        "assistant_speech": f"Alerty managera ({label}): {lines}",
    }


async def _run_rank_inventory_usage(
    *,
    rank: str = "best",
    period_type: str = "week",
    limit_days=None,
    top_n=None,
    category: Optional[str] = None,
    period_hint: Optional[str] = None,
    selected_periods: Optional[list] = None,
) -> dict:
    """Zużycie magazynu = sprzedaż dań × gramatury z recipe_ingredients."""
    since_iso, until_iso, label = _resolve_selected_or_hint(
        period_type, limit_days, period_hint, selected_periods,
    )
    days = _period_days(period_type or "week", limit_days)
    n = 5
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 20)
    except (TypeError, ValueError):
        pass
    want_most = (rank or "best").lower() != "worst"

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        dish_sales = await _aggregate_menu_sales(
            client, days, category=None, since_iso=since_iso, until_iso=until_iso,
        )
        if not dish_sales:
            return {
                "ok": True,
                "period_label": label,
                "rank": "best" if want_most else "worst",
                "items": [],
                "assistant_speech": (
                    f"Brak sprzedaży POS za {label} — nie policzę zużycia magazynu."
                ),
            }
        ri = await sb_get(client, "recipe_ingredients", params={
            "select": "menu_item_id,ingredient_name,quantity,unit",
            "limit": "30000",
        }) or []
        by_menu: dict[str, list] = {}
        for r in ri:
            by_menu.setdefault(r["menu_item_id"], []).append(r)

        inv = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,unit,inventory_categories(name)",
            "limit": "5000",
        }) or []
        inv_norm = {_norm_pl(r["name"]): r for r in inv if r.get("name")}

        usage: dict[str, dict] = {}
        for d in dish_sales:
            sold = float(d.get("qty_sold") or 0)
            if sold <= 0:
                continue
            for ing in by_menu.get(d["menu_item_id"], []):
                iname = (ing.get("ingredient_name") or "").strip()
                key = _norm_pl(iname)
                if not key:
                    continue
                used = float(ing.get("quantity") or 0) * sold
                if key not in usage:
                    matched = inv_norm.get(key)
                    if not matched:
                        hit, _ = _fuzzy_match(key, list(inv_norm.keys()), threshold=78)
                        matched = inv_norm.get(hit) if hit else None
                    cat_name = None
                    if matched:
                        cats = matched.get("inventory_categories")
                        if isinstance(cats, dict):
                            cat_name = cats.get("name")
                        elif isinstance(cats, list) and cats:
                            cat_name = cats[0].get("name")
                    usage[key] = {
                        "ingredient_name": iname,
                        "unit": ing.get("unit") or "g",
                        "qty_used": 0.0,
                        "inventory_id": (matched or {}).get("id"),
                        "inventory_name": (matched or {}).get("name") or iname,
                        "category": cat_name,
                        "current_stock": float((matched or {}).get("quantity") or 0),
                    }
                usage[key]["qty_used"] = round(usage[key]["qty_used"] + used, 3)

        rows = list(usage.values())
        if category:
            rows = [
                r for r in rows
                if _cat_matches(r.get("category") or r.get("ingredient_name") or "", category)
            ]
        if not rows:
            return {
                "ok": True,
                "period_label": label,
                "rank": "best" if want_most else "worst",
                "items": [],
                "assistant_speech": (
                    f"Nie udało się zmapować zużycia składników za {label}. "
                    "Upewnij się, że dania mają receptury w Menu."
                ),
            }
        rows.sort(key=lambda r: r["qty_used"], reverse=want_most)
        top = rows[:n]
        kind = "największe" if want_most else "najmniejsze"
        lines = ", ".join(
            f"{i+1}. {r['inventory_name']} ({r['qty_used']:g} {r['unit']})"
            for i, r in enumerate(top)
        )
        speech = f"Za {label} {kind} zużycie z magazynu: {lines}."
        return {
            "ok": True,
            "period_label": label,
            "rank": "best" if want_most else "worst",
            "category": category,
            "items": top,
            "assistant_speech": speech,
        }


def _report_net(r: dict) -> float:
    return (float(r.get("total_revenue") or 0)
            - float(r.get("total_waste_cost") or 0)
            - float(r.get("total_invoice_cost") or 0))


def _agg_reports(rows: list) -> dict:
    rev = round(sum(float(r.get("total_revenue") or 0) for r in rows), 2)
    waste = round(sum(float(r.get("total_waste_cost") or 0) for r in rows), 2)
    inv = round(sum(float(r.get("total_invoice_cost") or 0) for r in rows), 2)
    return {
        "total_revenue": rev, "total_waste_cost": waste, "total_invoice_cost": inv,
        "net_profit": round(rev - waste - inv, 2), "days_count": len(rows),
    }


def _iter_days(d0, d1):
    from datetime import timedelta
    cur = d0
    while cur <= d1:
        yield cur
        cur += timedelta(days=1)


async def _compute_true_pnl(
    client: httpx.AsyncClient,
    since_d: str,
    until_d: str,
) -> dict:
    """Rzetelny P&L okna [since_d, until_d] (YYYY-MM-DD, włącznie).

    - Przychód: POS / revenue_entries / daily_reports
    - Koszty stałe: fixed_costs × proporcja dni
    - Koszty zmienne brutto: variable_cost_entries type≠waste × proporcja dni
      (zakupy materiałów — tu już jest koszt zapłaconych produktów)
    - Straty produktowe: waste_logs (dania+składniki, receptura/unit_cost)
    - Koszty zmienne netto = max(0, zmienne_brutto − straty)
      (nie liczymy drugi raz produktów już zapłaconych w zakupach)
    - Zysk = przychód − stałe − straty − zmienne_netto
            = przychód − stałe − zmienne_brutto
    """
    from datetime import date as _date
    from calendar import monthrange
    from collections import defaultdict

    d0 = _date.fromisoformat(since_d[:10])
    d1 = _date.fromisoformat(until_d[:10])
    if d1 < d0:
        d0, d1 = d1, d0
    days_selected = (d1 - d0).days + 1
    since_iso = _pg_ts(f"{d0.isoformat()}T00:00:00+00:00")
    until_iso = _pg_ts(f"{d1.isoformat()}T23:59:59+00:00")

    # ── Miesiące przecinające okno ──
    months: dict[str, int] = defaultdict(int)  # YYYY-MM -> days overlap
    for d in _iter_days(d0, d1):
        months[f"{d.year:04d}-{d.month:02d}"] += 1

    # ── Przychód ──
    # 1) POS (ta sama baza co rankingi menu) — zawsze w oknie since..until
    # 2) revenue_entries z created_at w oknie
    # 3) year_month + data w note (seed SIM)
    # 4) daily_reports
    revenue = 0.0
    revenue_source = "none"
    try:
        menu_agg = await _aggregate_menu_sales(
            client,
            days_selected,
            since_iso=since_iso,
            until_iso=until_iso,
        )
        pos_rev = round(sum(float(r.get("revenue_pln") or 0) for r in menu_agg), 2)
        if pos_rev > 0:
            revenue = pos_rev
            revenue_source = "pos_sales_log"
    except Exception:
        pass

    seen_rev = 0.0
    if revenue <= 0:
        try:
            rev_rows = await sb_get(client, "revenue_entries", params=[
                ("select", "amount_pln,created_at,year_month"),
                ("created_at", f"gte.{since_iso}"),
                ("created_at", f"lte.{until_iso}"),
                ("limit", "20000"),
            ]) or []
            for r in rev_rows:
                ca = str(r.get("created_at") or "")
                if ca and d0.isoformat() <= ca[:10] <= d1.isoformat():
                    revenue += float(r.get("amount_pln") or 0)
                    seen_rev += 1
            if revenue > 0:
                revenue_source = "revenue_entries"
        except Exception:
            # Fallback bez podwójnego created_at
            try:
                rev_rows = await sb_get(client, "revenue_entries", params={
                    "select": "amount_pln,created_at,year_month",
                    "created_at": f"gte.{since_iso}",
                    "limit": "20000",
                }) or []
                for r in rev_rows:
                    ca = str(r.get("created_at") or "")
                    if ca and d0.isoformat() <= ca[:10] <= d1.isoformat():
                        revenue += float(r.get("amount_pln") or 0)
                        seen_rev += 1
                if revenue > 0:
                    revenue_source = "revenue_entries"
            except Exception:
                pass

    # dociągnij po year_month (gdy created_at = data insertu, a nie dzień sprzedaży)
    if revenue <= 0:
        for ym in months:
            try:
                ym_rows = await sb_get(client, "revenue_entries", params={
                    "select": "amount_pln,created_at,year_month,note,description",
                    "year_month": f"eq.{ym}",
                    "limit": "5000",
                }) or []
            except Exception:
                ym_rows = []
            for r in ym_rows:
                ca = str(r.get("created_at") or "")
                if ca and d0.isoformat() <= ca[:10] <= d1.isoformat():
                    continue  # już w sumie z created_at
                note = str(r.get("note") or "") + " " + str(r.get("description") or "")
                mday = re.search(r"(20\d{2}-\d{2}-\d{2})", note)
                if mday:
                    day_s = mday.group(1)
                    if d0.isoformat() <= day_s <= d1.isoformat():
                        revenue += float(r.get("amount_pln") or 0)
                    continue
                y, m = int(ym[:4]), int(ym[5:7])
                dim = monthrange(y, m)[1]
                overlap = months[ym]
                if dim and seen_rev == 0:
                    revenue += float(r.get("amount_pln") or 0) * (overlap / dim)
        if revenue > 0:
            revenue_source = "revenue_entries_ym"

    if revenue <= 0:
        # fallback: daily_reports
        try:
            dr = await sb_get(client, "daily_reports", params={
                "select": "date,total_revenue",
                "date": f"gte.{d0.isoformat()}",
                "limit": "400",
            }) or []
            for r in dr:
                if (r.get("date") or "") <= d1.isoformat():
                    revenue += float(r.get("total_revenue") or 0)
            if revenue > 0:
                revenue_source = "daily_reports"
        except Exception:
            pass
    revenue = round(revenue, 2)

    # ── Koszty stałe (proporcja) ──
    fixed_alloc = 0.0
    fixed_detail = []
    for ym, overlap_days in months.items():
        y, m = int(ym[:4]), int(ym[5:7])
        dim = monthrange(y, m)[1]
        rows = await sb_get(client, "fixed_costs", params={
            "select": "amount_pln,name,year_month",
            "year_month": f"eq.{ym}",
            "limit": "2000",
        }) or []
        month_sum = round(sum(float(r.get("amount_pln") or 0) for r in rows), 2)
        part = round(month_sum * (overlap_days / dim), 2) if dim else 0.0
        fixed_alloc += part
        if month_sum:
            fixed_detail.append({
                "year_month": ym, "month_total": month_sum,
                "days_in_month": dim, "days_selected": overlap_days, "allocated": part,
            })
    fixed_alloc = round(fixed_alloc, 2)

    # ── Koszty zmienne bez waste (proporcja po year_month) — brutto / zakupy ──
    variable_gross = 0.0
    variable_detail = []
    for ym, overlap_days in months.items():
        y, m = int(ym[:4]), int(ym[5:7])
        dim = monthrange(y, m)[1]
        rows = await sb_get(client, "variable_cost_entries", params={
            "select": "amount_pln,type,name,year_month",
            "year_month": f"eq.{ym}",
            "limit": "5000",
        }) or []
        month_sum = round(sum(
            float(r.get("amount_pln") or 0)
            for r in rows
            if str(r.get("type") or "").lower() != "waste"
        ), 2)
        part = round(month_sum * (overlap_days / dim), 2) if dim else 0.0
        variable_gross += part
        if month_sum:
            variable_detail.append({
                "year_month": ym, "month_total": month_sum,
                "days_in_month": dim, "days_selected": overlap_days, "allocated": part,
            })
    variable_gross = round(variable_gross, 2)

    # ── Straty produktowe (waste_logs: dania + składniki) ──
    waste_actual = 0.0
    waste_meta: dict = {}
    try:
        waste_meta = await _sum_waste_logs_cost_pln(
            client,
            since_iso=since_iso,
            until_iso=until_iso,
            d0_iso=d0.isoformat(),
            d1_iso=d1.isoformat(),
        )
        waste_actual = float(waste_meta.get("total_cost_pln") or 0)
    except Exception:
        waste_actual = 0.0

    if waste_actual <= 0:
        # fallback: variable type=waste w oknie po created_at
        try:
            wrows = await sb_get(client, "variable_cost_entries", params={
                "select": "amount_pln,type,created_at",
                "type": "eq.waste",
                "created_at": f"gte.{since_iso}",
                "limit": "5000",
            }) or []
            for r in wrows:
                ca = str(r.get("created_at") or "")
                if ca and d0.isoformat() <= ca[:10] <= d1.isoformat():
                    waste_actual += float(r.get("amount_pln") or 0)
        except Exception:
            pass
    waste_actual = round(waste_actual, 2)

    # Zmienne netto: zakupy już zawierają koszt zmarnowanych produktów —
    # odejmujemy straty od zmiennych, żeby nie liczyć ich drugi raz.
    variable_net = round(max(0.0, variable_gross - waste_actual), 2)
    net_profit = round(revenue - fixed_alloc - waste_actual - variable_net, 2)
    # Równoważnie: revenue - fixed - variable_gross
    operating = round(revenue - fixed_alloc - variable_gross, 2)

    return {
        "since": d0.isoformat(),
        "until": d1.isoformat(),
        "days_count": days_selected,
        "total_revenue": revenue,
        "revenue_source": revenue_source,
        "fixed_costs_allocated": fixed_alloc,
        "variable_costs_allocated": variable_gross,  # brutto (zakupy) — kompatybilność
        "variable_costs_gross": variable_gross,
        "variable_costs_net": variable_net,
        "total_waste_cost": waste_actual,
        "operating_profit": operating,
        "net_profit": net_profit,
        # aliases for older UI
        "total_invoice_cost": variable_gross,
        "fixed_detail": fixed_detail,
        "variable_detail": variable_detail,
        "waste_events_costed": waste_meta.get("events_costed"),
        "waste_events_total": waste_meta.get("events_total"),
    }


def _coerce_selected_periods(raw) -> Optional[list[dict]]:
    """Normalizuje selected_periods z frontu (drzewko dat) do listy dictów."""
    if not raw or not isinstance(raw, list):
        return None
    out: list[dict] = []
    for sel in raw[:24]:
        if not isinstance(sel, dict):
            continue
        kind = str(sel.get("kind") or "month").strip().lower()
        if kind not in ("year", "month", "week", "day"):
            continue
        try:
            y = int(sel.get("year"))
        except (TypeError, ValueError):
            continue
        if y < 2000 or y > 2100:
            continue
        item: dict = {"kind": kind, "year": y}
        if kind in ("month", "week", "day"):
            try:
                m = int(sel.get("month") or 0)
            except (TypeError, ValueError):
                continue
            if not (1 <= m <= 12):
                continue
            item["month"] = m
        if kind == "week":
            try:
                item["week"] = max(1, min(5, int(sel.get("week") or 1)))
            except (TypeError, ValueError):
                item["week"] = 1
        if kind == "day":
            try:
                item["day"] = max(1, min(31, int(sel.get("day") or 1)))
            except (TypeError, ValueError):
                item["day"] = 1
        out.append(item)
    return out or None


def _window_from_period_sel(sel: dict) -> tuple[str, str, str]:
    """{kind, year, month?, week?, day?} → (since_iso, until_iso, label) z czasem UTC (Z)."""
    from calendar import monthrange
    kind = (sel.get("kind") or "month").lower()
    y = int(sel.get("year") or _default_finance_year())
    if kind == "year":
        return (
            f"{y}-01-01T00:00:00Z",
            f"{y}-12-31T23:59:59Z",
            f"rok {y}",
        )
    m = int(sel.get("month") or 1)
    last = monthrange(y, m)[1]
    if kind == "month":
        return (
            f"{y}-{m:02d}-01T00:00:00Z",
            f"{y}-{m:02d}-{last:02d}T23:59:59Z",
            f"{_MONTH_NAMES_PL[m]} {y}",
        )
    if kind == "day":
        d = max(1, min(last, int(sel.get("day") or 1)))
        return (
            f"{y}-{m:02d}-{d:02d}T00:00:00Z",
            f"{y}-{m:02d}-{d:02d}T23:59:59Z",
            f"{d:02d}.{m:02d}.{y}",
        )
    w = max(1, min(5, int(sel.get("week") or 1)))
    start_day = 1 + (w - 1) * 7
    end_day = min(last, start_day + 6)
    if start_day > last:
        start_day = max(1, last - 6)
        end_day = last
    return (
        f"{y}-{m:02d}-{start_day:02d}T00:00:00Z",
        f"{y}-{m:02d}-{end_day:02d}T23:59:59Z",
        f"tydzień {w} · {_MONTH_NAMES_PL[m]} {y}",
    )


def _resolve_selected_or_hint(
    period_type: Optional[str],
    limit_days,
    period_hint: Optional[str],
    selected_periods: Optional[list],
) -> tuple[str, str, str]:
    """Jedno okno: suma zaznaczeń z drzewka (min..max) albo hint/period_type."""
    coerced = _coerce_selected_periods(selected_periods)
    if coerced:
        ranges = []
        labels = []
        for sel in coerced:
            s, u, lbl = _window_from_period_sel(sel)
            ranges.append((s, u))
            labels.append(lbl)
        if ranges:
            since = min(r[0] for r in ranges)
            until = max(r[1] for r in ranges)
            return since, until, " + ".join(labels)
    return _resolve_period_window(period_type, limit_days, period_hint)


async def _run_period_analysis(
    period_type: str,
    limit_days,
    period_hint: Optional[str] = None,
    selected_periods: Optional[list] = None,
) -> dict:
    """Analiza P&L. selected_periods: lista {kind, year, month?, week?, day?} z pickera."""
    from datetime import date as _date
    from calendar import monthrange

    async def _window_from_sel(sel: dict) -> tuple[str, str, str]:
        return _window_from_period_sel(sel if isinstance(sel, dict) else {})


    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        await _check_ai_access(client)

        periods_out = []
        sels = _coerce_selected_periods(selected_periods)
        if sels:
            for sel in sels[:12]:
                s, u, lbl = await _window_from_sel(sel)
                pnl = await _compute_true_pnl(client, s[:10], u[:10])
                periods_out.append({"label": lbl, "aggregates": pnl})
            label = " · ".join(p["label"] for p in periods_out)
            # NIE sumuj nakładających się okresów (rok + miesiąc = podwójne liczenie).
            # FE pokazuje każdy okres osobno; aggregates zostawiamy tylko przy 1 okresie.
            agg = periods_out[0]["aggregates"] if len(periods_out) == 1 else {
                "total_revenue": None,
                "fixed_costs_allocated": None,
                "variable_costs_allocated": None,
                "total_waste_cost": None,
                "operating_profit": None,
                "net_profit": None,
                "days_count": sum(p["aggregates"].get("days_count") or 0 for p in periods_out),
                "total_invoice_cost": None,
            }
        else:
            since_iso, until_iso, label = _resolve_period_window(period_type, limit_days, period_hint)
            pnl = await _compute_true_pnl(client, since_iso[:10], until_iso[:10])
            agg = pnl
            periods_out = [{"label": label, "aggregates": pnl}]

        # Krótki komunikat bez ściany tekstu AI
        if len(periods_out) > 1:
            speech = ""
            billing = {}
        else:
            sign = "na plusie" if (agg.get("net_profit") or 0) >= 0 else "na minusie"
            speech = (
                f"Za {label}: przychód {agg.get('total_revenue') or 0:.0f} zł, "
                f"straty {agg.get('total_waste_cost') or 0:.0f} zł, "
                f"zysk {agg.get('net_profit') or 0:.0f} zł ({sign})."
            )
            billing = {}

    return _with_billing({
        "ok": True,
        "period_label": label,
        "reports_count": agg.get("days_count", 0) if isinstance(agg, dict) else 0,
        "aggregates": agg if len(periods_out) == 1 else None,
        "periods": periods_out,
        "assistant_speech": "",
        "message": speech if speech else f"P&L — {len(periods_out)} okresów osobno poniżej.",
    }, billing)


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


async def _run_compare_periods(
    period_1: str,
    period_2: str,
    selected_periods: Optional[list] = None,
) -> dict:
    """Porównanie dwóch okresów na rzetelnym P&L (przychód − stałe − zmienne − straty)."""
    from calendar import monthrange
    from datetime import date as _date

    def _parse_one(period: str):
        """Zwraca (since, until, label) lub (None, None, raw)."""
        # reuse calendar resolver
        since, until, label = _resolve_period_window("month", None, period)
        # jeśli resolver spadł do „ostatni tydzień” — fail
        if label.startswith("ostatni") or label.startswith("ostatnie"):
            return None, period
        return (since[:10], until[:10]), label

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        await _check_ai_access(client)
        # Preferuj selected_periods: pierwsze dwa okna
        if selected_periods and isinstance(selected_periods, list) and len(selected_periods) >= 2:
            from calendar import monthrange as _mr
            async def _win(sel):
                kind = (sel.get("kind") or "month").lower()
                y = int(sel.get("year") or _date.today().year)
                if kind == "year":
                    return f"{y}-01-01", f"{y}-12-31", f"rok {y}"
                m = int(sel.get("month") or 1)
                last = _mr(y, m)[1]
                if kind == "month":
                    return f"{y}-{m:02d}-01", f"{y}-{m:02d}-{last:02d}", f"{_MONTH_NAMES_PL[m]} {y}"
                if kind == "day":
                    d = max(1, min(last, int(sel.get("day") or 1)))
                    iso = f"{y}-{m:02d}-{d:02d}"
                    return iso, iso, f"{d:02d}.{m:02d}.{y}"
                w = max(1, min(5, int(sel.get("week") or 1)))
                sd = 1 + (w - 1) * 7
                ed = min(last, sd + 6)
                return f"{y}-{m:02d}-{sd:02d}", f"{y}-{m:02d}-{ed:02d}", f"tydzień {w} · {_MONTH_NAMES_PL[m]} {y}"
            s1, u1, lbl1 = await _win(selected_periods[0] if isinstance(selected_periods[0], dict) else {})
            s2, u2, lbl2 = await _win(selected_periods[1] if isinstance(selected_periods[1], dict) else {})
            w1, w2 = (s1, u1), (s2, u2)
        else:
            w1, lbl1 = _parse_one(period_1)
            w2, lbl2 = _parse_one(period_2)
            if w1 is None or w2 is None:
                return {"ok": False,
                        "assistant_speech": f"Nie rozpoznałem okresów „{period_1}” i „{period_2}”. "
                                            "Podaj miesiące z rokiem, np. lipiec 2025 i sierpień 2025."}

        a1 = await _compute_true_pnl(client, w1[0], w1[1])
        a2 = await _compute_true_pnl(client, w2[0], w2[1])
        prompt = (
            "Działasz jako dyrektor finansowy restauracji. Porównaj dwa okresy.\n"
            f"Okres 1 ({lbl1}): przychód {a1['total_revenue']} zł, koszty stałe {a1['fixed_costs_allocated']} zł, "
            f"straty produktowe {a1['total_waste_cost']} zł, "
            f"koszty zmienne netto {a1.get('variable_costs_net', a1['variable_costs_allocated'])} zł "
            f"(brutto {a1['variable_costs_allocated']} zł), zysk {a1['net_profit']} zł.\n"
            f"Okres 2 ({lbl2}): przychód {a2['total_revenue']} zł, koszty stałe {a2['fixed_costs_allocated']} zł, "
            f"straty produktowe {a2['total_waste_cost']} zł, "
            f"koszty zmienne netto {a2.get('variable_costs_net', a2['variable_costs_allocated'])} zł "
            f"(brutto {a2['variable_costs_allocated']} zł), zysk {a2['net_profit']} zł.\n\n"
            "NIGDY nie nazywaj przychodu „zyskiem”. Wskaż różnicę w zysku, co się poprawiło/pogorszyło "
            "i jedną managerską radę. Maks. 5 zdań po polsku."
        )
        speech, billing = await _chat_and_bill(client, prompt,
                                      endpoint="/api/reports/compare-periods",
                                      extras={"p1": lbl1, "p2": lbl2})

    return _with_billing({
        "ok": True,
        "period_1": {"label": lbl1, "aggregates": a1},
        "period_2": {"label": lbl2, "aggregates": a2},
        "aggregates": {
            "total_revenue": round(a1["total_revenue"] + a2["total_revenue"], 2),
            "fixed_costs_allocated": round(a1["fixed_costs_allocated"] + a2["fixed_costs_allocated"], 2),
            "variable_costs_allocated": round(a1["variable_costs_allocated"] + a2["variable_costs_allocated"], 2),
            "variable_costs_gross": round(
                a1.get("variable_costs_gross", a1["variable_costs_allocated"])
                + a2.get("variable_costs_gross", a2["variable_costs_allocated"]),
                2,
            ),
            "variable_costs_net": round(
                a1.get("variable_costs_net", a1["variable_costs_allocated"])
                + a2.get("variable_costs_net", a2["variable_costs_allocated"]),
                2,
            ),
            "total_waste_cost": round(a1["total_waste_cost"] + a2["total_waste_cost"], 2),
            "operating_profit": round(a1["operating_profit"] + a2["operating_profit"], 2),
            "net_profit": round(a1["net_profit"] + a2["net_profit"], 2),
        },
        "period_label": f"{lbl1} vs {lbl2}",
        "assistant_speech": speech,
    }, billing)


@app.post("/api/reports/analyze-period")
async def reports_analyze_period(req: AnalyzePeriodRequest):
    """Analiza P&L (przychód − koszty stałe/zmienne − straty) dla okresu / zaznaczonych okien."""
    return await _run_period_analysis(
        req.period_type,
        req.limit_days,
        period_hint=req.period_hint,
        selected_periods=req.selected_periods,
    )


@app.post("/api/reports/compare-periods")
async def reports_compare_periods(req: ComparePeriodsRequest):
    """Porównanie dwóch okresów finansowych (np. maj vs czerwiec)."""
    return await _run_compare_periods(req.period_1, req.period_2)


# ─────────────────────────────────────────────────────────────────────────────
# Subskrypcje i Portfel Kredytowy — API
# ─────────────────────────────────────────────────────────────────────────────

class TopupRequest(BaseModel):
    package: Literal["small", "medium", "large"]


class SubscribeRequest(BaseModel):
    tier_level: int


def _subscription_view(sub: dict, message: Optional[str] = None) -> dict:
    tier = int(sub.get("tier_level") or 0)
    cfg = TIER_CONFIG.get(tier, TIER_CONFIG[0])
    bal = int(sub.get("credits_balance") or 0)
    trial_active = _trial_active(sub)
    premium = _premium_entitled(sub)
    effective_tier = max(tier, 2) if premium else tier
    features = []
    for f in FEATURE_CATALOG:
        needs_dh = f["requires_deal_hunter"]
        reason = None
        if needs_dh and not premium:
            reason = "Wymaga planu Profesjonalny lub aktywnego trialu Premium (30 dni)"
        elif bal <= 0:
            reason = "Brak kredytów"
        features.append({**f, "locked": reason is not None, "locked_reason": reason})
    tier_label = cfg["name"]
    if trial_active and tier < 2:
        tier_label = f"{cfg['name']} · trial Premium"
    return {
        "tier_level": tier,
        "effective_tier_level": effective_tier,
        "tier_name": tier_label,
        "credits_balance": bal,
        "max_credits": cfg["max_credits"],
        "credits_pln": round(bal / 100.0, 2),
        "status": sub.get("status") or "active",
        "current_period_end": sub.get("current_period_end"),
        "trial_ends_at": sub.get("trial_ends_at"),
        "trial_active": trial_active,
        "deal_hunter_unlocked": premium,
        "premium_ui": premium or bal > 0,
        "features": features,
        "topup_packages": [{"key": k, **v} for k, v in TOPUP_PACKAGES.items()],
        "plans": [
            {"tier_level": t, "name": c["name"], "price_pln": c["price_pln"],
             "price_note": c.get("price_note"),
             "monthly_grant": c["monthly_grant"], "max_credits": c["max_credits"],
             "deal_hunter": c["deal_hunter"], "perks": c.get("perks", [])}
            for t, c in TIER_CONFIG.items()
        ],
        "message": message,
    }


def _parse_usage_ts(iso: Optional[str]) -> float:
    if not iso:
        return 0.0
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _aggregate_credit_history(items: list[dict], *, window_sec: int = 150) -> list[dict]:
    """
    Scala wiele mikropłatności (np. 13× −1 w Łowcy) w jedną akcję z pełną kwotą.
    1) grupuje po extras.request_id
    2) legacy: ten sam endpoint w oknie czasowym ~window_sec
    Wejście: najnowsze pierwsze.
    """
    if not items:
        return []

    by_req: dict[str, list[dict]] = {}
    orphans: list[dict] = []
    for it in items:
        ex = it.get("extras") if isinstance(it.get("extras"), dict) else {}
        rid = ex.get("request_id") if ex else None
        if rid:
            by_req.setdefault(str(rid), []).append(it)
        else:
            orphans.append(it)

    def _merge_group(group: list[dict]) -> dict:
        group = sorted(group, key=lambda x: _parse_usage_ts(x.get("created_at")), reverse=True)
        head = dict(group[0])
        head["credits"] = sum(int(g.get("credits") or 0) for g in group)
        head["cost_pln"] = round(sum(float(g.get("cost_pln") or 0) for g in group), 6)
        head["id"] = head.get("id") or group[0].get("id")
        ex = dict(head.get("extras") or {}) if isinstance(head.get("extras"), dict) else {}
        ex["aggregated_calls"] = len(group)
        head["extras"] = ex
        return head

    merged: list[dict] = [_merge_group(g) for g in by_req.values()]

    # Legacy burst merge (newest-first walk)
    orphans_sorted = sorted(orphans, key=lambda x: _parse_usage_ts(x.get("created_at")), reverse=True)
    i = 0
    while i < len(orphans_sorted):
        cluster = [orphans_sorted[i]]
        j = i + 1
        while j < len(orphans_sorted):
            prev = cluster[-1]
            cur = orphans_sorted[j]
            if (cur.get("endpoint") or "") != (prev.get("endpoint") or ""):
                break
            dt = abs(_parse_usage_ts(prev.get("created_at")) - _parse_usage_ts(cur.get("created_at")))
            if dt > window_sec:
                break
            cluster.append(cur)
            j += 1
        merged.append(_merge_group(cluster))
        i = j

    merged.sort(key=lambda x: _parse_usage_ts(x.get("created_at")), reverse=True)
    return merged


@app.get("/api/subscription/usage-history")
async def subscription_usage_history(limit: int = 500):
    """Historia zużycia kredytów AI (token_usage), najnowsze wpisy pierwsze.
    Wiele wywołań LLM z jednej akcji użytkownika jest scalanych w jeden wiersz."""
    import math
    # Pobierz więcej surowych wierszy, by po agregacji nadal mieć sensowny limit.
    cap = max(1, min(int(limit), 1000))
    raw_cap = min(3000, max(cap * 4, cap))
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
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


@app.get("/api/subscription")
async def get_subscription():
    """Zwraca stan portfela, plan, listę funkcji (z blokadami) i pakiety doładowań."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        try:
            sub = await _get_subscription(client)
        except httpx.HTTPStatusError:
            return {"ok": False, "needs_migration": True,
                    "message": "Brak tabeli subscriptions. Uruchom migrację ADD_SUBSCRIPTIONS.sql w Supabase."}
        view = _subscription_view(sub)
        view["ok"] = True
        return view


@app.post("/api/subscription/topup")
async def subscription_topup(req: TopupRequest):
    """MOCK doładowanie — tylko gdy ALLOW_MOCK_BILLING=true. Produkcyjnie: Stripe Checkout."""
    if os.getenv("ALLOW_MOCK_BILLING", "false").strip().lower() not in ("1", "true", "yes"):
        raise HTTPException(
            status_code=400,
            detail="Płatności MOCK wyłączone. Użyj POST /api/billing/create-checkout-session.",
        )
    pkg = TOPUP_PACKAGES[req.package]
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        sub = await _ensure_subscription(client)
        new_bal = int(sub.get("credits_balance") or 0) + pkg["credits"]
        await sb_patch(client, "subscriptions", {"account_key": f"eq.{get_account_key()}"},
                       {"credits_balance": new_bal})
        sub["credits_balance"] = new_bal
        view = _subscription_view(sub, message=f"Doładowano {pkg['label']} za {pkg['price_pln']} zł (MOCK).")
        view["ok"] = True
        return view


@app.post("/api/subscription/subscribe")
async def subscription_subscribe(req: SubscribeRequest):
    """MOCK subskrypcja — tylko gdy ALLOW_MOCK_BILLING=true. Produkcyjnie: Stripe Checkout."""
    from datetime import datetime, timezone, timedelta
    if os.getenv("ALLOW_MOCK_BILLING", "false").strip().lower() not in ("1", "true", "yes"):
        raise HTTPException(
            status_code=400,
            detail="Płatności MOCK wyłączone. Użyj POST /api/billing/create-checkout-session.",
        )
    if req.tier_level not in (1, 2):
        raise HTTPException(status_code=400, detail="Nieprawidłowy tier (dozwolone: 1 lub 2).")
    cfg = TIER_CONFIG[req.tier_level]
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        sub = await _ensure_subscription(client)
        grant = cfg["monthly_grant"]
        new_bal = int(sub.get("credits_balance") or 0) + grant
        cpe = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        upd = {"tier_level": req.tier_level, "credits_balance": new_bal,
               "status": "active", "current_period_end": cpe}
        await sb_patch(client, "subscriptions", {"account_key": f"eq.{get_account_key()}"}, upd)
        view = _subscription_view({**sub, **upd},
                                  message=f"Aktywowano plan {cfg['name']} (+{grant} kredytów). MOCK.")
        view["ok"] = True
        return view


# ── Stripe Billing (Checkout + Webhooks) ─────────────────────────────────────

class CheckoutSessionRequest(BaseModel):
    kind: Literal["subscription", "topup"]
    tier_level: Optional[int] = None
    package: Optional[str] = None
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    idempotency_key: Optional[str] = None


class PortalSessionRequest(BaseModel):
    return_url: Optional[str] = None


@app.post("/api/billing/create-checkout-session")
async def billing_create_checkout(req: CheckoutSessionRequest):
    """Tworzy Stripe Checkout Session. Kredyty dolicza TYLKO webhook / confirm-session po płatności."""
    from billing_stripe import create_checkout_session, stripe_configured
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY — skonfiguruj backend/.env")
    success = (req.success_url or os.getenv("BILLING_SUCCESS_URL") or "myapp://billing/success").strip()
    cancel = (req.cancel_url or os.getenv("BILLING_CANCEL_URL") or "myapp://billing/cancel").strip()
    # Stripe wymaga https lub http localhost — deep linki Expo: użyj https success page z redirect
    if success.startswith("myapp://"):
        public = (os.getenv("PUBLIC_APP_URL") or "http://localhost:8081").rstrip("/")
        success = f"{public}/billing-success?session_id={{CHECKOUT_SESSION_ID}}"
    if cancel.startswith("myapp://"):
        public = (os.getenv("PUBLIC_APP_URL") or "http://localhost:8081").rstrip("/")
        cancel = f"{public}/billing-cancel"
    success = assert_safe_redirect_url(success)
    cancel = assert_safe_redirect_url(cancel)
    try:
        session = await create_checkout_session(
            account_key=get_account_key(),
            kind=req.kind,
            tier_level=req.tier_level,
            package=req.package,
            success_url=success,
            cancel_url=cancel,
            idempotency_key=req.idempotency_key or str(uuid.uuid4()),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("create-checkout-session failed")
        raise HTTPException(status_code=502, detail=str(e)[:300])
    return {"ok": True, **session}


class ConfirmSessionRequest(BaseModel):
    session_id: str


@app.post("/api/billing/confirm-session")
async def billing_confirm_session(req: ConfirmSessionRequest):
    """
    Potwierdzenie płatności bez Stripe CLI / webhooka.
    Backend odpytuje Stripe API — jeśli session jest opłacona, dolicza kredyty/tier.
    Frontend NIE może podać kwoty kredytów — tylko session_id.
    """
    from billing_stripe import (
        apply_paid_checkout_session,
        retrieve_checkout_session,
        stripe_configured,
    )
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY")
    sid = (req.session_id or "").strip()
    if not sid.startswith("cs_"):
        raise HTTPException(status_code=400, detail="Nieprawidłowy session_id")
    try:
        session = await retrieve_checkout_session(sid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)[:300])
    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        result = await apply_paid_checkout_session(
            session,
            client=client,
            sb_get=sb_get,
            sb_post=sb_post,
            sb_patch=sb_patch,
            account_key_default=get_account_key(),
            tier_config=TIER_CONFIG,
        )
        if result.get("paid"):
            sub = await _get_subscription(client)
            view = _subscription_view(sub, message="Płatność potwierdzona. Portfel zaktualizowany.")
            view["ok"] = True
            view["billing"] = result
            return view
        return {"ok": False, **result}


@app.post("/api/billing/portal")
async def billing_portal(req: PortalSessionRequest):
    """Stripe Customer Portal — zarządzanie kartą / anulowanie / faktury."""
    from billing_stripe import create_billing_portal_session, stripe_configured
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY")
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        sub = await _ensure_subscription(client)
        cid = sub.get("stripe_customer_id")
        if not cid:
            raise HTTPException(status_code=400, detail="Brak klienta Stripe — najpierw wykup plan.")
        ret = (req.return_url or os.getenv("PUBLIC_APP_URL") or "http://localhost:8081").strip()
        ret = assert_safe_redirect_url(ret)
        try:
            portal = await create_billing_portal_session(customer_id=cid, return_url=ret)
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e)[:300])
        return {"ok": True, **portal}


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    """Stripe Webhook — jedyne miejsce dodawania kredytów / zmiany tieru."""
    from billing_stripe import construct_event, handle_stripe_event
    payload = await request.body()
    sig = request.headers.get("stripe-signature") or ""
    try:
        event = construct_event(payload, sig)
    except Exception as e:
        logger.warning("Stripe webhook signature failed: %s", e)
        raise HTTPException(status_code=400, detail=f"Webhook signature: {e}")
    if hasattr(event, "to_dict"):
        event_dict = event.to_dict()
    else:
        event_dict = dict(event)
    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        result = await handle_stripe_event(
            event_dict,
            client=client,
            sb_get=sb_get,
            sb_post=sb_post,
            sb_patch=sb_patch,
            account_key_default=get_account_key(),
            tier_config=TIER_CONFIG,
        )
    return result


@app.get("/api/billing/status")
async def billing_status():
    from billing_stripe import stripe_configured, DEFAULT_PRICES
    return {
        "ok": True,
        "stripe_configured": stripe_configured(),
        "webhook_secret_set": bool(
            (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip().startswith("whsec_")
        ),
        "confirm_session_available": True,
        "mock_billing": os.getenv("ALLOW_MOCK_BILLING", "false").strip().lower() in ("1", "true", "yes"),
        "prices": DEFAULT_PRICES,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Stripe Connect Express — onboarding dystrybutorów (panel WWW)
# ─────────────────────────────────────────────────────────────────────────────

class StripeConnectRequest(BaseModel):
    producer_id: str
    email: Optional[str] = None


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
                f"{SUPABASE_URL.rstrip('/')}/auth/v1/user",
                headers={"Authorization": f"Bearer {user_jwt}", "apikey": apikey},
            )
            if uresp.status_code == 200:
                return (uresp.json() or {}).get("id")
    except Exception:
        return None
    return None


async def _run_stripe_connect_onboard(pid: str, *, require_owner_uid: Optional[str]) -> dict:
    from billing_stripe import stripe_configured
    from stripe_connect import start_connect_onboarding

    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Brak STRIPE_SECRET_KEY")
    pid = (pid or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Brak producer_id")

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        rows = await sb_get(client, "local_producers", params={
            "select": "id,auth_user_id,email,company_name,stripe_connect_id,stripe_account_id",
            "id": f"eq.{pid}",
            "limit": "1",
        })
        if not rows:
            raise HTTPException(status_code=404, detail="Dystrybutor nie istnieje")
        owner = (rows[0].get("auth_user_id") or "").strip()
        if require_owner_uid is not None:
            if not require_owner_uid:
                raise HTTPException(status_code=401, detail="Zaloguj się (Bearer JWT)")
            if owner and owner != require_owner_uid:
                raise HTTPException(status_code=403, detail="To nie jest Twój profil dystrybutora")
        try:
            return await start_connect_onboarding(
                client=client,
                sb_get=sb_get,
                sb_patch=sb_patch,
                producer_id=pid,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.exception("stripe connect onboard failed")
            raise HTTPException(status_code=502, detail=str(e)[:300])


@app.post("/api/stripe/connect")
async def stripe_connect_onboard_post(request: Request, body: StripeConnectRequest):
    """
    Tworzy Stripe Express (PL) + Account Link onboarding.
    Panel WWW: POST JSON { producer_id } z Bearer JWT właściciela.
    """
    uid = await _auth_user_id_from_request(request)
    return await _run_stripe_connect_onboard(body.producer_id, require_owner_uid=uid)


@app.get("/api/stripe/connect")
async def stripe_connect_onboard_get(producer_id: str, refresh: Optional[int] = None):
    """Refresh URL z Stripe Account Link — przekierowanie do nowego linku onboardingu."""
    from fastapi.responses import RedirectResponse
    result = await _run_stripe_connect_onboard(producer_id, require_owner_uid=None)
    if result.get("url"):
        return RedirectResponse(url=result["url"], status_code=303)
    return result


@app.get("/api/stripe/connect/callback")
async def stripe_connect_callback(
    producer_id: Optional[str] = None,
    account_id: Optional[str] = None,
):
    """
    Return URL po onboardingu Stripe — pobiera acct_... i zapisuje stripe_connect_id.
    """
    from fastapi.responses import RedirectResponse, HTMLResponse
    from stripe_connect import sync_connect_account_to_producer, connect_www_success_url

    pid = (producer_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Brak producer_id")

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        try:
            synced = await sync_connect_account_to_producer(
                client=client,
                sb_get=sb_get,
                sb_patch=sb_patch,
                producer_id=pid,
                account_id=(account_id or "").strip() or None,
            )
        except Exception as e:
            logger.exception("stripe connect callback failed")
            return HTMLResponse(
                content=(
                    "<html><body style='font-family:sans-serif;padding:2rem'>"
                    f"<h1>Stripe Connect — błąd</h1><p>{str(e)[:300]}</p>"
                    "</body></html>"
                ),
                status_code=502,
            )

    success = connect_www_success_url()
    if success.startswith("http"):
        sep = "&" if "?" in success else "?"
        return RedirectResponse(
            url=f"{success}{sep}producer_id={pid}&stripe_connect_id={synced.get('stripe_connect_id','')}",
            status_code=303,
        )
    return {
        "ok": True,
        "message": "Konto Stripe Connect zapisane. Możesz wrócić do panelu WWW.",
        **synced,
    }


@app.get("/api/stripe/connect/done")
async def stripe_connect_done(
    producer_id: Optional[str] = None,
    stripe_connect_id: Optional[str] = None,
):
    """Prosta strona sukcesu (gdy brak STRIPE_CONNECT_WWW_SUCCESS_URL)."""
    from fastapi.responses import HTMLResponse
    return HTMLResponse(
        content=(
            "<html><body style='font-family:sans-serif;padding:2rem'>"
            "<h1>Stripe połączony</h1>"
            f"<p>Dystrybutor: <code>{producer_id or '—'}</code></p>"
            f"<p>Konto: <code>{stripe_connect_id or '—'}</code></p>"
            "<p>Produkty będą widoczne dla restauratorów po zatwierdzeniu profilu.</p>"
            "</body></html>"
        )
    )


@app.get("/api/stripe/connect/status")
async def stripe_connect_status(producer_id: str, request: Request):
    """Status Connect dystrybutora (panel WWW)."""
    pid = (producer_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Brak producer_id")
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        rows = await sb_get(client, "local_producers", params={
            "select": "id,stripe_connect_id,stripe_account_id,payouts_enabled,stripe_onboarding_complete",
            "id": f"eq.{pid}",
            "limit": "1",
        })
    if not rows:
        raise HTTPException(status_code=404, detail="Dystrybutor nie istnieje")
    p = rows[0]
    from stripe_connect import producer_connect_id
    acct = producer_connect_id(p)
    return {
        "ok": True,
        "producer_id": pid,
        "stripe_connect_id": acct or None,
        "connected": bool(acct),
        "payouts_enabled": bool(p.get("payouts_enabled")),
        "stripe_onboarding_complete": bool(p.get("stripe_onboarding_complete")),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Lokalni Przetwórcy — Checkout Stripe (BLIK+karta) + InPost ShipX
# ─────────────────────────────────────────────────────────────────────────────

class LpCheckoutRequest(BaseModel):
    order_id: str
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    idempotency_key: Optional[str] = None
    app_return_url: Optional[str] = None


class LpConfirmRequest(BaseModel):
    session_id: Optional[str] = None
    order_id: Optional[str] = None


class LpShipmentRequest(BaseModel):
    order_id: str
    receiver_name: Optional[str] = None
    receiver_email: Optional[str] = None
    receiver_phone: Optional[str] = None
    street: Optional[str] = None
    building_number: Optional[str] = None
    city: Optional[str] = None
    post_code: Optional[str] = None


class LpCourierQuoteItem(BaseModel):
    quantity: float = 0
    unit: Optional[str] = None
    weight_g: Optional[float] = None
    product_id: Optional[str] = None


class LpCourierQuoteRequest(BaseModel):
    producer_id: str
    items: list[LpCourierQuoteItem] = []
    receiver_name: Optional[str] = None
    receiver_phone: Optional[str] = None
    street: Optional[str] = None
    building_number: Optional[str] = None
    city: Optional[str] = None
    post_code: Optional[str] = None
    width_cm: Optional[int] = None
    height_cm: Optional[int] = None
    depth_cm: Optional[int] = None


@app.get("/api/local-producers/commerce-status")
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


@app.post("/api/local-producers/courier-quotes")
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
        weight_kg = estimate_order_weight_kg(items)
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

    quotes = quoted.get("quotes") or []
    cheapest = next((q for q in quotes if q.get("available") and q.get("price_gross")), None)
    return {
        "ok": True,
        "source": quoted.get("source"),
        "weight_kg": weight_kg,
        "width_cm": dims.get("width"),
        "height_cm": dims.get("height"),
        "depth_cm": dims.get("depth"),
        "parcels": len(parcels),
        "quotes": quotes,
        "cheapest": cheapest,
        "note": (
            "Stawki testowe (sandbox) — ustaw FURGONETKA_* z konta, żeby dostać żywe ceny."
            if quoted.get("source") == "sandbox"
            else "Ceny brutto z kalkulatora Furgonetka dla podanej wagi i wymiarów."
        ),
    }


@app.post("/api/local-producers/checkout")
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
    if success.startswith("myapp://") or success.startswith("exp://") or success.startswith("exp+"):
        success = billing_ok
    if cancel.startswith("myapp://") or cancel.startswith("exp://") or cancel.startswith("exp+"):
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


@app.get("/api/local-producers/billing-return")
async def local_producers_billing_return(
    status: str = "success",
    session_id: str = "",
    app: str = "",
):
    """
    Stripe success/cancel (http/https) → HTML z deep linkiem.
    Expo Go nie obsługuje myapp:// — wtedy używamy `app` z Linking.createURL.
    """
    from html import escape
    from urllib.parse import quote, unquote
    from fastapi.responses import HTMLResponse

    ok = (status or "").strip().lower() in ("success", "ok", "paid")
    sid = (session_id or "").strip()
    suffix = f"?session_id={quote(sid, safe='')}" if sid.startswith("cs_") else ""
    # Trzy slashe: myapp:///lp/success → ścieżka /lp/success (nie host=lp → /success).
    if ok:
        deep = f"myapp:///lp/success{suffix}"
        title = "Płatność zrealizowana"
        hint = "Wracamy do Gastro Manager. Jeśli nic się nie dzieje — kliknij przycisk poniżej."
    else:
        deep = "myapp:///lp/cancel"
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

    # Expo Go: NIE skacz automatycznie na myapp:// — to otwiera „This screen doesn't exist”.
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


@app.post("/api/local-producers/confirm-payment")
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


@app.post("/api/local-producers/orders/{order_id}/mark-handed-to-courier")
async def local_producers_mark_handed_to_courier(order_id: str, request: Request):
    """
    Panel dystrybutora: paczka przekazana kurierowi → shipment_status=shipped + push do restauracji.
    """
    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")
    uid = await _auth_user_id_from_request(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Wymagane logowanie dystrybutora")

    async with httpx.AsyncClient(timeout=45.0, verify=_httpx_verify()) as client:
        orders = await sb_get(client, "producer_orders", params={
            "select": "id,producer_id,restaurant_id,restaurant_account_key,payment_status,shipment_status,delivery_tracking",
            "id": f"eq.{oid}",
            "limit": "1",
        })
        if not orders:
            raise HTTPException(status_code=404, detail="Zamówienie nie istnieje")
        order = orders[0]
        producers = await sb_get(client, "local_producers", params={
            "select": "id,auth_user_id,company_name",
            "id": f"eq.{order.get('producer_id')}",
            "limit": "1",
        })
        if not producers:
            raise HTTPException(status_code=404, detail="Producent nie istnieje")
        producer = producers[0]
        if str(producer.get("auth_user_id") or "") != str(uid):
            raise HTTPException(status_code=403, detail="Tylko właściciel profilu dystrybutora")

        if str(order.get("payment_status") or "").lower() != "paid":
            raise HTTPException(status_code=400, detail="Zamówienie nie jest opłacone")

        already = str(order.get("shipment_status") or "").lower() == "shipped"
        if not already:
            await sb_patch(client, "producer_orders", {"id": f"eq.{oid}"}, {
                "shipment_status": "shipped",
                "order_status": "shipped",
            })
            try:
                from lp_stock import decrement_stock_for_shipped_order
                await decrement_stock_for_shipped_order(
                    client=client,
                    sb_get=sb_get,
                    sb_patch=sb_patch,
                    order_id=oid,
                    producer_id=str(order.get("producer_id") or ""),
                )
            except Exception:
                logger.exception("LP stock decrement on mark-handed failed")

        tracking = (order.get("delivery_tracking") or "").strip()
        company = (producer.get("company_name") or "Lokalny przetwórca").strip()
        eta = "Zwykle doręczenie w 1–2 dni robocze."
        body = (
            f"{company}: kurier jest już w drodze. {eta}"
            + (f" Numer przesyłki: {tracking}." if tracking else "")
        )
        pushed = 0
        restaurant_id = (order.get("restaurant_id") or "").strip()
        if restaurant_id:
            try:
                tokens = await sb_get(client, "device_push_tokens", params={
                    "select": "token",
                    "user_id": f"eq.{restaurant_id}",
                    "limit": "50",
                }) or []
                msgs = []
                for t in tokens:
                    tok = str(t.get("token") or "").strip()
                    if tok:
                        msgs.append({
                            "to": tok,
                            "title": "Kurier w drodze",
                            "body": body[:180],
                            "sound": "default",
                            "data": {"type": "lp_shipment", "order_id": oid},
                        })
                for i in range(0, len(msgs), 80):
                    chunk = msgs[i:i + 80]
                    if not chunk:
                        continue
                    await client.post(
                        "https://exp.host/--/api/v2/push/send",
                        json=chunk,
                        headers={"Accept": "application/json", "Content-Type": "application/json"},
                        timeout=30.0,
                    )
                    pushed += len(chunk)
            except Exception:
                logger.exception("LP mark-handed push failed")

    return {
        "ok": True,
        "shipment_status": "shipped",
        "already": already,
        "pushed": pushed,
        "message": body,
    }


@app.post("/api/local-producers/create-shipment")
async def local_producers_create_shipment(req: LpShipmentRequest):
    """Ręczne utworzenie przesyłki przez Furgonetkę (InPost Kurier) po paid."""
    from furgonetka_broker import create_furgonetka_shipment, furgonetka_configured
    from local_producers_commerce import create_inpost_shipment, parse_lp_ship_from_notes

    order_id = (req.order_id or "").strip()
    if not order_id:
        raise HTTPException(status_code=400, detail="Brak order_id")
    account_key = get_account_key()

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        orders = await sb_get(client, "producer_orders", params={
            "select": "*", "id": f"eq.{order_id}", "limit": "1",
        })
        if not orders:
            raise HTTPException(status_code=404, detail="Zamówienie nie istnieje")
        order = orders[0]
        if order.get("restaurant_account_key") and order.get("restaurant_account_key") != account_key:
            raise HTTPException(status_code=403, detail="To zamówienie należy do innego konta")
        if str(order.get("payment_status") or "").lower() != "paid":
            raise HTTPException(status_code=400, detail="Najpierw opłać zamówienie")

        producers = await sb_get(client, "local_producers", params={
            "select": "*", "id": f"eq.{order.get('producer_id')}", "limit": "1",
        })
        producer = (producers or [{}])[0]
        ship = parse_lp_ship_from_notes(order.get("notes")) or {}
        receiver = {
            "name": req.receiver_name or ship.get("name") or "Restauracja",
            "email": req.receiver_email or ship.get("email") or "orders@gastromanager.app",
            "phone": req.receiver_phone or ship.get("phone") or "500600700",
            "address": {
                "street": req.street or ship.get("street") or "ul. Restauracyjna",
                "building_number": req.building_number or ship.get("building_number") or "1",
                "city": req.city or ship.get("city") or "Warszawa",
                "post_code": req.post_code or ship.get("post_code") or "00-001",
            },
        }
        try:
            if furgonetka_configured():
                result = await create_furgonetka_shipment(
                    order_id,
                    client=client,
                    sb_get=sb_get,
                    sb_patch=sb_patch,
                )
            else:
                result = await create_inpost_shipment(
                    client=client,
                    sb_get=sb_get,
                    sb_patch=sb_patch,
                    order=order,
                    producer=producer,
                    receiver=receiver,
                )
        except Exception as e:
            logger.exception("LP create-shipment failed")
            raise HTTPException(status_code=502, detail=str(e)[:300])
    return result


async def _lp_order_for_actor(client, order_id: str, request: Request) -> dict:
    """Zamówienie LP + flaga is_owner / is_restaurant. 403 gdy brak dostępu."""
    uid = await _auth_user_id_from_request(request)
    account_key = get_account_key()
    orders = await sb_get(client, "producer_orders", params={
        "select": "*", "id": f"eq.{order_id}", "limit": "1",
    })
    if not orders:
        raise HTTPException(status_code=404, detail="Zamówienie nie istnieje")
    order = orders[0]
    producers = await sb_get(client, "local_producers", params={
        "select": "id,auth_user_id",
        "id": f"eq.{order.get('producer_id')}",
        "limit": "1",
    })
    owner = ((producers or [{}])[0].get("auth_user_id") or "").strip()
    is_owner = bool(uid and owner and uid == owner)
    is_restaurant = bool(
        order.get("restaurant_account_key")
        and order.get("restaurant_account_key") == account_key
        and account_key != "default"
    )
    if not (is_owner or is_restaurant):
        raise HTTPException(status_code=403, detail="Brak dostępu do tego zamówienia")
    return {"order": order, "is_owner": is_owner, "is_restaurant": is_restaurant}


@app.get("/api/local-producers/orders/{order_id}/shipping")
@app.post("/api/local-producers/orders/{order_id}/sync-tracking")
async def producer_order_shipping(order_id: str, request: Request):
    """Status kuriera + opcjonalne odświeżenie trackingu Furgonetka."""
    from datetime import datetime, timezone, timedelta
    from furgonetka_broker import furgonetka_configured, sync_order_tracking
    from lp_tracking import timeline_index

    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")

    refresh = request.method == "POST" or (request.query_params.get("refresh") or "").lower() in (
        "1", "true", "yes",
    )

    async with httpx.AsyncClient(timeout=45.0, verify=_httpx_verify()) as client:
        acc = await _lp_order_for_actor(client, oid, request)
        order = acc["order"]
        synced = None
        pid = (order.get("furgonetka_package_id") or order.get("broker_package_id") or "").strip()
        last = order.get("tracking_synced_at")
        stale = True
        if last:
            try:
                ts = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                stale = datetime.now(timezone.utc) - ts > timedelta(minutes=12)
            except Exception:
                stale = True
        if refresh or (pid and furgonetka_configured() and stale):
            try:
                synced = await sync_order_tracking(
                    oid, client=client, sb_get=sb_get, sb_patch=sb_patch, package_id=pid or None,
                )
                if synced.get("ok"):
                    order = {**order, **{
                        k: synced[k] for k in (
                            "shipment_status", "tracking", "courier_name",
                        ) if k in synced
                    }}
                    order["delivery_tracking"] = synced.get("tracking") or order.get("delivery_tracking")
                    order["tracking_state"] = synced.get("state") or order.get("tracking_state")
            except Exception as e:
                logger.warning("LP tracking sync: %s", e)

    pickup_date = order.get("pickup_date")
    pickup_min = order.get("pickup_min_time")
    pickup_max = order.get("pickup_max_time")
    pickup_label = None
    if pickup_date:
        window = "–".join(x for x in (pickup_min, pickup_max) if x)
        pickup_label = f"{pickup_date}" + (f" {window}" if window else "")

    return {
        "ok": True,
        "order_id": oid,
        "package_id": pid or None,
        "courier_name": order.get("courier_name") or "inpost",
        "tracking": order.get("delivery_tracking"),
        "tracking_state": order.get("tracking_state"),
        "shipment_status": order.get("shipment_status"),
        "order_status": order.get("order_status"),
        "pickup_date": pickup_date,
        "pickup_min_time": pickup_min,
        "pickup_max_time": pickup_max,
        "pickup_label": pickup_label,
        "parcel_weight_kg": order.get("parcel_weight_kg"),
        "shipping_error": order.get("shipping_error"),
        "label_ready": bool(order.get("broker_label_ready") or order.get("label_storage_path")),
        "timeline_index": timeline_index(
            order.get("tracking_state"),
            has_pickup=bool(pickup_date),
        ),
        "events": (synced or {}).get("events") or [],
        "refreshed": bool(synced and synced.get("ok")),
    }


@app.post("/api/local-producers/orders/{order_id}/retry-shipment")
async def producer_order_retry_shipment(order_id: str, request: Request):
    """Ponów utworzenie / dokończenie przesyłki (bez duplikatu gdy package_id już jest)."""
    from furgonetka_broker import create_furgonetka_shipment, furgonetka_configured

    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")
    if not furgonetka_configured():
        raise HTTPException(status_code=503, detail="Furgonetka nie skonfigurowana")

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        acc = await _lp_order_for_actor(client, oid, request)
        order = acc["order"]
        if str(order.get("payment_status") or "").lower() != "paid":
            raise HTTPException(status_code=400, detail="Zamówienie nie jest opłacone")
        result = await create_furgonetka_shipment(
            oid, client=client, sb_get=sb_get, sb_patch=sb_patch,
        )
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error") or "Nie udało się zlecić przesyłki")
    return result


@app.get("/api/local-producers/orders/{order_id}/invoice-url")
async def producer_order_invoice_url(order_id: str, request: Request):
    """
    Podpisany HTTPS URL do faktury.
    WWW zapisuje invoice_url jako ``producer-documents:path`` (prywatny Storage).
    """
    from lp_invoice_url import resolve_order_invoice_url

    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")

    uid = await _auth_user_id_from_request(request)
    account_key = get_account_key()

    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        order = None
        last_err = None
        for select in (
            "id,producer_id,restaurant_account_key,restaurant_id,invoice_url,settlement_invoice_url,invoice_file_url",
            "id,producer_id,restaurant_account_key,restaurant_id,invoice_url",
            "id,producer_id,restaurant_account_key,invoice_url",
            "*",
        ):
            try:
                orders = await sb_get(client, "producer_orders", params={
                    "select": select,
                    "id": f"eq.{oid}",
                    "limit": "1",
                })
                if orders:
                    order = orders[0]
                    break
            except Exception as e:
                last_err = e
                continue
        if not order:
            logger.warning("LP invoice order fetch failed: %s", last_err)
            raise HTTPException(status_code=404, detail="Zamówienie nie istnieje")

        producers = []
        try:
            producers = await sb_get(client, "local_producers", params={
                "select": "id,auth_user_id",
                "id": f"eq.{order.get('producer_id')}",
                "limit": "1",
            })
        except Exception:
            producers = []
        owner = ((producers or [{}])[0].get("auth_user_id") or "").strip()
        is_owner = bool(uid and owner and uid == owner)
        is_restaurant = bool(
            (
                order.get("restaurant_account_key")
                and order.get("restaurant_account_key") == account_key
                and account_key != "default"
            )
            or (uid and order.get("restaurant_id") and str(order.get("restaurant_id")) == str(uid))
        )
        if not (is_owner or is_restaurant):
            raise HTTPException(status_code=403, detail="Brak dostępu do faktury tego zamówienia")

        try:
            url = await resolve_order_invoice_url(
                order, client=client, verify=_httpx_verify(), expires_in=3600,
            )
        except Exception as e:
            logger.exception("LP invoice signed URL failed")
            raise HTTPException(
                status_code=502,
                detail=f"Nie udało się otworzyć faktury: {str(e)[:240]}",
            ) from e

    if not url:
        raise HTTPException(status_code=404, detail="Brak faktury dla tego zamówienia")
    return {"ok": True, "url": url, "expires_in": 3600}


@app.get("/api/orders/{order_id}/invoice")
@app.get("/api/local-producers/orders/{order_id}/invoice")
async def producer_order_invoice_file(order_id: str, request: Request):
    """
    Rachunek / faktura PDF: wgrany dokument ze Storage albo wygenerowany w locie.
    Sprzedawca = profil przetwórcy. Content-Disposition: attachment.
    """
    from fastapi.responses import StreamingResponse
    from lp_invoice_pdf import (
        build_invoice_pdf,
        fetch_stored_invoice_bytes,
        invoice_filename,
        load_order_invoice_items,
        settlement_type_of,
    )

    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        acc = await _lp_order_for_actor(client, oid, request)
        order = acc["order"]
        pid = str(order.get("producer_id") or "").strip()
        producers = []
        if pid:
            try:
                producers = await sb_get(client, "local_producers", params={
                    "select": "*",
                    "id": f"eq.{pid}",
                    "limit": "1",
                }) or []
            except Exception:
                producers = await sb_get(client, "local_producers", params={
                    "select": "id,company_name,owner_name,address,postal_code,city,voivodeship",
                    "id": f"eq.{pid}",
                    "limit": "1",
                }) or []
        producer = (producers or [{}])[0]

        stored = await fetch_stored_invoice_bytes(
            order, client=client, verify=_httpx_verify(),
        )
        if stored:
            body, ctype = stored
            ext = "pdf"
            if ctype == "application/pdf" or body[:4] == b"%PDF":
                ext = "pdf"
                ctype = "application/pdf"
            elif "jpeg" in ctype or "jpg" in ctype:
                ext = "jpg"
            elif "png" in ctype:
                ext = "png"
            filename = f"rachunek-{oid[:8]}.{ext}"
            return StreamingResponse(
                io.BytesIO(body),
                media_type=ctype,
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Cache-Control": "no-store",
                },
            )

        items = await load_order_invoice_items(client, oid)
        try:
            pdf = build_invoice_pdf(producer=producer, order=order, items=items)
        except Exception as e:
            logger.exception("LP invoice PDF generate failed")
            raise HTTPException(
                status_code=500,
                detail=f"Nie udało się wygenerować rachunku: {str(e)[:200]}",
            ) from e

        filename = invoice_filename(settlement_type_of(producer), oid)
        return StreamingResponse(
            io.BytesIO(pdf),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "no-store",
            },
        )


@app.get("/api/orders/{order_id}/furgonetka-label")
@app.get("/api/orders/{order_id}/label")
@app.get("/api/producer-orders/{order_id}/label")
@app.get("/api/local-producers/orders/{order_id}/label")
async def producer_order_furgonetka_label(order_id: str, request: Request):
    """
    Etykieta PDF — najpierw prywatny Storage, potem Furgonetka API.
    """
    import io
    from fastapi.responses import StreamingResponse
    from furgonetka_broker import download_label_pdf, furgonetka_configured
    from lp_invoice_url import parse_invoice_storage_ref

    oid = (order_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Brak order_id")

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        acc = await _lp_order_for_actor(client, oid, request)
        order = acc["order"]
        package_id = (
            (order.get("furgonetka_package_id") or order.get("broker_package_id") or "")
        ).strip()
        label_ref = (order.get("label_storage_path") or "").strip()

        pdf = None
        if label_ref:
            parsed = parse_invoice_storage_ref(label_ref)
            if parsed and parsed.get("kind") == "storage":
                try:
                    from lp_invoice_url import create_storage_signed_url
                    signed = await create_storage_signed_url(
                        bucket=parsed["bucket"],
                        path=parsed["path"],
                        expires_in=120,
                        client=client,
                        verify=_httpx_verify(),
                    )
                    r = await client.get(signed)
                    if r.status_code < 400 and r.content:
                        pdf = r.content
                except Exception as e:
                    logger.info("label from storage failed: %s", e)

        if pdf is None:
            if not package_id:
                raise HTTPException(
                    status_code=404,
                    detail="Etykieta jeszcze niegotowa — poczekaj na zlecenie kuriera po płatności.",
                )
            if not furgonetka_configured():
                raise HTTPException(status_code=503, detail="Furgonetka nie skonfigurowana")
            try:
                pdf = await download_label_pdf(package_id)
            except Exception as e:
                raise HTTPException(status_code=502, detail=str(e)[:300])

        try:
            await sb_patch(client, "producer_orders", {"id": f"eq.{oid}"}, {
                "broker_label_ready": True,
            })
        except Exception:
            pass

    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="etykieta-{oid[:8]}.pdf"',
        },
    )


@app.post("/api/subscription/resign")
async def subscription_resign():
    """Rezygnacja z subskrypcji — natychmiast Tier 0 Free, bez ponownego pakietu 100 kredytów."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        sub = await _ensure_subscription(client)
        upd = {"tier_level": 0, "status": "active", "current_period_end": None, "free_starter_claimed": True}
        await sb_patch(client, "subscriptions", {"account_key": f"eq.{get_account_key()}"}, upd)
        view = _subscription_view({**sub, **upd},
                                  message=f"Przełączono na plan Free. Saldo: {sub.get('credits_balance')} kredytów "
                                          f"(bez ponownego pakietu startowego).")
        view["ok"] = True
        return view


@app.post("/api/subscription/cancel")
async def subscription_cancel():
    """Anulowanie — brak dalszych doładowań; kredyty i tier zostają do końca okresu."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        sub = await _ensure_subscription(client)
        await sb_patch(client, "subscriptions", {"account_key": f"eq.{get_account_key()}"},
                       {"status": "canceled"})
        view = _subscription_view({**sub, "status": "canceled"},
                                  message="Subskrypcja anulowana. Kredyty i plan pozostają do końca "
                                          "bieżącego okresu, bez kolejnych doładowań.")
        view["ok"] = True
        return view


@app.get("/api/suppliers/{supplier_id}/catalog")
async def get_supplier_catalog(supplier_id: str):
    """Pełny katalog dostawcy dla Łowcy (W menu + poza menu).

    in_menu = is_visible OR fuzzy match do składników z receptur menu użytkownika.
    """
    sid = (supplier_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="Brak supplier_id.")
    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        sup_rows = await sb_get(
            client, "suppliers",
            params={"select": "id,name,email,min_order_value", "id": f"eq.{sid}", "limit": "1"},
        ) or []
        if not sup_rows:
            raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")
        sup = sup_rows[0]
        try:
            rows = await sb_get(client, "supplier_catalog", params={
                "select": "id,name,variant,unit,price_pln,is_visible,volume_label,sort_order",
                "supplier_id": f"eq.{sid}",
                "order": "name.asc",
                "limit": "2000",
            }) or []
        except httpx.HTTPStatusError:
            rows = await sb_get(client, "supplier_catalog", params={
                "select": "id,name,variant,unit,price_pln,volume_label,sort_order",
                "supplier_id": f"eq.{sid}",
                "order": "name.asc",
                "limit": "2000",
            }) or []

        menu_ings: list[str] = []
        try:
            # Składniki z receptur menu — do tagu „W menu”
            menu_items = await sb_get(client, "menu_items", params={
                "select": "id", "is_active": "eq.true", "limit": "500",
            }) or []
            menu_ids = [m["id"] for m in menu_items if m.get("id")]
            if menu_ids:
                # PostgREST: in.(id1,id2,…)
                chunk = menu_ids[:80]
                ing_rows = await sb_get(client, "recipe_ingredients", params={
                    "select": "ingredient_name",
                    "menu_item_id": f"in.({','.join(chunk)})",
                    "limit": "3000",
                }) or []
                menu_ings = [
                    str(r.get("ingredient_name") or "").strip()
                    for r in ing_rows
                    if str(r.get("ingredient_name") or "").strip()
                ]
        except Exception as e:  # noqa: BLE001
            logger.warning(f"get_supplier_catalog menu ingredients: {e}")

        products = []
        for r in rows:
            name = (r.get("name") or "").strip()
            if not name:
                continue
            try:
                price = float(r.get("price_pln") or 0)
            except (TypeError, ValueError):
                price = 0.0
            visible = r.get("is_visible")
            in_menu = visible is not False
            if visible is False and menu_ings:
                # Fuzzy jak na ekranie Dostawcy
                try:
                    from rapidfuzz import fuzz as _rf
                    nn = _norm_pl(name)
                    in_menu = any(
                        _rf.token_set_ratio(nn, _norm_pl(ing)) >= 72
                        for ing in menu_ings
                    )
                except Exception:
                    in_menu = False
            elif visible is None:
                in_menu = True
            products.append({
                "id": r.get("id"),
                "name": name,
                "variant": r.get("variant"),
                "unit": r.get("unit") or "szt",
                "price_pln": price,
                "volume_label": r.get("volume_label"),
                "is_visible": visible if visible is not None else True,
                "in_menu": bool(in_menu),
            })
        # W menu najpierw, potem poza menu; w grupie A-Z
        products.sort(key=lambda p: (0 if p["in_menu"] else 1, _norm_pl(p["name"])))
        return {
            "ok": True,
            "supplier_id": sid,
            "supplier_name": (sup.get("name") or "").strip() or "Dostawca",
            "supplier_email": (sup.get("email") or "").strip() or None,
            "min_order_value": float(sup.get("min_order_value") or 0),
            "products": products,
            "count": len(products),
            "in_menu_count": sum(1 for p in products if p["in_menu"]),
            "extra_count": sum(1 for p in products if not p["in_menu"]),
        }


@app.post("/api/suppliers/{supplier_id}/refresh-catalog-visibility")
async def refresh_catalog_visibility(supplier_id: str):
    """Ponownie przelicza is_visible wg MENU/receptur (bez magazynu)."""
    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        rows = await sb_get(client, "supplier_catalog", params={
            "select": "id,name,price_pln,unit,volume_label,variant",
            "supplier_id": f"eq.{supplier_id}",
        })
        if not rows:
            return {"ok": True, "updated": 0, "message": "Pusty katalog."}
        products = [
            {"product_name": r["name"], "price_netto": float(r.get("price_pln") or 0),
             "unit": r.get("unit") or "szt", "volume_label": r.get("volume_label") or ""}
            for r in rows
        ]
        result = await _process_offer(client, supplier_id, {"products": products})
        return {"ok": True, "updated": len(rows), **result}
