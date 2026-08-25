"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `analytics_pnl`."""
from __future__ import annotations

from supabase_rest import sb_get
import httpx
import re
from analytics_sales import _aggregate_menu_sales
from analytics_waste import _sum_waste_logs_cost_pln
from app_core import _pg_ts



def _report_net(r: dict) -> float:
    return (float(r.get("total_revenue") or 0)
            - float(r.get("total_waste_cost") or 0)
            - float(r.get("total_invoice_cost") or 0))


def _agg_reports(rows: list) -> dict:
    rev = round(sum(float(r.get("total_revenue") or 0) for r in rows), 2)
    waste = round(sum(float(r.get("total_waste_cost") or 0) for r in rows), 2)
    inv = round(sum(float(r.get("total_invoice_cost") or 0) for r in rows), 2)
    return {
        "total_revenue": rev, "total_waste_cost": waste, "total_invoice_cost": inv,
        "net_profit": round(rev - waste - inv, 2), "days_count": len(rows),
    }


def _iter_days(d0, d1):
    from datetime import timedelta
    cur = d0
    while cur <= d1:
        yield cur
        cur += timedelta(days=1)


async def _compute_true_pnl(
    client: httpx.AsyncClient,
    since_d: str,
    until_d: str,
) -> dict:
    """Rzetelny P&L okna [since_d, until_d] (YYYY-MM-DD, włącznie).

    - Przychód: POS / revenue_entries / daily_reports
    - Koszty stałe: fixed_costs × proporcja dni
    - Koszty zmienne brutto: variable_cost_entries type≠waste × proporcja dni
      (zakupy materiałów — tu już jest koszt zapłaconych produktów)
    - Straty produktowe: waste_logs (dania+składniki, receptura/unit_cost)
    - Koszty zmienne netto = max(0, zmienne_brutto − straty)
      (nie liczymy drugi raz produktów już zapłaconych w zakupach)
    - Zysk = przychód − stałe − straty − zmienne_netto
            = przychód − stałe − zmienne_brutto
    """
    from datetime import date as _date
    from calendar import monthrange
    from collections import defaultdict

    d0 = _date.fromisoformat(since_d[:10])
    d1 = _date.fromisoformat(until_d[:10])
    if d1 < d0:
        d0, d1 = d1, d0
    days_selected = (d1 - d0).days + 1
    since_iso = _pg_ts(f"{d0.isoformat()}T00:00:00+00:00")
    until_iso = _pg_ts(f"{d1.isoformat()}T23:59:59+00:00")

    # ── Miesiące przecinające okno ──
    months: dict[str, int] = defaultdict(int)  # YYYY-MM -> days overlap
    for d in _iter_days(d0, d1):
        months[f"{d.year:04d}-{d.month:02d}"] += 1

    # ── Przychód ──
    # 1) POS (ta sama baza co rankingi menu) — zawsze w oknie since..until
    # 2) revenue_entries z created_at w oknie
    # 3) year_month + data w note (seed SIM)
    # 4) daily_reports
    revenue = 0.0
    revenue_source = "none"
    try:
        menu_agg = await _aggregate_menu_sales(
            client,
            days_selected,
            since_iso=since_iso,
            until_iso=until_iso,
        )
        pos_rev = round(sum(float(r.get("revenue_pln") or 0) for r in menu_agg), 2)
        if pos_rev > 0:
            revenue = pos_rev
            revenue_source = "pos_sales_log"
    except Exception:
        pass

    seen_rev = 0.0
    if revenue <= 0:
        try:
            rev_rows = await sb_get(client, "revenue_entries", params=[
                ("select", "amount_pln,created_at,year_month"),
                ("created_at", f"gte.{since_iso}"),
                ("created_at", f"lte.{until_iso}"),
                ("limit", "20000"),
            ]) or []
            for r in rev_rows:
                ca = str(r.get("created_at") or "")
                if ca and d0.isoformat() <= ca[:10] <= d1.isoformat():
                    revenue += float(r.get("amount_pln") or 0)
                    seen_rev += 1
            if revenue > 0:
                revenue_source = "revenue_entries"
        except Exception:
            # Fallback bez podwójnego created_at
            try:
                rev_rows = await sb_get(client, "revenue_entries", params={
                    "select": "amount_pln,created_at,year_month",
                    "created_at": f"gte.{since_iso}",
                    "limit": "20000",
                }) or []
                for r in rev_rows:
                    ca = str(r.get("created_at") or "")
                    if ca and d0.isoformat() <= ca[:10] <= d1.isoformat():
                        revenue += float(r.get("amount_pln") or 0)
                        seen_rev += 1
                if revenue > 0:
                    revenue_source = "revenue_entries"
            except Exception:
                pass

    # dociągnij po year_month (gdy created_at = data insertu, a nie dzień sprzedaży)
    if revenue <= 0:
        for ym in months:
            try:
                ym_rows = await sb_get(client, "revenue_entries", params={
                    "select": "amount_pln,created_at,year_month,note,description",
                    "year_month": f"eq.{ym}",
                    "limit": "5000",
                }) or []
            except Exception:
                ym_rows = []
            for r in ym_rows:
                ca = str(r.get("created_at") or "")
                if ca and d0.isoformat() <= ca[:10] <= d1.isoformat():
                    continue  # już w sumie z created_at
                note = str(r.get("note") or "") + " " + str(r.get("description") or "")
                mday = re.search(r"(20\d{2}-\d{2}-\d{2})", note)
                if mday:
                    day_s = mday.group(1)
                    if d0.isoformat() <= day_s <= d1.isoformat():
                        revenue += float(r.get("amount_pln") or 0)
                    continue
                y, m = int(ym[:4]), int(ym[5:7])
                dim = monthrange(y, m)[1]
                overlap = months[ym]
                if dim and seen_rev == 0:
                    revenue += float(r.get("amount_pln") or 0) * (overlap / dim)
        if revenue > 0:
            revenue_source = "revenue_entries_ym"

    if revenue <= 0:
        # fallback: daily_reports
        try:
            dr = await sb_get(client, "daily_reports", params={
                "select": "date,total_revenue",
                "date": f"gte.{d0.isoformat()}",
                "limit": "400",
            }) or []
            for r in dr:
                if (r.get("date") or "") <= d1.isoformat():
                    revenue += float(r.get("total_revenue") or 0)
            if revenue > 0:
                revenue_source = "daily_reports"
        except Exception:
            pass
    revenue = round(revenue, 2)

    # ── Koszty stałe (proporcja) ──
    fixed_alloc = 0.0
    fixed_detail = []
    for ym, overlap_days in months.items():
        y, m = int(ym[:4]), int(ym[5:7])
        dim = monthrange(y, m)[1]
        rows = await sb_get(client, "fixed_costs", params={
            "select": "amount_pln,name,year_month",
            "year_month": f"eq.{ym}",
            "limit": "2000",
        }) or []
        month_sum = round(sum(float(r.get("amount_pln") or 0) for r in rows), 2)
        part = round(month_sum * (overlap_days / dim), 2) if dim else 0.0
        fixed_alloc += part
        if month_sum:
            fixed_detail.append({
                "year_month": ym, "month_total": month_sum,
                "days_in_month": dim, "days_selected": overlap_days, "allocated": part,
            })
    fixed_alloc = round(fixed_alloc, 2)

    # ── Koszty zmienne bez waste (proporcja po year_month) — brutto / zakupy ──
    variable_gross = 0.0
    variable_detail = []
    for ym, overlap_days in months.items():
        y, m = int(ym[:4]), int(ym[5:7])
        dim = monthrange(y, m)[1]
        rows = await sb_get(client, "variable_cost_entries", params={
            "select": "amount_pln,type,name,year_month",
            "year_month": f"eq.{ym}",
            "limit": "5000",
        }) or []
        month_sum = round(sum(
            float(r.get("amount_pln") or 0)
            for r in rows
            if str(r.get("type") or "").lower() != "waste"
        ), 2)
        part = round(month_sum * (overlap_days / dim), 2) if dim else 0.0
        variable_gross += part
        if month_sum:
            variable_detail.append({
                "year_month": ym, "month_total": month_sum,
                "days_in_month": dim, "days_selected": overlap_days, "allocated": part,
            })
    variable_gross = round(variable_gross, 2)

    # ── Straty produktowe (waste_logs: dania + składniki) ──
    waste_actual = 0.0
    waste_meta: dict = {}
    try:
        waste_meta = await _sum_waste_logs_cost_pln(
            client,
            since_iso=since_iso,
            until_iso=until_iso,
            d0_iso=d0.isoformat(),
            d1_iso=d1.isoformat(),
        )
        waste_actual = float(waste_meta.get("total_cost_pln") or 0)
    except Exception:
        waste_actual = 0.0

    if waste_actual <= 0:
        # fallback: variable type=waste w oknie po created_at
        try:
            wrows = await sb_get(client, "variable_cost_entries", params={
                "select": "amount_pln,type,created_at",
                "type": "eq.waste",
                "created_at": f"gte.{since_iso}",
                "limit": "5000",
            }) or []
            for r in wrows:
                ca = str(r.get("created_at") or "")
                if ca and d0.isoformat() <= ca[:10] <= d1.isoformat():
                    waste_actual += float(r.get("amount_pln") or 0)
        except Exception:
            pass
    waste_actual = round(waste_actual, 2)

    # Zmienne netto: zakupy już zawierają koszt zmarnowanych produktów —
    # odejmujemy straty od zmiennych, żeby nie liczyć ich drugi raz.
    variable_net = round(max(0.0, variable_gross - waste_actual), 2)
    net_profit = round(revenue - fixed_alloc - waste_actual - variable_net, 2)
    # Równoważnie: revenue - fixed - variable_gross
    operating = round(revenue - fixed_alloc - variable_gross, 2)

    return {
        "since": d0.isoformat(),
        "until": d1.isoformat(),
        "days_count": days_selected,
        "total_revenue": revenue,
        "revenue_source": revenue_source,
        "fixed_costs_allocated": fixed_alloc,
        "variable_costs_allocated": variable_gross,  # brutto (zakupy) — kompatybilność
        "variable_costs_gross": variable_gross,
        "variable_costs_net": variable_net,
        "total_waste_cost": waste_actual,
        "operating_profit": operating,
        "net_profit": net_profit,
        # aliases for older UI
        "total_invoice_cost": variable_gross,
        "fixed_detail": fixed_detail,
        "variable_detail": variable_detail,
        "waste_events_costed": waste_meta.get("events_costed"),
        "waste_events_total": waste_meta.get("events_total"),
    }


# Reports API: backend/reports_routes.py (include_router)


async def _daily_profit_series(
    client: httpx.AsyncClient,
    since_d: str,
    until_d: str,
) -> list[dict]:
    """Dni z zyskiem: daily_reports, potem fallback z revenue/variable/waste."""
    from collections import defaultdict

    days: dict[str, dict] = {}
    try:
        dr = await sb_get(client, "daily_reports", params={
            "select": "date,total_revenue,total_waste_cost,total_invoice_cost",
            "date": f"gte.{since_d}",
            "order": "date.asc",
            "limit": "800",
        }) or []
        for r in dr:
            d = str(r.get("date") or "")[:10]
            if not d or d < since_d or d > until_d:
                continue
            rev = float(r.get("total_revenue") or 0)
            waste = float(r.get("total_waste_cost") or 0)
            inv = float(r.get("total_invoice_cost") or 0)
            days[d] = {
                "date": d,
                "revenue_pln": round(rev, 2),
                "waste_pln": round(waste, 2),
                "costs_pln": round(inv, 2),
                "net_pln": round(rev - waste - inv, 2),
                "source": "daily_reports",
            }
    except Exception:
        pass

    if days:
        return sorted(days.values(), key=lambda x: x["date"])

    rev_by: dict[str, float] = defaultdict(float)
    cost_by: dict[str, float] = defaultdict(float)
    waste_by: dict[str, float] = defaultdict(float)
    since_iso = _pg_ts(f"{since_d}T00:00:00+00:00")
    until_iso = _pg_ts(f"{until_d}T23:59:59+00:00")
    try:
        revs = await sb_get(client, "revenue_entries", params={
            "select": "amount_pln,created_at",
            "created_at": f"gte.{since_iso}",
            "limit": "20000",
        }) or []
        for r in revs:
            ca = str(r.get("created_at") or "")[:10]
            if since_d <= ca <= until_d:
                rev_by[ca] += float(r.get("amount_pln") or 0)
    except Exception:
        pass
    try:
        vars_ = await sb_get(client, "variable_cost_entries", params={
            "select": "amount_pln,type,created_at",
            "created_at": f"gte.{since_iso}",
            "limit": "20000",
        }) or []
        for r in vars_:
            ca = str(r.get("created_at") or "")[:10]
            if not (since_d <= ca <= until_d):
                continue
            amt = float(r.get("amount_pln") or 0)
            if (r.get("type") or "") == "waste":
                waste_by[ca] += amt
            else:
                cost_by[ca] += amt
    except Exception:
        pass
    try:
        wmeta = await _sum_waste_logs_cost_pln(
            client,
            since_iso=since_iso,
            until_iso=until_iso,
            d0_iso=since_d,
            d1_iso=until_d,
        )
        # brak rozbicia dziennego w meta — zostaw waste_by z variable type=waste
        _ = wmeta
    except Exception:
        pass

    all_dates = sorted(set(rev_by) | set(cost_by) | set(waste_by))
    out = []
    for d in all_dates:
        rev = round(rev_by.get(d, 0.0), 2)
        costs = round(cost_by.get(d, 0.0), 2)
        waste = round(waste_by.get(d, 0.0), 2)
        out.append({
            "date": d,
            "revenue_pln": rev,
            "waste_pln": waste,
            "costs_pln": costs,
            "net_pln": round(rev - waste - costs, 2),
            "source": "entries",
        })
    return out

__all__ = ['_agg_reports', '_compute_true_pnl', '_daily_profit_series', '_iter_days', '_report_net']
