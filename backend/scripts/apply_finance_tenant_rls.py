#!/usr/bin/env python3
"""Apply FIX_FINANCE_TENANT_RLS.sql via Supabase Postgres (DATABASE_URL / SUPABASE_DB_URL).

Usage (from Gastro-Manager-fixed/backend):
  python scripts/apply_finance_tenant_rls.py

Requires one of: DATABASE_URL, SUPABASE_DB_URL, or SUPABASE_DB_PASSWORD
(+ SUPABASE_URL project ref tucmmrcwwcltkqwyvzxa).
Does NOT print secrets.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
load_dotenv(ROOT / ".env")
load_dotenv(REPO / ".env")

SQL_PATH = REPO / "supabase_migrations" / "FIX_FINANCE_TENANT_RLS.sql"
PROJECT_REF = "tucmmrcwwcltkqwyvzxa"


def _dsn() -> str | None:
    for key in ("DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL", "SUPABASE_POSTGRES_URL"):
        v = (os.environ.get(key) or "").strip()
        if v:
            return v
    pw = (os.environ.get("SUPABASE_DB_PASSWORD") or os.environ.get("POSTGRES_PASSWORD") or "").strip()
    if pw:
        return (
            f"postgresql://postgres.{PROJECT_REF}:{quote_plus(pw)}"
            f"@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
        )
    return None


def main() -> int:
    if not SQL_PATH.is_file():
        print(f"Brak pliku: {SQL_PATH}")
        return 1
    dsn = _dsn()
    if not dsn:
        print(
            "Missing DATABASE_URL / SUPABASE_DB_URL / SUPABASE_DB_PASSWORD — "
            "run SQL manually in Dashboard SQL Editor:\n"
            f"  {SQL_PATH}"
        )
        return 2

    try:
        import psycopg2
    except ImportError:
        print("Brak psycopg2 — pip install psycopg2-binary, albo wklej SQL w Dashboard.")
        return 3

    sql = SQL_PATH.read_text(encoding="utf-8")
    print(f"Applying {SQL_PATH.name} to project {PROJECT_REF}…")
    try:
        conn = psycopg2.connect(dsn, connect_timeout=30)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.close()
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {type(e).__name__}: {e}")
        print(f"Uruchom ręcznie: {SQL_PATH}")
        return 4
    print("OK — finance tenant RLS applied; default demo finance wiped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
