"""
Symulacja ruchu POS → magazyn + finanse + (opcjonalnie) zamknięcie dnia.

Użycie (z katalogu backend, z działającym uvicorn):
  python scripts/simulate_pos_sales.py
  python scripts/simulate_pos_sales.py --orders 8 --close-day
"""
from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import sys
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
load_dotenv(os.path.join(ROOT, ".env"))

BACKEND = (os.getenv("EXPO_PUBLIC_BACKEND_URL") or os.getenv("PUBLIC_BACKEND_URL") or "http://127.0.0.1:8001").rstrip("/")
# Prefer local if EXPO points at phone LAN and we're on same machine
if "8001" not in BACKEND:
    BACKEND = "http://127.0.0.1:8001"

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""

SIM_SKU = "SIM-BURGER-01"
SIM_DISH = "Burger Symulacja POS"
SIM_INV_NAME = "Bułka hamburgerowa (SIM)"


def _sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


async def sb_get(client: httpx.AsyncClient, table: str, params: dict) -> list:
    r = await client.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=_sb_headers(), params=params)
    r.raise_for_status()
    return r.json() if r.content else []


async def sb_post(client: httpx.AsyncClient, table: str, payload: dict) -> dict:
    r = await client.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**_sb_headers(), "Prefer": "return=representation"},
        json=payload,
    )
    r.raise_for_status()
    data = r.json()
    return data[0] if isinstance(data, list) and data else (data or {})


async def sb_patch(client: httpx.AsyncClient, table: str, match: dict, payload: dict) -> None:
    headers = {**_sb_headers(), "Prefer": "return=minimal"}
    params = {k: f"eq.{v}" for k, v in match.items()}
    r = await client.patch(f"{SUPABASE_URL}/rest/v1/{table}", headers=headers, params=params, json=payload)
    r.raise_for_status()


async def ensure_seed(client: httpx.AsyncClient) -> dict:
    """Tworzy produkt POS + składnik magazynowy + recepturę jeśli brak."""
    products = await sb_get(client, "pos_products", {
        "select": "id,name,pos_external_id,price_pln",
        "pos_external_id": f"eq.{SIM_SKU}",
        "limit": "1",
    })
    if products:
        product = products[0]
    else:
        product = await sb_post(client, "pos_products", {
            "name": SIM_DISH,
            "pos_external_id": SIM_SKU,
            "price_pln": 32.0,
        })
        print(f"  + pos_products: {product.get('id')}")

    inv = await sb_get(client, "inventory_items", {
        "select": "id,name,quantity,unit,min_quantity",
        "name": f"eq.{SIM_INV_NAME}",
        "limit": "1",
    })
    if inv:
        inventory = inv[0]
    else:
        inventory = await sb_post(client, "inventory_items", {
            "name": SIM_INV_NAME,
            "quantity": 50.0,
            "unit": "szt",
            "min_quantity": 5.0,
            "unit_cost": 1.5,
            "is_critical": False,
            "is_combo_polprodukt": False,
        })
        print(f"  + inventory_items: {inventory.get('id')} (qty=50)")

    recipes = await sb_get(client, "recipes", {
        "select": "id,pos_product_id,warehouse_product_id,quantity_per_portion",
        "pos_product_id": f"eq.{product['id']}",
        "limit": "5",
    })
    if not recipes:
        recipe = await sb_post(client, "recipes", {
            "pos_product_id": product["id"],
            "warehouse_product_id": inventory["id"],
            "quantity_per_portion": 1.0,
            "unit": "szt",
        })
        print(f"  + recipes: {recipe.get('id')} (1 szt bułki / burger)")
    else:
        # odśwież stan magazynu żeby test był czytelny
        await sb_patch(client, "inventory_items", {"id": inventory["id"]}, {"quantity": 50.0})
        inventory["quantity"] = 50.0
        print("  ~ inventory zresetowany do 50 szt (dla czytelnego testu)")

    return {"product": product, "inventory": inventory}


async def snapshot(client: httpx.AsyncClient, inv_id: str) -> dict:
    inv = (await sb_get(client, "inventory_items", {
        "select": "id,name,quantity", "id": f"eq.{inv_id}", "limit": "1",
    }))[0]
    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    revs = await sb_get(client, "revenue_entries", {
        "select": "id,amount_pln,description,year_month",
        "year_month": f"eq.{ym}",
        "order": "created_at.desc",
        "limit": "20",
    })
    pos_rev = sum(float(r["amount_pln"]) for r in revs if str(r.get("description") or "").startswith(("POS:", "[")))
    return {
        "qty": float(inv["quantity"]),
        "revenue_month_posish": round(pos_rev, 2),
        "revenue_rows": len(revs),
    }


async def run_orders(n: int, close_day: bool) -> None:
    print(f"Backend: {BACKEND}")
    print(f"Supabase: {SUPABASE_URL[:40]}...")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("Brak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY w backend/.env")

    async with httpx.AsyncClient(timeout=60.0, verify=False) as client:
        # health
        try:
            h = await client.get(f"{BACKEND}/api/billing/status")
            print(f"Billing status HTTP {h.status_code}: stripe={h.json().get('stripe_configured')}")
        except Exception as e:
            raise SystemExit(f"Backend niedostępny na {BACKEND}: {e}")

        print("\n== Seed POS (produkt + magazyn + receptura) ==")
        seed = await ensure_seed(client)
        inv_id = seed["inventory"]["id"]
        before = await snapshot(client, inv_id)
        print(f"Przed: magazyn={before['qty']} szt, utarg POS~={before['revenue_month_posish']} zł")

        print(f"\n== Symulacja {n} zamówień POS ==")
        total_burgers = 0
        total_revenue = 0.0
        for i in range(1, n + 1):
            # Use cryptographically secure randomness even in simulations,
            # so scanners don't flag weak RNG usage.
            qty = 1 + secrets.randbelow(3)
            total_burgers += qty
            order_id = f"SIM-{datetime.now(timezone.utc).strftime('%H%M%S')}-{i:02d}"
            payload = {
                "external_order_id": order_id,
                "items": [{
                    "pos_external_id": SIM_SKU,
                    "quantity_sold": qty,
                    "unit_price_pln": 32.0,
                }],
            }
            r = await client.post(f"{BACKEND}/api/pos/webhook", json=payload)
            data = r.json()
            if r.status_code != 200 or not data.get("ok"):
                print(f"  FAIL {order_id}: HTTP {r.status_code} {data}")
                continue
            rev = float(data.get("revenue_added_pln") or 0)
            total_revenue += rev
            upd = data.get("inventory_updates") or []
            warn = data.get("warnings") or []
            print(
                f"  OK {order_id}: +{qty} burger(y), +{rev:.2f} zł, "
                f"magazyn_upd={len(upd)}"
                + (f", warnings={warn}" if warn else "")
            )

        after = await snapshot(client, inv_id)
        expected_qty = before["qty"] - total_burgers  # 1 bułka / burger
        print("\n== Weryfikacja ==")
        print(f"Sprzedano burgerów: {total_burgers}")
        print(f"Utarg z symulacji:  {total_revenue:.2f} zł")
        print(f"Magazyn: {before['qty']} -> {after['qty']} (oczekiwane ~{expected_qty})")
        qty_ok = abs(after["qty"] - expected_qty) < 0.01
        rev_ok = after["revenue_month_posish"] + 0.01 >= before["revenue_month_posish"] + total_revenue - 0.5
        print(f"Magazyn OK: {qty_ok}")
        print(f"Finanse (POS w revenue_entries) OK: {rev_ok} "
              f"({before['revenue_month_posish']} -> {after['revenue_month_posish']})")

        if close_day:
            print("\n== Zamknięcie dnia (raport AI) ==")
            cd = await client.post(f"{BACKEND}/api/pos/close-day", json={})
            print(f"HTTP {cd.status_code}: {str(cd.json())[:400]}")
            rep = await client.get(f"{BACKEND}/api/reports/daily")
            body = rep.json()
            print(f"Raporty daily: ok={body.get('ok')} count={body.get('count') or len(body.get('reports') or [])}")
            if body.get("needs_migration"):
                print("  ! Uruchom ADD_DAILY_REPORTS.sql w Supabase")

        print("\nGotowe. Odśwież zakładkę Finanse i Magazyn w aplikacji.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--orders", type=int, default=5)
    p.add_argument("--close-day", action="store_true")
    p.add_argument("--backend", default=None)
    args = p.parse_args()
    global BACKEND
    if args.backend:
        BACKEND = args.backend.rstrip("/")
    asyncio.run(run_orders(args.orders, args.close_day))


if __name__ == "__main__":
    main()
