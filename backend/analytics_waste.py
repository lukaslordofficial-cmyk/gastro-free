"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `analytics_waste`."""
from __future__ import annotations

from culinary_units import convert_culinary as _convert_culinary
from culinary_units import is_piece_unit as _is_piece_unit
from http_ssl import httpx_verify as _httpx_verify
from supabase_rest import sb_get
from typing import Optional
import httpx
import re
from analytics_periods import _coerce_selected_periods, _resolve_period_window, _window_from_period_sel
from app_core import _pg_ts
from matching_utils import _is_porcja_row, _norm_name_key, _resolve_by_fuzzy



async def _lookup_unit_cost_pln(
    client: httpx.AsyncClient,
    *,
    inv_row: Optional[dict],
    item_name: str,
    around_iso: Optional[str] = None,
) -> float:
    """Koszt 1 jednostki magazynowej: unit_cost → variable_cost → invoices.note."""
    if inv_row:
        uc = float(inv_row.get("unit_cost") or 0)
        if uc > 0:
            return uc
    name_key = _norm_name_key(item_name)
    # variable_cost_entries — best-effort po nazwie w description/note
    try:
        params: list[tuple[str, str]] = [
            ("select", "amount_pln,note,description,created_at,year_month"),
            ("order", "created_at.desc"),
            ("limit", "300"),
        ]
        if around_iso:
            params.append(("created_at", f"lte.{_pg_ts(around_iso)}"))
        rows = await sb_get(client, "variable_cost_entries", params=params) or []
        for r in rows:
            blob = _norm_name_key(f"{r.get('note') or ''} {r.get('description') or ''}")
            if name_key and name_key in blob:
                amt = float(r.get("amount_pln") or 0)
                m = re.search(r"(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|szt)", blob)
                if m and amt > 0:
                    q = float(m.group(1).replace(",", "."))
                    u = m.group(2)
                    if u == "g":
                        q = q / 1000.0
                    elif u == "ml":
                        q = q / 1000.0
                    if q > 0:
                        return round(amt / q, 4)
                if amt > 0:
                    return round(amt, 4)
    except Exception:
        pass
    # invoices.note często zawiera linie „Burak 10 kg = 50.00 zł”
    try:
        params2: list[tuple[str, str]] = [
            ("select", "total_cost,note,created_at"),
            ("order", "created_at.desc"),
            ("limit", "200"),
        ]
        if around_iso:
            params2.append(("created_at", f"lte.{_pg_ts(around_iso)}"))
        invs = await sb_get(client, "invoices", params=params2) or []
        for inv in invs:
            note = _norm_name_key(inv.get("note") or "")
            if not name_key or name_key not in note:
                continue
            # szukaj fragmentu z ilością i kwotą przy nazwie
            raw = str(inv.get("note") or "")
            for part in re.split(r"[;|]", raw):
                if name_key not in _norm_name_key(part):
                    continue
                m = re.search(
                    r"(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|szt).{0,12}?(\d+(?:[.,]\d+)?)\s*zl",
                    _norm_name_key(part),
                )
                if m:
                    q = float(m.group(1).replace(",", "."))
                    u = m.group(2)
                    amt = float(m.group(3).replace(",", "."))
                    if u == "g":
                        q /= 1000.0
                    elif u == "ml":
                        q /= 1000.0
                    if q > 0 and amt > 0:
                        return round(amt / q, 4)
    except Exception:
        pass
    return 0.0


def _dish_portions_from_waste(qty: float, unit: str, portion_size_grams: float) -> float:
    """Ile porcji reprezentuje strata dania (porcja/szt albo l/ml/kg/g vs gramatura)."""
    u = (unit or "").strip().lower()
    portion_g = float(portion_size_grams or 0)
    if u in ("porcja", "porcje", "szt") or _is_piece_unit(u):
        return float(qty)
    if u in ("l", "ml") and portion_g > 0:
        ml = qty * (1000.0 if u == "l" else 1.0)
        return ml / portion_g
    if u in ("kg", "g") and portion_g > 0:
        g = qty * (1000.0 if u == "kg" else 1.0)
        return g / portion_g
    return float(qty)


def _ingredient_qty_in_inv_unit(
    qty: float,
    from_unit: str,
    inv_row: Optional[dict],
) -> float:
    """Przelicz ilość straty składnika na jednostkę magazynową (pod unit_cost)."""
    if not inv_row:
        return float(qty)
    inv_u = (inv_row.get("unit") or "").strip().lower()
    waste_u = (from_unit or inv_u or "").strip().lower()
    if not inv_u or not waste_u or inv_u == waste_u:
        return float(qty)
    size = inv_row.get("unit_weight_volume") or inv_row.get("portion_size")
    converted = _convert_culinary(float(qty), waste_u, inv_u, size)
    return float(converted) if converted is not None else float(qty)


async def _dish_waste_cost_pln(
    client: httpx.AsyncClient,
    *,
    dish_name: str,
    qty: float,
    unit: str,
    around_iso: Optional[str],
    inv_by_name: dict,
) -> float:
    """Koszt straty dania: receptura × koszt składników × przelicznik porcji/litrów."""
    menu = await sb_get(client, "menu_items", params={
        "select": "id,name,portion_size_grams",
        "limit": "5000",
    }) or []
    hit, _ = _resolve_by_fuzzy(dish_name, menu, threshold=72)
    if not hit:
        return 0.0
    mid = hit["id"]
    ings = await sb_get(client, "recipe_ingredients", params={
        "select": "ingredient_name,quantity,unit",
        "menu_item_id": f"eq.{mid}",
        "limit": "200",
    }) or []
    if not ings:
        return 0.0
    portions = _dish_portions_from_waste(qty, unit, float(hit.get("portion_size_grams") or 0))
    total = 0.0
    for ing in ings:
        iname = (ing.get("ingredient_name") or "").strip()
        if _is_porcja_row(iname):
            continue
        iq = float(ing.get("quantity") or 0) * portions
        iunit = (ing.get("unit") or "g").strip().lower()
        inv = inv_by_name.get(_norm_name_key(iname))
        base_qty = _ingredient_qty_in_inv_unit(iq, iunit, inv)
        uc = await _lookup_unit_cost_pln(
            client, inv_row=inv, item_name=iname, around_iso=around_iso,
        )
        total += base_qty * uc
    return round(total, 2)


async def _waste_log_event_cost_pln(
    client: httpx.AsyncClient,
    w: dict,
    *,
    by_id: dict,
    by_name: dict,
    around_iso: Optional[str],
) -> tuple[float, float]:
    """Koszt jednego wpisu waste_logs → (cost_pln, unit_cost_display)."""
    name = (w.get("item_name") or "Nieznany").strip()
    qty = float(w.get("quantity") or 0)
    if qty <= 0:
        return 0.0, 0.0
    item_type = (w.get("item_type") or "ingredient").strip().lower()
    ca = str(w.get("created_at") or around_iso or "")
    inv_row = None
    iid = w.get("item_id") or (w.get("related_id") if item_type == "ingredient" else None)
    if iid and str(iid) in by_id:
        inv_row = by_id[str(iid)]
    else:
        inv_row = by_name.get(_norm_name_key(name))

    if item_type == "dish":
        cost = await _dish_waste_cost_pln(
            client,
            dish_name=name,
            qty=qty,
            unit=w.get("unit") or "porcja",
            around_iso=ca or around_iso,
            inv_by_name=by_name,
        )
        unit_cost = round(cost / qty, 4) if qty else 0.0
        return cost, unit_cost

    unit_cost = await _lookup_unit_cost_pln(
        client, inv_row=inv_row, item_name=name, around_iso=ca or around_iso,
    )
    base_qty = _ingredient_qty_in_inv_unit(qty, w.get("unit") or "", inv_row)
    return round(base_qty * unit_cost, 2), unit_cost


async def _sum_waste_logs_cost_pln(
    client: httpx.AsyncClient,
    *,
    since_iso: str,
    until_iso: str,
    d0_iso: Optional[str] = None,
    d1_iso: Optional[str] = None,
) -> dict:
    """Suma strat z waste_logs w oknie (dania + składniki, z przeliczeniem jednostek)."""
    logs = await sb_get(client, "waste_logs", params={
        "select": "item_name,quantity,unit,created_at,item_id,item_type,related_id",
        "created_at": f"gte.{_pg_ts(since_iso)}",
        "order": "created_at.desc",
        "limit": "10000",
    }) or []
    until_s = _pg_ts(until_iso) if until_iso else None
    if until_s:
        logs = [r for r in logs if str(r.get("created_at") or "") <= until_s]
    if d0_iso and d1_iso:
        logs = [
            r for r in logs
            if d0_iso <= str(r.get("created_at") or "")[:10] <= d1_iso
        ]

    inv = await sb_get(client, "inventory_items", params={
        "select": "id,name,unit_cost,unit,unit_weight_volume,portion_size",
        "limit": "5000",
    }) or []
    by_id = {str(i["id"]): i for i in inv if i.get("id")}
    by_name = {_norm_name_key(i.get("name") or ""): i for i in inv if i.get("name")}

    total = 0.0
    events = 0
    missing = 0
    for w in logs:
        cost, _uc = await _waste_log_event_cost_pln(
            client, w, by_id=by_id, by_name=by_name, around_iso=since_iso,
        )
        if cost <= 0:
            missing += 1
        else:
            total += cost
            events += 1
    return {
        "total_cost_pln": round(total, 2),
        "events_costed": events,
        "missing_unit_cost_rows": missing,
        "events_total": len(logs),
    }


async def _run_rank_waste_cost(
    *,
    period_type: str = "week",
    limit_days=None,
    top_n=None,
    period_hint: Optional[str] = None,
    selected_periods: Optional[list] = None,
) -> dict:
    """Ranking strat w zł: unit_cost / faktury / receptura dania."""
    n = 5
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 20)
    except (TypeError, ValueError):
        pass
    sels = _coerce_selected_periods(selected_periods)

    async def _one(client, since_iso: str, until_iso: str, label: str) -> dict:
        logs = await sb_get(client, "waste_logs", params={
            "select": "item_name,quantity,unit,created_at,item_id,item_type,related_id",
            "created_at": f"gte.{_pg_ts(since_iso)}",
            "order": "created_at.desc",
            "limit": "5000",
        }) or []
        until_s = _pg_ts(until_iso) if until_iso else None
        if until_s:
            logs = [r for r in logs if str(r.get("created_at") or "") <= until_s]

        inv = await sb_get(client, "inventory_items", params={
            "select": "id,name,unit_cost,unit",
            "limit": "5000",
        }) or []
        by_id = {str(i["id"]): i for i in inv if i.get("id")}
        by_name = {_norm_name_key(i.get("name") or ""): i for i in inv if i.get("name")}

        totals: dict[str, dict] = {}
        missing_cost = 0
        for w in logs:
            name = (w.get("item_name") or "Nieznany").strip()
            qty = float(w.get("quantity") or 0)
            if qty <= 0:
                continue
            ca = str(w.get("created_at") or "") or since_iso
            cost, unit_cost = await _waste_log_event_cost_pln(
                client, w, by_id=by_id, by_name=by_name, around_iso=ca,
            )
            inv_row = None
            iid = w.get("item_id") or w.get("related_id")
            if iid and str(iid) in by_id:
                inv_row = by_id[str(iid)]
            else:
                inv_row = by_name.get(_norm_name_key(name))

            if cost <= 0:
                missing_cost += 1
            key = _norm_name_key(name) or name
            slot = totals.setdefault(key, {
                "name": name,
                "qty": 0.0,
                "unit": w.get("unit") or (inv_row or {}).get("unit") or "",
                "cost_pln": 0.0,
                "unit_cost": unit_cost,
            })
            slot["qty"] = round(slot["qty"] + qty, 2)
            slot["cost_pln"] = round(slot["cost_pln"] + cost, 2)
            if unit_cost > 0:
                slot["unit_cost"] = unit_cost

        rows = sorted(totals.values(), key=lambda r: r["cost_pln"], reverse=True)
        top = rows[:n]
        total_pln = round(sum(r["cost_pln"] for r in rows), 2)
        return {
            "label": label,
            "period_label": label,
            "items": top,
            "total_cost_pln": total_pln,
            "missing_unit_cost_rows": missing_cost,
            "message": "",
        }

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
            "periods": periods_out,
            "items": periods_out[0]["items"] if len(periods_out) == 1 else [],
            "total_cost_pln": periods_out[0]["total_cost_pln"] if len(periods_out) == 1 else None,
            "assistant_speech": "",
            "message": "Straty w złotówkach — każdy okres osobno.",
        }


async def _waste_ranking_for_window(
    client: httpx.AsyncClient,
    since_iso: str,
    until_iso: str,
    *,
    top_n: int = 10,
) -> dict:
    """Straty w PLN za okno (jak rank_waste_cost, ale bez okresu względnego)."""
    logs = await sb_get(client, "waste_logs", params={
        "select": "item_name,quantity,unit,created_at,item_id,item_type,related_id",
        "created_at": f"gte.{_pg_ts(since_iso)}",
        "order": "created_at.desc",
        "limit": "5000",
    }) or []
    until_s = _pg_ts(until_iso) if until_iso else None
    if until_s:
        logs = [r for r in logs if str(r.get("created_at") or "") <= until_s]

    inv = await sb_get(client, "inventory_items", params={
        "select": "id,name,unit_cost,unit",
        "limit": "5000",
    }) or []
    by_id = {str(i["id"]): i for i in inv if i.get("id")}
    by_name = {_norm_name_key(i.get("name") or ""): i for i in inv if i.get("name")}

    totals: dict[str, dict] = {}
    missing_cost = 0
    for w in logs:
        name = (w.get("item_name") or "Nieznany").strip()
        qty = float(w.get("quantity") or 0)
        if qty <= 0:
            continue
        ca = str(w.get("created_at") or "") or since_iso
        cost, unit_cost = await _waste_log_event_cost_pln(
            client, w, by_id=by_id, by_name=by_name, around_iso=ca,
        )
        inv_row = None
        iid = w.get("item_id") or w.get("related_id")
        if iid and str(iid) in by_id:
            inv_row = by_id[str(iid)]
        else:
            inv_row = by_name.get(_norm_name_key(name))
        if cost <= 0:
            missing_cost += 1
        key = _norm_name_key(name) or name
        slot = totals.setdefault(key, {
            "name": name,
            "qty": 0.0,
            "unit": w.get("unit") or (inv_row or {}).get("unit") or "",
            "cost_pln": 0.0,
            "unit_cost": unit_cost,
        })
        slot["qty"] = round(slot["qty"] + qty, 2)
        slot["cost_pln"] = round(slot["cost_pln"] + cost, 2)
        if unit_cost > 0:
            slot["unit_cost"] = unit_cost

    rows = sorted(totals.values(), key=lambda r: r["cost_pln"], reverse=True)
    n = max(1, min(int(top_n or 10), 30))
    return {
        "items": rows[:n],
        "all_items": rows,
        "total_cost_pln": round(sum(r["cost_pln"] for r in rows), 2),
        "missing_unit_cost_rows": missing_cost,
        "events_count": len(logs),
    }

__all__ = ['_dish_portions_from_waste', '_dish_waste_cost_pln', '_ingredient_qty_in_inv_unit', '_lookup_unit_cost_pln', '_run_rank_waste_cost', '_sum_waste_logs_cost_pln', '_waste_log_event_cost_pln', '_waste_ranking_for_window']
