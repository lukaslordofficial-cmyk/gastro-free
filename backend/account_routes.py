"""Usunięcie konta — wymóg Google Play (aplikacje z rejestracją)."""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException, Request

from app_core import SUPABASE_KEY, SUPABASE_URL
from http_ssl import httpx_verify
from supabase_rest import sb_delete, sb_get
from url_safety import build_supabase_auth_admin_url

logger = logging.getLogger("account.delete")
router = APIRouter(tags=["account"])

_WIPE_TABLES = (
    "token_usage",
    "waste_logs",
    "app_feedback",
    "sales_log",
    "pos_sales_log",
    "pos_sync_events",
    "pos_products",
    "pos_settings",
    "daily_reports",
    "revenue_entries",
    "fixed_costs",
    "variable_cost_entries",
    "financial_records",
    "invoices",
    "warehouse_expiry_alerts",
    "warehouse_inventory",
    "kitchen_utensils",
    "recipes",
    "menu_items",
    "inventory_items",
    "inventory_categories",
    "supplier_orders",
    "supplier_offers",
    "restaurant_profile",
    "subscriptions",
    "suppliers",
)


@router.post("/api/account/delete")
async def delete_own_account(request: Request):
    """Kasuje login Auth, profil i w miarę możliwości dane restauracji. Anuluje Stripe."""
    from lp_orders import _auth_user_id_from_request
    from server import require_tenant_account_key

    ak = require_tenant_account_key()
    uid = await _auth_user_id_from_request(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Zaloguj się ponownie, aby usunąć konto.")

    async with httpx.AsyncClient(timeout=45.0, verify=httpx_verify()) as client:
        profiles = await sb_get(
            client,
            "profiles",
            params={"select": "id,account_key,email", "id": f"eq.{uid}", "limit": "1"},
        ) or []
        row = profiles[0] if profiles else None
        if row:
            pak = str(row.get("account_key") or "").strip()
            if pak and pak != ak:
                raise HTTPException(status_code=403, detail="To konto nie należy do tej sesji.")

        try:
            from billing_stripe import cancel_stripe_subscription, stripe_configured
            from server import _get_subscription

            sub = await _get_subscription(client)
            sid = str((sub or {}).get("stripe_subscription_id") or "").strip()
            if sid.startswith("sub_") and stripe_configured():
                try:
                    await cancel_stripe_subscription(sid, at_period_end=False)
                except Exception:
                    logger.exception("Stripe cancel during account delete")
        except Exception:
            logger.exception("subscription lookup during account delete")

        suppliers = await sb_get(client, "suppliers", params={"select": "id", "limit": "2000"}) or []
        ids = [str(s["id"]) for s in suppliers if s.get("id")]
        if ids:
            try:
                await sb_delete(client, "supplier_catalog", {"supplier_id": f"in.({','.join(ids[:80])})"})
            except httpx.HTTPStatusError:
                logger.warning("wipe supplier_catalog failed")
        try:
            orders = await sb_get(client, "supplier_orders", params={"select": "id", "limit": "2000"}) or []
            oids = [str(o["id"]) for o in orders if o.get("id")]
            if oids:
                await sb_delete(client, "supplier_order_items", {"order_id": f"in.({','.join(oids[:80])})"})
        except httpx.HTTPStatusError:
            logger.warning("wipe supplier_order_items failed")

        try:
            menus = await sb_get(client, "menu_items", params={"select": "id", "limit": "2000"}) or []
            mids = [str(m["id"]) for m in menus if m.get("id")]
            if mids:
                await sb_delete(client, "recipe_ingredients", {"menu_item_id": f"in.({','.join(mids[:80])})"})
        except httpx.HTTPStatusError:
            logger.warning("wipe recipe_ingredients failed")

        for table in _WIPE_TABLES:
            try:
                await sb_delete(client, table, {})
            except httpx.HTTPStatusError:
                logger.warning("wipe table %s failed", table)

        try:
            await sb_delete(client, "profiles", {"id": f"eq.{uid}"})
        except httpx.HTTPStatusError:
            logger.warning("profile delete failed")

        if SUPABASE_URL and SUPABASE_KEY:
            try:
                admin_url = build_supabase_auth_admin_url(SUPABASE_URL, uid)
                resp = await client.delete(
                    admin_url,
                    headers={
                        "Authorization": f"Bearer {SUPABASE_KEY}",
                        "apikey": SUPABASE_KEY,
                    },
                )
                if resp.status_code not in (200, 204):
                    logger.warning("auth admin delete %s %s", resp.status_code, resp.text[:200])
            except Exception:
                logger.exception("auth admin delete failed")

    return {"ok": True, "message": "Konto zostało usunięte."}
