"""POS sync — status, lista zdarzeń i synchronizacja kontrolna (tenant only)."""
from __future__ import annotations

from typing import Optional

import httpx
from fastapi import APIRouter, Request

from http_ssl import httpx_verify
from pos_sync import list_recent_events, missing_event_ids, sync_status

router = APIRouter(tags=["pos-sync"])


def _require_tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


@router.get("/api/pos/sync/status")
async def pos_sync_status():
    """Czytelny status synchronizacji: ile zsynchronizowane / oczekuje / błędy."""
    _require_tenant()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        return await sync_status(client)


@router.get("/api/pos/sync/events")
async def pos_sync_events(limit: int = 200):
    """Ostatnie zdarzenia POS (do diffu po stronie POS)."""
    _require_tenant()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        events = await list_recent_events(client, limit=limit)
    return {"ok": True, "events": events}


@router.post("/api/pos/sync/reconcile")
async def pos_sync_reconcile(request: Request):
    """POS wysyła listę swoich event_id → dostaje te, których serwer nie przetworzył.

    Body: {"event_ids": ["...", "..."]}
    Zwraca: {"missing": [...]} — POS dosyła tylko brakujące (bez utraty danych).
    """
    _require_tenant()
    try:
        body = await request.json()
    except Exception:
        body = {}
    event_ids = body.get("event_ids") if isinstance(body, dict) else None
    if not isinstance(event_ids, list):
        event_ids = []
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        missing = await missing_event_ids(client, event_ids)
    return {"ok": True, "checked": len(event_ids), "missing": missing, "missing_count": len(missing)}
