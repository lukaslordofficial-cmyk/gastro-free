"""Push o krytycznym stanie magazynu (qty ≤ min_quantity)."""
from __future__ import annotations

import logging

import httpx

from supabase_rest import sb_get


async def _tokens_for_account(client: httpx.AsyncClient, account_key: str) -> list[str]:
    profiles = await sb_get(
        client,
        "profiles",
        params={"select": "id", "account_key": f"eq.{account_key}", "limit": "200"},
    ) or []
    uids = [str(p.get("id")) for p in profiles if p.get("id")]
    if not uids:
        return []
    tokens = await sb_get(
        client,
        "device_push_tokens",
        params={
            "select": "token",
            "user_id": f"in.({','.join(uids)})",
            "limit": "500",
        },
    ) or []
    out: list[str] = []
    for t in tokens:
        tok = (t.get("token") or "").strip()
        if tok:
            out.append(tok)
    return out


async def push_critical_stock_now(
    client: httpx.AsyncClient,
    *,
    account_key: str,
    product_name: str,
    quantity_after: float,
    min_quantity: float,
    unit: str = "",
) -> int:
    """Natychmiastowy Expo Push (np. po POS webhook)."""
    tokens = await _tokens_for_account(client, account_key)
    if not tokens:
        return 0
    unit_s = (unit or "").strip()
    qty_s = f"{quantity_after:g}{(' ' + unit_s) if unit_s else ''}"
    min_s = f"{min_quantity:g}{(' ' + unit_s) if unit_s else ''}"
    body = f"„{product_name}” ma stan krytyczny: {qty_s} (min. {min_s})."
    msgs = [
        {
            "to": tok,
            "title": "Krytyczny stan magazynu",
            "body": body[:180],
            "sound": "default",
            "data": {"type": "critical_stock", "product_name": product_name},
        }
        for tok in tokens
    ]
    pushed = 0
    for i in range(0, len(msgs), 80):
        chunk = msgs[i : i + 80]
        try:
            await client.post(
                "https://exp.host/--/api/v2/push/send",
                json=chunk,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=30.0,
            )
            pushed += len(chunk)
        except Exception:
            logging.exception("critical stock push failed")
    return pushed


async def run_critical_stock_alerts_for_tenant(
    client: httpx.AsyncClient,
    *,
    send_push: bool = True,
) -> tuple[list[dict], int]:
    """Skanuj pozycje ≤ min_quantity i wyślij Expo Push."""
    from app_core import get_account_key

    ak = (get_account_key() or "").strip()
    if not ak or ak == "default":
        return [], 0

    rows = await sb_get(
        client,
        "inventory_items",
        params={
            "select": "id,name,quantity,min_quantity,unit",
            "account_key": f"eq.{ak}",
            "is_active": "eq.true",
            "limit": "5000",
        },
    ) or []

    alerts: list[dict] = []
    for r in rows:
        try:
            qty = float(r.get("quantity") or 0)
            min_q = float(r.get("min_quantity") or 0)
        except (TypeError, ValueError):
            continue
        if min_q <= 0 or qty > min_q:
            continue
        name = (r.get("name") or "").strip() or "Produkt"
        unit = (r.get("unit") or "").strip()
        msg = (
            f"„{name}” ma stan krytyczny: {qty:g}"
            f"{(' ' + unit) if unit else ''} (min. {min_q:g}"
            f"{(' ' + unit) if unit else ''})."
        )
        alerts.append({
            "product_id": r.get("id"),
            "product_name": name,
            "quantity": qty,
            "min_quantity": min_q,
            "unit": unit,
            "message": msg,
        })

    if not alerts or not send_push:
        return alerts, 0

    fresh = alerts[:12]
    tokens = await _tokens_for_account(client, ak)
    if not tokens:
        return alerts, 0

    push_msgs = []
    for a in fresh:
        for tok in tokens:
            push_msgs.append({
                "to": tok,
                "title": "Krytyczny stan magazynu",
                "body": a["message"][:180],
                "sound": "default",
                "data": {"type": "critical_stock", "product_name": a["product_name"]},
            })

    pushed = 0
    for i in range(0, len(push_msgs), 80):
        chunk = push_msgs[i : i + 80]
        if not chunk:
            continue
        try:
            await client.post(
                "https://exp.host/--/api/v2/push/send",
                json=chunk,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=30.0,
            )
            pushed += len(chunk)
        except Exception:
            logging.exception("critical stock cron push failed for %s", ak)

    return alerts, pushed


async def maybe_notify_critical_after_consume(
    client: httpx.AsyncClient,
    inventory_updates: list[dict],
) -> None:
    """Po POS: gdy status below_minimum / out_of_stock → push."""
    from app_core import get_account_key

    ak = (get_account_key() or "").strip()
    if not ak or ak == "default":
        return
    for upd in inventory_updates or []:
        status = str(upd.get("status") or "")
        if status not in ("below_minimum", "out_of_stock"):
            continue
        try:
            await push_critical_stock_now(
                client,
                account_key=ak,
                product_name=str(upd.get("name") or "Produkt"),
                quantity_after=float(upd.get("quantity_after") or 0),
                min_quantity=float(upd.get("min_quantity") or 0),
                unit=str(upd.get("unit") or ""),
            )
        except Exception:
            logging.exception("critical stock notify after consume failed")
