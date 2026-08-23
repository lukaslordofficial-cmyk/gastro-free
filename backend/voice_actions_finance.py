"""
Proste akcje głosowe: przychody / koszty + resolve kategorii magazynu.

Wydzielone z server.py (helpers bez FastAPI).
"""
from __future__ import annotations

from typing import Optional

import httpx
from fastapi import HTTPException

from supabase_rest import sb_get, sb_post


def current_year_month() -> str:
    from datetime import date
    return date.today().strftime("%Y-%m")


async def apply_revenue(client, p, transcript, source):
    desc = (p.get("description") or "").strip() or "Wpływ (dyktowane)"
    amt = float(p.get("amount_pln") or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Revenue: amount_pln musi być > 0.")
    row = await sb_post(client, "revenue_entries", {
        "year_month": current_year_month(),
        "description": desc, "amount_pln": amt,
        "note": p.get("note") or transcript,
    })
    return row[0]["id"], {"description": desc, "amount_pln": amt}, []


async def apply_fixed_cost(client, p, transcript, source):
    name = (p.get("cost_name") or p.get("description") or "").strip() or "Koszt stały"
    amt = float(p.get("amount_pln") or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Fixed cost: amount_pln musi być > 0.")
    typ = p.get("cost_type") or "other"
    if typ not in ("rent", "media", "payroll", "other"):
        typ = "other"
    row = await sb_post(client, "fixed_costs", {
        "year_month": current_year_month(),
        "type": typ, "name": name, "amount_pln": amt,
        "note": p.get("note") or transcript,
    })
    return row[0]["id"], {"type": typ, "name": name, "amount_pln": amt}, []


async def apply_variable_cost(client, p, transcript, source):
    name = (p.get("cost_name") or p.get("description") or "").strip() or "Koszt zmienny"
    amt = float(p.get("amount_pln") or 0)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Variable cost: amount_pln musi być > 0.")
    typ = p.get("cost_type") or "other"
    if typ not in ("materials", "waste", "other"):
        typ = "other"
    row = await sb_post(client, "variable_cost_entries", {
        "year_month": current_year_month(),
        "type": typ, "name": name, "amount_pln": amt,
        "note": p.get("note") or transcript,
    })
    return row[0]["id"], {"type": typ, "name": name, "amount_pln": amt}, []


async def resolve_category_id(client, name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    rows = await sb_get(client, "inventory_categories",
                        params={"select": "id,name", "name": f"ilike.{name}", "limit": "1"})
    if rows:
        return rows[0]["id"]
    new = await sb_post(client, "inventory_categories", {
        "name": name, "color": "#6B7280", "icon_name": "package",
    })
    return new[0]["id"]
