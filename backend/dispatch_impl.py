"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `dispatch_impl`."""
from __future__ import annotations

from fastapi import HTTPException
from typing import Optional
from analytics_periods import _merge_period_sels
from analytics_runners import _run_compare_periods, _run_haccp_tip, _run_list_expiring_soon, _run_manager_core_alerts, _run_period_analysis, _run_rank_supplier_spend
from analytics_sales import _run_rank_dead_menu, _run_rank_inventory_usage, _run_rank_menu_sales
from analytics_waste import _run_rank_waste_cost
from app_core import require_tenant_account_key
from compare_offers_impl import compare_offers
from models import CompareItem, CompareOffersRequest, CriticalByCategoryRequest, ExtraOrderItem, VoiceDispatchRequest
from orders_impl import orders_critical_by_category



async def voice_dispatch(req: VoiceDispatchRequest):
    """Wykonanie intencji rozpoznanej przez /api/voice/interpret. Router do właściwego
    endpointu wykonawczego. Frontend może użyć zamiast wywołania /interpret + drugiego call."""
    require_tenant_account_key()
    p = req.payload or {}
    it = req.intent
    def _period_hint_from_payload(pl: dict) -> Optional[str]:
        for k in ("period_1", "note", "_transcript"):
            v = pl.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    if it == "summarize_custom_period":
        sels = _merge_period_sels(p)
        res = await _run_period_analysis(
            p.get("period_type") or "month",
            p.get("limit_days"),
            period_hint=_period_hint_from_payload(p),
            selected_periods=sels,
        )
        res.setdefault("action", "summarize_custom_period")
        res.setdefault("message", res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "compare_two_periods":
        sels = _merge_period_sels(p)
        res = await _run_compare_periods(
            p.get("period_1") or "",
            p.get("period_2") or "",
            selected_periods=sels,
        )
        res.setdefault("action", "compare_two_periods")
        res.setdefault("message", res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "rank_menu_sales":
        sels = _merge_period_sels(p)
        res = await _run_rank_menu_sales(
            rank=p.get("rank") or "best",
            period_type=p.get("period_type") or "year",
            limit_days=p.get("limit_days"),
            top_n=p.get("top_n"),
            category=p.get("category") or p.get("category_name"),
            period_hint=_period_hint_from_payload(p),
            selected_periods=sels,
        )
        res.setdefault("action", "rank_menu_sales")
        res.setdefault("message", res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "rank_inventory_usage":
        sels = _merge_period_sels(p)
        res = await _run_rank_inventory_usage(
            rank=p.get("rank") or "best",
            period_type=p.get("period_type") or "year",
            limit_days=p.get("limit_days"),
            top_n=p.get("top_n"),
            category=p.get("category") or p.get("category_name"),
            period_hint=_period_hint_from_payload(p),
            selected_periods=sels,
        )
        res.setdefault("action", "rank_inventory_usage")
        res.setdefault("message", res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "rank_waste_cost":
        sels = _merge_period_sels(p)
        res = await _run_rank_waste_cost(
            period_type=p.get("period_type") or "year",
            limit_days=p.get("limit_days"),
            top_n=p.get("top_n"),
            period_hint=_period_hint_from_payload(p),
            selected_periods=sels,
        )
        res.setdefault("action", "rank_waste_cost")
        res.setdefault("message", res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "rank_dead_menu":
        sels = _merge_period_sels(p)
        res = await _run_rank_dead_menu(
            period_type=p.get("period_type") or "year",
            limit_days=p.get("limit_days"),
            top_n=p.get("top_n"),
            category=p.get("category") or p.get("category_name"),
            period_hint=_period_hint_from_payload(p),
            selected_periods=sels,
        )
        res.setdefault("action", "rank_dead_menu")
        res.setdefault("message", res.get("message") or res.get("assistant_speech", ""))
        if sels:
            res["selected_periods_used"] = sels
        return res
    if it == "list_expiring_soon":
        res = await _run_list_expiring_soon(
            within_days=p.get("limit_days") or 3,
            top_n=p.get("top_n"),
        )
        res.setdefault("action", "list_expiring_soon")
        res.setdefault("message", res.get("assistant_speech", ""))
        return res
    if it == "rank_supplier_spend":
        res = await _run_rank_supplier_spend(
            period_type=p.get("period_type") or "month",
            limit_days=p.get("limit_days"),
            top_n=p.get("top_n"),
            period_hint=p.get("period_1") or p.get("note"),
            supplier_name=p.get("supplier_name") or p.get("item_name"),
        )
        res.setdefault("action", "rank_supplier_spend")
        res.setdefault("message", res.get("assistant_speech", ""))
        return res
    if it == "manager_core_alerts":
        res = await _run_manager_core_alerts(
            period_type=p.get("period_type") or "week",
            limit_days=p.get("limit_days"),
            period_hint=p.get("period_1") or p.get("note"),
        )
        res.setdefault("action", "manager_core_alerts")
        res.setdefault("message", res.get("assistant_speech", ""))
        return res
    if it == "haccp_tip":
        res = _run_haccp_tip(
            p.get("item_name") or p.get("product_name") or p.get("note") or p.get("reason_text") or "",
        )
        res.setdefault("action", "haccp_tip")
        res.setdefault("message", res.get("assistant_speech", ""))
        return res
    if it in ("upload_invoice", "upload_offer", "upload_document", "upload_menu"):
        kind = (
            "menu" if it == "upload_menu"
            else "invoice" if it == "upload_invoice"
            else ("offer" if it == "upload_offer" else "document")
        )
        return {
            "ok": True,
            "action": it,
            "doc_kind": kind,
            "open_scan": True,
            "message": (
                "Otwieram skaner menu restauracji (karta dań)."
                if kind == "menu"
                else (
                    "Otwieram skaner — wgraj ofertę/gazetkę dostawcy."
                    if kind == "offer"
                    else "Otwieram skaner dokumentów — wgraj fakturę lub ofertę."
                )
            ),
        }
    from voice_crud_v2_routes import voice_dispatch_v2
    v2 = await voice_dispatch_v2(it, p)
    if v2 is not None:
        return v2
    if it == "edit_menu_item_price":
        from voice_crud_routes import SetMenuPriceRequest, set_menu_price
        return await set_menu_price(SetMenuPriceRequest(
            dish_id=p.get("dish_id"), dish_name=p.get("dish_name") or p.get("dish_name_resolved"),
            new_price=float(p.get("new_price") or 0),
        ))
    if it == "add_recipe_ingredient":
        from voice_crud_routes import SetRecipeIngredientRequest, set_recipe_ingredient
        return await set_recipe_ingredient(SetRecipeIngredientRequest(
            dish_id=p.get("dish_id"), dish_name=p.get("dish_name") or p.get("dish_name_resolved"),
            ingredient_name=(p.get("ingredient_name") or p.get("ingredient_name_resolved") or "").strip(),
            quantity=float(p.get("quantity") or 0),
            unit=p.get("unit"),
            mode="upsert",
        ))
    if it == "edit_recipe_ingredient_qty":
        from voice_crud_routes import SetRecipeIngredientRequest, set_recipe_ingredient
        return await set_recipe_ingredient(SetRecipeIngredientRequest(
            dish_id=p.get("dish_id"), dish_name=p.get("dish_name") or p.get("dish_name_resolved"),
            ingredient_name=(p.get("ingredient_name") or p.get("ingredient_name_resolved") or "").strip(),
            quantity=float(p.get("quantity") or 0),
            unit=p.get("unit"),
            mode="edit_qty",
        ))
    if it == "edit_inventory_item":
        from voice_crud_routes import SetInventoryThresholdsRequest, set_inventory_thresholds
        return await set_inventory_thresholds(SetInventoryThresholdsRequest(
            inventory_id=p.get("inventory_id"),
            item_name=p.get("item_name") or p.get("item_name_resolved"),
            min_quantity=(float(p["min_quantity"]) if p.get("min_quantity") is not None else None),
            current_quantity=(float(p["current_quantity"]) if p.get("current_quantity") is not None else None),
            safety_buffer_percent=(float(p["safety_buffer_percent"]) if p.get("safety_buffer_percent") is not None else None),
        ))
    if it == "supplier_flip_order":
        from supplier_intent_routes import FlipOrderRequest, supplier_flip_order
        return await supplier_flip_order(FlipOrderRequest(
            from_supplier=p.get("from_supplier") or "",
            to_supplier=p.get("to_supplier") or "",
            category=p.get("category"),
            items=p.get("items"),
        ))
    if it == "budget_cap_order":
        from supplier_intent_routes import BudgetCapOrderRequest, supplier_budget_cap_order
        return await supplier_budget_cap_order(BudgetCapOrderRequest(
            max_budget=float(p.get("max_budget") or 0),
            category=p.get("category"),
            supplier_id=p.get("supplier_id"),
        ))
    if it == "compare_catalogs_top_savings":
        from supplier_intent_routes import supplier_top_savings
        return await supplier_top_savings(limit=5)
    if it == "predictive_weekend_restock":
        from supplier_intent_routes import PredictiveRestockRequest, supplier_predictive_restock
        return await supplier_predictive_restock(PredictiveRestockRequest(
            weeks_back=4, day_of_week=None, supplier_id=p.get("supplier_id"),
        ))
    if it == "check_minimum_order_value":
        from supplier_min_order_routes import CheckMinOrderRequest, supplier_check_min_order
        return await supplier_check_min_order(CheckMinOrderRequest(
            supplier_id=p.get("supplier_id"),
            supplier_name=p.get("supplier_name") or p.get("supplier_name_resolved"),
            current_cart_total=float(p.get("current_cart_total") or 0),
            category=p.get("category"),
        ))
    if it == "order_product":
        raw_items = p.get("items") or []
        if not isinstance(raw_items, list):
            raw_items = []
        compare_items: list[CompareItem] = []
        for itx in raw_items:
            if not isinstance(itx, dict):
                continue
            name = (itx.get("product_name") or itx.get("name") or "").strip()
            if not name:
                continue
            try:
                qty = float(itx.get("quantity") or 1)
            except (TypeError, ValueError):
                qty = 1.0
            if qty <= 0:
                qty = 1.0
            unit = (itx.get("unit") or "szt").strip() or "szt"
            compare_items.append(CompareItem(
                product_name_or_id=name,
                quantity=qty,
                unit=unit,
            ))
        if not compare_items:
            return {
                "ok": False,
                "action": "order_product",
                "compare": None,
                "message": "Dodaj co najmniej jeden produkt do zamówienia (nazwa + ilość).",
            }
        try:
            compare = await compare_offers(CompareOffersRequest(
                items=compare_items,
                restaurant_name=p.get("restaurant_name"),
                search_scope=p.get("search_scope") or "suppliers_only",
            ))
        except HTTPException as e:
            return {
                "ok": False,
                "action": "order_product",
                "compare": None,
                "message": f"Łowca Okazji: {e.detail}",
            }
        except Exception as e:  # noqa: BLE001
            return {
                "ok": False,
                "action": "order_product",
                "compare": None,
                "message": f"Łowca Okazji: {str(e)[:160]}",
            }
        found = sum(1 for x in (compare.get("items_requested") or []) if x.get("found"))
        return {
            "ok": True,
            "action": "order_product",
            "compare": compare,
            "message": (
                f"Koszyk: {len(compare_items)} pozycji · "
                f"znaleziono oferty dla {found}/{len(compare_items)}. "
                "Otwieram Łowcę Okazji."
            ),
        }
    if it == "order_critical_items_by_category":
        cats = p.get("categories") or []
        if isinstance(cats, str):
            cats = [cats]
        raw_items = p.get("items") or []
        extra: list[ExtraOrderItem] = []
        if isinstance(raw_items, list):
            for itx in raw_items:
                if not isinstance(itx, dict):
                    continue
                pname = str(itx.get("product_name") or itx.get("name") or "").strip()
                if not pname:
                    continue
                try:
                    qty = float(itx.get("quantity")) if itx.get("quantity") is not None else None
                except (TypeError, ValueError):
                    qty = None
                if qty is not None and qty <= 0:
                    qty = None
                uwv_val = None
                try:
                    if itx.get("unit_weight_volume") is not None and str(itx.get("unit_weight_volume")).strip() != "":
                        uwv_val = float(itx["unit_weight_volume"])
                except (TypeError, ValueError):
                    uwv_val = None
                extra.append(ExtraOrderItem(
                    product_name=pname,
                    quantity=qty,
                    unit=str(itx.get("unit") or "szt").strip() or "szt",
                    unit_weight_volume=uwv_val,
                    weight_volume_unit=(
                        str(itx.get("weight_volume_unit") or "").strip() or None
                    ),
                ))
        return await orders_critical_by_category(CriticalByCategoryRequest(
            categories=list(cats),
            restaurant_name=p.get("restaurant_name"),
            stock_target=str(p.get("stock_target") or "critical"),
            items=extra,
            cart_objective=(
                str(p.get("cart_objective")).strip()
                if p.get("cart_objective") else None
            ),
            search_scope=p.get("search_scope") or "suppliers_only",
        ))
    raise HTTPException(status_code=400, detail=f"Intencja {it!r} nie obsługiwana przez /voice/dispatch.")

__all__ = ['voice_dispatch']
