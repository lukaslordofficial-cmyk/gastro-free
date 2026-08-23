"""
Ładowanie katalogów dla Łowcy Okazji (hurtownicy + lokalni przetwórcy).

Wydzielone z server.py — pure I/O helpers bez FastAPI routes.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from supabase_rest import sb_get

logger = logging.getLogger("server")

_UNIT_MAP = {
    "g": ("kg", 0.001), "gram": ("kg", 0.001), "gramy": ("kg", 0.001),
    "kg": ("kg", 1.0), "kilogram": ("kg", 1.0),
    "ml": ("l", 0.001), "mililitr": ("l", 0.001),
    "l": ("l", 1.0), "litr": ("l", 1.0), "litry": ("l", 1.0),
    "szt": ("szt", 1.0), "sztuka": ("szt", 1.0), "sztuk": ("szt", 1.0),
    "opak": ("szt", 1.0), "opakowanie": ("szt", 1.0),
    "porcja": ("szt", 1.0), "porcje": ("szt", 1.0),
}


def _norm_unit(u: str):
    key = (u or "").strip().lower().rstrip(".")
    return _UNIT_MAP.get(key, ("szt", 1.0))


def normalize_deal_hunter_search_scope(raw: Optional[str]) -> str:
    v = (raw or "suppliers_only").strip().lower().replace("-", "_").replace(" ", "_")
    if v in (
        "local_producers_only", "local", "producers", "lokalni", "lp",
        "local_suppliers", "local_producers", "dystrybutorzy", "lokalni_dostawcy",
        "tylko_lokalni", "tylko_lokalne",
    ):
        return "local_producers_only"
    if v in (
        "both", "all", "wszystkie", "oba", "compare", "porownaj",
        "hurtownicy_i_lokalni", "suppliers_and_local",
    ):
        return "both"
    return "suppliers_only"


async def fetch_catalog_and_suppliers(client: httpx.AsyncClient):
    """Katalog + dostawcy TYLKO bieżącego tenanta.

    `supplier_catalog` często nie ma kolumny account_key (tenant przez supplier_id).
    Service role omija RLS — bez filtra `in.(supplier_ids)` matchowałoby obce
    katalogi → puste nazwy dostawców i pusty picker w FE.
    """
    supplier_select = (
        "id,name,email,contact_person,phone,min_order_value,"
        "shipping_cost,free_shipping_threshold,lead_time_days"
    )
    try:
        await sb_get(client, "suppliers", params={
            "select": "min_order_value,shipping_cost,free_shipping_threshold,lead_time_days",
            "limit": "1",
        })
    except Exception:
        try:
            await sb_get(client, "suppliers", params={
                "select": "min_order_value,shipping_cost,free_shipping_threshold",
                "limit": "1",
            })
            supplier_select = (
                "id,name,email,contact_person,phone,min_order_value,"
                "shipping_cost,free_shipping_threshold"
            )
        except Exception:
            try:
                await sb_get(client, "suppliers", params={"select": "min_order_value", "limit": "1"})
                supplier_select = "id,name,email,contact_person,phone,min_order_value"
            except Exception:
                supplier_select = "id,name,email,contact_person,phone"
    suppliers = await sb_get(client, "suppliers", params={
        "select": supplier_select, "limit": "500",
    }) or []
    allowed_ids = [str(s["id"]) for s in suppliers if s.get("id")]
    if not allowed_ids:
        return [], suppliers

    select_full = (
        "id,supplier_id,name,variant,unit,price_pln,liters_total,kg_total,unit_count,is_visible"
    )
    select_no_kg = (
        "id,supplier_id,name,variant,unit,price_pln,liters_total,unit_count,is_visible"
    )
    catalog: list = []
    for i in range(0, len(allowed_ids), 40):
        chunk = allowed_ids[i : i + 40]
        id_filter = f"in.({','.join(chunk)})"
        try:
            rows = await sb_get(client, "supplier_catalog", params={
                "select": select_full,
                "supplier_id": id_filter,
                "limit": "2000",
            }) or []
        except httpx.HTTPStatusError as e:
            if "kg_total" in (e.response.text or ""):
                rows = await sb_get(client, "supplier_catalog", params={
                    "select": select_no_kg,
                    "supplier_id": id_filter,
                    "limit": "2000",
                }) or []
            else:
                raise
        catalog.extend(rows)

    allowed_set = set(allowed_ids)
    catalog = [r for r in catalog if str(r.get("supplier_id") or "") in allowed_set]
    return catalog, suppliers


async def fetch_local_producer_catalog(client: httpx.AsyncClient):
    """Mapuje marketplace Lokalni Przetworcy -> format supplier_catalog dla Lowcy.

    HARD RULE: active + verified + approved + nie zarchiwizowany (+ Connect gdy kolumna jest).
    Fail-soft: brak tabel / migracji → puste listy.
    """
    producers = []
    select_full = (
        "id,company_name,email,phone,owner_name,min_order_value,city,voivodeship,"
        "pickup_available,courier_available,active,verified,verification_status,"
        "archived_at,stripe_connect_id,free_delivery_from"
    )
    select_no_connect = (
        "id,company_name,email,phone,owner_name,min_order_value,city,voivodeship,"
        "pickup_available,courier_available,active,verified,verification_status,"
        "archived_at,free_delivery_from"
    )
    try:
        producers = await sb_get(client, "local_producers", params={
            "select": select_full,
            "active": "eq.true",
            "verified": "eq.true",
            "limit": "500",
        }) or []
    except Exception as e:
        logger.warning("local_producers fetch (connect) failed: %s — retry", e)
        try:
            producers = await sb_get(client, "local_producers", params={
                "select": select_no_connect,
                "active": "eq.true",
                "verified": "eq.true",
                "limit": "500",
            }) or []
        except Exception as e2:
            logger.warning("local_producers fetch for Deal Hunter failed: %s — retry bare", e2)
            try:
                producers = await sb_get(client, "local_producers", params={
                    "select": (
                        "id,company_name,email,phone,owner_name,min_order_value,city,voivodeship,"
                        "pickup_available,courier_available,active,verified,verification_status,"
                        "archived_at"
                    ),
                    "active": "eq.true",
                    "verified": "eq.true",
                    "limit": "500",
                }) or []
            except Exception as e3:
                logger.warning("local_producers fetch bare failed: %s", e3)
                return [], []

    visible = []
    for p in producers:
        if p.get("archived_at"):
            continue
        status = str(p.get("verification_status") or "").lower()
        if status and status != "approved":
            continue
        if "stripe_connect_id" in p:
            connect = (p.get("stripe_connect_id") or "").strip()
            if not connect.startswith("acct_"):
                continue
        visible.append(p)

    if not visible:
        return [], []

    producer_ids = [str(p["id"]) for p in visible if p.get("id")]
    products: list = []
    for i in range(0, len(producer_ids), 40):
        chunk = producer_ids[i : i + 40]
        id_filter = f"in.({','.join(chunk)})"
        try:
            rows = await sb_get(client, "producer_products", params={
                "select": "id,producer_id,title,description,price,unit,available,stock,weight_g",
                "producer_id": id_filter,
                "available": "eq.true",
                "limit": "2000",
            }) or []
        except Exception as e:
            logger.warning("producer_products fetch failed: %s", e)
            rows = []
        products.extend(rows)

    suppliers = []
    try:
        from lp_courier_price import courier_price_for_weight_kg
        lp_ship_estimate = float(courier_price_for_weight_kg(1.0))
    except Exception:
        lp_ship_estimate = 15.99
    for p in visible:
        name = (p.get("company_name") or "Lokalny producent").strip()
        city = (p.get("city") or "").strip()
        if p.get("pickup_available"):
            lead = 0.0
        elif p.get("courier_available"):
            lead = 1.0
        else:
            lead = 1.0
        if city and city.lower() not in name.lower():
            display = f"{name} · Lokalny · {city}"
        else:
            display = f"{name} · Lokalny"
        try:
            free_from = float(p.get("free_delivery_from") or 0)
        except (TypeError, ValueError):
            free_from = 0.0
        suppliers.append({
            "id": str(p["id"]),
            "name": display,
            "email": p.get("email"),
            "contact_person": p.get("owner_name") or p.get("phone"),
            "phone": p.get("phone"),
            "min_order_value": float(p.get("min_order_value") or 0),
            "shipping_cost": lp_ship_estimate,
            "free_shipping_threshold": free_from,
            "lead_time_days": lead,
            "is_local_producer": True,
            "city": city or None,
            "voivodeship": (p.get("voivodeship") or None),
            "source": "local_producer",
        })

    by_producer = {str(p["id"]) for p in visible if p.get("id")}
    catalog = []
    for row in products:
        pid = str(row.get("producer_id") or "")
        if pid not in by_producer:
            continue
        try:
            stock = float(row.get("stock") or 0)
        except (TypeError, ValueError):
            stock = 0.0
        if stock <= 0:
            continue
        try:
            price = float(row.get("price") or 0)
        except (TypeError, ValueError):
            price = 0.0
        if price <= 0:
            continue
        title = (row.get("title") or "").strip()
        if not title:
            continue
        unit_raw = (row.get("unit") or "szt").strip() or "szt"
        unit_dim, _ = _norm_unit(unit_raw)
        kg_total = None
        if unit_dim == "szt":
            try:
                wg = float(row.get("weight_g") or 0)
                if wg > 0:
                    kg_total = round(wg / 1000.0, 6)
            except (TypeError, ValueError):
                kg_total = None
        entry = {
            "id": str(row.get("id")),
            "supplier_id": pid,
            "name": title,
            "variant": (row.get("description") or "")[:80] or None,
            "unit": unit_raw,
            "price_pln": price,
            "liters_total": None,
            "unit_count": 1,
            "is_visible": True,
            "is_local_producer": True,
            "producer_product_id": str(row.get("id")),
            "source": "local_producer",
            "available_stock": stock,
            "stock": stock,
        }
        if kg_total:
            entry["kg_total"] = kg_total
        try:
            wg = float(row.get("weight_g") or 0)
            if wg > 0:
                entry["weight_g"] = wg
        except (TypeError, ValueError):
            pass
        catalog.append(entry)

    logger.info(
        "Deal Hunter: loaded %s local producers, %s products (search scope)",
        len(suppliers),
        len(catalog),
    )
    return catalog, suppliers


async def load_catalog_for_search_scope(client: httpx.AsyncClient, search_scope: Optional[str]):
    """Łączy katalogi hurtowników i/lub lokalnych producentów wg search_scope."""
    scope = normalize_deal_hunter_search_scope(search_scope)
    catalog: list = []
    suppliers: list = []

    if scope in ("suppliers_only", "both"):
        c, s = await fetch_catalog_and_suppliers(client)
        for row in c:
            row = dict(row)
            row.setdefault("source", "supplier")
            catalog.append(row)
        for srow in s:
            srow = dict(srow)
            srow.setdefault("source", "supplier")
            suppliers.append(srow)

    if scope in ("local_producers_only", "both"):
        c, s = await fetch_local_producer_catalog(client)
        catalog.extend(c)
        suppliers.extend(s)

    return catalog, suppliers, scope
