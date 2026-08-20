"""Cienkie endpointy POS (lista providerów, signed webhook URL, produkty)."""
from __future__ import annotations

import os
from typing import Optional

import httpx
from fastapi import APIRouter, Request

from http_ssl import httpx_verify
from pos_adapters import PROVIDERS
from pos_webhook_auth import build_pos_webhook_path
from supabase_rest import sb_get

router = APIRouter(tags=["pos-config"])


def _require_tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


@router.get("/api/pos/providers")
async def pos_providers_list():
    """Lista adapterów popularnych POS (PL) — do pickera w Ustawieniach."""
    return {"providers": PROVIDERS}


@router.get("/api/pos/webhook-config")
async def pos_webhook_config(request: Request, provider: Optional[str] = None):
    """Zwraca URL webhooka z tokenem HMAC dla zalogowanego tenanta."""
    key = _require_tenant()
    base = (os.getenv("BACKEND_PUBLIC_URL") or "").strip().rstrip("/")
    if not base:
        base = str(request.base_url).rstrip("/")
    url = build_pos_webhook_path(key, provider, base)
    return {"ok": True, "url": url, "account_key": key}


@router.get("/api/pos/products")
async def pos_products_list():
    """Lista produktów POS — tylko zalogowany tenant."""
    _require_tenant()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        rows = await sb_get(client, "pos_products", params={
            "select": "id,pos_external_id,name,price_pln",
            "order": "name.asc",
            "limit": "500",
        })
    return {"products": rows or []}
