"""
Supplier intents: flip-order, budget-cap, top-savings, predictive-restock.
Wydzielone z server.py — require_tenant_account_key na wszystkich.
"""
from __future__ import annotations

from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get

router = APIRouter(tags=["supplier-intents"])


def _tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


def _fuzzy(query, rows, *, key: str = "name", threshold: int = 55):
    from server import _resolve_by_fuzzy

    return _resolve_by_fuzzy(query, rows, key=key, threshold=threshold)


def _norm(text: str) -> str:
    from server import _norm_pl

    return _norm_pl(text)


def _fuzzy_str(query: str, choices: list[str], threshold: int = 70):
    from server import _fuzzy_match

    return _fuzzy_match(query, choices, threshold=threshold)


async def _ai_access(client, **kwargs):
    from server import _check_ai_access

    return await _check_ai_access(client, **kwargs)


async def _ai_guard(**kwargs):
    from server import _guard_ai

    return await _guard_ai(**kwargs)


class FlipOrderRequest(BaseModel):
    from_supplier: str
    to_supplier: str
    category: Optional[str] = None
    items: Optional[list[dict]] = None  # opcjonalna lista {product_name, quantity, unit}


@router.post("/api/suppliers/flip-order")
async def supplier_flip_order(req: FlipOrderRequest):
    """Przerzuca koszyk z jednego dostawcy do drugiego (fuzzy match po nazwach produktów).
    Zwraca porównanie cen i sugerowany nowy koszyk u to_supplier."""
    _tenant()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        await _ai_access(client, needs_credits=False, needs_deal_hunter=True)
        suppliers = await sb_get(client, "suppliers", params={"select": "id,name", "limit": "500"}) or []
        src, _ = _fuzzy(req.from_supplier, suppliers)
        dst, _ = _fuzzy(req.to_supplier, suppliers)
        if not src:
            raise HTTPException(status_code=404, detail=f"Nie znaleziono dostawcy: {req.from_supplier}")
        if not dst:
            raise HTTPException(status_code=404, detail=f"Nie znaleziono dostawcy: {req.to_supplier}")

        src_catalog = await sb_get(client, "supplier_catalog", params={
            "select": "id,name,price_pln,variant,unit,volume_label,is_visible",
            "supplier_id": f"eq.{src['id']}",
        }) or []
        dst_catalog = await sb_get(client, "supplier_catalog", params={
            "select": "id,name,price_pln,variant,unit,volume_label,is_visible",
            "supplier_id": f"eq.{dst['id']}",
        }) or []

        # Jeśli podano items — porównaj tylko te, w innym razie: cały koszyk jawny.
        if req.items:
            comparison = []
            for it in req.items:
                pname = (it.get("product_name") or "").strip()
                qty = float(it.get("quantity") or 1)
                src_hit, _ = _fuzzy(pname, src_catalog, key="name")
                dst_hit, _ = _fuzzy(pname, dst_catalog, key="name")
                comparison.append({
                    "product_name": pname, "quantity": qty,
                    "from": {"name": (src_hit or {}).get("name"),
                             "price_pln": float((src_hit or {}).get("price_pln") or 0)} if src_hit else None,
                    "to": {"name": (dst_hit or {}).get("name"),
                           "price_pln": float((dst_hit or {}).get("price_pln") or 0)} if dst_hit else None,
                    "matched_at_target": bool(dst_hit),
                })
        else:
            # Cały jawny koszyk from_supplier → próbujemy zmapować na to_supplier.
            comparison = []
            for r in src_catalog:
                if r.get("is_visible") is False:
                    continue
                dst_hit, _ = _fuzzy(r["name"], dst_catalog, key="name")
                comparison.append({
                    "product_name": r["name"], "quantity": 1,
                    "from": {"name": r["name"], "price_pln": float(r.get("price_pln") or 0)},
                    "to": ({"name": dst_hit["name"], "price_pln": float(dst_hit.get("price_pln") or 0)}
                           if dst_hit else None),
                    "matched_at_target": bool(dst_hit),
                })

        total_from = sum((c["from"] or {}).get("price_pln", 0) * c["quantity"] for c in comparison if c["from"])
        total_to = sum((c["to"] or {}).get("price_pln", 0) * c["quantity"] for c in comparison if c["to"])
        saving = total_from - total_to
        matched = sum(1 for c in comparison if c["matched_at_target"])

        return {
            "from_supplier": {"id": src["id"], "name": src["name"]},
            "to_supplier": {"id": dst["id"], "name": dst["name"]},
            "category": req.category,
            "items_matched": matched, "items_total": len(comparison),
            "total_from_pln": round(total_from, 2),
            "total_to_pln": round(total_to, 2),
            "saving_pln": round(saving, 2),
            "comparison": comparison,
        }


class BudgetCapOrderRequest(BaseModel):
    max_budget: float
    category: Optional[str] = None
    supplier_id: Optional[str] = None


@router.post("/api/suppliers/budget-cap-order")
async def supplier_budget_cap_order(req: BudgetCapOrderRequest):
    """Kompletuje zamówienie priorytetyzując najpilniejsze braki magazynowe (najniższy
    stosunek quantity/min_quantity) do LIMITU KWOTOWEGO."""
    _tenant()
    if req.max_budget is None or req.max_budget <= 0:
        raise HTTPException(status_code=400, detail="Nieprawidłowy budżet.")
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        await _ai_access(client, needs_credits=False, needs_deal_hunter=True)
        # 1) Ranking produktów magazynowych po pilności (im niższy stan / min, tym pilniej).
        inv = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,min_quantity,safety_buffer_percent,unit",
            "limit": "5000"
        }) or []
        prioritized = []
        for r in inv:
            q = float(r.get("quantity") or 0)
            m = float(r.get("min_quantity") or 0)
            sb = float(r.get("safety_buffer_percent") or 20) / 100.0
            target = m * (1.0 + sb) if m > 0 else max(q * 1.5, 1.0)
            deficit = max(0.0, target - q)
            urgency = (q / m) if m > 0 else 999.0  # niższe = pilniejsze
            prioritized.append({**r, "deficit": deficit, "urgency": urgency, "target": target})
        prioritized = [p for p in prioritized if p["deficit"] > 0]
        prioritized.sort(key=lambda x: x["urgency"])

        # 2) Ceny — bierzemy najtańszą pozycję z supplier_catalog per produkt (fuzzy match).
        cat_params = {"select": "id,supplier_id,name,price_pln,unit,volume_label,is_visible", "limit": "10000"}
        if req.supplier_id:
            cat_params["supplier_id"] = f"eq.{req.supplier_id}"
        catalog = await sb_get(client, "supplier_catalog", params=cat_params) or []
        catalog = [c for c in catalog if c.get("is_visible") is not False]

        # 3) Wybieramy od najpilniejszych, aż wyczerpiemy budżet.
        cart = []
        spent = 0.0
        for p in prioritized:
            hit, _ = _fuzzy(p["name"], catalog, key="name", threshold=70)
            if not hit:
                continue
            unit_price = float(hit.get("price_pln") or 0)
            if unit_price <= 0:
                continue
            qty = p["deficit"]
            line = qty * unit_price
            if spent + line > req.max_budget:
                # dorzuć tyle ile się zmieści
                max_qty = max(0.0, (req.max_budget - spent) / unit_price)
                if max_qty < 0.05:
                    continue
                qty = round(max_qty, 2)
                line = qty * unit_price
            cart.append({
                "inventory_id": p["id"], "product_name": p["name"], "quantity": round(qty, 3),
                "unit": p.get("unit"), "unit_price_pln": unit_price,
                "line_total_pln": round(line, 2), "supplier_id": hit.get("supplier_id"),
                "supplier_product_id": hit.get("id"), "urgency_score": round(p["urgency"], 3),
            })
            spent += line
            if spent >= req.max_budget:
                break

        return {
            "max_budget_pln": req.max_budget,
            "category": req.category,
            "items_count": len(cart),
            "total_pln": round(spent, 2),
            "remaining_pln": round(req.max_budget - spent, 2),
            "cart": cart,
        }


@router.get("/api/suppliers/top-savings")
async def supplier_top_savings(limit: int = 5):
    """Zwraca TOP-{limit} największych rabatów procentowych — porównuje aktualną cenę
    w `supplier_catalog` z historyczną (średnia z `pos_sales_log` / `cost_history` /
    wcześniejsze wpisy tego samego produktu). Fallback: pokazuje najniższe ceny per produkt."""
    _tenant()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as _probe:
        await _ai_access(_probe, needs_credits=False, needs_deal_hunter=True)
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        catalog = await sb_get(client, "supplier_catalog", params={
            "select": "id,supplier_id,name,price_pln,is_visible", "limit": "10000"
        }) or []
        catalog = [c for c in catalog if c.get("is_visible") is not False]
        suppliers = await sb_get(client, "suppliers", params={"select": "id,name", "limit": "500"}) or []
        sup_by_id = {s["id"]: s["name"] for s in suppliers}

        # Grupujemy po norm nazwy produktu; dla każdej grupy liczymy % różnicy vs. mediana.
        groups: dict[str, list[dict]] = {}
        for c in catalog:
            k = _norm(c.get("name") or "")
            if not k:
                continue
            price = float(c.get("price_pln") or 0)
            if price <= 0:
                continue
            groups.setdefault(k, []).append({**c, "_norm_name": k})

        savings = []
        for k, rows in groups.items():
            if len(rows) < 2:
                continue
            prices = sorted(float(r["price_pln"]) for r in rows)
            best = prices[0]
            median = prices[len(prices) // 2]
            if median <= 0:
                continue
            discount_pct = round((median - best) / median * 100.0, 1)
            if discount_pct < 3:
                continue  # nieznaczące
            best_row = min(rows, key=lambda r: float(r["price_pln"]))
            savings.append({
                "product_name": best_row.get("name"),
                "best_price_pln": best,
                "median_price_pln": median,
                "discount_pct": discount_pct,
                "supplier_id": best_row.get("supplier_id"),
                "supplier_name": sup_by_id.get(best_row.get("supplier_id"), "?"),
                "compared_count": len(rows),
            })
        savings.sort(key=lambda x: -x["discount_pct"])
        return {"top": savings[:limit], "compared_products": len(groups)}


class PredictiveRestockRequest(BaseModel):
    weeks_back: int = 4
    day_of_week: Optional[int] = None  # 0=Mon..6=Sun. Domyślnie: dziś.
    supplier_id: Optional[str] = None


@router.post("/api/suppliers/predictive-restock")
async def supplier_predictive_restock(req: PredictiveRestockRequest):
    """Wylicza sugerowane zamówienie na podstawie sprzedaży POS z analogicznych dni tygodnia
    z poprzednich `weeks_back` tygodni. Rozbija dania na składniki (recipe_ingredients)
    i sumuje potrzebne surowce."""
    _tenant()
    await _ai_guard(needs_credits=False, needs_deal_hunter=True)
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    target_dow = req.day_of_week if req.day_of_week is not None else now.weekday()
    weeks = max(1, min(int(req.weeks_back or 4), 12))

    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        # Pobieramy sprzedaż z pos_sales_log od `weeks*7 + 3` dni wstecz.
        since = (now - timedelta(days=weeks * 7 + 3)).isoformat()
        sales = await sb_get(client, "pos_sales_log", params={
            "select": "pos_external_id,pos_product_id,quantity_sold,processed_at",
            "processed_at": f"gte.{since}", "limit": "20000",
        }) or []

        # Filtrujemy do analogicznych dni tygodnia (target_dow).
        filtered = []
        for s in sales:
            try:
                dt = datetime.fromisoformat(str(s["processed_at"]).replace("Z", "+00:00"))
                if dt.weekday() == target_dow:
                    filtered.append(s)
            except Exception:
                continue

        # Mapujemy pos_external_id → menu_items.
        menu_all = await sb_get(client, "menu_items",
                                params={"select": "id,name,pos_id", "is_active": "eq.true", "limit": "5000"}) or []
        by_pos = {m.get("pos_id"): m for m in menu_all if m.get("pos_id")}
        by_id = {m["id"]: m for m in menu_all}

        # Sumujemy sprzedaż per menu_item.
        dish_totals: dict[str, float] = {}
        for s in filtered:
            mid = None
            pos_ext = s.get("pos_external_id")
            if pos_ext and pos_ext in by_pos:
                mid = by_pos[pos_ext]["id"]
            elif s.get("pos_product_id") in by_id:
                mid = s["pos_product_id"]
            if not mid:
                continue
            dish_totals[mid] = dish_totals.get(mid, 0.0) + float(s.get("quantity_sold") or 0)

        # Średnia sprzedaż per dzień = suma / weeks.
        forecasts = [{"menu_item_id": mid, "name": by_id[mid]["name"],
                      "avg_daily_qty": round(qty / weeks, 2)}
                     for mid, qty in dish_totals.items()]
        forecasts.sort(key=lambda x: -x["avg_daily_qty"])

        # Rozbicie na składniki (recipe_ingredients).
        ri = await sb_get(client, "recipe_ingredients", params={"select": "menu_item_id,ingredient_name,quantity,unit",
                                                                "limit": "20000"}) or []
        by_menu: dict[str, list[dict]] = {}
        for r in ri:
            by_menu.setdefault(r["menu_item_id"], []).append(r)

        # Sumujemy zapotrzebowanie na składniki (fuzzy do inventory dla obecnego stanu).
        inv = await sb_get(client, "inventory_items",
                           params={"select": "id,name,quantity,unit", "limit": "5000"}) or []
        inv_norm = {_norm(r["name"]): r for r in inv if r.get("name")}

        needs: dict[str, dict] = {}  # klucz = norm ingredient_name
        for f in forecasts:
            for ing in by_menu.get(f["menu_item_id"], []):
                key = _norm(ing.get("ingredient_name") or "")
                if not key:
                    continue
                need_qty = float(ing.get("quantity") or 0) * f["avg_daily_qty"]
                if key not in needs:
                    matched_inv = inv_norm.get(key)
                    if not matched_inv:
                        # fuzzy
                        hit, _ = _fuzzy_str(key, list(inv_norm.keys()), threshold=70)
                        matched_inv = inv_norm.get(hit) if hit else None
                    needs[key] = {
                        "ingredient_name": ing.get("ingredient_name"),
                        "unit": ing.get("unit"),
                        "forecast_qty": 0.0,
                        "current_stock": float((matched_inv or {}).get("quantity") or 0),
                        "inventory_id": (matched_inv or {}).get("id"),
                        "inventory_name": (matched_inv or {}).get("name"),
                    }
                needs[key]["forecast_qty"] = round(needs[key]["forecast_qty"] + need_qty, 3)

        # Sugerowane dorzucenia: forecast - current_stock (jeśli > 0).
        suggestions = []
        for n in needs.values():
            gap = round(n["forecast_qty"] - n["current_stock"], 3)
            if gap > 0:
                suggestions.append({**n, "suggested_order_qty": gap})
        suggestions.sort(key=lambda x: -x["suggested_order_qty"])

        return {
            "day_of_week": target_dow,
            "weeks_analyzed": weeks,
            "sales_records": len(filtered),
            "dish_forecasts": forecasts[:15],
            "ingredient_suggestions": suggestions[:30],
        }
