#!/usr/bin/env python3
"""
Fikcyjne faktury zakupowe 2025 + unit_cost na magazynie — pod testy:
  - Łowca Okazji / wydatki u dostawców (tabela invoices)
  - ranking strat w zł (inventory_items.unit_cost + variable_cost_entries z nazwą produktu)

Tag: [SIM_INV2025]
  wipe+seed:  python scripts/seed_sim_purchase_invoices_2025.py --wipe

Pokrywa WSZYSTKIE produkty z inventory_items (oraz składniki z recipe_ingredients).
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_KEY")
    or ""
).strip()
SIM_TAG = "[SIM_INV2025]"
YEAR = 2025
RNG = random.Random(2025)


def _headers(prefer: str = "return=representation"):
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


async def sb_get(client: httpx.AsyncClient, table: str, params: dict):
    r = await client.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=_headers(), params=params)
    r.raise_for_status()
    return r.json()


async def sb_post(client: httpx.AsyncClient, table: str, rows, *, prefer: str = "return=representation"):
    r = await client.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_headers(prefer),
        json=rows,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"POST {table}: {r.status_code} {r.text[:400]}")
    return r.json() if r.text else None


async def wipe(client: httpx.AsyncClient):
    print(f"Czyszczenie {SIM_TAG}...")
    # invoices
    invs = await sb_get(client, "invoices", {
        "select": "id",
        "note": f"like.*{SIM_TAG}*",
        "limit": "5000",
    }) or []
    for row in invs:
        await client.delete(
            f"{SUPABASE_URL}/rest/v1/invoices",
            headers=_headers("return=minimal"),
            params={"id": f"eq.{row['id']}"},
        )
    print(f"  invoices: {len(invs)}")

    vars_ = await sb_get(client, "variable_cost_entries", {
        "select": "id",
        "note": f"like.*{SIM_TAG}*",
        "limit": "5000",
    }) or []
    for row in vars_:
        await client.delete(
            f"{SUPABASE_URL}/rest/v1/variable_cost_entries",
            headers=_headers("return=minimal"),
            params={"id": f"eq.{row['id']}"},
        )
    print(f"  variable_cost_entries: {len(vars_)}")


def _guess_unit_cost(name: str, unit: str) -> float:
    n = (name or "").lower()
    u = (unit or "kg").lower()
    if any(x in n for x in ("wołow", "wolow", "łosoś", "losos", "krewet")):
        base = 48.0
    elif any(x in n for x in ("kurczak", "pierś", "piers", "indyk", "wieprz")):
        base = 22.0
    elif any(x in n for x in ("ser", "mozzarella", "parmezan", "śmietan", "smietan", "masło", "maslo")):
        base = 28.0
    elif any(x in n for x in ("oliw", "olej")):
        base = 35.0
    elif any(x in n for x in ("bakłażan", "baklazan", "pomidor", "cebula", "ogórek", "ogorek", "sałat", "salat", "burak", "ziemniak")):
        base = 6.5
    elif any(x in n for x in ("bagiet", "chleb", "bułk", "bulk")):
        base = 3.5
    elif any(x in n for x in ("wino", "piwo", "wódka", "wodka")):
        base = 18.0
    else:
        base = 12.0
    if u in ("l", "ml"):
        return round(base * RNG.uniform(0.9, 1.15), 2)
    if u in ("szt", "opak"):
        return round(max(1.5, base * 0.25) * RNG.uniform(0.9, 1.2), 2)
    return round(base * RNG.uniform(0.9, 1.15), 2)


async def load_products(client: httpx.AsyncClient) -> list[dict]:
    inv = await sb_get(client, "inventory_items", {
        "select": "id,name,unit,unit_cost",
        "limit": "5000",
    }) or []
    ri = await sb_get(client, "recipe_ingredients", {
        "select": "ingredient_name,unit",
        "limit": "5000",
    }) or []
    by_name: dict[str, dict] = {}
    for r in inv:
        name = (r.get("name") or "").strip()
        if not name:
            continue
        by_name[name.lower()] = {
            "id": r.get("id"),
            "name": name,
            "unit": (r.get("unit") or "kg").strip() or "kg",
            "unit_cost": float(r.get("unit_cost") or 0),
        }
    for r in ri:
        name = (r.get("ingredient_name") or "").strip()
        if not name or name.lower() in by_name:
            continue
        by_name[name.lower()] = {
            "id": None,
            "name": name,
            "unit": (r.get("unit") or "kg").strip() or "kg",
            "unit_cost": 0.0,
        }
    return list(by_name.values())


async def load_suppliers(client: httpx.AsyncClient) -> list[dict]:
    rows = await sb_get(client, "suppliers", {
        "select": "id,name,notes,is_active",
        "is_active": "eq.true",
        "limit": "100",
    }) or []
    # prefer SIM_SUP, else any
    sim = [r for r in rows if SIM_TAG.replace("INV", "SUP")[:8] in str(r.get("notes") or "") or "[SIM_SUP]" in str(r.get("notes") or "")]
    return sim or rows or [{"id": None, "name": "SIM Hurtownia Test"}]


async def patch_unit_costs(client: httpx.AsyncClient, products: list[dict]):
    patched = 0
    for p in products:
        if not p.get("id"):
            continue
        cost = p["unit_cost"] if p["unit_cost"] > 0 else _guess_unit_cost(p["name"], p["unit"])
        p["unit_cost"] = cost
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/inventory_items",
            headers=_headers("return=minimal"),
            params={"id": f"eq.{p['id']}"},
            json={"unit_cost": cost},
        )
        if r.status_code < 300:
            patched += 1
    print(f"  unit_cost ustawione: {patched}")


async def seed(client: httpx.AsyncClient):
    products = await load_products(client)
    suppliers = await load_suppliers(client)
    print(f"Produkty: {len(products)}, dostawcy: {len(suppliers)}")
    await patch_unit_costs(client, products)

    # 12 miesięcy × kilka faktur rozdzielonych między dostawców
    invoice_rows = []
    var_rows = []
    # rozłóż produkty na miesiące
    chunk_size = max(1, (len(products) + 11) // 12)
    for month in range(1, 13):
        start = (month - 1) * chunk_size
        batch = products[start:start + chunk_size] or products[: min(8, len(products))]
        # 2 faktury na miesiąc u różnych dostawców
        for wave in range(2):
            half = batch[wave::2] or batch
            if not half:
                continue
            sup = suppliers[(month + wave) % len(suppliers)]
            day = 5 + wave * 12
            lines = []
            total = 0.0
            for p in half:
                qty = round(RNG.uniform(2.0, 12.0), 1)
                unit = p["unit"] if p["unit"] in ("kg", "l", "szt") else "kg"
                # jednostka receptury g/ml → kupujemy w kg/l
                if unit in ("g", "ml"):
                    unit = "kg" if unit == "g" else "l"
                    qty = round(RNG.uniform(2.0, 8.0), 1)
                uc = p["unit_cost"] if p["unit_cost"] > 0 else _guess_unit_cost(p["name"], unit)
                line_total = round(qty * uc, 2)
                total += line_total
                lines.append(f"{p['name']} {qty} {unit} = {line_total:.2f} zł")
                # osobny wpis kosztów zmiennych — lookup strat po nazwie + ilości
                ym = f"{YEAR}-{month:02d}"
                ts = datetime(YEAR, month, day, 10 + wave, 0, tzinfo=timezone.utc)
                var_rows.append({
                    "year_month": ym,
                    "type": "materials",
                    "name": f"Zakup {p['name']}",
                    "amount_pln": line_total,
                    "description": f"{p['name']} {qty} {unit}",
                    "note": f"{SIM_TAG} {p['name']} {qty} {unit} za {line_total:.2f} zł",
                    "created_at": ts.isoformat(),
                })
            ts_inv = datetime(YEAR, month, day, 11 + wave, 0, tzinfo=timezone.utc)
            invoice_rows.append({
                "supplier_id": sup.get("id"),
                "supplier_name": sup.get("name") or "SIM Hurtownia",
                "total_cost": round(total, 2),
                "note": f"{SIM_TAG} FV/{YEAR}/{month:02d}-{wave + 1}: " + "; ".join(lines[:12]),
                "created_at": ts_inv.isoformat(),
            })

    print(f"Wgrywanie invoices ({len(invoice_rows)})...")
    for i in range(0, len(invoice_rows), 40):
        await sb_post(client, "invoices", invoice_rows[i:i + 40], prefer="return=minimal")

    print(f"Wgrywanie variable_cost_entries ({len(var_rows)})...")
    for i in range(0, len(var_rows), 50):
        try:
            await sb_post(client, "variable_cost_entries", var_rows[i:i + 50], prefer="return=minimal")
        except RuntimeError as e:
            # description może nie istnieć — bez tego pola
            if "description" in str(e):
                cleaned = [{k: v for k, v in row.items() if k != "description"} for row in var_rows[i:i + 50]]
                await sb_post(client, "variable_cost_entries", cleaned, prefer="return=minimal")
            else:
                raise

    print("Gotowe.")
    print("Test: 'Pokaż straty w złotówkach za 2026' (po unit_cost) / 'Wydatki u dostawców za 2025'")
    print(f"Tag: {SIM_TAG}")


async def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("Brak SUPABASE_URL / SUPABASE_KEY w .env")
    ap = argparse.ArgumentParser()
    ap.add_argument("--wipe", action="store_true")
    args = ap.parse_args()
    async with httpx.AsyncClient(verify=False, timeout=120) as client:
        if args.wipe:
            await wipe(client)
        await seed(client)


if __name__ == "__main__":
    asyncio.run(main())
