"""
Admin / cron endpoints — migration-status (cron secret).
Wydzielone z server.py.
"""
from __future__ import annotations

from pathlib import Path

import httpx
from fastapi import APIRouter, Request

from cron_auth import require_cron_secret
from http_ssl import httpx_verify
from supabase_rest import sb_get

router = APIRouter(tags=["admin"])


@router.get("/api/admin/migration-status")
async def admin_migration_status(request: Request):
    """Sprawdza czy migracja ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql jest w DB."""
    require_cron_secret(request)
    async with httpx.AsyncClient(timeout=15.0, verify=httpx_verify()) as client:
        checks: dict[str, bool] = {}
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
    sql_path = (
        Path(__file__).resolve().parent.parent
        / "supabase_migrations"
        / "ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql"
    )
    sql_content = sql_path.read_text(encoding="utf-8") if sql_path.exists() else ""
    return {
        "ok": all_ok,
        "checks": checks,
        "instructions": (
            "Otwórz Supabase Dashboard → SQL Editor → New query → wklej poniższy SQL → Run."
            if not all_ok
            else "Wszystkie migracje uruchomione."
        ),
        "sql": sql_content if not all_ok else "",
    }
