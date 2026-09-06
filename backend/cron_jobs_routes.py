"""
Joby cron (sekret X-Cron-Secret) — expiry + CORE alerts.
Wydzielone z server.py.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Request

from cron_auth import require_cron_secret
from http_ssl import httpx_verify
from supabase_rest import sb_get, sb_post

router = APIRouter(tags=["cron-jobs"])


@router.get("/api/inventory/expiry-daily-job")
async def expiry_daily_job(request: Request):
    """Scheduler: odśwież statusy partii; alerty dat ważności per tenant."""
    from datetime import date as _date, timedelta

    from server import (
        _push_account_key,
        _reset_account_key,
        _run_expiry_alerts_for_tenant,
        get_account_key,
    )
    from tenant_expiry_alerts import list_tenant_account_keys

    require_cron_secret(request)
    today = _date.today()
    warn_until = today + timedelta(days=14)
    all_alerts: list[dict] = []
    dish: Optional[str] = None
    tenants_done = 0

    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as httpx_c:
        try:
            await sb_post(httpx_c, "rpc/warehouse_inventory_refresh_status", {})
        except Exception:
            logging.exception("expiry job: refresh_status RPC failed")

        tenant_keys = await list_tenant_account_keys(httpx_c)
        if not tenant_keys:
            fallback = (get_account_key() or "").strip()
            if fallback and fallback != "default":
                tenant_keys = [fallback]

        for ak in tenant_keys:
            tok = _push_account_key(ak)
            try:
                tenant_alerts, tenant_dish = await _run_expiry_alerts_for_tenant(
                    httpx_c, today=today, warn_until=warn_until,
                )
                all_alerts.extend(tenant_alerts)
                if tenant_dish and not dish:
                    dish = tenant_dish
                tenants_done += 1
            finally:
                _reset_account_key(tok)

    return {
        "ok": True,
        "tenants": tenants_done,
        "alert_count": len(all_alerts),
        "dish_of_the_day": dish,
        "reminders": [a["message"] for a in all_alerts],
    }


@router.get("/api/manager/core-alerts-job")
async def manager_core_alerts_job(request: Request, push: bool = True):
    """Cron: alerty CORE dla każdego tenanta (+ opcjonalny Expo Push)."""
    from server import (
        _push_account_key,
        _reset_account_key,
        _run_manager_core_alerts,
        get_account_key,
    )
    from tenant_expiry_alerts import list_tenant_account_keys

    require_cron_secret(request)
    all_alerts: list[dict] = []
    speech: Optional[str] = None
    pushed = 0
    tenants_done = 0

    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as httpx_c:
        tenant_keys = await list_tenant_account_keys(httpx_c)
        if not tenant_keys:
            fallback = (get_account_key() or "").strip()
            if fallback and fallback != "default":
                tenant_keys = [fallback]

        for ak in tenant_keys:
            tok = _push_account_key(ak)
            try:
                res = await _run_manager_core_alerts(period_type="week", limit_days=7)
                alerts = [
                    a for a in (res.get("alerts") or [])
                    if a.get("severity") in ("critical", "warn")
                ]
                all_alerts.extend(alerts)
                if res.get("assistant_speech") and not speech:
                    speech = res.get("assistant_speech")
                tenants_done += 1

                if not (push and alerts):
                    continue
                try:
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
                    for a in alerts[:8]:
                        body = f"[{a.get('pair')}] {a.get('name')}: {a.get('detail', '')}"[:180]
                        for t in tokens:
                            tok_s = t.get("token")
                            if not tok_s:
                                continue
                            push_msgs.append({
                                "to": tok_s,
                                "title": "Manager AI — alert",
                                "body": body,
                                "sound": "default",
                                "data": {"type": "manager_core", "pair": a.get("pair")},
                            })
                    for i in range(0, len(push_msgs), 80):
                        chunk = push_msgs[i:i + 80]
                        if not chunk:
                            continue
                        await httpx_c.post(
                            "https://exp.host/--/api/v2/push/send",
                            json=chunk,
                            headers={
                                "Accept": "application/json",
                                "Content-Type": "application/json",
                            },
                            timeout=30.0,
                        )
                        pushed += len(chunk)
                except Exception:
                    logging.exception("manager core alerts: Expo Push failed for %s", ak)
            finally:
                _reset_account_key(tok)

    return {
        "ok": True,
        "tenants": tenants_done,
        "alert_count": len(all_alerts),
        "pushed_messages": pushed,
        "speech": speech,
        "alerts": all_alerts,
    }


@router.get("/api/reports/auto-close-daily-job")
async def auto_close_daily_job(request: Request):
    """Cron: zamknij dzień i wygeneruj raport, gdy użytkownik nie zrobił tego ręcznie (~24h)."""
    from daily_report_routes import auto_close_stale_daily_reports
    from server import _push_account_key, _reset_account_key, get_account_key
    from tenant_expiry_alerts import list_tenant_account_keys

    require_cron_secret(request)
    closed: list[dict] = []
    tenants_done = 0

    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as httpx_c:
        tenant_keys = await list_tenant_account_keys(httpx_c)
        if not tenant_keys:
            fallback = (get_account_key() or "").strip()
            if fallback and fallback != "default":
                tenant_keys = [fallback]

        for ak in tenant_keys:
            tok = _push_account_key(ak)
            try:
                days = await auto_close_stale_daily_reports(httpx_c)
                tenants_done += 1
                if days:
                    closed.append({"account_key": ak, "dates": days})
            finally:
                _reset_account_key(tok)

    return {"ok": True, "tenants": tenants_done, "closed": closed}


@router.get("/api/inventory/critical-stock-job")
async def critical_stock_job(request: Request, push: bool = True):
    """Cron: push gdy stan magazynu ≤ min_quantity (poziom krytyczny)."""
    from critical_stock_alerts import run_critical_stock_alerts_for_tenant
    from server import _push_account_key, _reset_account_key, get_account_key
    from tenant_expiry_alerts import list_tenant_account_keys

    require_cron_secret(request)
    all_alerts: list[dict] = []
    pushed = 0
    tenants_done = 0

    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as httpx_c:
        tenant_keys = await list_tenant_account_keys(httpx_c)
        if not tenant_keys:
            fallback = (get_account_key() or "").strip()
            if fallback and fallback != "default":
                tenant_keys = [fallback]

        for ak in tenant_keys:
            tok = _push_account_key(ak)
            try:
                alerts, n = await run_critical_stock_alerts_for_tenant(
                    httpx_c, send_push=push,
                )
                all_alerts.extend(alerts)
                pushed += n
                tenants_done += 1
            finally:
                _reset_account_key(tok)

    return {
        "ok": True,
        "tenants": tenants_done,
        "alert_count": len(all_alerts),
        "pushed_messages": pushed,
        "alerts": all_alerts[:50],
    }
