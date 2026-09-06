"""
Pomocnicze operacje webhooka POS: raw log, unmapped SKU, status połączenia.
Wszystkie błędy są połykane / logowane — POS zawsze dostaje ACK gdy to możliwe.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from supabase_rest import sb_get, sb_patch, sb_post, sb_upsert

logger = logging.getLogger("pos_webhook_support")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def log_pos_raw(
    client: httpx.AsyncClient,
    *,
    account_key: str,
    provider: Optional[str],
    raw: Any,
    headers: Optional[dict] = None,
    path: Optional[str] = None,
    method: Optional[str] = None,
) -> None:
    try:
        payload = {
            "account_key": account_key,
            "provider": (provider or "")[:64] or None,
            "raw": raw if isinstance(raw, (dict, list)) else {"_non_json": str(raw)[:4000]},
            "headers": headers or None,
            "path": (path or "")[:500] or None,
            "http_method": (method or "")[:16] or None,
        }
        await sb_post(client, "pos_raw_logs", payload)
    except Exception as e:  # noqa: BLE001
        logger.info("pos_raw_logs skip: %s", e)


async def upsert_unmapped_pos_item(
    client: httpx.AsyncClient,
    *,
    account_key: str,
    pos_sku: str,
    dish_name_hint: Optional[str] = None,
    quantity: Optional[float] = None,
    unit_price_pln: Optional[float] = None,
    provider: Optional[str] = None,
) -> None:
    sku = (pos_sku or "").strip()
    if not sku or sku == "?":
        return
    try:
        existing = await sb_get(
            client,
            "unmapped_pos_items",
            params={
                "select": "id,occurrence_count",
                "pos_sku": f"eq.{sku}",
                "limit": "1",
            },
        )
        row = existing[0] if isinstance(existing, list) and existing else None
        if row and row.get("id"):
            prev = int(row.get("occurrence_count") or 1)
            patch: dict[str, Any] = {
                "last_seen": _now_iso(),
                "occurrence_count": prev + 1,
            }
            if dish_name_hint:
                patch["dish_name_hint"] = str(dish_name_hint)[:200]
            if quantity is not None:
                patch["last_quantity"] = float(quantity)
            if unit_price_pln is not None:
                patch["last_unit_price_pln"] = float(unit_price_pln)
            if provider:
                patch["provider"] = str(provider)[:64]
            await sb_patch(client, "unmapped_pos_items", {"id": f"eq.{row['id']}"}, patch)
            return

        await sb_upsert(
            client,
            "unmapped_pos_items",
            {
                "account_key": account_key,
                "pos_sku": sku[:120],
                "dish_name_hint": (dish_name_hint or "")[:200] or None,
                "last_seen": _now_iso(),
                "occurrence_count": 1,
                "last_quantity": float(quantity) if quantity is not None else None,
                "last_unit_price_pln": float(unit_price_pln) if unit_price_pln is not None else None,
                "provider": (provider or "")[:64] or None,
            },
            on_conflict="account_key,pos_sku",
        )
    except Exception as e:  # noqa: BLE001
        logger.info("unmapped_pos_items skip: %s", e)


async def mark_pos_connected(
    client: httpx.AsyncClient,
    *,
    account_key: str,
    provider: Optional[str] = None,
) -> None:
    """Ustaw connection_status=connected + is_connected + last_sync_at (best-effort)."""
    try:
        rows = await sb_get(
            client,
            "pos_settings",
            params={"select": "id", "limit": "1"},
        )
        now = _now_iso()
        patch = {
            "connection_status": "connected",
            "is_connected": True,
            "last_sync_at": now,
            "updated_at": now,
        }
        if provider:
            patch["pos_system"] = str(provider)[:64]
        if isinstance(rows, list) and rows and rows[0].get("id"):
            await sb_patch(client, "pos_settings", {"id": f"eq.{rows[0]['id']}"}, patch)
        else:
            await sb_post(
                client,
                "pos_settings",
                {
                    "account_key": account_key,
                    **patch,
                    "api_key": "",
                    "webhook_url": "",
                },
            )
    except Exception as e:  # noqa: BLE001
        logger.info("mark_pos_connected skip: %s", e)


def safe_header_snapshot(request_headers) -> dict[str, str]:
    """Wybrane nagłówki (bez Authorization) do diagnostyki."""
    out: dict[str, str] = {}
    try:
        for k in (
            "content-type",
            "user-agent",
            "x-pos-webhook-secret",
            "x-webhook-secret",
            "x-account-key",
        ):
            v = request_headers.get(k)
            if v:
                out[k] = str(v)[:200]
    except Exception:  # noqa: BLE001
        pass
    return out
