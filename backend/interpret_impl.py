"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `interpret_impl`."""
from __future__ import annotations

from fastapi import HTTPException
from http_ssl import httpx_verify as _httpx_verify
from openai import APIError
from openai import OpenAIError
from pl_fuzzy_norm import norm_pl as _norm_pl
from rapidfuzz import fuzz
from supabase_rest import sb_get
from voice_fuzzy_resolve import verify_related_name as _verify_related_name_impl
from voice_period_intent_guard import guard_period_intent as _guard_period_intent
from voice_system_prompt import build_system_prompt as _build_system_prompt
import httpx
import json
from app_core import CHAT_MODEL, _openai, require_tenant_account_key
from billing_credits import _bill_openai_response
from constants import _JSON_SCHEMA
from matching_utils import _food_names_compatible, _resolve_by_fuzzy
from models import InterpretOrderRequest, InterpretRequest, VoiceInterpretation, WasteInterpretationLegacy
from subscription_core import _guard_ai



async def interpret(payload: InterpretRequest):
    require_tenant_account_key()
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Brak tekstu wejściowego.")

    client = _openai()
    await _guard_ai()

    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
        try:
            dishes = await sb_get(httpx_c, "menu_items",
                                  params={"select": "id,name", "is_active": "eq.true", "limit": "300"})
        except Exception:
            dishes = []
        try:
            ingredients = await sb_get(httpx_c, "inventory_items",
                                       params={"select": "id,name,unit", "limit": "1000"})
        except Exception:
            ingredients = []
        try:
            suppliers = await sb_get(httpx_c, "suppliers",
                                     params={"select": "id,name", "limit": "200"})
        except Exception:
            suppliers = []

        system = _build_system_prompt(dishes, ingredients, suppliers)

        try:
            resp = await client.chat.completions.create(
                model=CHAT_MODEL,
                temperature=0.0,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": text},
                ],
                response_format={"type": "json_schema", "json_schema": _JSON_SCHEMA},
            )
        except APIError as e:
            raise HTTPException(status_code=502, detail=f"OpenAI chat: {e.message}") from e
        except OpenAIError as e:  # pragma: no cover
            raise HTTPException(status_code=502, detail=f"OpenAI: {e}") from e

        # Token billing (real usage from OpenAI).
        billing = await _bill_openai_response(
            httpx_c, resp,
            endpoint="/api/voice/interpret",
            model=CHAT_MODEL,
            extras={"transcript_preview": text[:120]},
        )

        raw = (resp.choices[0].message.content or "").strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=502, detail=f"Model zwrócił nie-JSON: {e}: {raw[:200]}") from e

        # Guard: „pokaż zyski z lipca 2025” ≠ compare; porównanie tylko przy wyraźnych słowach
        data = _guard_period_intent(text, data)
        # ── Fuzzy resolve nazw dla intencji CRUD/order/supplier (odporność na Whisper).
        pl = data.get("payload") or {}
        intent_val = data.get("intent")
        extras: dict = {}

        # ── Normalizacja: LLM czasami zwraca ingredients:[{ingredient_name,quantity,unit}]
        # dla add_recipe_ingredient/edit_recipe_ingredient_qty zamiast pól top-level.
        # Spłaszczamy — bierzemy pierwszy ingredient jako źródło danych.
        if intent_val in ("add_recipe_ingredient", "edit_recipe_ingredient_qty"):
            ings = pl.get("ingredients")
            if isinstance(ings, list) and ings and not (pl.get("ingredient_name") or "").strip():
                first = ings[0] or {}
                if isinstance(first, dict):
                    pl["ingredient_name"] = first.get("ingredient_name") or pl.get("ingredient_name")
                    if pl.get("quantity") in (None, 0):
                        pl["quantity"] = first.get("quantity")
                    if not (pl.get("unit") or "").strip():
                        pl["unit"] = first.get("unit") or pl.get("unit")

        def _remember_match(field: str, matched_to: str, score: float, resolved_id: str) -> None:
            extras.setdefault("fuzzy_matches", []).append({
                "field": field, "matched_to": matched_to,
                "score": round(score, 1), "resolved_id": resolved_id,
            })

        # dish_name → menu_items
        if intent_val in ("edit_menu_item_price", "add_recipe_ingredient", "edit_recipe_ingredient_qty",
                          "delete_menu_item", "toggle_menu_item_availability",
                          "edit_menu_item_category", "rename_menu_item", "scale_recipe"):
            q = pl.get("dish_name")
            row, score = _resolve_by_fuzzy(q, dishes)
            if row:
                pl["dish_id"] = row["id"]
                pl["dish_name_resolved"] = row["name"]
                _remember_match("dish_name", row["name"], score, row["id"])

        # item_name → inventory_items (strict: bataty nie mogą wylądować na bakłażanie)
        if intent_val in ("edit_inventory_item", "delete_inventory_item", "add_expiration_batch"):
            q = pl.get("item_name")
            row, score = _resolve_by_fuzzy(q, ingredients, strict_food=True)
            if row:
                pl["inventory_id"] = row["id"]
                pl["item_name_resolved"] = row["name"]
                _remember_match("item_name", row["name"], score, row["id"])

        # waste: related_id z LLM bywa błędne — zawsze re-resolve po nazwie (strict)
        if intent_val == "waste":
            item_type_w = (pl.get("item_type") or "ingredient").strip().lower()
            claimed_id = pl.get("related_id")
            if item_type_w == "ingredient":
                q = pl.get("item_name")
                row, score = _resolve_by_fuzzy(q, ingredients, strict_food=True)
                if row:
                    pl["related_id"] = row["id"]
                    pl["item_name"] = row["name"]
                    pl["item_name_resolved"] = row["name"]
                    _remember_match("item_name", row["name"], score, row["id"])
                else:
                    claimed = next((r for r in ingredients if str(r.get("id")) == str(claimed_id)), None) if claimed_id else None
                    if claimed and q and _verify_related_name_impl(
                        str(q), claimed, food_names_compatible=_food_names_compatible,
                    ):
                        pl["item_name"] = claimed.get("name") or pl.get("item_name")
                        pl["item_name_resolved"] = claimed.get("name")
                    else:
                        pl["related_id"] = None
            elif item_type_w == "dish":
                q = pl.get("item_name")
                row, score = _resolve_by_fuzzy(q, dishes)
                if row:
                    pl["related_id"] = row["id"]
                    pl["item_name"] = row["name"]
                    pl["item_name_resolved"] = row["name"]
                    _remember_match("item_name", row["name"], score, row["id"])
                else:
                    claimed = next((r for r in dishes if str(r.get("id")) == str(claimed_id)), None) if claimed_id else None
                    if claimed and q:
                        sc = float(fuzz.token_set_ratio(_norm_pl(str(q)), _norm_pl(str(claimed.get("name") or ""))))
                        if sc >= 80:
                            pl["item_name"] = claimed.get("name") or pl.get("item_name")
                            pl["item_name_resolved"] = claimed.get("name")
                        else:
                            pl["related_id"] = None
                    else:
                        pl["related_id"] = None

        # ingredient_name → inventory_items (bez resolvowania id, ale zwracamy resolved name)
        if intent_val in ("add_recipe_ingredient", "edit_recipe_ingredient_qty"):
            q = pl.get("ingredient_name")
            row, score = _resolve_by_fuzzy(q, ingredients, strict_food=True)
            if row:
                pl["ingredient_inventory_id"] = row["id"]
                pl["ingredient_name_resolved"] = row["name"]
                _remember_match("ingredient_name", row["name"], score, row["id"])

        # supplier_name / from_supplier / to_supplier → suppliers
        for f in ("supplier_name", "from_supplier", "to_supplier"):
            q = pl.get(f)
            if not q:
                continue
            row, score = _resolve_by_fuzzy(q, suppliers)
            if row:
                pl[f"{f}_id"] = row["id"]
                pl[f"{f}_resolved"] = row["name"]
                _remember_match(f, row["name"], score, row["id"])

        data["payload"] = pl
        if extras.get("fuzzy_matches"):
            reason = data.get("reason") or ""
            picks = "; ".join(m["matched_to"] for m in extras["fuzzy_matches"])
            data["reason"] = (reason + f" | Dopasowano: {picks}").strip(" |")
            # Attach as top-level flag for FE convenience
            data["fuzzy_matches"] = extras["fuzzy_matches"]

    try:
        fields = {k: v for k, v in data.items()
                  if k in ("intent", "confidence", "reason", "payload", "fuzzy_matches", "alternate_intents")}
        fields["credits_deducted"] = int(billing.get("credits_deducted") or 0)
        fields["credits_remaining"] = billing.get("credits_remaining")
        return VoiceInterpretation(**fields)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Schema mismatch: {e}") from e


async def interpret_waste_legacy(payload: InterpretRequest):
    resp = await interpret(payload)
    p = resp.payload
    if resp.intent != "waste":
        return WasteInterpretationLegacy(
            item_type="unknown", item_name=p.get("item_name") or "",
            quantity=float(p.get("quantity") or 0), unit=p.get("unit") or "",
            reason=p.get("reason_text") or "", confidence=resp.confidence,
            notes=resp.reason,
        )
    return WasteInterpretationLegacy(
        item_type=p.get("item_type") or "unknown",
        related_id=p.get("related_id"),
        item_name=p.get("item_name") or "",
        quantity=float(p.get("quantity") or 0),
        unit=p.get("unit") or "",
        reason=p.get("reason_text") or "",
        confidence=resp.confidence,
        notes=resp.reason,
    )


# Order email: backend/order_email_routes.py + order_email_format.py


# --- Intencja głosowa Jarvisa: order_product ---------------------------------

async def interpret_order_command(req: InterpretOrderRequest):
    """Alias/kompatybilność wsteczna dla frontendu — używa nowego /api/voice/interpret
    i mapuje odpowiedź do starego formatu {intent, items[]}.
    Nowe intencje (edit_menu_item_price, add_recipe_ingredient, edit_recipe_ingredient_qty,
    edit_inventory_item, supplier_*) są przekazywane w polu `payload`, `fuzzy_matches`, `full`."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Brak tekstu komendy.")

    interpretation = await interpret(InterpretRequest(text=text))
    intent = interpretation.intent
    p = interpretation.payload or {}

    # Wsteczna kompatybilność: order_product → items[]
    items = []
    if intent == "order_product":
        raw_items = p.get("items") or []
        for i in raw_items:
            try:
                items.append({
                    "product_name": str(i.get("product_name", "")).strip(),
                    "quantity": float(i.get("quantity") or 1),
                    "unit": str(i.get("unit") or "szt").strip(),
                })
            except (TypeError, ValueError):
                continue
        items = [i for i in items if i["product_name"]]

    return {
        "intent": intent,
        "items": items,
        "payload": p,
        "confidence": interpretation.confidence,
        "reason": interpretation.reason,
    }

__all__ = ['interpret', 'interpret_order_command', 'interpret_waste_legacy']
