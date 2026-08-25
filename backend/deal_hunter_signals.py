"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `deal_hunter_signals`."""
from __future__ import annotations

from supabase_rest import sb_get
from typing import Optional
import httpx
import json
from analytics_sales import _aggregate_menu_sales
from app_core import CHAT_MODEL, _openai, _pg_ts, logger
from billing_credits import _bill_openai_response
from constants import _LONG_SHELF_KEYWORDS



async def _load_long_shelf_fillers(client: httpx.AsyncClient, limit: int = 18) -> list[dict]:
    """Produkty magazynowe / katalogowe o długiej dacie — wypełniacze progów."""
    out: list[dict] = []
    try:
        inv = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,unit,min_quantity",
            "limit": "800",
        }) or []
        for row in inv:
            name = (row.get("name") or "").lower()
            if any(k in name for k in _LONG_SHELF_KEYWORDS):
                out.append({
                    "name": row.get("name"),
                    "stock": float(row.get("quantity") or 0),
                    "unit": row.get("unit") or "szt",
                    "source": "warehouse",
                })
            if len(out) >= limit:
                break
    except Exception as e:
        logger.warning(f"_load_long_shelf_fillers: {e}")
    return out


async def _load_deal_hunter_kitchen_signals(
    client: httpx.AsyncClient,
    *,
    days: int = 30,
) -> dict:
    """
    Sygnały kuchni (ostatnie ~30 dni) dla priority score + suggestions.
    Zwraca:
      kitchen_priorities: { inventory_id | norm_name → {score, class_a, reasons, ...} }
      waste_top: [{name, cost_pln?, qty?}, ...]
      fillers: long-shelf candidates
    Fail-soft — puste mapy gdy brak danych / błąd.
    """
    from smart_basket_optimizer import compute_priority_score, _product_norm_key

    kitchen_priorities: dict[str, dict] = {"_by_name": {}}
    waste_top: list[dict] = []
    fillers: list[dict] = []

    try:
        fillers = await _load_long_shelf_fillers(client)
    except Exception as e:
        logger.warning(f"deal_hunter fillers: {e}")

    # ── POS / menu sales (30d) ──
    sales_by_ing: dict[str, float] = {}
    try:
        dish_sales = await _aggregate_menu_sales(client, days)
        # Map dish sales → ingredients via recipes (same idea as rank_inventory_usage)
        ri = await sb_get(client, "recipe_ingredients", params={
            "select": "menu_item_id,ingredient_name,quantity,unit",
            "limit": "30000",
        }) or []
        by_menu: dict[str, list] = {}
        for r in ri:
            by_menu.setdefault(r["menu_item_id"], []).append(r)
        for d in dish_sales:
            sold = float(d.get("qty_sold") or 0)
            if sold <= 0:
                continue
            # dish-level sales score (for menu items that are also ordered as products)
            dname = _product_norm_key(str(d.get("name") or ""))
            if dname:
                sales_by_ing[dname] = sales_by_ing.get(dname, 0.0) + sold
            for ing in by_menu.get(d["menu_item_id"], []):
                iname = _product_norm_key(str(ing.get("ingredient_name") or ""))
                if not iname:
                    continue
                used = float(ing.get("quantity") or 0) * sold
                sales_by_ing[iname] = sales_by_ing.get(iname, 0.0) + used
    except Exception as e:
        logger.warning(f"deal_hunter menu sales: {e}")

    # ── Waste TOP (30d) ──
    waste_qty: dict[str, float] = {}
    try:
        from datetime import datetime, timezone, timedelta
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        logs = await sb_get(client, "waste_logs", params={
            "select": "item_name,quantity,unit,created_at,item_id",
            "created_at": f"gte.{_pg_ts(since)}",
            "order": "created_at.desc",
            "limit": "5000",
        }) or []
        for w in logs:
            key = _product_norm_key(str(w.get("item_name") or ""))
            if not key:
                continue
            waste_qty[key] = waste_qty.get(key, 0.0) + float(w.get("quantity") or 0)
        ranked_waste = sorted(waste_qty.items(), key=lambda kv: -kv[1])
        waste_top = [{"name": k, "qty": v} for k, v in ranked_waste[:15]]
    except Exception as e:
        logger.warning(f"deal_hunter waste: {e}")

    # ── Inventory stock vs min (low stock) ──
    inv_rows: list[dict] = []
    try:
        inv_rows = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,min_quantity,unit",
            "limit": "5000",
        }) or []
    except Exception as e:
        logger.warning(f"deal_hunter inventory: {e}")

    max_sales = max(sales_by_ing.values()) if sales_by_ing else 0.0
    max_waste = max(waste_qty.values()) if waste_qty else 0.0

    for row in inv_rows:
        name = str(row.get("name") or "")
        key = _product_norm_key(name)
        iid = str(row.get("id") or "")
        qty = float(row.get("quantity") or 0)
        try:
            min_q = float(row.get("min_quantity") or 0)
        except (TypeError, ValueError):
            min_q = 0.0
        low_stock = min_q > 0 and qty <= min_q
        sales_rank = (sales_by_ing.get(key, 0.0) / max_sales) if max_sales > 0 else 0.0
        # usage ≈ sales_by_ing (recipe×POS) — reuse as usage_rank
        usage_rank = sales_rank
        waste_rank = (waste_qty.get(key, 0.0) / max_waste) if max_waste > 0 else 0.0
        pri = compute_priority_score(
            sales_rank=sales_rank,
            usage_rank=usage_rank,
            waste_rank=waste_rank,
            low_stock=low_stock,
            critical_shortage=False,
        )
        pri["name"] = name
        pri["inventory_id"] = iid
        if iid:
            kitchen_priorities[iid] = pri
        if key:
            kitchen_priorities["_by_name"][key] = pri
            kitchen_priorities[key] = pri

    # Also stamp pure waste/sales keys not in inventory
    for key, val in sales_by_ing.items():
        if key in kitchen_priorities:
            continue
        sales_rank = (val / max_sales) if max_sales > 0 else 0.0
        waste_rank = (waste_qty.get(key, 0.0) / max_waste) if max_waste > 0 else 0.0
        pri = compute_priority_score(
            sales_rank=sales_rank,
            usage_rank=sales_rank,
            waste_rank=waste_rank,
        )
        kitchen_priorities[key] = pri
        kitchen_priorities["_by_name"][key] = pri

    return {
        "kitchen_priorities": kitchen_priorities,
        "waste_top": waste_top,
        "fillers": fillers,
    }


async def _enrich_deal_hunter_ai_tips(
    client: httpx.AsyncClient,
    result: dict,
    per_item: list[dict],
) -> dict:
    """LLM jako analityk biznesowy — NIE liczy koszyków, tylko smart_tip + summary.

    Koszty API: jedno wywołanie na porównanie, kompaktowy JSON wejściowy.
    """
    scenarios = result.get("scenarios") or []
    if not scenarios:
        scenarios = [
            result.get("scenario_split_max"),
            result.get("scenario_monolith"),
            result.get("scenario_smart_hybrid"),
        ]
        scenarios = [s for s in scenarios if isinstance(s, dict)]
    if not scenarios:
        return result

    needed = [p.get("product_name") for p in per_item if p.get("product_name")]
    compact_scenarios = []
    for sc in scenarios:
        compact_scenarios.append({
            "id": sc.get("id"),
            "label": sc.get("label"),
            "products_pln": sc.get("products_pln"),
            "shipping_pln": sc.get("shipping_pln"),
            "total_pln": sc.get("total_pln"),
            "supplier_count": sc.get("supplier_count"),
            "viable": sc.get("viable"),
            "meets_all_minimums": sc.get("meets_all_minimums"),
            "missing": (sc.get("missing") or [])[:8],
            "logistics_hints": sc.get("logistics_hints") or [],
            "math_tip": sc.get("smart_tip") or "",
            "split": {
                (g.get("supplier_name") or "?"): [
                    i.get("product_name") for i in (g.get("items") or [])[:12]
                ]
                for g in (sc.get("suppliers") or [])
            },
        })

    fillers = await _load_long_shelf_fillers(client)
    # Structured evidence from math suggestions — LLM must not invent tips
    math_suggestions = result.get("suggestions") or []
    decision_log = result.get("decision_log") or []
    prompt = (
        "Jesteś 'Łowcą Okazji' – doradcą zakupowym Gastro Manager. "
        "Koszyki i kwoty są JUŻ WYLICZONE matematycznie — NIE zmieniaj liczb. "
        "Twoje zadanie: napisać krótkie, praktyczne tipy po polsku.\n\n"
        f"Produkty potrzebne: {json.dumps(needed, ensure_ascii=False)}\n"
        f"Scenariusze (math): {json.dumps(compact_scenarios, ensure_ascii=False)}\n"
        f"Wypełniacze długoterminowe z magazynu: {json.dumps(fillers, ensure_ascii=False)}\n"
        f"Sugestie matematyczne (evidence — bazuj na nich, nie wymyślaj): "
        f"{json.dumps(math_suggestions[:12], ensure_ascii=False)}\n"
        f"Decision log (fragment): {json.dumps((decision_log or [])[:8], ensure_ascii=False)}\n\n"
        "Zwróć WYŁĄCZNIE JSON:\n"
        "{"
        '"analysis_summary":"2-3 zdania podsumowania dla szefa kuchni",'
        '"recommended_variant_id":"split_max|monolith|smart_hybrid",'
        '"recommended_reason":"jedno zdanie dlaczego",'
        '"tips":[{"scenario_id":"...","smart_tip":"konkretna rada (minima/dostawa/wypełniacz)"}],'
        '"suggestion_rewrites":[{"type":"...","message":"opcjonalnie dopracowana treść sugestii"}]'
        "}"
    )
    try:
        oai = _openai()
        resp = await oai.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.3,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Analityk finansowy gastronomii. Nie wymyślaj cen ani faktów. "
                        "Opieraj tipy na logistics_hints, sugestiach matematycznych i wypełniaczach."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        )
        bill = await _bill_openai_response(
            client, resp, endpoint="/api/orders/compare-offers/tips",
            model=CHAT_MODEL, extras={"scenarios": len(scenarios)},
        )
        raw = (resp.choices[0].message.content or "").strip()
        parsed = json.loads(raw) if raw else {}
    except Exception as e:
        logger.warning(f"_enrich_deal_hunter_ai_tips LLM failed: {e}")
        return result

    tips_by_id = {
        (t.get("scenario_id") or ""): (t.get("smart_tip") or "").strip()
        for t in (parsed.get("tips") or [])
        if isinstance(t, dict)
    }

    def _apply(sc: Optional[dict]) -> Optional[dict]:
        if not isinstance(sc, dict):
            return sc
        tip = tips_by_id.get(sc.get("id") or "")
        if tip:
            sc = dict(sc)
            sc["smart_tip"] = tip
        return sc

    result["scenario_split_max"] = _apply(result.get("scenario_split_max"))
    result["scenario_monolith"] = _apply(result.get("scenario_monolith"))
    result["scenario_smart_hybrid"] = _apply(result.get("scenario_smart_hybrid"))
    result["scenarios"] = [_apply(s) for s in (result.get("scenarios") or [])]

    summary = (parsed.get("analysis_summary") or "").strip()
    if summary:
        result["analysis_summary"] = summary
        result["assistant_speech"] = summary
    rec = (parsed.get("recommended_variant_id") or "").strip()
    if rec in ("split_max", "monolith", "smart_hybrid"):
        result["recommended_scenario_id"] = rec
        reason = (parsed.get("recommended_reason") or "").strip()
        if reason:
            result["recommended_reason"] = reason

    # Optional LLM wording polish for math suggestions (keep evidence intact)
    rewrites = {
        (r.get("type") or ""): (r.get("message") or "").strip()
        for r in (parsed.get("suggestion_rewrites") or [])
        if isinstance(r, dict) and (r.get("message") or "").strip()
    }
    if rewrites and isinstance(result.get("suggestions"), list):
        polished = []
        for s in result["suggestions"]:
            s2 = dict(s)
            t = s2.get("type") or ""
            if t in rewrites:
                s2["message"] = rewrites[t]
                s2["llm_polished"] = True
            polished.append(s2)
        result["suggestions"] = polished
    if bill:
        result.setdefault("_tips_billing", bill)
        # Dołącz do głównego rozliczenia jeśli merge_billing nie był wywołany
        if bill.get("credits_deducted"):
            result["credits_deducted"] = int(result.get("credits_deducted") or 0) + int(
                bill.get("credits_deducted") or 0
            )
            if bill.get("credits_remaining") is not None:
                result["credits_remaining"] = bill.get("credits_remaining")
    return result

__all__ = ['_enrich_deal_hunter_ai_tips', '_load_deal_hunter_kitchen_signals', '_load_long_shelf_fillers']
