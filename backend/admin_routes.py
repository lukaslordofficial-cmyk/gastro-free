"""
Admin / cron endpoints — migration-status (cron secret).
Wydzielone z server.py.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Request

from cron_auth import require_cron_secret
from http_ssl import httpx_verify
from supabase_rest import sb_get

router = APIRouter(tags=["admin"])


def _probe(checks: dict[str, bool], name: str, ok: bool) -> None:
    checks[name] = ok


@router.get("/api/admin/migration-status")
async def admin_migration_status(request: Request):
    """Sondy kolumn/tabel krytycznych dla izolacji tenant + POS + billing."""
    require_cron_secret(request)
    checks: dict[str, bool] = {}
    missing_sql: list[str] = []

    async with httpx.AsyncClient(timeout=15.0, verify=httpx_verify()) as client:
        probes: list[tuple[str, str, dict, str]] = [
            ("menu_items.is_available", "menu_items", {"select": "is_available", "limit": "1"}, "ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql"),
            ("inventory_items.synonyms", "inventory_items", {"select": "synonyms", "limit": "1"}, "ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql"),
            ("token_usage table", "token_usage", {"select": "id", "limit": "1"}, "ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql"),
            ("suppliers.min_order_value", "suppliers", {"select": "min_order_value", "limit": "1"}, "ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql"),
            ("pos_sync_events", "pos_sync_events", {"select": "id,account_key,event_id", "limit": "1"}, "ADD_POS_SYNC_EVENTS.sql"),
            ("invoices.account_key", "invoices", {"select": "account_key", "limit": "1"}, "FIX_INVOICES_TENANT_RLS.sql"),
            ("pos_products.account_key", "pos_products", {"select": "account_key", "limit": "1"}, "FIX_POS_TENANT_RLS.sql"),
            ("pos_settings.account_key", "pos_settings", {"select": "account_key", "limit": "1"}, "FIX_POS_TENANT_RLS.sql"),
            ("recipes.account_key", "recipes", {"select": "account_key", "limit": "1"}, "FIX_POS_TENANT_RLS.sql"),
            ("warehouse_expiry_alerts.account_key", "warehouse_expiry_alerts", {"select": "account_key", "limit": "1"}, "FIX_WAREHOUSE_EXPIRY_TENANT_RLS.sql"),
            ("subscriptions.account_key", "subscriptions", {"select": "account_key", "limit": "1"}, "FIX_SUBSCRIPTIONS_TENANT_RLS.sql"),
        ]
        for name, table, params, sql_file in probes:
            try:
                await sb_get(client, table, params=params)
                _probe(checks, name, True)
            except Exception:
                _probe(checks, name, False)
                if sql_file not in missing_sql:
                    missing_sql.append(sql_file)

    all_ok = all(checks.values())
    return {
        "ok": all_ok,
        "checks": checks,
        "missing_sql": missing_sql,
        "instructions": (
            "Supabase → SQL Editor → kolejno wklej pliki z missing_sql (katalog supabase_migrations/)."
            if not all_ok
            else "Wszystkie sondy migracji OK."
        ),
    }
