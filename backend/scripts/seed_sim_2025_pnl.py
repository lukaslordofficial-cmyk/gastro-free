#!/usr/bin/env python3
"""
Symulacja finansowa 2025 — przychody, koszty stałe/zmienne, straty, daily_reports.

Użycie (z katalogu backend):
  python scripts/seed_sim_2025_pnl.py
  python scripts/seed_sim_2025_pnl.py --year 2025 --wipe-sim

Wymaga SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (lub SUPABASE_KEY) w backend/.env.
Wszystkie wpisy mają note zaczynający się od [SIM2025] — łatwo je wyczyścić.
"""
from __future__ import annotations

import argparse
import asyncio
import calendar
import math
import os
import random
import ssl
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import certifi
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
SIM_TAG = "[SIM2025]"


def _httpx_verify():
    """SSL verify for httpx — Windows needs system cert store, not certifi bundle."""
    mode = os.environ.get("OPENAI_SSL_VERIFY", "auto").strip().lower()
    if mode in ("0", "false", "no"):
        return False
    if mode in ("certifi", "bundle"):
        return certifi.where()
    return ssl.create_default_context()

FIXED_TEMPLATES = [
    ("rent", "Czynsz lokalu", 8500),
    ("media", "Prąd + gaz + woda", 2200),
    ("payroll", "Wynagrodzenia kuchnia+sala", 18000),
    ("other", "ZUS / księgowość", 1600),
]

VARIABLE_TEMPLATES = [
    ("materials", "Dostawa warzyw", 0.35),
    ("materials", "Dostawa mięso/ryby", 0.40),
    ("other", "Opakowania / chemia", 0.15),
    ("other", "Mandat / niespodziewane", 0.10),
]


def _headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


async def sb_post(client: httpx.AsyncClient, table: str, rows):
    r = await client.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=_headers(), json=rows)
    if r.status_code >= 400:
        raise RuntimeError(f"POST {table}: {r.status_code} {r.text[:300]}")
    return r.json() if r.text else None


async def sb_delete_sim(client: httpx.AsyncClient, table: str, note_col: str = "note"):
    # PostgREST: note=like.*[SIM2025]*
    params = {note_col: f"like.*{SIM_TAG}*"}
    r = await client.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=_headers(), params=params)
    if r.status_code >= 400:
        print(f"  wipe {table}: {r.status_code} {r.text[:160]}")
    else:
        print(f"  wiped {table}")


def daily_revenue(d: date, rng: random.Random) -> float:
    """Weekend wyższy, sezon letni wyższy, z szumem."""
    base = 4200.0
    if d.weekday() >= 5:
        base *= 1.35
    # sezon: maj–wrzesień
    if d.month in (5, 6, 7, 8, 9):
        base *= 1.18
    if d.month in (1, 2):
        base *= 0.82
    # środa lekko słabsza
    if d.weekday() == 2:
        base *= 0.92
    noise = rng.uniform(0.88, 1.14)
    return round(base * noise, 2)


def month_variable_pool(month: int, days: int, rng: random.Random) -> float:
    # ok. 8–14% przychodów miesiąca jako koszty zmienne bez waste
    avg_day = 4500 * (1.15 if month in (5, 6, 7, 8, 9) else 0.95)
    return round(avg_day * days * rng.uniform(0.09, 0.13), 2)


async def seed_year(year: int, wipe: bool) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Brak SUPABASE_URL / SUPABASE_KEY w .env", file=sys.stderr)
        sys.exit(1)

    rng = random.Random(year * 97 + 2025)
    async with httpx.AsyncClient(timeout=120.0, verify=_httpx_verify()) as client:
        if wipe:
            print("Czyszczenie poprzedniej symulacji…")
            for t in (
                "revenue_entries",
                "fixed_costs",
                "variable_cost_entries",
                "waste_logs",
                "daily_reports",
            ):
                await sb_delete_sim(client, t)

        rev_batch = []
        waste_batch = []
        daily_batch = []
        fixed_batch = []
        var_batch = []

        for month in range(1, 13):
            dim = calendar.monthrange(year, month)[1]
            ym = f"{year:04d}-{month:02d}"

            # koszty stałe miesiąca (lekka sezonowość mediów)
            for typ, name, amount in FIXED_TEMPLATES:
                amt = amount
                if typ == "media" and month in (1, 2, 12):
                    amt = round(amount * 1.25, 2)
                if typ == "media" and month in (6, 7, 8):
                    amt = round(amount * 1.1, 2)  # klimatyzacja
                fixed_batch.append({
                    "year_month": ym,
                    "type": typ,
                    "name": name,
                    "amount_pln": amt,
                    "note": f"{SIM_TAG} {ym} {name}",
                })

            var_pool = month_variable_pool(month, dim, rng)
            # rozbij na kilka pozycji (suma = var_pool)
            remaining = var_pool
            for i, (typ, name, share) in enumerate(VARIABLE_TEMPLATES):
                if i == len(VARIABLE_TEMPLATES) - 1:
                    part = round(remaining, 2)
                else:
                    part = round(var_pool * share * rng.uniform(0.85, 1.15), 2)
                    remaining = round(remaining - part, 2)
                if part > 0:
                    var_batch.append({
                        "year_month": ym,
                        "type": typ,
                        "name": name,
                        "amount_pln": part,
                        "note": f"{SIM_TAG} {ym} {name}",
                    })

            month_rev = 0.0
            month_waste = 0.0
            for day in range(1, dim + 1):
                d = date(year, month, day)
                rev = daily_revenue(d, rng)
                month_rev += rev
                # straty: ~1–4% przychodu w losowe dni (faktyczne, nie proporcja)
                waste = 0.0
                if rng.random() < 0.55:
                    waste = round(rev * rng.uniform(0.008, 0.035), 2)
                    month_waste += waste
                    ts = datetime(year, month, day, 18, rng.randint(0, 50), tzinfo=timezone.utc)
                    waste_batch.append({
                        "item_name": rng.choice([
                            "Salata lodowa", "Losos", "Pomidory", "Smietana 30%",
                            "Kurczak filet", "Pieczywo", "Awokado",
                        ]),
                        "quantity": round(rng.uniform(0.5, 4.0), 2),
                        "unit": "kg",
                        "reason": f"{SIM_TAG} waste {d.isoformat()} cost~{waste}",
                        "item_type": "ingredient",
                        "source": "sim",
                        "created_at": ts.isoformat(),
                    })
                    # równolegle kwota w variable type=waste (fallback PnL)
                    var_batch.append({
                        "year_month": ym,
                        "type": "waste",
                        "name": f"Strata {d.isoformat()}",
                        "amount_pln": waste,
                        "note": f"{SIM_TAG} waste-amt {d.isoformat()}",
                        "created_at": ts.isoformat(),
                    })

                ts_rev = datetime(year, month, day, 22, 5, tzinfo=timezone.utc)
                rev_batch.append({
                    "year_month": ym,
                    "description": f"POS utarg {d.isoformat()}",
                    "amount_pln": rev,
                    "note": f"{SIM_TAG} revenue {d.isoformat()}",
                    "created_at": ts_rev.isoformat(),
                })

                # daily_reports — week_of_month = ceil(day/7)
                wom = min(5, math.ceil(day / 7))
                daily_batch.append({
                    "date": d.isoformat(),
                    "year": year,
                    "month": month,
                    "week_of_month": wom,
                    "total_revenue": rev,
                    "total_waste_cost": waste,
                    "total_invoice_cost": 0,
                    "note": f"{SIM_TAG} day {d.isoformat()}",
                })

            print(f"  {ym}: rev~{month_rev:.0f} PLN, waste~{month_waste:.0f} PLN, fixed~{sum(x['amount_pln'] for x in fixed_batch if x['year_month']==ym):.0f}")

        async def flush(table: str, rows: list, chunk: int = 80):
            if not rows:
                return
            for i in range(0, len(rows), chunk):
                part = rows[i : i + chunk]
                try:
                    await sb_post(client, table, part)
                except RuntimeError as e:
                    msg = str(e)
                    # Strip optional columns that schema may not have
                    drop_sets = [
                        ["note"],
                        ["created_at"],
                        ["note", "created_at"],
                        ["item_type", "source", "related_id", "transcript"],
                        ["note", "created_at", "item_type", "source"],
                    ]
                    ok = False
                    for drop in drop_sets:
                        cleaned = [{k: v for k, v in r.items() if k not in drop} for r in part]
                        try:
                            await sb_post(client, table, cleaned)
                            ok = True
                            break
                        except RuntimeError:
                            continue
                    if not ok and table == "daily_reports":
                        slim = [{
                            k: v for k, v in r.items()
                            if k in ("date", "year", "month", "week_of_month",
                                     "total_revenue", "total_waste_cost", "total_invoice_cost")
                        } for r in part]
                        try:
                            await sb_post(client, table, slim)
                            ok = True
                        except RuntimeError as e2:
                            print(f"  SKIP {table}: {e2}")
                            return
                    if not ok:
                        print(f"  SKIP {table} chunk: {msg[:200]}")
                        return
            print(f"  + {table}: {len(rows)} rows")

        print("Wgrywanie…")
        await flush("fixed_costs", fixed_batch)
        await flush("variable_cost_entries", var_batch)
        await flush("revenue_entries", rev_batch)
        await flush("waste_logs", waste_batch)
        await flush("daily_reports", daily_batch)
        print("Gotowe. Tag wpisów:", SIM_TAG)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2025)
    ap.add_argument("--wipe-sim", action="store_true", help="Usuń poprzednie wpisy [SIM2025]")
    args = ap.parse_args()
    asyncio.run(seed_year(args.year, args.wipe_sim))


if __name__ == "__main__":
    main()
