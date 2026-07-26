#!/usr/bin/env python3
"""Interim: wipe shared (unscoped) finance + token_usage demo rows via REST.

Use BEFORE FIX_FINANCE_TENANT_RLS.sql when account_key column may not exist yet.
Safe here because finance tables were global/shared — no per-tenant data yet.
Does not print secrets.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()

TABLES = [
    "revenue_entries",
    "fixed_costs",
    "variable_cost_entries",
    "daily_reports",
    "token_usage",
    "sales_log",
    "financial_records",
]


def _verify():
    import ssl
    import certifi
    mode = os.environ.get("OPENAI_SSL_VERIFY", "auto").strip().lower()
    if mode in ("0", "false", "no"):
        return False
    if mode in ("certifi", "bundle"):
        return certifi.where()
    return ssl.create_default_context()


def main() -> int:
    if not URL or not KEY:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
        return 1
    headers = {
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    with httpx.Client(timeout=60.0, verify=_verify()) as client:
        for t in TABLES:
            # Count first
            r = client.get(
                f"{URL}/rest/v1/{t}",
                headers={**headers, "Prefer": "count=exact"},
                params={"select": "id", "limit": "1"},
            )
            if r.status_code in (404,) or "PGRST205" in (r.text or ""):
                print(f"{t}: skip (missing)")
                continue
            if r.status_code >= 400:
                print(f"{t}: count failed HTTP {r.status_code}")
                continue
            count = r.headers.get("content-range", "*/?").split("/")[-1]
            # Delete all rows (shared pool). PostgREST needs a filter.
            d = client.delete(
                f"{URL}/rest/v1/{t}",
                headers=headers,
                params={"id": "not.is.null"},
            )
            if d.status_code >= 300:
                # daily_reports may use date PK differently — try created_at
                d2 = client.delete(
                    f"{URL}/rest/v1/{t}",
                    headers=headers,
                    params={"created_at": "not.is.null"},
                )
                if d2.status_code >= 300:
                    print(f"{t}: delete failed ({count} rows) HTTP {d.status_code}/{d2.status_code}")
                    continue
            print(f"{t}: wiped (~{count} rows)")
    print("Done. Still run FIX_FINANCE_TENANT_RLS.sql for account_key + RLS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
