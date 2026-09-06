"""
Outbound PostgREST client (service_role).

Origin comes ONLY from env SUPABASE_URL (assert_supabase_origin).
``path`` is a validated table / ``rpc/<fn>`` segment — never a host.
"""
from __future__ import annotations

import os
from typing import Any, Callable
from contextvars import ContextVar
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from url_safety import assert_safe_rest_path, assert_supabase_origin
from http_ssl import is_production_runtime

# Tabele z kolumną account_key (tenant isolation — service_role filtruje tu, RLS na kliencie).
_TENANT_TABLES = frozenset({
    "inventory_items",
    "inventory_categories",
    "menu_items",
    "suppliers",
    "waste_logs",
    "warehouse_inventory",
    "supplier_offers",
    "revenue_entries",
    "fixed_costs",
    "variable_cost_entries",
    "daily_reports",
    "token_usage",
    "sales_log",
    "pos_sales_log",
    "pos_sync_events",
    "pos_products",
    "pos_settings",
    "pos_raw_logs",
    "unmapped_pos_items",
    "recipes",
    "financial_records",
    "subscriptions",
    "restaurant_profile",
    "kitchen_utensils",
    "supplier_orders",
    "invoices",
    "warehouse_expiry_alerts",
})

_GetAccountKey = Callable[[], str]
_get_account_key: _GetAccountKey | None = None
_account_key_override: ContextVar[str | None] = ContextVar("sb_account_key_override", default=None)


def configure(*, get_account_key: _GetAccountKey) -> None:
    """Wire tenant ContextVar from server middleware (avoids import cycles)."""
    global _get_account_key
    _get_account_key = get_account_key


def push_account_key(account_key: str):
    """Tymczasowo nadpisz tenant (np. odbiór paczki LP na konto restauracji)."""
    return _account_key_override.set((account_key or "").strip() or None)


def reset_account_key(token) -> None:
    _account_key_override.reset(token)


def _account_key() -> str:
    override = _account_key_override.get()
    if override:
        return override
    if _get_account_key is None:
        return (os.environ.get("ACCOUNT_KEY") or "default").strip() or "default"
    return _get_account_key()


def _supabase_url() -> str:
    return (os.environ.get("SUPABASE_URL") or "").rstrip("/")


def _supabase_key() -> str:
    return (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        or os.environ.get("SUPABASE_ANON_KEY", "").strip()
    )


def sb_headers() -> dict[str, str]:
    key = _supabase_key()
    base = {
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if not key:
        return base
    return {**base, "apikey": key, "Authorization": f"Bearer {key}"}


def require_supabase() -> None:
    if not _supabase_url() or not _supabase_key():
        raise HTTPException(
            status_code=503,
            detail=(
                "Supabase nie jest skonfigurowane. Ustaw SUPABASE_URL oraz "
                "SUPABASE_SERVICE_ROLE_KEY w Variables na Railway."
            ),
        )


def _table_name(path: str) -> str:
    return (path or "").split("?", 1)[0].strip("/").split("/")[0]


def _with_tenant_params(path: str, params: dict | list | None) -> dict | list | None:
    """Dokleja filtr account_key do zapytań tenantowych (service_role omija RLS)."""
    if _table_name(path) not in _TENANT_TABLES:
        return params
    ak_filter = f"eq.{_account_key()}"
    if isinstance(params, dict):
        out = dict(params)
        out["account_key"] = ak_filter
        return out
    if isinstance(params, list):
        kept = [
            p for p in params
            if not (
                (isinstance(p, (list, tuple)) and len(p) >= 1 and p[0] == "account_key")
                or (isinstance(p, str) and p.startswith("account_key"))
            )
        ]
        return kept + [("account_key", ak_filter)]
    return params


def _with_tenant_payload(path: str, payload: Any) -> Any:
    if _table_name(path) not in _TENANT_TABLES:
        return payload
    ak = _account_key()
    if isinstance(payload, list):
        return [{**row, "account_key": ak} for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        return {**payload, "account_key": ak}
    return payload


def _missing_account_key_error(resp: httpx.Response) -> bool:
    body = (resp.text or "").lower()
    return "account_key" in body and (
        "does not exist" in body or "schema cache" in body or "pgrst204" in body or "42703" in body
    )


def _retry_without_tenant_column(resp: httpx.Response) -> bool:
    """Dev-only: kolumna account_key jeszcze nie istnieje. Produkcja fail-closed."""
    if is_production_runtime():
        return False
    return _missing_account_key_error(resp)


def _strip_account_key_payload(payload: Any) -> Any:
    if isinstance(payload, list):
        return [{k: v for k, v in row.items() if k != "account_key"} for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        return {k: v for k, v in payload.items() if k != "account_key"}
    return payload


def _strip_account_key_params(params: dict | list | None) -> dict | list | None:
    if isinstance(params, dict):
        return {k: v for k, v in params.items() if k != "account_key"}
    if isinstance(params, list):
        return [
            p for p in params
            if not (
                (isinstance(p, (list, tuple)) and len(p) >= 1 and p[0] == "account_key")
                or (isinstance(p, str) and p.startswith("account_key"))
            )
        ]
    return params


def _rest_url(path: str) -> httpx.URL:
    """
    Build PostgREST URL from env origin + validated relative path only.
    Host/scheme never come from ``path`` (SSRF posture for scanners).
    """
    safe = assert_safe_rest_path(path).split("?", 1)[0]
    origin = assert_supabase_origin(_supabase_url())
    host = urlparse(origin).hostname
    if not host:
        raise HTTPException(status_code=503, detail="SUPABASE_URL bez hosta.")
    return httpx.URL(scheme="https", host=host, path=f"/rest/v1/{safe}")


async def sb_get(
    client: httpx.AsyncClient,
    path: str,
    params: dict | list | None = None,
):
    require_supabase()
    tenant_params = _with_tenant_params(path, params)
    url = _rest_url(path)
    r = await client.get(url, headers=sb_headers(), params=tenant_params or {})
    if r.status_code >= 400 and _retry_without_tenant_column(r):
        r = await client.get(
            url,
            headers=sb_headers(),
            params=_strip_account_key_params(tenant_params) or {},
        )
    r.raise_for_status()
    return r.json()


async def sb_post(client: httpx.AsyncClient, path: str, payload: Any):
    require_supabase()
    body = _with_tenant_payload(path, payload)
    url = _rest_url(path)
    r = await client.post(url, headers=sb_headers(), json=body)
    if r.status_code >= 400 and _retry_without_tenant_column(r):
        r = await client.post(url, headers=sb_headers(), json=_strip_account_key_payload(body))
    r.raise_for_status()
    return r.json() if r.text else None


async def sb_upsert(
    client: httpx.AsyncClient,
    path: str,
    payload: Any,
    *,
    on_conflict: str,
):
    """POST z Prefer: resolution=merge-duplicates + on_conflict (PostgREST UPSERT)."""
    require_supabase()
    body = _with_tenant_payload(path, payload)
    url = _rest_url(path)
    headers = {**sb_headers(), "Prefer": "resolution=merge-duplicates,return=representation"}
    params = {"on_conflict": on_conflict}
    r = await client.post(url, headers=headers, params=params, json=body)
    if r.status_code >= 400 and _retry_without_tenant_column(r):
        r = await client.post(
            url,
            headers=headers,
            params=params,
            json=_strip_account_key_payload(body),
        )
    r.raise_for_status()
    return r.json() if r.text else None


async def sb_patch(client: httpx.AsyncClient, path: str, params: dict, payload: Any):
    require_supabase()
    tenant_params = _with_tenant_params(path, params)
    url = _rest_url(path)
    r = await client.patch(
        url, headers=sb_headers(), params=tenant_params or {}, json=payload,
    )
    if r.status_code >= 400 and _retry_without_tenant_column(r):
        r = await client.patch(
            url,
            headers=sb_headers(),
            params=_strip_account_key_params(tenant_params) or {},
            json=_strip_account_key_payload(payload),
        )
    r.raise_for_status()
    return r.json() if r.text else None


async def sb_delete(client: httpx.AsyncClient, path: str, params: dict):
    require_supabase()
    tenant_params = _with_tenant_params(path, params)
    url = _rest_url(path)
    r = await client.delete(url, headers=sb_headers(), params=tenant_params or {})
    if r.status_code >= 400 and _retry_without_tenant_column(r):
        r = await client.delete(
            url,
            headers=sb_headers(),
            params=_strip_account_key_params(tenant_params) or {},
        )
    r.raise_for_status()
    return r.json() if r.text else None
