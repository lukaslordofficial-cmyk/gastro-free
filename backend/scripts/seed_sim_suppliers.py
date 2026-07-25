#!/usr/bin/env python3
"""
Seed dostawców + katalogów pod testy Łowcy Okazji (zakładka Dostawcy).

Tworzy 6 dużych hurtowni z różnymi:
  - minimami zamówienia (min_order_value)
  - kosztem dostawy (shipping_cost)
  - progiem darmowej dostawy (free_shipping_threshold)
  - cenami / opakowaniami (kg, l, szt)

Katalog łącznie pokrywa WSZYSTKIE składniki z recipe_ingredients
(nazwy 1:1 → fuzzy match w compare-offers). Kluczowe produkty
są u 2–3 dostawców w różnych cenach, żeby optymalizator miał co porównywać.

Tag w notes: [SIM_SUP]
  wipe:  python scripts/seed_sim_suppliers.py --wipe
  seed:  python scripts/seed_sim_suppliers.py --wipe

Wymaga SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (lub SUPABASE_KEY) w .env.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import re
import unicodedata
from collections import Counter, defaultdict
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
SIM_TAG = "[SIM_SUP]"
RNG = random.Random(2025)

# ── 6 hurtowni: różne reguły logistyczne ─────────────────────────────────────
SUPPLIERS_DEF = [
    {
        "key": "makro",
        "name": "Makro Gastro Cash",
        "category": "Ogólnospożywczy",
        "nip": "5250001001",
        "contact_person": "Anna Kowalska",
        "phone": "+48 22 111 22 01",
        "email": "zamowienia@makro-gastro-sim.pl",
        "icon_color": "#2563EB",
        "min_order_value": 1500.0,
        "shipping_cost": 89.0,
        "free_shipping_threshold": 2500.0,
        "notes": f"{SIM_TAG} Hurtownia ogólna — szeroki asortyment, wyższe minimum.",
        "price_mult": 1.00,  # baza
        "coverage": "general",  # ~wszystko
    },
    {
        "key": "euro",
        "name": "EuroCash FoodService",
        "category": "Ogólnospożywczy",
        "nip": "5250001002",
        "contact_person": "Piotr Nowak",
        "phone": "+48 22 111 22 02",
        "email": "orders@eurocash-fs-sim.pl",
        "icon_color": "#DC2626",
        "min_order_value": 800.0,
        "shipping_cost": 49.0,
        "free_shipping_threshold": 1200.0,
        "notes": f"{SIM_TAG} Konkurent ogólny — niższe minimum, trochę drożej.",
        "price_mult": 1.08,
        "coverage": "general",
    },
    {
        "key": "meat",
        "name": "MEAT&FRESH Hurt",
        "category": "Mięso & Wędliny",
        "nip": "5250001003",
        "contact_person": "Marek Woźniak",
        "phone": "+48 22 111 22 03",
        "email": "biuro@meatfresh-sim.pl",
        "icon_color": "#7C3AED",
        "min_order_value": 500.0,
        "shipping_cost": 35.0,
        "free_shipping_threshold": 900.0,
        "notes": f"{SIM_TAG} Specjalista mięso/ryby — najlepsze ceny protein.",
        "price_mult": 0.88,
        "coverage": "meat",
    },
    {
        "key": "fresh",
        "name": "Zielony Koszyk Fresh",
        "category": "Warzywa & Owoce",
        "nip": "5250001004",
        "contact_person": "Ewa Zielińska",
        "phone": "+48 22 111 22 04",
        "email": "sklep@zielonykoszyk-sim.pl",
        "icon_color": "#16A34A",
        "min_order_value": 300.0,
        "shipping_cost": 25.0,
        "free_shipping_threshold": 550.0,
        "notes": f"{SIM_TAG} Warzywa i owoce — tanie skrzynie 5–10 kg.",
        "price_mult": 0.85,
        "coverage": "produce",
    },
    {
        "key": "dairy",
        "name": "DairyPro Nabiał",
        "category": "Nabiał & Sery",
        "nip": "5250001005",
        "contact_person": "Katarzyna Mleczna",
        "phone": "+48 22 111 22 05",
        "email": "zamow@dairypro-sim.pl",
        "icon_color": "#0891B2",
        "min_order_value": 400.0,
        "shipping_cost": 30.0,
        "free_shipping_threshold": 700.0,
        "notes": f"{SIM_TAG} Nabiał i sery — chłodnia, dobre ceny.",
        "price_mult": 0.90,
        "coverage": "dairy",
    },
    {
        "key": "pantry",
        "name": "Pantry & Bar Dry",
        "category": "Suche & Sypkie",
        "nip": "5250001006",
        "contact_person": "Tomasz Suchy",
        "phone": "+48 22 111 22 06",
        "email": "hurt@pantrybar-sim.pl",
        "icon_color": "#D97706",
        "min_order_value": 200.0,
        "shipping_cost": 19.0,
        "free_shipping_threshold": 450.0,
        "notes": f"{SIM_TAG} Suche, oleje, sosy, napoje — niskie minimum.",
        "price_mult": 0.92,
        "coverage": "dry",
    },
]

# Słowa kluczowe → kategoria coverage (kolejność: pierwsze dopasowanie wygrywa)
_CAT_RULES: list[tuple[str, list[str]]] = [
    (
        "meat",
        [
            "kurczak", "piers", "pierś", "wolow", "wołow", "wieprz", "polędw", "poledw",
            "boczek", "szynka", "salami", "rostbef", "kotlet", "nugget", "losos", "łosoś",
            "krewet", "owoc.*morz", "ryb", "mielon",
        ],
    ),
    (
        "produce",
        [
            "cebula", "czosnek", "pomidor", "ogorek", "ogórek", "sałat", "salat", "rukola",
            "papryk", "cukini", "ziemniak", "marchew", "seler", "pietruszk", "burak",
            "batat", "dynia", "baklaz", "bakłaż", "awokado", "cytryn", "jablk", "jabłk",
            "pomaranc", "pomarańcz", "winogron", "owoc", "warzyw", "grzyb", "pieczark",
            "borowik", "bazyl", "rozmaryn", "koper", "imbir", "natka", "oregano", "ziol",
            "zioł",
        ],
    ),
    (
        "dairy",
        [
            "maslo", "masło", "smietan", "śmietan", "ser ", "ser$", "cheddar", "parmezan",
            "mascarpone", "twarog", "twaróg", "feta", "jogurt", "jajk", "jajko", "zoltko",
            "żółtko", "lody",
        ],
    ),
    (
        "dry",
        [
            "sol", "sól", "cukier", "maka", "mąka", "oliwa", "olej", "makaron", "ryz", "ryż",
            "quinoa", "tagliatelle", "spaghetti", "bulion", "sos ", "musztard", "keczup",
            "ketchup", "winegret", "vinaigrette", "vinegret", "balsamic", "kawa", "herbata",
            "woda", "czekolad", "biszkopt", "ciasto", "zelatyn", "żelatyn", "cynamon",
            "miod", "miód", "orzech", "bagiet", "bulka", "bułka", "grzank", "frytk",
            "opak",
        ],
    ),
]


def _strip_pl(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return s.lower().strip()


def classify_ingredient(name: str) -> str:
    n = _strip_pl(name)
    for cat, patterns in _CAT_RULES:
        for pat in patterns:
            if re.search(pat, n):
                return cat
    return "dry"  # fallback do pantrynych / ogólnych


# Orientacyjne ceny hurtowe za 1 kg / 1 l / 1 szt (PLN)
_BASE_PRICE_HINTS: list[tuple[str, float, str]] = [
    (r"piers|pierś|kurczak filet|kurczak$", 22.0, "kg"),
    (r"nugget", 18.0, "kg"),
    (r"wolow.*miel|wołow.*miel|mielon", 32.0, "kg"),
    (r"kotlet wol|kotlet woł|rostbef|wolowin|wołowin", 48.0, "kg"),
    (r"poledw|polędw|wieprz", 28.0, "kg"),
    (r"boczek", 24.0, "kg"),
    (r"szynka|salami", 55.0, "kg"),
    (r"losos|łosoś", 65.0, "kg"),
    (r"krewet|owoc.*morz", 72.0, "kg"),
    (r"parmezan", 85.0, "kg"),
    (r"cheddar|ser zolt|ser żółt|ser kozi|ser plen|ser pleś|feta|twarog|twaróg", 38.0, "kg"),
    (r"mascarpone", 28.0, "kg"),
    (r"maslo|masło", 32.0, "kg"),
    (r"smietan|śmietan", 8.5, "l"),
    (r"jogurt", 6.5, "l"),
    (r"jajk|jajko|zoltko|żółtko", 0.85, "szt"),
    (r"lody", 18.0, "kg"),
    (r"oliwa", 28.0, "l"),
    (r"olej", 9.5, "l"),
    (r"bulion", 4.5, "l"),
    (r"sos |winegret|vinaigrette|vinegret|balsamic|musztard|keczup|ketchup", 12.0, "l"),
    (r"kawa", 45.0, "kg"),
    (r"herbata", 35.0, "kg"),
    (r"woda$", 1.2, "l"),
    (r"cukier|sol$|sól$", 3.2, "kg"),
    (r"makaron|tagliatelle|spaghetti|ryz|ryż|quinoa", 6.5, "kg"),
    (r"bulka|bułka|bagiet|grzank|biszkopt|ciasto", 8.0, "kg"),
    (r"bulka brioche|bułka brioche|bulka hamburger|bułka hamburger|bulka pelnoz|bułka pełnoz", 2.2, "szt"),
    (r"frytk", 9.0, "kg"),
    (r"orzech", 42.0, "kg"),
    (r"czekolad|zelatyn|żelatyn|cynamon|miod|miód", 25.0, "kg"),
    (r"ziemniak|batat|marchew|cebula|burak|dynia|seler", 3.5, "kg"),
    (r"pomidor|ogorek|ogórek|papryk|cukini|baklaz|bakłaż|sałat|salat|rukola|awokado", 8.0, "kg"),
    (r"czosnek|imbir|bazyl|rozmaryn|koper|natka|pietruszk|oregano|ziol|zioł", 25.0, "kg"),
    (r"cytryn|jablk|jabłk|pomaranc|pomarańcz|winogron|owoc", 7.5, "kg"),
    (r"grzyb|pieczark|borowik", 22.0, "kg"),
]


def base_unit_and_price(name: str, recipe_unit: str) -> tuple[str, float]:
    """Zwraca (base_dim kg|l|szt, cena_za_jednostkę_bazową)."""
    n = _strip_pl(name)
    ru = (recipe_unit or "").strip().lower()
    for pat, price, dim in _BASE_PRICE_HINTS:
        if re.search(pat, n):
            return dim, price
    # fallback z jednostki receptury
    if ru in ("ml", "l"):
        return "l", 10.0
    if ru in ("szt", "sztuka", "sztuk"):
        return "szt", 2.5
    return "kg", 12.0


def pack_options(dim: str) -> list[dict]:
    """Różne opakowania: variant, volume_label, unit, unit_count, kg_total, liters_total, pack_factor."""
    if dim == "l":
        return [
            {"variant": "1 l", "volume_label": "1 l", "unit": "l", "unit_count": 1,
             "kg_total": 0, "liters_total": 1.0, "qty": 1.0},
            {"variant": "5 l", "volume_label": "5 l", "unit": "l", "unit_count": 1,
             "kg_total": 0, "liters_total": 5.0, "qty": 5.0},
        ]
    if dim == "szt":
        return [
            {"variant": "1 szt", "volume_label": "1 szt", "unit": "szt", "unit_count": 1,
             "kg_total": 0, "liters_total": 0, "qty": 1.0},
            {"variant": "opak. 10 szt", "volume_label": "10 szt", "unit": "opak", "unit_count": 10,
             "kg_total": 0, "liters_total": 0, "qty": 10.0},
            {"variant": "tacka 30 szt", "volume_label": "30 szt", "unit": "opak", "unit_count": 30,
             "kg_total": 0, "liters_total": 0, "qty": 30.0},
        ]
    # kg
    return [
        {"variant": "1 kg", "volume_label": "1 kg", "unit": "kg", "unit_count": 1,
         "kg_total": 1.0, "liters_total": 0, "qty": 1.0},
        {"variant": "2.5 kg", "volume_label": "2.5 kg", "unit": "kg", "unit_count": 1,
         "kg_total": 2.5, "liters_total": 0, "qty": 2.5},
        {"variant": "5 kg", "volume_label": "5 kg", "unit": "kg", "unit_count": 1,
         "kg_total": 5.0, "liters_total": 0, "qty": 5.0},
    ]


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
        raise RuntimeError(f"POST {table}: {r.status_code} {r.text[:500]}")
    return r.json() if r.text else None


async def wipe_sim(client: httpx.AsyncClient):
    print(f"Czyszczenie poprzednich dostawców {SIM_TAG}...")
    rows = await sb_get(client, "suppliers", {
        "select": "id,name,notes",
        "notes": f"like.*{SIM_TAG}*",
        "limit": "100",
    }) or []
    if not rows:
        print("  (brak poprzednich SIM_SUP)")
        return
    ids = [r["id"] for r in rows]
    # katalog najpierw (FK)
    for sid in ids:
        r = await client.delete(
            f"{SUPABASE_URL}/rest/v1/supplier_catalog",
            headers=_headers("return=minimal"),
            params={"supplier_id": f"eq.{sid}"},
        )
        print(f"  wipe catalog {sid[:8]}... -> {r.status_code}")
    for sid in ids:
        r = await client.delete(
            f"{SUPABASE_URL}/rest/v1/suppliers",
            headers=_headers("return=minimal"),
            params={"id": f"eq.{sid}"},
        )
        print(f"  wipe supplier {sid[:8]}... -> {r.status_code}")


async def load_ingredients(client: httpx.AsyncClient) -> list[dict]:
    """Unikalne składniki z receptur (+ uzupełnienie z magazynu)."""
    ri = await sb_get(client, "recipe_ingredients", {
        "select": "ingredient_name,unit",
        "limit": "5000",
    }) or []
    inv = await sb_get(client, "inventory_items", {
        "select": "name,unit",
        "limit": "5000",
    }) or []

    units: dict[str, Counter] = defaultdict(Counter)
    for r in ri:
        name = (r.get("ingredient_name") or "").strip()
        if not name:
            continue
        units[name][(r.get("unit") or "").strip().lower()] += 1

    # magazyn — dodaj brakujące nazwy
    for i in inv:
        name = (i.get("name") or "").strip()
        if not name or name in units:
            continue
        if name.lower().endswith("(sim)"):
            continue
        units[name][(i.get("unit") or "kg").strip().lower()] += 1

    out = []
    for name, uc in sorted(units.items(), key=lambda kv: kv[0].lower()):
        recipe_unit = uc.most_common(1)[0][0] if uc else "g"
        cat = classify_ingredient(name)
        dim, base_price = base_unit_and_price(name, recipe_unit)
        out.append({
            "name": name,
            "recipe_unit": recipe_unit,
            "category": cat,
            "dim": dim,
            "base_price": base_price,
        })
    return out


def suppliers_for_product(prod: dict) -> list[dict]:
    """Którzy dostawcy oferują ten produkt (ogólni + specjalista + czasem drugi)."""
    cat = prod["category"]
    chosen = []
    for s in SUPPLIERS_DEF:
        cov = s["coverage"]
        if cov == "general":
            chosen.append(s)
        elif cov == cat:
            chosen.append(s)
    # dodatkowe nachodzenie: 35% produktów trafia też do „sąsiedniego” specjalisty
    if RNG.random() < 0.35:
        extras = [s for s in SUPPLIERS_DEF if s["coverage"] not in ("general", cat)]
        if extras:
            chosen.append(RNG.choice(extras))
    # unikalne po key
    seen = set()
    uniq = []
    for s in chosen:
        if s["key"] not in seen:
            seen.add(s["key"])
            uniq.append(s)
    return uniq


def build_catalog_row(supplier_id: str, prod: dict, sdef: dict, sort_order: int) -> dict:
    packs = pack_options(prod["dim"])
    pack = RNG.choice(packs)
    # wariacja ceny + rabat hurtowy na większe opakowanie
    mult = float(sdef["price_mult"]) * RNG.uniform(0.94, 1.06)
    unit_price = prod["base_price"] * mult
    if pack["qty"] >= 5:
        unit_price *= 0.93
    elif pack["qty"] >= 2.5:
        unit_price *= 0.96
    price_pln = round(unit_price * pack["qty"], 2)
    # dla szt w opakowaniu: price = unit_price * unit_count (już w qty)
    row = {
        "supplier_id": supplier_id,
        "name": prod["name"],
        "variant": pack["variant"],
        "volume_label": pack["volume_label"],
        "unit": pack["unit"],
        "unit_count": int(pack["unit_count"]),
        "price_pln": price_pln,
        "liters_total": float(pack["liters_total"]),
        "kg_total": float(pack["kg_total"]),
        "sort_order": sort_order,
        "is_visible": True,
    }
    return row


async def ensure_inventory_units(client: httpx.AsyncClient, products: list[dict]):
    """Uzupełnij magazyn brakującymi nazwami + popraw unit na kg/l/szt pod deal hunter."""
    inv = await sb_get(client, "inventory_items", {
        "select": "id,name,unit",
        "limit": "5000",
    }) or []
    by_lower = {(i.get("name") or "").strip().lower(): i for i in inv}

    to_insert = []
    patched = 0
    for p in products:
        key = p["name"].lower()
        want_unit = p["dim"]
        existing = by_lower.get(key)
        if existing:
            cur = (existing.get("unit") or "").strip().lower()
            if cur != want_unit and want_unit in ("kg", "l", "szt"):
                r = await client.patch(
                    f"{SUPABASE_URL}/rest/v1/inventory_items",
                    headers=_headers("return=minimal"),
                    params={"id": f"eq.{existing['id']}"},
                    json={"unit": want_unit},
                )
                if r.status_code < 300:
                    patched += 1
            continue
        to_insert.append({
            "name": p["name"],
            "unit": want_unit,
            # NIE dokładać sztucznego stanu — magazyn rośnie tylko ręcznie / komendą / fakturą
            "quantity": 0.0,
            "min_quantity": 2.0,
            "unit_cost": round(p["base_price"], 2),
            "is_active": True,
        })

    if to_insert:
        # batch 80
        for i in range(0, len(to_insert), 80):
            chunk = to_insert[i:i + 80]
            try:
                await sb_post(client, "inventory_items", chunk, prefer="return=minimal")
            except RuntimeError as e:
                print(f"  warn inventory insert: {e}")
        print(f"  + inventory_items: {len(to_insert)}")
    if patched:
        print(f"  ~ inventory unit patch: {patched}")


async def seed(client: httpx.AsyncClient, *, sync_inventory: bool):
    products = await load_ingredients(client)
    print(f"Składniki z menu/magazynu: {len(products)}")
    by_cat = Counter(p["category"] for p in products)
    print("  kategorie:", dict(by_cat))

    if sync_inventory:
        print("Synchronizacja magazynu (nazwy + jednostki)...")
        await ensure_inventory_units(client, products)

    # insert suppliers
    print("Tworzenie dostawców...")
    id_by_key: dict[str, str] = {}
    for s in SUPPLIERS_DEF:
        payload = {
            "name": s["name"],
            "category": s["category"],
            "nip": s["nip"],
            "contact_person": s["contact_person"],
            "phone": s["phone"],
            "email": s["email"],
            "icon_color": s["icon_color"],
            "notes": s["notes"],
            "min_order_value": s["min_order_value"],
            "shipping_cost": s["shipping_cost"],
            "free_shipping_threshold": s["free_shipping_threshold"],
            "is_active": True,
        }
        rows = await sb_post(client, "suppliers", payload)
        sid = rows[0]["id"] if isinstance(rows, list) else rows["id"]
        id_by_key[s["key"]] = sid
        print(
            f"  + {s['name']}: min={s['min_order_value']} zł, "
            f"dostawa={s['shipping_cost']} zł, gratis od {s['free_shipping_threshold']} zł"
        )

    # katalog
    print("Budowanie katalogów (nachodzące oferty)...")
    catalog_rows: list[dict] = []
    coverage_check: dict[str, set[str]] = defaultdict(set)
    sort_i = 0
    for prod in products:
        for sdef in suppliers_for_product(prod):
            sid = id_by_key[sdef["key"]]
            catalog_rows.append(build_catalog_row(sid, prod, sdef, sort_i))
            coverage_check[prod["name"]].add(sdef["key"])
            sort_i += 1

    uncovered = [n for n, keys in coverage_check.items() if not keys]
    if uncovered:
        raise RuntimeError(f"Brak pokrycia dla: {uncovered[:10]}")

    multi = sum(1 for keys in coverage_check.values() if len(keys) >= 2)
    print(f"  pozycji katalogu: {len(catalog_rows)}")
    print(f"  produktow z 2+ dostawcami (do porownania): {multi}/{len(coverage_check)}")

    for i in range(0, len(catalog_rows), 100):
        chunk = catalog_rows[i:i + 100]
        try:
            await sb_post(client, "supplier_catalog", chunk, prefer="return=minimal")
        except RuntimeError as e:
            if "kg_total" in str(e):
                slim = [{k: v for k, v in row.items() if k != "kg_total"} for row in chunk]
                await sb_post(client, "supplier_catalog", slim, prefer="return=minimal")
            else:
                raise
        print(f"  + catalog batch {i // 100 + 1} ({len(chunk)} rows)")

    # szybki podgląd overlapu na pierś z kurczaka / oliwa
    print("\nPrzykładowe oferty (pierwsze 3 produkty z overlapem):")
    shown = 0
    for name, keys in coverage_check.items():
        if len(keys) < 2:
            continue
        print(f"  • {name}: {', '.join(sorted(keys))}")
        shown += 1
        if shown >= 5:
            break

    print("\nGotowe.")
    print("Jarvis / Łowca: porównaj koszyk np. pierś z kurczaka 5 kg + cebula 10 kg + oliwa 3 l")
    print(f"Tag: {SIM_TAG}")


async def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("Brak SUPABASE_URL / SUPABASE_KEY w .env")

    ap = argparse.ArgumentParser()
    ap.add_argument("--wipe", action="store_true", help=f"Usuń poprzednie {SIM_TAG}")
    ap.add_argument(
        "--no-inventory",
        action="store_true",
        help="Nie synchronizuj inventory_items",
    )
    args = ap.parse_args()

    async with httpx.AsyncClient(verify=False, timeout=120) as client:
        if args.wipe:
            await wipe_sim(client)
        await seed(client, sync_inventory=not args.no_inventory)


if __name__ == "__main__":
    asyncio.run(main())
