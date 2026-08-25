"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `analytics_runners`."""
from __future__ import annotations

from http_ssl import httpx_verify as _httpx_verify
from supabase_rest import sb_get
from supabase_rest import sb_post
from typing import Optional
import httpx
from analytics_periods import _coerce_selected_periods, _period_days, _resolve_period_window, _window_from_period_sel
from analytics_pnl import _compute_true_pnl
from analytics_sales import _aggregate_menu_sales, _run_rank_dead_menu
from analytics_waste import _run_rank_waste_cost
from billing_credits import _chat_and_bill, _with_billing
from constants import _HACCP_RULES, _MONTH_NAMES_PL
from matching_utils import _norm_name_key
from subscription_core import _check_ai_access



async def _run_list_expiring_soon(
    *,
    within_days=3,
    top_n=None,
) -> dict:
    """Drabina dat ważności z warehouse_inventory (bez żargonu T-N)."""
    from datetime import date as _date, timedelta

    try:
        horizon = max(1, min(int(within_days or 3), 14))
    except (TypeError, ValueError):
        horizon = 3
    n = 20
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 40)
    except (TypeError, ValueError):
        pass

    today = _date.today()
    until = today + timedelta(days=horizon)

    def _ladder_label(days_left: int) -> str:
        if days_left <= 0:
            return "dziś"
        if days_left == 1:
            return "jutro"
        if days_left == 2:
            return "pojutrze"
        return f"za {days_left} dni"

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        try:
            # Refresh endpoint: PostgREST RPC. Use sb_post() so we validate
            # the rest path (prevents SSRF-style URL construction findings).
            await sb_post(client, "rpc/warehouse_inventory_refresh_status", {})
        except Exception:
            pass

        rows = await sb_get(client, "warehouse_inventory", params={
            "select": "id,product_name,quantity,unit,expiration_date,status",
            "expiration_date": f"lte.{until.isoformat()}",
            "quantity": "gt.0",
            "order": "expiration_date.asc",
            "limit": "500",
        }) or []

        ladder: dict[str, list] = {}
        items = []
        for r in rows:
            try:
                exp = _date.fromisoformat(str(r.get("expiration_date"))[:10])
            except Exception:
                continue
            days_left = (exp - today).days
            if days_left < 0:
                continue
            if days_left > horizon:
                continue
            # Bogate tipy + gry: frontend pickExpiryTips (expiryTipsCatalog).
            # Tu tylko krótki fallback fazy (gdy FE nie podmieni / API klient).
            if days_left <= 1:
                tip_phase = "t1"
                tip = "T-1: ratuj agresywnie (katalog tipów w aplikacji)."
            elif days_left == 2:
                tip_phase = "t2"
                tip = "T-2: Happy Hour / przeróbka (katalog tipów w aplikacji)."
            elif days_left == 3:
                tip_phase = "t3"
                tip = "T-3: łagodna promocja / combo (katalog tipów w aplikacji)."
            else:
                tip_phase = None
                tip = "Monitoruj datę — tipy katalogowe dla T-3/T-2/T-1."
            label = _ladder_label(days_left)
            entry = {
                "id": r.get("id"),
                "name": r.get("product_name"),
                "qty": float(r.get("quantity") or 0),
                "unit": r.get("unit") or "",
                "expiration_date": exp.isoformat(),
                "days_left": days_left,
                "ladder": label,
                "tip": tip,
                "tip_phase": tip_phase,
                "tips_source": "frontend_catalog",
            }
            items.append(entry)
            ladder.setdefault(label, []).append(entry)

        items = items[:n]
        if not items:
            return {
                "ok": True,
                "within_days": horizon,
                "items": [],
                "ladder": ladder,
                "assistant_speech": "",
                "message": (
                    f"Brak partii kończących się w ciągu {horizon} dni. "
                    "Dodawaj daty ważności przy dostawie."
                ),
            }

        return {
            "ok": True,
            "within_days": horizon,
            "items": items,
            "ladder": ladder,
            "assistant_speech": "",
            "message": f"Produkty kończące się w ciągu {horizon} dni — lista poniżej.",
        }


async def _run_rank_supplier_spend(
    *,
    period_type: str = "month",
    limit_days=None,
    top_n=None,
    period_hint: Optional[str] = None,
    supplier_name: Optional[str] = None,
) -> dict:
    """Suma invoices.total_cost per dostawca w oknie."""
    since_iso, until_iso, label = _resolve_period_window(period_type, limit_days, period_hint)
    n = 5
    try:
        if top_n and int(top_n) > 0:
            n = min(int(top_n), 20)
    except (TypeError, ValueError):
        pass
    filt = (supplier_name or "").strip().lower()

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as client:
        rows = await sb_get(client, "invoices", params={
            "select": "supplier_id,supplier_name,total_cost,created_at",
            "created_at": f"gte.{since_iso}",
            "order": "created_at.desc",
            "limit": "5000",
        }) or []
        if until_iso:
            rows = [r for r in rows if str(r.get("created_at") or "") <= until_iso]

        totals: dict[str, dict] = {}
        for r in rows:
            name = (r.get("supplier_name") or "Nieznany dostawca").strip()
            if filt and filt not in name.lower() and filt not in _norm_name_key(name):
                continue
            key = str(r.get("supplier_id") or _norm_name_key(name) or name)
            slot = totals.setdefault(key, {
                "supplier_id": r.get("supplier_id"),
                "name": name,
                "spend_pln": 0.0,
                "invoice_count": 0,
            })
            slot["spend_pln"] = round(slot["spend_pln"] + float(r.get("total_cost") or 0), 2)
            slot["invoice_count"] += 1

        ranked = sorted(totals.values(), key=lambda x: x["spend_pln"], reverse=True)
        top = ranked[:n]
        total = round(sum(x["spend_pln"] for x in ranked), 2)
        if not ranked:
            return {
                "ok": True,
                "period_label": label,
                "total_spend_pln": 0,
                "items": [],
                "assistant_speech": "",
                "message": f"Brak faktur za {label}. Wgraj faktury zakupowe.",
            }
        return {
            "ok": True,
            "period_label": label,
            "total_spend_pln": total,
            "items": top,
            "assistant_speech": "",
            "message": f"Wydatki u dostawców za {label} — lista poniżej.",
        }


def _run_haccp_tip(query: str) -> dict:
    q = _norm_name_key(query or "")
    hits = []
    for rule in _HACCP_RULES:
        if any(k in q for k in rule["keys"]):
            hits.append(rule)
    if not hits:
        hits = [_HACCP_RULES[0], _HACCP_RULES[1], _HACCP_RULES[2]]
    hits = hits[:3]
    lines = " ".join(f"{h['title']}: {h['body']}" for h in hits)
    topic = query.strip() or "ogólne"
    return {
        "ok": True,
        "items": [{"name": h["title"], "tip": h["body"], "id": h["id"]} for h in hits],
        "assistant_speech": f"HACCP / przechowywanie ({topic}): {lines}",
    }


async def _run_manager_core_alerts(
    *,
    period_type: str = "week",
    limit_days=None,
    period_hint: Optional[str] = None,
) -> dict:
    """4 pary CORE: POS↔Mag, Mag↔Waste/expiry, Waste↔zł, Mag↔Dostawy (overstock)."""
    from datetime import date as _date, timedelta

    since_iso, until_iso, label = _resolve_period_window(period_type, limit_days, period_hint)
    days = _period_days(period_type or "week", limit_days)
    alerts: list[dict] = []

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        # 1) POS ↔ Magazyn — top dish coverage in hours (rough)
        sales = await _aggregate_menu_sales(
            client, days, since_iso=since_iso, until_iso=until_iso,
        )
        sales_sorted = sorted(sales, key=lambda r: r.get("qty_sold", 0), reverse=True)[:5]
        inv = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,min_quantity,unit",
            "limit": "3000",
        }) or []
        inv_by_name = {_norm_name_key(i.get("name") or ""): i for i in inv}
        recipes = await sb_get(client, "recipe_ingredients", params={
            "select": "menu_item_id,ingredient_name,quantity,inventory_item_id",
            "limit": "8000",
        }) or []
        by_menu: dict[str, list] = {}
        for ri in recipes:
            mid = ri.get("menu_item_id")
            if mid:
                by_menu.setdefault(mid, []).append(ri)

        hours_open = max(1.0, float(days) * 8.0)  # rough service hours in window
        for dish in sales_sorted:
            mid = dish.get("menu_item_id")
            qty_sold = float(dish.get("qty_sold") or 0)
            if qty_sold < 3:
                continue
            rate = qty_sold / hours_open  # portions per hour
            if rate <= 0:
                continue
            # weakest ingredient coverage
            worst_h = None
            worst_name = None
            for ri in by_menu.get(mid, []):
                iname = ri.get("ingredient_name") or ""
                inv_row = inv_by_name.get(_norm_name_key(iname))
                if not inv_row and ri.get("inventory_item_id"):
                    inv_row = next((x for x in inv if str(x.get("id")) == str(ri.get("inventory_item_id"))), None)
                if not inv_row:
                    continue
                per_portion = float(ri.get("quantity") or 0) or 1.0
                stock = float(inv_row.get("quantity") or 0)
                portions_left = stock / per_portion if per_portion > 0 else 0
                hours_left = portions_left / rate if rate > 0 else 999
                if worst_h is None or hours_left < worst_h:
                    worst_h = hours_left
                    worst_name = inv_row.get("name") or iname
            if worst_h is not None and worst_h < 3:
                alerts.append({
                    "pair": "POS↔Magazyn",
                    "name": dish.get("name"),
                    "detail": (
                        f"Przy obecnym tempie zapas „{worst_name}” wystarczy ~{worst_h:.1f} h "
                        f"({dish.get('qty_sold')} szt sprzedanych w okresie)."
                    ),
                    "severity": "critical" if worst_h < 1.5 else "warn",
                })

        # 2) Magazyn ↔ Waste / expiry — batches ≤48h
        today = _date.today()
        batches = await sb_get(client, "warehouse_inventory", params={
            "select": "product_name,quantity,unit,expiration_date",
            "expiration_date": f"lte.{(today + timedelta(days=2)).isoformat()}",
            "quantity": "gt.0",
            "limit": "200",
        }) or []
        for b in batches[:8]:
            try:
                exp = _date.fromisoformat(str(b.get("expiration_date"))[:10])
            except Exception:
                continue
            left = (exp - today).days
            if left < 0:
                continue
            alerts.append({
                "pair": "Magazyn↔Ważność",
                "name": b.get("product_name"),
                "detail": (
                    f"Partia {b.get('quantity')} {b.get('unit') or ''} kończy się za {left} dni "
                    f"({exp.isoformat()}). Rozważ promocję / przeróbkę."
                ),
                "severity": "critical" if left <= 1 else "warn",
            })

        # 3) Waste ↔ zł — threshold
        waste = await _run_rank_waste_cost(
            period_type=period_type, limit_days=limit_days, top_n=3, period_hint=period_hint,
        )
        total_w = float(waste.get("total_cost_pln") or 0)
        if total_w >= 100:
            top = (waste.get("items") or [{}])[0]
            alerts.append({
                "pair": "Straty↔Zł",
                "name": top.get("name") or "Kosz",
                "detail": (
                    f"Za {label} strata ~{total_w:.0f} zł. Lider: {top.get('name')} "
                    f"({top.get('cost_pln', 0):.0f} zł)."
                ),
                "severity": "critical" if total_w >= 500 else "warn",
            })

        # 4) Magazyn ↔ Dostawy — recent invoice while stock >> min
        invs = await sb_get(client, "invoices", params={
            "select": "supplier_name,total_cost,created_at,note",
            "created_at": f"gte.{(today - timedelta(days=3)).isoformat()}",
            "order": "created_at.desc",
            "limit": "20",
        }) or []
        overstock = [
            i for i in inv
            if float(i.get("min_quantity") or 0) > 0
            and float(i.get("quantity") or 0) >= float(i.get("min_quantity") or 0) * 3
        ][:5]
        if invs and overstock:
            names = ", ".join(o.get("name") or "?" for o in overstock[:3])
            alerts.append({
                "pair": "Magazyn↔Dostawy",
                "name": "Możliwe dublowanie",
                "detail": (
                    f"W ostatnich 3 dniach są nowe faktury, a stany wysokie (×3 próg): {names}. "
                    "Sprawdź, czy nie zamawiasz w nadmiarze."
                ),
                "severity": "info",
            })

        # 5) POS ↔ Waste — dead menu + waste money both present
        dead = await _run_rank_dead_menu(
            period_type=period_type, limit_days=limit_days, top_n=3, period_hint=period_hint,
        )
        weak = dead.get("items") or []
        if len(weak) >= 3 and total_w >= 50:
            dnames = ", ".join(x.get("name") or "?" for x in weak[:3])
            alerts.append({
                "pair": "POS↔Straty",
                "name": "Słaba sprzedaż + kosz",
                "detail": (
                    f"Najsłabsze dania: {dnames}… przy stratach {total_w:.0f} zł. "
                    "Rozważ rotację karty i mniejsze zamówienia składników."
                ),
                "severity": "warn",
            })

    if not alerts:
        return {
            "ok": True,
            "period_label": label,
            "items": [],
            "alerts": [],
            "assistant_speech": (
                f"Za {label} brak krytycznych alertów korelacji CORE. "
                "Magazyn, POS i straty wyglądają stabilnie."
            ),
        }

    alerts.sort(key=lambda a: {"critical": 0, "warn": 1, "info": 2}.get(a.get("severity"), 3))
    lines = "; ".join(f"[{a['pair']}] {a['name']}: {a['detail']}" for a in alerts[:6])
    return {
        "ok": True,
        "period_label": label,
        "items": [{"name": a["name"], "detail": a["detail"], "pair": a["pair"], "severity": a["severity"]} for a in alerts],
        "alerts": alerts,
        "assistant_speech": f"Alerty managera ({label}): {lines}",
    }


async def _run_period_analysis(
    period_type: str,
    limit_days,
    period_hint: Optional[str] = None,
    selected_periods: Optional[list] = None,
) -> dict:
    """Analiza P&L. selected_periods: lista {kind, year, month?, week?, day?} z pickera."""
    from datetime import date as _date
    from calendar import monthrange

    async def _window_from_sel(sel: dict) -> tuple[str, str, str]:
        return _window_from_period_sel(sel if isinstance(sel, dict) else {})


    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        await _check_ai_access(client)

        periods_out = []
        sels = _coerce_selected_periods(selected_periods)
        if sels:
            for sel in sels[:12]:
                s, u, lbl = await _window_from_sel(sel)
                pnl = await _compute_true_pnl(client, s[:10], u[:10])
                periods_out.append({"label": lbl, "aggregates": pnl})
            label = " · ".join(p["label"] for p in periods_out)
            # NIE sumuj nakładających się okresów (rok + miesiąc = podwójne liczenie).
            # FE pokazuje każdy okres osobno; aggregates zostawiamy tylko przy 1 okresie.
            agg = periods_out[0]["aggregates"] if len(periods_out) == 1 else {
                "total_revenue": None,
                "fixed_costs_allocated": None,
                "variable_costs_allocated": None,
                "total_waste_cost": None,
                "operating_profit": None,
                "net_profit": None,
                "days_count": sum(p["aggregates"].get("days_count") or 0 for p in periods_out),
                "total_invoice_cost": None,
            }
        else:
            since_iso, until_iso, label = _resolve_period_window(period_type, limit_days, period_hint)
            pnl = await _compute_true_pnl(client, since_iso[:10], until_iso[:10])
            agg = pnl
            periods_out = [{"label": label, "aggregates": pnl}]

        # Krótki komunikat bez ściany tekstu AI
        if len(periods_out) > 1:
            speech = ""
            billing = {}
        else:
            sign = "na plusie" if (agg.get("net_profit") or 0) >= 0 else "na minusie"
            speech = (
                f"Za {label}: przychód {agg.get('total_revenue') or 0:.0f} zł, "
                f"straty {agg.get('total_waste_cost') or 0:.0f} zł, "
                f"zysk {agg.get('net_profit') or 0:.0f} zł ({sign})."
            )
            billing = {}

    return _with_billing({
        "ok": True,
        "period_label": label,
        "reports_count": agg.get("days_count", 0) if isinstance(agg, dict) else 0,
        "aggregates": agg if len(periods_out) == 1 else None,
        "periods": periods_out,
        "assistant_speech": "",
        "message": speech if speech else f"P&L — {len(periods_out)} okresów osobno poniżej.",
    }, billing)


async def _run_compare_periods(
    period_1: str,
    period_2: str,
    selected_periods: Optional[list] = None,
) -> dict:
    """Porównanie dwóch okresów na rzetelnym P&L (przychód − stałe − zmienne − straty)."""
    from calendar import monthrange
    from datetime import date as _date

    def _parse_one(period: str):
        """Zwraca (since, until, label) lub (None, None, raw)."""
        # reuse calendar resolver
        since, until, label = _resolve_period_window("month", None, period)
        # jeśli resolver spadł do „ostatni tydzień” — fail
        if label.startswith("ostatni") or label.startswith("ostatnie"):
            return None, period
        return (since[:10], until[:10]), label

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        await _check_ai_access(client)
        # Preferuj selected_periods: pierwsze dwa okna
        if selected_periods and isinstance(selected_periods, list) and len(selected_periods) >= 2:
            from calendar import monthrange as _mr
            async def _win(sel):
                kind = (sel.get("kind") or "month").lower()
                y = int(sel.get("year") or _date.today().year)
                if kind == "year":
                    return f"{y}-01-01", f"{y}-12-31", f"rok {y}"
                m = int(sel.get("month") or 1)
                last = _mr(y, m)[1]
                if kind == "month":
                    return f"{y}-{m:02d}-01", f"{y}-{m:02d}-{last:02d}", f"{_MONTH_NAMES_PL[m]} {y}"
                if kind == "day":
                    d = max(1, min(last, int(sel.get("day") or 1)))
                    iso = f"{y}-{m:02d}-{d:02d}"
                    return iso, iso, f"{d:02d}.{m:02d}.{y}"
                w = max(1, min(5, int(sel.get("week") or 1)))
                sd = 1 + (w - 1) * 7
                ed = min(last, sd + 6)
                return f"{y}-{m:02d}-{sd:02d}", f"{y}-{m:02d}-{ed:02d}", f"tydzień {w} · {_MONTH_NAMES_PL[m]} {y}"
            s1, u1, lbl1 = await _win(selected_periods[0] if isinstance(selected_periods[0], dict) else {})
            s2, u2, lbl2 = await _win(selected_periods[1] if isinstance(selected_periods[1], dict) else {})
            w1, w2 = (s1, u1), (s2, u2)
        else:
            w1, lbl1 = _parse_one(period_1)
            w2, lbl2 = _parse_one(period_2)
            if w1 is None or w2 is None:
                return {"ok": False,
                        "assistant_speech": f"Nie rozpoznałem okresów „{period_1}” i „{period_2}”. "
                                            "Podaj miesiące z rokiem, np. lipiec 2025 i sierpień 2025."}

        a1 = await _compute_true_pnl(client, w1[0], w1[1])
        a2 = await _compute_true_pnl(client, w2[0], w2[1])
        prompt = (
            "Działasz jako dyrektor finansowy restauracji. Porównaj dwa okresy.\n"
            f"Okres 1 ({lbl1}): przychód {a1['total_revenue']} zł, koszty stałe {a1['fixed_costs_allocated']} zł, "
            f"straty produktowe {a1['total_waste_cost']} zł, "
            f"koszty zmienne netto {a1.get('variable_costs_net', a1['variable_costs_allocated'])} zł "
            f"(brutto {a1['variable_costs_allocated']} zł), zysk {a1['net_profit']} zł.\n"
            f"Okres 2 ({lbl2}): przychód {a2['total_revenue']} zł, koszty stałe {a2['fixed_costs_allocated']} zł, "
            f"straty produktowe {a2['total_waste_cost']} zł, "
            f"koszty zmienne netto {a2.get('variable_costs_net', a2['variable_costs_allocated'])} zł "
            f"(brutto {a2['variable_costs_allocated']} zł), zysk {a2['net_profit']} zł.\n\n"
            "NIGDY nie nazywaj przychodu „zyskiem”. Wskaż różnicę w zysku, co się poprawiło/pogorszyło "
            "i jedną managerską radę. Maks. 5 zdań po polsku."
        )
        speech, billing = await _chat_and_bill(client, prompt,
                                      endpoint="/api/reports/compare-periods",
                                      extras={"p1": lbl1, "p2": lbl2})

    return _with_billing({
        "ok": True,
        "period_1": {"label": lbl1, "aggregates": a1},
        "period_2": {"label": lbl2, "aggregates": a2},
        "aggregates": {
            "total_revenue": round(a1["total_revenue"] + a2["total_revenue"], 2),
            "fixed_costs_allocated": round(a1["fixed_costs_allocated"] + a2["fixed_costs_allocated"], 2),
            "variable_costs_allocated": round(a1["variable_costs_allocated"] + a2["variable_costs_allocated"], 2),
            "variable_costs_gross": round(
                a1.get("variable_costs_gross", a1["variable_costs_allocated"])
                + a2.get("variable_costs_gross", a2["variable_costs_allocated"]),
                2,
            ),
            "variable_costs_net": round(
                a1.get("variable_costs_net", a1["variable_costs_allocated"])
                + a2.get("variable_costs_net", a2["variable_costs_allocated"]),
                2,
            ),
            "total_waste_cost": round(a1["total_waste_cost"] + a2["total_waste_cost"], 2),
            "operating_profit": round(a1["operating_profit"] + a2["operating_profit"], 2),
            "net_profit": round(a1["net_profit"] + a2["net_profit"], 2),
        },
        "period_label": f"{lbl1} vs {lbl2}",
        "assistant_speech": speech,
    }, billing)

__all__ = ['_run_compare_periods', '_run_haccp_tip', '_run_list_expiring_soon', '_run_manager_core_alerts', '_run_period_analysis', '_run_rank_supplier_spend']
