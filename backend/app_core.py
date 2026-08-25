"""
Gastro Manager — fundament backendu (config, klient OpenAI, helpery wspóldzielone).

Wydzielone z server.py podczas podziału monolitu na moduly. Logika bez zmian
(kod przeniesiony 1:1). Moduly domenowe importuja stad wspólne stale i helpery,
a server.py re-eksportuje wszystko przez `from app_core import *`.
"""
from __future__ import annotations

import logging
import os
from contextvars import ContextVar
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException
from openai import AsyncOpenAI

from http_ssl import httpx_verify as _httpx_verify
from supabase_rest import (
    configure as _configure_supabase_rest,
    sb_headers as _sb_headers,
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


_openai_client: AsyncOpenAI | None = None


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


# Resend (e-mail) — obliczane raz na starcie procesu (env już załadowany).
RESEND_API_KEY = _resend_api_key()
RESEND_FROM_EMAIL = _resend_from_email()


__all__ = [
    "_BACKEND_DIR", "OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_KEY", "STT_MODEL",
    "CHAT_MODEL", "VISION_MODEL", "PDF_MAX_PAGES", "PDF_VISION_BATCH_SIZE",
    "PDF_INCLUDED_PAGES", "INSPIRATIONS_MODEL", "_ACCOUNT_KEY_DEFAULT",
    "_account_key_ctx", "_SUPABASE_ANON_KEY", "get_account_key",
    "require_tenant_account_key", "_ACCOUNT_KEY", "_env", "_resend_api_key",
    "_resend_from_email", "logger", "_SUPABASE_CONFIGURED", "_openai_client",
    "_openai", "SB_HEADERS", "_pg_ts", "_current_year_month", "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
]
