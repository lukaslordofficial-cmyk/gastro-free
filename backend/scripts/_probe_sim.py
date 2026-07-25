#!/usr/bin/env python3
"""Szybki podglad: menu + SIM2025 counts."""
import asyncio, os
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
import httpx

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY") or "").strip()
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

async def main():
    async with httpx.AsyncClient(timeout=60, verify=False) as c:
        r = await c.get(f"{URL}/rest/v1/menu_items", headers=H, params={
            "select": "id,name,pos_id,price_pln", "is_active": "eq.true", "limit": "200",
        })
        items = r.json()
        with_pos = [i for i in items if i.get("pos_id")]
        with_price = [i for i in items if float(i.get("price_pln") or 0) > 0]
        print("menu", len(items), "with_pos", len(with_pos), "with_price", len(with_price))
        for i in (with_price or with_pos)[:8]:
            name = (i.get("name") or "")[:40]
            print(" ", i.get("pos_id"), i.get("price_pln"), name)

        for ym in ("2025-03", "2025-07"):
            r2 = await c.get(f"{URL}/rest/v1/revenue_entries", headers=H, params={
                "select": "amount_pln", "year_month": f"eq.{ym}", "limit": "2000",
            })
            rows = r2.json()
            s = round(sum(float(x["amount_pln"]) for x in rows), 2)
            print(ym, "rev rows", len(rows), "sum", s)

        r3 = await c.get(f"{URL}/rest/v1/pos_sales_log", headers=H, params={
            "select": "processed_at,pos_external_id",
            "processed_at": "gte.2025-01-01",
            "limit": "5",
            "order": "processed_at.asc",
        })
        print("pos 2025 sample", r3.status_code, r3.text[:200])

asyncio.run(main())
