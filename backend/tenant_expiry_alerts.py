"""
Alerty dat ważności per tenant (cron).

Wydzielone z server.py — I/O + Expo Push, bez FastAPI routes.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from supabase_rest import sb_get, sb_post
from tenant_auth import collect_tenant_account_keys

logger = logging.getLogger("server")


async def list_tenant_account_keys(client: httpx.AsyncClient) -> list[str]:
    """Wszystkie account_key z profiles — cron musi obejść każdego tenanta osobno."""
    rows = await sb_get(
        client,
        "profiles",
        params={"select": "account_key", "limit": "5000"},
    ) or []
    return collect_tenant_account_keys(rows)


async def run_expiry_alerts_for_tenant(
    httpx_c: httpx.AsyncClient,
    *,
    today,
    warn_until,
    account_key: str,
    suggest_dish_fn=None,
) -> tuple[list[dict], Optional[str]]:
    """Jeden tenant: partie kończące ważność + opcjonalne danie dnia + Expo Push.

    ``suggest_dish_fn(names: list[str]) -> Optional[str]`` — hook AI (server._guard_ai + OpenAI).
    Fail-soft gdy hook niepodany lub rzuci wyjątkiem.
    """
    from datetime import date as _date

    alerts: list[dict] = []
    dish: Optional[str] = None

    rows = await sb_get(
        httpx_c,
        "warehouse_inventory",
        params={
            "select": "id,restaurant_id,product_name,quantity,unit,expiration_date,status,alert_triggers",
            "expiration_date": f"lte.{warn_until.isoformat()}",
            "quantity": "gt.0",
            "limit": "500",
        },
    ) or []

    batches = []
    for r in rows:
        try:
            exp = _date.fromisoformat(str(r.get("expiration_date"))[:10])
        except Exception:
            continue
        if exp < today:
            continue
        if float(r.get("quantity") or 0) <= 0:
            continue
        batches.append(r)

    names = [str(b.get("product_name") or "") for b in batches if b.get("product_name")]
    if names and suggest_dish_fn is not None:
        try:
            dish = await suggest_dish_fn(names)
            if dish:
                dish = str(dish).strip() or None
        except Exception:
            logging.exception("expiry job: dish suggestion failed")

    for i, b in enumerate(batches):
        exp = _date.fromisoformat(str(b["expiration_date"])[:10])
        days_left = (exp - today).days
        triggers = b.get("alert_triggers") or [7, 3, 1]
        if not isinstance(triggers, list):
            triggers = [7, 3, 1]
        triggers_i = {
            int(x) for x in triggers
            if str(x).lstrip("-").isdigit() or isinstance(x, (int, float))
        }
        if days_left not in triggers_i and days_left != 0:
            continue
        message = (
            f"Produkt {b['product_name']} kończy ważność DZIŚ! Użyj go!"
            if days_left == 0
            else f"Produkt {b['product_name']} kończy ważność za {days_left} dni! Użyj go!"
        )
        logging.info("EXPIRY_ALERT %s", message)
        alerts.append({
            "restaurant_id": b.get("restaurant_id"),
            "batch_id": b.get("id"),
            "product_name": b.get("product_name"),
            "days_left": days_left,
            "alert_day": days_left,
            "message": message,
            "dish_of_the_day": dish if i == 0 else None,
        })
    if not alerts:
        return alerts, dish

    try:
        await sb_post(httpx_c, "warehouse_expiry_alerts", alerts)
    except Exception:
        for a in alerts:
            a.pop("alert_day", None)
        try:
            await sb_post(httpx_c, "warehouse_expiry_alerts", alerts)
        except Exception:
            logging.exception("expiry job: alert insert failed")

    try:
        ak = (account_key or "").strip()
        if not ak or ak == "default":
            return alerts, dish
        profiles = await sb_get(
            httpx_c,
            "profiles",
            params={
                "select": "id",
                "account_key": f"eq.{ak}",
                "limit": "200",
            },
        ) or []
        uids = [str(p.get("id")) for p in profiles if p.get("id")]
        tokens: list[dict] = []
        if uids:
            tokens = await sb_get(
                httpx_c,
                "device_push_tokens",
                params={
                    "select": "token",
                    "user_id": f"in.({','.join(uids)})",
                    "limit": "500",
                },
            ) or []
        push_msgs = []
        for t in tokens:
            tok = str(t.get("token") or "").strip()
            if not tok:
                continue
            for a in alerts[:20]:
                push_msgs.append({
                    "to": tok,
                    "title": "Termin przydatności",
                    "body": a["message"],
                    "sound": "default",
                    "data": {"type": "expiry", "product_name": a.get("product_name")},
                })
        for i in range(0, len(push_msgs), 80):
            chunk = push_msgs[i:i + 80]
            if not chunk:
                continue
            await httpx_c.post(
                "https://exp.host/--/api/v2/push/send",
                json=chunk,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=30.0,
            )
    except Exception:
        logging.exception("expiry job: Expo Push failed")

    return alerts, dish
