"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `actions_core`."""
from __future__ import annotations

from culinary_units import PIECE_DEFAULT_SIZE as _PIECE_DEFAULT_SIZE
from culinary_units import to_gml as _to_gml
from fastapi import HTTPException
from http_ssl import httpx_verify as _httpx_verify
from ingredient_name_norm import norm_name as _norm_name
from ingredient_name_norm import whole_product_name as _whole_product_name
from pl_fuzzy_norm import norm_pl as _norm_pl
from supabase_rest import sb_get
from supabase_rest import sb_patch
from supabase_rest import sb_post
from typing import Optional
import httpx
import re
from app_core import require_tenant_account_key
from dispatch_impl import voice_dispatch
from expiration_apply import _apply_expiration_batch
from inventory_match import _find_inventory_duplicate
from matching_utils import _food_names_compatible, _is_porcja_row, _norm_unit, _resolve_by_fuzzy
from models import ApplyRequest, ApplyResponse, ApplyWasteRequestLegacy, VoiceDispatchRequest
from pos_availability import _recompute_menu_availability



async def _apply_waste(client: httpx.AsyncClient, p: dict, transcript: Optional[str], source: str):
    from rapidfuzz import fuzz as _fuzz
    from voice_actions_waste import apply_waste as _apply_waste_impl
    return await _apply_waste_impl(
        client, p, transcript, source,
        resolve_by_fuzzy=_resolve_by_fuzzy,
        food_names_compatible=_food_names_compatible,
        norm_pl=_norm_pl,
        fuzz_token_set_ratio=lambda a, b: float(_fuzz.token_set_ratio(a, b)),
        is_porcja_row=_is_porcja_row,
        to_gml=_to_gml,
        norm_name=_norm_name,
        piece_default_size=_PIECE_DEFAULT_SIZE,
        recompute_menu_availability=_recompute_menu_availability,
    )


async def _apply_revenue(client, p, transcript, source):
    from voice_actions_finance import apply_revenue
    return await apply_revenue(client, p, transcript, source)


async def _apply_fixed_cost(client, p, transcript, source):
    from voice_actions_finance import apply_fixed_cost
    return await apply_fixed_cost(client, p, transcript, source)


async def _apply_variable_cost(client, p, transcript, source):
    from voice_actions_finance import apply_variable_cost
    return await apply_variable_cost(client, p, transcript, source)


async def _resolve_category_id(client, name: Optional[str]) -> Optional[str]:
    from voice_actions_finance import resolve_category_id
    return await resolve_category_id(client, name)


async def _apply_inventory_item(client, p, transcript, source):
    warnings: list[str] = []
    name = (p.get("product_name") or p.get("item_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Inventory item: brak nazwy.")
    unit = p.get("unit") or "szt"
    qty = float(p.get("quantity") or 0)
    minq = float(p.get("min_quantity") or 0)
    buf = float(p.get("safety_buffer_percent") or 20)
    if buf < 10:
        buf = 10
    opt_raw = p.get("optimal_quantity")
    try:
        opt_q = float(opt_raw) if opt_raw is not None and str(opt_raw).strip() != "" else None
    except (TypeError, ValueError):
        opt_q = None
    cat_id = await _resolve_category_id(client, p.get("category_name"))
    payload = {
        "name": name, "category_id": cat_id,
        "quantity": qty, "unit": unit,
        "min_quantity": minq,
        "portion_size": p.get("portion_size"),
        "is_combo_polprodukt": bool(p.get("is_combo_polprodukt") or False),
        "unit_cost": p.get("unit_cost") or 0,
        "safety_buffer_percent": buf,
    }
    if opt_q is not None and opt_q > 0:
        payload["optimal_quantity"] = opt_q
    # Dedup: jeśli produkt już jest w magazynie (np. „Jabłko Jonagold” ≈ „Jabłko jonagold”,
    # marchew ≈ marchewka), zwiększ stan istniejącej pozycji zamiast tworzyć nową.
    try:
        inv_rows = await sb_get(client, "inventory_items", params={
            "select": "id,name,quantity,unit", "limit": "5000",
        }) or []
    except httpx.HTTPStatusError:
        inv_rows = []
    dup = _find_inventory_duplicate(name, inv_rows, threshold=88) if inv_rows else None
    if dup and qty > 0 and _norm_unit(dup.get("unit") or "") == _norm_unit(unit or ""):
        new_qty = float(dup.get("quantity") or 0) + qty
        await sb_patch(client, "inventory_items", {"id": f"eq.{dup['id']}"}, {"quantity": new_qty})
        warnings.append(
            f"Zwiększono stan istniejącej pozycji „{dup.get('name') or name}” (+{qty} {unit})."
        )
        return dup["id"], {
            "name": dup.get("name") or name, "quantity": new_qty,
            "unit": dup.get("unit") or unit, "min_quantity": minq,
            "optimal_quantity": opt_q, "merged_into_existing": True,
        }, warnings
    try:
        row = await sb_post(client, "inventory_items", payload)
    except httpx.HTTPStatusError as e:
        body = e.response.text or ""
        if "optimal_quantity" in body:
            warnings.append("Kolumna optimal_quantity nie istnieje — pomijam (uruchom migrację SQL).")
            payload.pop("optimal_quantity", None)
            try:
                row = await sb_post(client, "inventory_items", payload)
            except httpx.HTTPStatusError as e2:
                body = e2.response.text or ""
                if "safety_buffer_percent" in body:
                    warnings.append("Kolumna safety_buffer_percent nie istnieje — pomijam.")
                    payload.pop("safety_buffer_percent", None)
                    row = await sb_post(client, "inventory_items", payload)
                else:
                    raise HTTPException(status_code=502, detail=f"inventory_items insert: {body}") from e2
        elif "safety_buffer_percent" in body:
            warnings.append("Kolumna safety_buffer_percent nie istnieje — pomijam (uruchom migrację SQL).")
            payload.pop("safety_buffer_percent", None)
            row = await sb_post(client, "inventory_items", payload)
        else:
            raise HTTPException(status_code=502, detail=f"inventory_items insert: {body}") from e
    return row[0]["id"], {
        "name": name, "quantity": qty, "unit": unit,
        "min_quantity": minq, "optimal_quantity": opt_q,
    }, warnings


async def _apply_menu_item(client, p, transcript, source):
    warnings: list[str] = []
    name = (p.get("product_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Menu item: brak nazwy.")
    price = float(p.get("price_pln") or 0)
    if price <= 0:
        raise HTTPException(status_code=400, detail="Menu item: price_pln musi być > 0.")
    # Dedup: tylko aktywne dania (bez restore soft-deleted)
    try:
        existing = await sb_get(client, "menu_items", params={
            "select": "id,name,is_active,price_pln,category", "limit": "5000",
        }) or []
    except httpx.HTTPStatusError:
        existing = await sb_get(client, "menu_items", params={
            "select": "id,name,price_pln,category", "limit": "5000",
        }) or []
    active = [m for m in existing if m.get("is_active") is not False]
    hit, _score = _resolve_by_fuzzy(name, active, threshold=88)
    if hit:
        menu_id = hit["id"]
        warnings.append(f"Potrawa „{hit.get('name')}” już jest w menu — pominięto duplikat.")
        return menu_id, {"name": hit.get("name") or name, "price_pln": float(hit.get("price_pln") or price),
                         "ingredients_count": 0, "skipped_duplicate": True}, warnings

    menu_row = await sb_post(client, "menu_items", {
        "name": name, "category": p.get("menu_category") or "Inne",
        "price_pln": price, "is_active": True,
    })
    menu_id = menu_row[0]["id"]
    ingredients = p.get("ingredients") or []
    if isinstance(ingredients, list) and ingredients:
        rows = []
        for idx, ing in enumerate(ingredients):
            rows.append({
                "menu_item_id": menu_id,
                "ingredient_name": _whole_product_name(ing.get("ingredient_name") or ""),
                "quantity": float(ing.get("quantity") or 0),
                "unit": ing.get("unit") or "szt",
                "sort_order": idx + 1,
            })
        try:
            await sb_post(client, "recipe_ingredients", rows)
        except httpx.HTTPStatusError as e:
            warnings.append(f"Receptura nie została w pełni zapisana: {e.response.text}")
    return menu_id, {"name": name, "price_pln": price, "ingredients_count": len(ingredients)}, warnings

async def _apply_supplier(client, p, transcript, source):
    name = (p.get("supplier_name") or p.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Supplier: brak nazwy.")
    row = await sb_post(client, "suppliers", {
        "name": name,
        "contact_person": p.get("contact_person"),
        "phone": p.get("phone"),
        "email": p.get("email"),
        "category": p.get("supplier_category") or p.get("category") or "Inne",
        "nip": p.get("nip"),
        "notes": p.get("notes") or transcript,
        "icon_color": "#2563EB",
    })
    return row[0]["id"], {"name": name}, []


async def _apply_supplier_product(client, p, transcript, source):
    warnings: list[str] = []
    supplier_id = p.get("supplier_id")
    if not supplier_id and p.get("supplier_name"):
        rows = await sb_get(client, "suppliers",
                            params={"select": "id,name", "name": f"ilike.%{p['supplier_name']}%", "limit": "1"})
        if rows:
            supplier_id = rows[0]["id"]
        else:
            warnings.append(f"Nie znaleziono dostawcy '{p['supplier_name']}' — tworzę nowego.")
            new_sup = await sb_post(client, "suppliers", {
                "name": p["supplier_name"], "category": "Inne", "icon_color": "#2563EB",
            })
            supplier_id = new_sup[0]["id"]
    if not supplier_id:
        raise HTTPException(status_code=400, detail="Supplier product: brak supplier_id/supplier_name.")
    prod = (p.get("product_name") or "").strip()
    if not prod:
        raise HTTPException(status_code=400, detail="Supplier product: brak product_name.")
    price = float(p.get("price_pln") or 0)
    # `variant` ma w bazie ograniczenie NOT NULL — nigdy nie wysyłamy null.
    volume_label = p.get("volume_label")
    variant = p.get("variant") or volume_label or p.get("unit") or prod
    row = await sb_post(client, "supplier_catalog", {
        "supplier_id": supplier_id, "name": prod,
        "variant": variant,
        "volume_label": volume_label,
        "unit_count": p.get("unit_count") or 1,
        "price_pln": price,
    })
    return row[0]["id"], {"supplier_id": supplier_id, "product": prod, "price_pln": price}, warnings


async def actions_apply(req: ApplyRequest):
    require_tenant_account_key()
    dispatch = {
        "waste": _apply_waste,
        "add_revenue": _apply_revenue,
        "add_fixed_cost": _apply_fixed_cost,
        "add_variable_cost": _apply_variable_cost,
        "add_inventory_item": _apply_inventory_item,
        "add_expiration_batch": _apply_expiration_batch,
        "add_menu_item": _apply_menu_item,
        "add_supplier": _apply_supplier,
        "add_supplier_product": _apply_supplier_product,
    }
    # Nowe intencje CRUD/supplier: delegowane do dedykowanych endpointów przez /voice/dispatch.
    voice_crud = {
        "edit_menu_item_price", "add_recipe_ingredient", "edit_recipe_ingredient_qty",
        "edit_inventory_item", "supplier_flip_order", "budget_cap_order",
        "compare_catalogs_top_savings", "predictive_weekend_restock", "check_minimum_order_value",
        "order_critical_items_by_category", "order_product",
        "bulk_delete_menu", "bulk_delete_suppliers", "bulk_reset_inventory",
        "bulk_delete_inventory", "restore_last_deleted_menu", "restore_deleted_inventory",
        "delete_menu_item", "delete_supplier", "delete_inventory_item",
        "toggle_menu_item_availability",
        "bulk_edit_menu_prices_percentage", "bulk_edit_menu_prices_fixed",
        "bulk_edit_inventory_buffers",
        "edit_menu_item_category", "rename_menu_item", "scale_recipe",
        "navigate_screen", "filter_ui_inventory", "filter_ui_menu_blocked",
        "summarize_custom_period", "compare_two_periods",
        "rank_menu_sales", "rank_inventory_usage",
        "rank_waste_cost", "rank_dead_menu", "list_expiring_soon",
        "rank_supplier_spend", "manager_core_alerts", "haccp_tip",
        "upload_invoice", "upload_offer", "upload_document", "upload_menu",
    }
    if req.intent in voice_crud:
        # Dołącz transcript do payload — resolve okresu (period_1 / hint) gdy AI nic nie wypełnił.
        payload = dict(req.payload or {})
        tr = (req.transcript or "").strip()
        if tr:
            payload.setdefault("_transcript", tr)
            if not payload.get("period_1") and not payload.get("note"):
                payload["period_1"] = tr
            elif payload.get("period_1") and tr and len(str(payload.get("period_1"))) < 8:
                # Krótki period_1 („lipiec”) — dorzuć pełną komendę (może mieć rok).
                if re.search(r"20\d{2}", tr) and not re.search(r"20\d{2}", str(payload.get("period_1"))):
                    payload["period_1"] = tr
        result = await voice_dispatch(VoiceDispatchRequest(intent=req.intent, payload=payload))
        rec_id = result.get("dish_id") or result.get("inventory_id") or None
        return ApplyResponse(intent=req.intent, ok=bool(result.get("ok", True)),
                             id=rec_id, detail=result.get("message") or result.get("action") or "OK",
                             extras=result, warnings=([result["message"]] if result.get("needs_migration") else []))
    if req.intent == "unknown" or req.intent not in dispatch:
        raise HTTPException(status_code=400, detail="Nieznana intencja — anuluj lub popraw ręcznie.")
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        try:
            rec_id, extras, warnings = await dispatch[req.intent](
                client, req.payload, req.transcript, req.source,
            )
        except HTTPException:
            raise
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Supabase: {e.response.text}") from e
    return ApplyResponse(intent=req.intent, ok=True, id=rec_id, detail="OK",
                         extras=extras or {}, warnings=warnings or [])


async def apply_waste_legacy(req: ApplyWasteRequestLegacy):
    require_tenant_account_key()
    payload = {
        "item_type": req.item_type,
        "related_id": req.related_id,
        "item_name": req.item_name,
        "quantity": req.quantity,
        "unit": req.unit,
        "reason_text": req.reason,
    }
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as client:
        log_id, extras, warnings = await _apply_waste(client, payload, req.transcript, req.source)
    return {
        "waste_log_id": log_id,
        "deductions": extras.get("deductions", []),
        "warnings": warnings,
    }

__all__ = ['_apply_fixed_cost', '_apply_inventory_item', '_apply_menu_item', '_apply_revenue', '_apply_supplier', '_apply_supplier_product', '_apply_variable_cost', '_apply_waste', '_resolve_category_id', 'actions_apply', 'apply_waste_legacy']
