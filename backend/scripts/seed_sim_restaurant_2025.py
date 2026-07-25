#!/usr/bin/env python3
"""
Szkielet + seed symulacji małej restauracji za rok 2025.

Co tworzy (tag [SIM2025] w note / reason):
  1) pos_sales_log     — codzienna sprzedaż POS (potrawy z menu_items.pos_id)
  2) revenue_entries   — dzienny utarg (spójny z POS)
  3) fixed_costs       — miesięcznie: czynsz, wynagrodzenia, media
  4) variable_cost_entries — miesięcznie: dostawy produktów (COGS)
  5) daily_reports     — opcjonalnie (fallback PnL)

Cel finansowy: ok. 5–10 tys. zł zysku netto / miesiąc
  (przychód − stałe − dostawy; bez strat w tej wersji).

Użycie (katalog backend):
  set OPENAI_SSL_VERIFY=0
  python scripts/seed_sim_restaurant_2025.py --wipe
  python scripts/seed_sim_restaurant_2025.py

Wymaga SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (lub SUPABASE_KEY) w .env.
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
YEAR = 2025

# ── Model małej restauracji (miesiąc) ───────────────────────────────────────
# Przychód ~48–55k → stałe ~28k → dostawy ~30% utargu → zysk ~6–10k
FIXED_MONTHLY = [
    ("rent", "Czynsz lokalu", 6500.0),
    ("payroll", "Wynagrodzenia kuchnia+sala", 18500.0),
    ("media", "Prad + gaz + woda", 2800.0),
]
COGS_RATIO = 0.30  # dostawy / utarg
TARGET_DAILY_REV_WEEKDAY = 1600.0
TARGET_DAILY_REV_WEEKEND = 2300.0


def _httpx_verify():
    mode = os.environ.get("OPENAI_SSL_VERIFY", "auto").strip().lower()
    if mode in ("0", "false", "no"):
        return False
    if mode in ("certifi", "bundle"):
        return certifi.where()
    return ssl.create_default_context()


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


async def sb_post(client: httpx.AsyncClient, table: str, rows):
    r = await client.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=_headers(), json=rows)
    if r.status_code >= 400:
        raise RuntimeError(f"POST {table}: {r.status_code} {r.text[:400]}")
    return r.json() if r.text else None


async def sb_delete_like(client: httpx.AsyncClient, table: str, col: str, pattern: str):
    r = await client.delete(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_headers("return=minimal"),
        params={col: f"like.{pattern}"},
    )
    print(f"  wipe {table} ({col} like {pattern}): {r.status_code}")


async def wipe_sim(client: httpx.AsyncClient):
    print("Czyszczenie poprzedniej symulacji [SIM2025]...")
    await sb_delete_like(client, "revenue_entries", "note", f"*{SIM_TAG}*")
    await sb_delete_like(client, "fixed_costs", "note", f"*{SIM_TAG}*")
    await sb_delete_like(client, "variable_cost_entries", "note", f"*{SIM_TAG}*")
    # Stary tag SIM2025-* (jeśli kiedyś tak seedowano)
    r = await client.delete(
        f"{SUPABASE_URL}/rest/v1/pos_sales_log",
        headers=_headers("return=minimal"),
        params={"pos_external_id": "like.SIM2025-*"},
    )
    print(f"  wipe pos_sales_log (SIM2025-*): {r.status_code}")
    # Seed zapisuje prawdziwe pos_id menu + processed_at w YEAR —
    # bez tego wipe zostawia rozjechane ID po skanie/przywróceniu menu.
    r2 = await client.delete(
        f"{SUPABASE_URL}/rest/v1/pos_sales_log",
        headers=_headers("return=minimal"),
        params=[
            ("processed_at", f"gte.{YEAR}-01-01T00:00:00Z"),
            ("processed_at", f"lte.{YEAR}-12-31T23:59:59Z"),
        ],
    )
    print(f"  wipe pos_sales_log (processed_at {YEAR}): {r2.status_code}")
    try:
        await sb_delete_like(client, "daily_reports", "note", f"*{SIM_TAG}*")
    except Exception:
        pass
    # daily_reports bez note — po dacie roku
    try:
        r3 = await client.delete(
            f"{SUPABASE_URL}/rest/v1/daily_reports",
            headers=_headers("return=minimal"),
            params=[
                ("date", f"gte.{YEAR}-01-01"),
                ("date", f"lte.{YEAR}-12-31"),
            ],
        )
        print(f"  wipe daily_reports ({YEAR}): {r3.status_code}")
    except Exception as e:
        print(f"  wipe daily_reports skip: {e}")


async def load_menu(client: httpx.AsyncClient) -> list[dict]:
    rows = await sb_get(client, "menu_items", {
        "select": "id,name,pos_id,price_pln,is_active",
        "is_active": "eq.true",
        "limit": "500",
    }) or []
    usable = []
    patched = 0
    for r in rows:
        pos = (r.get("pos_id") or "").strip()
        if not pos:
            continue
        price = float(r.get("price_pln") or 0)
        if price <= 0:
            # Ranking POS bierze cene z menu_items — uzupelnij brakujace ceny testowe
            price = round(random.uniform(24, 52), 2)
            try:
                await client.patch(
                    f"{SUPABASE_URL}/rest/v1/menu_items",
                    headers=_headers("return=minimal"),
                    params={"id": f"eq.{r['id']}"},
                    json={"price_pln": price},
                )
                patched += 1
            except Exception as e:
                print(f"  warn price patch {r.get('name')}: {e}")
        usable.append({
            "id": r["id"],
            "name": r.get("name") or pos,
            "pos_id": pos,
            "price_pln": price,
        })
    if patched:
        print(f"  Uzupelniono ceny testowe na {patched} daniach (price_pln=0).")
    return usable


def pick_day_sales(menu: list[dict], d: date, rng: random.Random) -> list[dict]:
    """Losuje 4–10 pozycji menu na dzień, qty 1–6."""
    weekend = d.weekday() >= 5
    target = TARGET_DAILY_REV_WEEKEND if weekend else TARGET_DAILY_REV_WEEKDAY
    # sezon letni
    if d.month in (5, 6, 7, 8, 9):
        target *= 1.12
    if d.month in (1, 2):
        target *= 0.88
    target *= rng.uniform(0.92, 1.08)

    n_lines = rng.randint(5, 10)
    chosen = rng.sample(menu, k=min(n_lines, len(menu)))
    lines = []
    running = 0.0
    for dish in chosen:
        qty = rng.randint(1, 6)
        if weekend:
            qty = rng.randint(2, 8)
        unit = float(dish["price_pln"])
        lines.append({
            "pos_external_id": dish["pos_id"],
            "pos_product_id": dish["id"],
            "quantity_sold": qty,
            "unit_price_pln": unit,
            "line_total": round(qty * unit, 2),
            "name": dish["name"],
        })
        running += qty * unit

    # dociągnij do targetu dodatkowymi sztukami najlepiej sprzedającego się
    if running < target * 0.75 and lines:
        top = max(lines, key=lambda x: x["unit_price_pln"])
        need = target - running
        add = max(1, int(need / max(top["unit_price_pln"], 1)))
        top["quantity_sold"] += add
        top["line_total"] = round(top["quantity_sold"] * top["unit_price_pln"], 2)
        running = sum(x["line_total"] for x in lines)

    return lines


async def flush(client: httpx.AsyncClient, table: str, rows: list, chunk: int = 100):
    if not rows:
        return
    for i in range(0, len(rows), chunk):
        part = rows[i : i + chunk]
        try:
            await sb_post(client, table, part)
        except RuntimeError as e:
            msg = str(e)
            # spróbuj bez opcjonalnych kolumn
            drop_sets = [
                ["note"],
                ["unit_price_pln"],
                ["note", "unit_price_pln"],
                ["pos_product_id"],
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
            if not ok:
                print(f"  SKIP {table}: {msg[:250]}")
                return
    print(f"  + {table}: {len(rows)} rows")


async def seed(wipe: bool) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Brak SUPABASE_URL / SUPABASE_KEY w .env", file=sys.stderr)
        sys.exit(1)

    rng = random.Random(2025 * 17)
    async with httpx.AsyncClient(timeout=180.0, verify=_httpx_verify()) as client:
        if wipe:
            await wipe_sim(client)

        menu = await load_menu(client)
        if len(menu) < 3:
            print(
                f"Za malo pozycji menu z pos_id (mam {len(menu)}). "
                "Dodaj dania z mapowaniem POS w Ustawieniach.",
                file=sys.stderr,
            )
            sys.exit(1)
        print(f"Menu POS: {len(menu)} pozycji (przyklad: {menu[0]['name']} @ {menu[0]['price_pln']} zl)")

        pos_batch: list[dict] = []
        rev_batch: list[dict] = []
        fixed_batch: list[dict] = []
        var_batch: list[dict] = []
        daily_batch: list[dict] = []

        month_rev = {m: 0.0 for m in range(1, 13)}

        for month in range(1, 13):
            dim = calendar.monthrange(YEAR, month)[1]
            ym = f"{YEAR:04d}-{month:02d}"

            for day in range(1, dim + 1):
                d = date(YEAR, month, day)
                lines = pick_day_sales(menu, d, rng)
                day_total = round(sum(x["line_total"] for x in lines), 2)
                month_rev[month] += day_total

                hour = 12 + (day % 8)
                for line in lines:
                    ts = datetime(YEAR, month, day, hour, rng.randint(0, 59), tzinfo=timezone.utc)
                    pos_batch.append({
                        "pos_external_id": line["pos_external_id"],
                        "pos_product_id": line["pos_product_id"],
                        "quantity_sold": line["quantity_sold"],
                        "processed_at": ts.isoformat(),
                    })

                ts_rev = datetime(YEAR, month, day, 22, 5, tzinfo=timezone.utc)
                rev_batch.append({
                    "year_month": ym,
                    "description": f"POS utarg {d.isoformat()} {SIM_TAG}",
                    "amount_pln": day_total,
                    "note": f"{SIM_TAG} revenue {d.isoformat()}",
                    "created_at": ts_rev.isoformat(),
                })

                wom = min(5, math.ceil(day / 7))
                daily_batch.append({
                    "date": d.isoformat(),
                    "year": YEAR,
                    "month": month,
                    "week_of_month": wom,
                    "total_revenue": day_total,
                    "total_waste_cost": 0,
                    "total_invoice_cost": 0,
                })

            # koszty stałe miesiąca
            for typ, name, amount in FIXED_MONTHLY:
                amt = amount
                if typ == "media" and month in (1, 2, 12):
                    amt = round(amount * 1.2, 2)
                if typ == "media" and month in (6, 7, 8):
                    amt = round(amount * 1.15, 2)
                fixed_batch.append({
                    "year_month": ym,
                    "type": typ,
                    "name": name,
                    "amount_pln": amt,
                    "note": f"{SIM_TAG} {ym} {name}",
                })

            # dostawy = COGS_RATIO * utarg miesiąca (rozbite na 2–3 faktury)
            cogs = round(month_rev[month] * COGS_RATIO, 2)
            parts = [
                ("materials", "Dostawa warzywa/owoce", 0.35),
                ("materials", "Dostawa mieso/ryby/nabial", 0.45),
                ("materials", "Dostawa pieczywo/suche", 0.20),
            ]
            rem = cogs
            for i, (typ, name, share) in enumerate(parts):
                if i == len(parts) - 1:
                    part = round(rem, 2)
                else:
                    part = round(cogs * share, 2)
                    rem = round(rem - part, 2)
                var_batch.append({
                    "year_month": ym,
                    "type": typ,
                    "name": name,
                    "amount_pln": part,
                    "note": f"{SIM_TAG} {ym} {name}",
                })

            fixed_sum = sum(x["amount_pln"] for x in fixed_batch if x["year_month"] == ym)
            var_sum = sum(x["amount_pln"] for x in var_batch if x["year_month"] == ym)
            profit = round(month_rev[month] - fixed_sum - var_sum, 2)
            print(
                f"  {ym}: utarg={month_rev[month]:.0f}  stale={fixed_sum:.0f}  "
                f"dostawy={var_sum:.0f}  zysk~{profit:.0f} PLN"
            )

        print("Wgrywanie do Supabase...")
        await flush(client, "pos_sales_log", pos_batch, chunk=80)
        await flush(client, "revenue_entries", rev_batch, chunk=80)
        await flush(client, "fixed_costs", fixed_batch, chunk=50)
        await flush(client, "variable_cost_entries", var_batch, chunk=50)
        await flush(client, "daily_reports", daily_batch, chunk=80)

        print("Gotowe.")
        print("Jarvis: 'Pokaż zyski z marca 2025' / 'Najlepiej sprzedające się dania w 2025'")
        print(f"Tag wpisów: {SIM_TAG}")


def main():
    ap = argparse.ArgumentParser(description="Seed symulacji restauracji 2025")
    ap.add_argument("--wipe", action="store_true", help="Usun poprzednie [SIM2025] przed wgraniem")
    ap.add_argument("--year", type=int, default=2025)
    args = ap.parse_args()
    global YEAR
    YEAR = args.year
    asyncio.run(seed(args.wipe))


if __name__ == "__main__":
    main()
