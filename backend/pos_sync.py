"""
POS sync — trwały dziennik zdarzeń + idempotencja + reconciliation.

Cel: chwilowy brak internetu / niedostępność POS lub Gastro-Managera nie może
powodować utraty sprzedaży ani podwójnego księgowania.

Mechanika:
  • Każde zdarzenie sprzedaży ma `event_id` (unikalny w obrębie tenanta).
  • `claim_event` próbuje zarezerwować event_id (INSERT status=processing).
    Konflikt UNIQUE(account_key,event_id) = duplikat → nie przetwarzamy ponownie.
  • `finalize_event` zapisuje wynik (processed/error) — POS dostaje ACK.
  • `missing_event_ids` — POS wysyła listę swoich id, dostaje te, których serwer
    nie ma → dosyła tylko brakujące (synchronizacja kontrolna).

Wszystkie funkcje są cienkie nad supabase_rest (tabela `pos_sync_events`
jest tenantowa — account_key doklejany automatycznie).
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

import httpx

from supabase_rest import sb_get, sb_patch, sb_post

EVENT_TABLE = "pos_sync_events"


def payload_hash(canonical: dict) -> str:
    """Deterministyczny hash payloadu — do wykrycia zmienionej treści przy tym samym id."""
    try:
        blob = json.dumps(canonical, sort_keys=True, ensure_ascii=False, default=str)
    except Exception:
        blob = str(canonical)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


def extract_event_id(body: dict, canonical: dict) -> Optional[str]:
    """Wyznacza stabilny identyfikator zdarzenia.

    Priorytet: jawny event_id → idempotency_key → external_order_id.
    Brak = None (zachowanie wsteczne, bez idempotencji).
    """
    for src in (canonical, body):
        if not isinstance(src, dict):
            continue
        for k in ("event_id", "idempotency_key", "idempotencyKey", "external_order_id", "order_id"):
            v = src.get(k)
            if v is not None and str(v).strip():
                return str(v).strip()
    return None


def _is_duplicate_error(exc: httpx.HTTPStatusError) -> bool:
    body = ""
    try:
        body = (exc.response.text or "").lower()
    except Exception:
        body = ""
    status = getattr(getattr(exc, "response", None), "status_code", None)
    return status == 409 or "23505" in body or "duplicate key" in body or "already exists" in body


async def claim_event(
    client: httpx.AsyncClient,
    *,
    event_id: str,
    provider: Optional[str],
    external_order_id: Optional[str],
    p_hash: str,
) -> tuple[str, Optional[dict]]:
    """Rezerwuje event_id. Zwraca (status, row).

    status: "new" (można przetwarzać) | "duplicate" (już był — zwróć ACK bez księgowania).
    """
    try:
        rows = await sb_post(client, EVENT_TABLE, {
            "event_id": event_id,
            "provider": provider or "generic",
            "external_order_id": external_order_id,
            "payload_hash": p_hash,
            "status": "processing",
        })
        row = rows[0] if isinstance(rows, list) else rows
        return "new", row
    except httpx.HTTPStatusError as e:
        if _is_duplicate_error(e):
            existing = await sb_get(client, EVENT_TABLE, params={
                "select": "id,event_id,status,result,error,processed_at,created_at",
                "event_id": f"eq.{event_id}",
                "limit": "1",
            }) or []
            return "duplicate", (existing[0] if existing else None)
        raise


async def finalize_event(
    client: httpx.AsyncClient,
    *,
    row_id: str,
    status: str,
    result: Optional[dict] = None,
    error: Optional[str] = None,
) -> None:
    from datetime import datetime, timezone
    patch: dict[str, Any] = {
        "status": status,
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }
    if result is not None:
        patch["result"] = result
    if error is not None:
        patch["error"] = error[:500]
    try:
        await sb_patch(client, EVENT_TABLE, {"id": f"eq.{row_id}"}, patch)
    except httpx.HTTPStatusError:
        pass  # dziennik best-effort — nie wywracaj księgowania z powodu logu


async def sync_status(client: httpx.AsyncClient, *, sample: int = 1000) -> dict:
    """Czytelny status synchronizacji dla administratora."""
    rows = await sb_get(client, EVENT_TABLE, params={
        "select": "event_id,status,error,processed_at,created_at",
        "order": "created_at.desc",
        "limit": str(sample),
    }) or []
    counts: dict[str, int] = {}
    last_processed_at = None
    last_error = None
    for r in rows:
        st = (r.get("status") or "unknown").lower()
        counts[st] = counts.get(st, 0) + 1
        if st == "processed" and last_processed_at is None:
            last_processed_at = r.get("processed_at") or r.get("created_at")
        if st == "error" and last_error is None:
            last_error = r.get("error")
    pending = counts.get("processing", 0)
    errors = counts.get("error", 0)
    processed = counts.get("processed", 0)
    synced = pending == 0 and errors == 0
    return {
        "ok": True,
        "synced": synced,
        "counts": counts,
        "processed": processed,
        "pending": pending,
        "errors": errors,
        "last_processed_at": last_processed_at,
        "last_error": last_error,
        "sampled_events": len(rows),
    }


async def list_recent_events(client: httpx.AsyncClient, *, limit: int = 200) -> list[dict]:
    rows = await sb_get(client, EVENT_TABLE, params={
        "select": "event_id,status,provider,external_order_id,processed_at,created_at",
        "order": "created_at.desc",
        "limit": str(max(1, min(limit, 1000))),
    }) or []
    return rows


async def missing_event_ids(client: httpx.AsyncClient, event_ids: list[str]) -> list[str]:
    """Synchronizacja kontrolna: które z podanych id NIE są przetworzone po stronie serwera."""
    wanted = [str(e).strip() for e in (event_ids or []) if str(e).strip()]
    if not wanted:
        return []
    known: set[str] = set()
    for i in range(0, len(wanted), 100):
        chunk = wanted[i:i + 100]
        quoted = ",".join(f'"{e}"' for e in chunk)
        rows = await sb_get(client, EVENT_TABLE, params={
            "select": "event_id,status",
            "event_id": f"in.({quoted})",
            "limit": "200",
        }) or []
        for r in rows:
            # „znane” = przetworzone; processing/error → POS powinien dosłać ponownie
            if (r.get("status") or "").lower() == "processed":
                known.add(str(r.get("event_id")))
    return [e for e in wanted if e not in known]


__all__ = [
    "EVENT_TABLE",
    "payload_hash",
    "extract_event_id",
    "claim_event",
    "finalize_event",
    "sync_status",
    "list_recent_events",
    "missing_event_ids",
]
