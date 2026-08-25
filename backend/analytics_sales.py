"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `analytics_sales`."""
from __future__ import annotations

from http_ssl import httpx_verify as _httpx_verify
from ingredient_name_norm import norm_name as _norm_name
from pl_fuzzy_norm import norm_pl as _norm_pl
from supabase_rest import sb_get
from typing import Optional
import httpx
from analytics_periods import _coerce_selected_periods, _period_days, _resolve_period_window, _resolve_selected_or_hint, _window_from_period_sel
from app_core import _pg_ts, logger
from matching_utils import _cat_matches, _fuzzy_match



async def _pos_sales_in_window(
    client: httpx.AsyncClient,
    days: int = 7,
    *,
    since_iso: Optional[str] = None,
    until_iso: Optional[str] = None,
) -> list[dict]:
    from datetime import datetime, timezone, timedelta

    def _as_aware(iso: str, *, end: bool) -> datetime:
        raw = (iso or "").strip()
        if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
            raw = raw + ("T23:59:59+00:00" if end else "T00:00:00+00:00")
        elif raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    if since_iso:
        since_dt = _as_aware(since_iso, end=False)
        since = _pg_ts(since_dt.isoformat())
    else:
        since_dt = datetime.now(timezone.utc) - timedelta(days=max(1, days))
        since = _pg_ts(since_dt.isoformat())

    until_dt = _as_aware(until_iso, end=True) if until_iso else None
    until_s = _pg_ts(until_dt.isoformat()) if until_dt is not None else None
    # PostgREST: filtr zakresu — dwa parametry processed_at (bez and= + bez '+' w URL)
    params_list: list[tuple[str, str]] = [
        ("select", "pos_external_id,pos_product_id,quantity_sold,processed_at"),
        ("processed_at", f"gte.{since}"),
        ("limit", "30000"),
        ("order", "processed_at.asc"),
    ]
    if until_s:
        params_list.insert(2, ("processed_at", f"lte.{until_s}"))
    try:
        rows = await sb_get(client, "pos_sales_log", params=params_list) or []
    except httpx.HTTPStatusError:
        # Fallback: and= z timestampami Z
        try:
            and_parts = [f"processed_at.gte.{since}"]
            if until_s:
                and_parts.append(f"processed_at.lte.{until_s}")
            rows = await sb_get(client, "pos_sales_log", params={
                "select": "pos_external_id,pos_product_id,quantity_sold,processed_at",
                "and": f"({','.join(and_parts)})",
                "limit": "30000",
                "order": "processed_at.asc",
            }) or []
        except httpx.HTTPStatusError:
            return []
        if until_dt is not None:
            filtered = []
            for r in rows:
                raw = r.get("processed_at") or ""
                try:
                    dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                except Exception:
                    continue
                if dt <= until_dt:
                    filtered.append(r)
            return filtered
    # Client-side until gdy PostgREST złączył dwa processed_at w jeden
    if until_dt is not None and rows:
        filtered = []
        for r in rows:
            raw = r.get("processed_at") or ""
            try:
                dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
            except Exception:
                continue
            if dt <= until_dt:
                filtered.append(r)
        return filtered
    return rows or []


async def _aggregate_menu_sales(
    client: httpx.AsyncClient,
    days: int,
    category: Optional[str] = None,
    *,
    since_iso: Optional[str] = None,
    until_iso: Optional[str] = None,
) -> list[dict]:
    """Sumuje sprzedaż POS → menu_items (qty + revenue).

    Bierze też nieaktywne dania (soft-delete), żeby historyczny POS
    po „usuń menu / przywróć / skan” nadal się sumował po starych id/pos_id.
    """
    sales = await _pos_sales_in_window(client, days, since_iso=since_iso, until_iso=until_iso)
    try:
        menu_all = await sb_get(client, "menu_items", params={
            "select": "id,name,category,pos_id,price_pln,is_active",
            "limit": "8000",
        }) or []
    except httpx.HTTPStatusError:
        menu_all = await sb_get(client, "menu_items", params={
            "select": "id,name,category,pos_id,price_pln",
            "limit": "8000",
        }) or []
    by_pos = {m.get("pos_id"): m for m in menu_all if m.get("pos_id")}
    by_id = {m["id"]: m for m in menu_all}
    by_name = {_norm_name(m.get("name") or ""): m for m in menu_all if m.get("name")}

    totals: dict[str, dict] = {}
    unmatched = 0
    for s in sales:
        mid = None
        pos_ext = s.get("pos_external_id")
        if pos_ext and pos_ext in by_pos:
            mid = by_pos[pos_ext]["id"]
        elif s.get("pos_product_id") in by_id:
            mid = s["pos_product_id"]
        if not mid or mid not in by_id:
            unmatched += 1
            continue
        m = by_id[mid]
        if category and not _cat_matches(m.get("category") or "", category):
            continue
        qty = float(s.get("quantity_sold") or 0)
        price = float(m.get("price_pln") or 0)
        slot = totals.setdefault(mid, {
            "menu_item_id": mid,
            "name": m.get("name"),
            "category": m.get("category"),
            "qty_sold": 0.0,
            "revenue_pln": 0.0,
        })
        slot["qty_sold"] = round(slot["qty_sold"] + qty, 2)
        slot["revenue_pln"] = round(slot["revenue_pln"] + qty * price, 2)
    # Debug hint w loggerze gdy sprzedaż jest, ale nic nie zmapowano (rozjechane pos_id)
    if sales and not totals and unmatched:
        logger.warning(
            "POS: %s wierszy w oknie, 0 dopasowań do menu (pos_id/id) — "
            "uruchom seed_sim_restaurant_2025.py --wipe albo zmapuj POS w Ustawieniach.",
            len(sales),
        )
    return list(totals.values())


async def _run_rank_menu_sales(
    *,
    rank: str = "best",
    period_type: str = "week",
    limit_days=None,
    top_n=None,
    category: Optional[str] = None,
    period_hint: Optional[str] = None,
    selected_periods: Optional[list] = None,
) -> dict:
    n = 5
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 20)
    except (TypeError, ValueError):
        pass
    want_best = (rank or "best").lower() != "worst"
    days = _period_days(period_type or "week", limit_days)
    sels = _coerce_selected_periods(selected_periods)

    async def _one(since_iso: str, until_iso: str, label: str) -> dict:
        rows = await _aggregate_menu_sales(
            client, days, category=category, since_iso=since_iso, until_iso=until_iso,
        )
        if not rows:
            return {
                "label": label,
                "period_label": label,
                "items": [],
                "message": f"Brak sprzedaży POS za {label}.",
            }
        rows.sort(key=lambda r: (r["qty_sold"], r["revenue_pln"]), reverse=want_best)
        top = rows[:n]
        return {"label": label, "period_label": label, "items": top, "message": ""}

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        periods_out: list[dict] = []
        if sels:
            for sel in sels[:12]:
                s, u, lbl = _window_from_period_sel(sel)
                periods_out.append(await _one(s, u, lbl))
        else:
            s, u, lbl = _resolve_period_window(period_type, limit_days, period_hint)
            periods_out.append(await _one(s, u, lbl))

        kind = "najlepiej" if want_best else "najsłabiej"
        # Bez ściany tekstu — FE pokazuje periods[].items
        return {
            "ok": True,
            "rank": "best" if want_best else "worst",
            "category": category,
            "period_label": " · ".join(p["label"] for p in periods_out),
            "periods": periods_out,
            "items": periods_out[0]["items"] if len(periods_out) == 1 else [],
            "assistant_speech": "",
            "message": f"Ranking {kind} sprzedających się dań — każdy okres osobno.",
        }


async def _run_rank_dead_menu(
    *,
    period_type: str = "week",
    limit_days=None,
    top_n=None,
    category: Optional[str] = None,
    period_hint: Optional[str] = None,
    selected_periods: Optional[list] = None,
) -> dict:
    """Najsłabiej sprzedające się dania (z qty>0) — nie „zero sprzedaży”."""
    n = 8
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 30)
    except (TypeError, ValueError):
        pass
    days = _period_days(period_type or "week", limit_days)
    sels = _coerce_selected_periods(selected_periods)

    async def _one(client, since_iso: str, until_iso: str, label: str) -> dict:
        sold = await _aggregate_menu_sales(
            client, days, category=category, since_iso=since_iso, until_iso=until_iso,
        )
        rows = [r for r in sold if float(r.get("qty_sold") or 0) > 0]
        if category:
            rows = [r for r in rows if _cat_matches(r.get("category") or "", category)]
        rows.sort(key=lambda r: (float(r.get("qty_sold") or 0), float(r.get("revenue_pln") or 0)))
        top = rows[:n]
        if not top:
            return {
                "label": label,
                "period_label": label,
                "items": [],
                "message": f"Brak sprzedaży POS za {label} — nie da się zbudować rankingu najsłabszych.",
            }
        return {"label": label, "period_label": label, "items": top, "message": ""}

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        periods_out: list[dict] = []
        if sels:
            for sel in sels[:12]:
                s, u, lbl = _window_from_period_sel(sel)
                periods_out.append(await _one(client, s, u, lbl))
        else:
            s, u, lbl = _resolve_period_window(period_type, limit_days, period_hint)
            periods_out.append(await _one(client, s, u, lbl))

        return {
            "ok": True,
            "period_label": " · ".join(p["label"] for p in periods_out),
            "category": category,
            "periods": periods_out,
            "items": periods_out[0]["items"] if len(periods_out) == 1 else [],
            "assistant_speech": "",
            "message": "Najsłabiej sprzedające się dania — każdy okres osobno.",
        }


async def _run_rank_inventory_usage(
    *,
    rank: str = "best",
    period_type: str = "week",
    limit_days=None,
    top_n=None,
    category: Optional[str] = None,
    period_hint: Optional[str] = None,
    selected_periods: Optional[list] = None,
) -> dict:
    """Zużycie magazynu = sprzedaż dań × gramatury z recipe_ingredients."""
    since_iso, until_iso, label = _resolve_selected_or_hint(
        period_type, limit_days, period_hint, selected_periods,
    )
    days = _period_days(period_type or "week", limit_days)
    n = 5
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 20)
    except (TypeError, ValueError):
        pass
    want_most = (rank or "best").lower() != "worst"

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        dish_sales = await _aggregate_menu_sales(
            client, days, category=None, since_iso=since_iso, until_iso=until_iso,
        )
        if not dish_sales:
            return {
                "ok": True,
                "period_label": label,
                "rank": "best" if want_most else "worst",
                "items": [],
                "assistant_speech": (
                    f"Brak sprzedaży POS za {label} — nie policzę zużycia magazynu."
                ),
            }
        ri = await sb_get(client, "recipe_ingredients", params={
            "select": "menu_item_id,ingredient_name,quantity,unit",
            "limit": "30000",
        }) or []
        by_menu: dict[str, list] = {}
        for r in ri:
            by_menu.setdefault(r["menu_item_id"], []).append(r)

        inv = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,unit,inventory_categories(name)",
            "limit": "5000",
        }) or []
        inv_norm = {_norm_pl(r["name"]): r for r in inv if r.get("name")}

        usage: dict[str, dict] = {}
        for d in dish_sales:
            sold = float(d.get("qty_sold") or 0)
            if sold <= 0:
                continue
            for ing in by_menu.get(d["menu_item_id"], []):
                iname = (ing.get("ingredient_name") or "").strip()
                key = _norm_pl(iname)
                if not key:
                    continue
                used = float(ing.get("quantity") or 0) * sold
                if key not in usage:
                    matched = inv_norm.get(key)
                    if not matched:
                        hit, _ = _fuzzy_match(key, list(inv_norm.keys()), threshold=78)
                        matched = inv_norm.get(hit) if hit else None
                    cat_name = None
                    if matched:
                        cats = matched.get("inventory_categories")
                        if isinstance(cats, dict):
                            cat_name = cats.get("name")
                        elif isinstance(cats, list) and cats:
                            cat_name = cats[0].get("name")
                    usage[key] = {
                        "ingredient_name": iname,
                        "unit": ing.get("unit") or "g",
                        "qty_used": 0.0,
                        "inventory_id": (matched or {}).get("id"),
                        "inventory_name": (matched or {}).get("name") or iname,
                        "category": cat_name,
                        "current_stock": float((matched or {}).get("quantity") or 0),
                    }
                usage[key]["qty_used"] = round(usage[key]["qty_used"] + used, 3)

        rows = list(usage.values())
        if category:
            rows = [
                r for r in rows
                if _cat_matches(r.get("category") or r.get("ingredient_name") or "", category)
            ]
        if not rows:
            return {
                "ok": True,
                "period_label": label,
                "rank": "best" if want_most else "worst",
                "items": [],
                "assistant_speech": (
                    f"Nie udało się zmapować zużycia składników za {label}. "
                    "Upewnij się, że dania mają receptury w Menu."
                ),
            }
        rows.sort(key=lambda r: r["qty_used"], reverse=want_most)
        top = rows[:n]
        kind = "największe" if want_most else "najmniejsze"
        lines = ", ".join(
            f"{i+1}. {r['inventory_name']} ({r['qty_used']:g} {r['unit']})"
            for i, r in enumerate(top)
        )
        speech = f"Za {label} {kind} zużycie z magazynu: {lines}."
        return {
            "ok": True,
            "period_label": label,
            "rank": "best" if want_most else "worst",
            "category": category,
            "items": top,
            "assistant_speech": speech,
        }


async def _inventory_usage_for_window(
    client: httpx.AsyncClient,
    since_iso: str,
    until_iso: str,
    *,
    top_n: int = 10,
) -> list[dict]:
    """Top zużycia magazynu = sprzedaż × receptury (to samo co ranking głosowy)."""
    from datetime import date as _date
    d0 = _date.fromisoformat(since_iso[:10])
    d1 = _date.fromisoformat(until_iso[:10])
    days = max(1, (d1 - d0).days + 1)
    dish_sales = await _aggregate_menu_sales(
        client, days, since_iso=since_iso, until_iso=until_iso,
    )
    if not dish_sales:
        return []
    ri = await sb_get(client, "recipe_ingredients", params={
        "select": "menu_item_id,ingredient_name,quantity,unit",
        "limit": "30000",
    }) or []
    by_menu: dict[str, list] = {}
    for r in ri:
        by_menu.setdefault(r["menu_item_id"], []).append(r)
    inv = await sb_get(client, "inventory_items", params={
        "select": "id,name,quantity,unit,inventory_categories(name)",
        "limit": "5000",
    }) or []
    inv_norm = {_norm_pl(r["name"]): r for r in inv if r.get("name")}
    usage: dict[str, dict] = {}
    for d in dish_sales:
        sold = float(d.get("qty_sold") or 0)
        if sold <= 0:
            continue
        for ing in by_menu.get(d["menu_item_id"], []):
            iname = (ing.get("ingredient_name") or "").strip()
            key = _norm_pl(iname)
            if not key:
                continue
            used = float(ing.get("quantity") or 0) * sold
            if key not in usage:
                matched = inv_norm.get(key)
                if not matched:
                    hit, _ = _fuzzy_match(key, list(inv_norm.keys()), threshold=78)
                    matched = inv_norm.get(hit) if hit else None
                cat_name = None
                if matched:
                    cats = matched.get("inventory_categories")
                    if isinstance(cats, dict):
                        cat_name = cats.get("name")
                    elif isinstance(cats, list) and cats:
                        cat_name = cats[0].get("name")
                usage[key] = {
                    "ingredient_name": iname,
                    "unit": ing.get("unit") or "g",
                    "qty_used": 0.0,
                    "inventory_id": (matched or {}).get("id"),
                    "inventory_name": (matched or {}).get("name") or iname,
                    "category": cat_name,
                    "current_stock": float((matched or {}).get("quantity") or 0),
                }
            usage[key]["qty_used"] = round(usage[key]["qty_used"] + used, 3)
    rows = sorted(usage.values(), key=lambda r: r["qty_used"], reverse=True)
    return rows[: max(1, min(int(top_n or 10), 30))]

__all__ = ['_aggregate_menu_sales', '_inventory_usage_for_window', '_pos_sales_in_window', '_run_rank_dead_menu', '_run_rank_inventory_usage', '_run_rank_menu_sales']
