#!/usr/bin/env python3
"""Sprawdza tabele subscriptions + token_usage w Supabase i seeduje brakujący wiersz.

Uruchom z katalogu backend:
  python scripts/ensure_supabase_setup.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import certifi
import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()


def _verify():
    import ssl
    mode = os.environ.get("OPENAI_SSL_VERIFY", "auto").strip().lower()
    if mode in ("0", "false", "no"):
        return False
    if mode in ("certifi", "bundle"):
        return certifi.where()
    return ssl.create_default_context()


def headers(extra: dict | None = None) -> dict:
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def check_table(client: httpx.Client, table: str) -> tuple[bool, str]:
    r = client.get(
        f"{URL}/rest/v1/{table}",
        headers={**headers(), "Prefer": "count=exact"},
        params={"select": "id", "limit": "1"},
    )
    if r.status_code == 404 or "PGRST205" in r.text:
        return False, f"brak tabeli ({r.status_code})"
    if r.status_code >= 400:
        return False, f"błąd HTTP {r.status_code}: {r.text[:200]}"
    count = r.headers.get("content-range", "*/0").split("/")[-1]
    return True, f"OK, wierszy: {count}"


def ensure_subscription_row(client: httpx.Client) -> None:
    r = client.get(
        f"{URL}/rest/v1/subscriptions",
        headers=headers(),
        params={"select": "id", "account_key": "eq.default", "limit": "1"},
    )
    r.raise_for_status()
    if r.json():
        print("  subscriptions: wiersz 'default' już istnieje")
        return
    ins = client.post(
        f"{URL}/rest/v1/subscriptions",
        headers={**headers(), "Prefer": "return=representation"},
        json={"account_key": "default", "tier_level": 0, "credits_balance": 1000, "status": "active"},
    )
    if ins.status_code >= 300:
        print(f"  subscriptions: nie udało się utworzyć wiersza — {ins.status_code} {ins.text[:200]}")
    else:
        print("  subscriptions: utworzono wiersz 'default' (Free, 1000 kredytów)")


def main() -> int:
    if not URL or not KEY:
        print("Brak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY w backend/.env")
        return 1

    print(f"Supabase: {URL}")
    with httpx.Client(timeout=30.0, verify=_verify()) as client:
        ok_sub, msg_sub = check_table(client, "subscriptions")
        ok_tu, msg_tu = check_table(client, "token_usage")
        print(f"subscriptions: {msg_sub}")
        print(f"token_usage:   {msg_tu}")

        if ok_sub:
            ensure_subscription_row(client)
        else:
            print("\nUruchom w Supabase SQL Editor:")
            print("  supabase_migrations/ADD_SUBSCRIPTIONS.sql")

        if not ok_tu:
            print("\nUruchom w Supabase SQL Editor:")
            print("  supabase_migrations/ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql")

        if not ok_sub or not ok_tu:
            return 2

    # szybki test backendu
    try:
        r = httpx.get("http://127.0.0.1:8001/api/subscription", timeout=5)
        d = r.json()
        print(f"\nBackend /api/subscription: HTTP {r.status_code}, ok={d.get('ok')}, tier={d.get('tier_level')}, credits={d.get('credits_balance')}")
    except Exception as e:
        print(f"\nBackend niedostępny lokalnie ({e}). Uruchom: uvicorn server:app --host 0.0.0.0 --port 8001")

    return 0


if __name__ == "__main__":
    sys.exit(main())
