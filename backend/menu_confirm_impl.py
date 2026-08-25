"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `menu_confirm_impl`."""
from __future__ import annotations

from culinary_units import PIECE_DEFAULT_SIZE as _PIECE_DEFAULT_SIZE
from fastapi import HTTPException
from http_ssl import httpx_verify as _httpx_verify
from ingredient_name_norm import apply_whole_product_names_to_dishes as _apply_whole_product_names_to_dishes
from ingredient_name_norm import is_combo_polprodukt_name as _is_combo_polprodukt_name
from ingredient_name_norm import norm_name as _norm_name
from ingredient_name_norm import normalize_ingredient_name as _normalize_ingredient_name
from recipe_ingredient_units import apply_integer_quantities_to_dishes as _apply_integer_quantities_to_dishes
from recipe_ingredient_units import canonicalize_ingredient_units as _canonicalize_ingredient_units
from recipe_ingredient_units import normalize_recipe_quantity as _normalize_recipe_quantity
from supabase_rest import sb_get
from supabase_rest import sb_post
from typing import Optional
import asyncio
import httpx
import json
from app_core import CHAT_MODEL, _openai, require_tenant_account_key
from billing_credits import _bill_openai_response
from constants import _MENU_SUGGEST_BATCH_SIZE, _MENU_SUGGEST_BATCH_TIMEOUT_S, _MENU_SUGGEST_JSON_SCHEMA, _MENU_SUGGEST_SYSTEM_PROMPT
from matching_utils import _is_porcja_row, _resolve_by_fuzzy
from models import ConfirmMenuIngredient, ConfirmMenuScanRequest
from onboard_impl import _auto_onboard_inventory, _make_pos_id_for_category



async def _fill_empty_ingredients_for_confirm(
    dishes: list,
    *,
    warnings: list[str],
) -> None:
    """Jak gastro-manager-15: gdy potrawa nie ma składników, AI proponuje recepturę
    zanim confirm-scan zbierze listę do magazynu. In-place na `dishes`."""
    need = [
        d for d in dishes
        if (d.name or "").strip() and not any(
            (getattr(i, "name", None) or "").strip() for i in (d.ingredients or [])
        )
    ]
    if not need:
        return
    warnings.append(
        f"Uzupełniam receptury AI dla {len(need)} potraw bez składników "
        f"(wymagane do zapełnienia magazynu)."
    )
    client = _openai()
    by_lower: dict[str, list] = {}
    portion_by: dict[str, tuple] = {}
    for i in range(0, len(need), _MENU_SUGGEST_BATCH_SIZE):
        batch_dishes = need[i:i + _MENU_SUGGEST_BATCH_SIZE]
        batch = [
            {
                "name": d.name,
                "category": d.category or "Inne",
                "has_ingredients": False,
                "ingredients": [],
                "has_portion_weight": d.portion_weight_value is not None,
                "portion_weight_unit_hint": d.portion_weight_unit,
            }
            for d in batch_dishes
        ]
        try:
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=CHAT_MODEL,
                    temperature=0.2,
                    messages=[
                        {"role": "system", "content": _MENU_SUGGEST_SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps({"dishes": batch}, ensure_ascii=False)},
                    ],
                    response_format={"type": "json_schema", "json_schema": _MENU_SUGGEST_JSON_SCHEMA},
                ),
                timeout=_MENU_SUGGEST_BATCH_TIMEOUT_S,
            )
        except Exception as e:  # noqa: BLE001
            warnings.append(f"Sugestie AI (batch) pominięte: {e}")
            continue
        try:
            async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
                await _bill_openai_response(
                    httpx_c, resp, endpoint="/api/menu/confirm-scan", model=CHAT_MODEL,
                    extras={"fill_empty_ingredients": len(batch)},
                )
        except Exception:
            pass
        try:
            data = json.loads((resp.choices[0].message.content or "").strip() or "{}")
        except json.JSONDecodeError:
            warnings.append("Sugestie AI: niepoprawny JSON — pominięto partię.")
            continue
        for raw in data.get("dishes") or []:
            nm = (raw.get("name") or "").strip().lower()
            if not nm:
                continue
            ings = raw.get("suggested_ingredients") or []
            if ings:
                by_lower[nm] = ings
            pw = raw.get("suggested_portion_weight_value")
            pu = raw.get("suggested_portion_weight_unit")
            if pw is not None and pu:
                portion_by[nm] = (pw, pu)

    for d in need:
        key = (d.name or "").strip().lower()
        ings = by_lower.get(key)
        if not ings:
            continue
        filled: list[ConfirmMenuIngredient] = []
        for si in ings:
            iname = (si.get("name") if isinstance(si, dict) else getattr(si, "name", None)) or ""
            iname = str(iname).strip()
            if not iname or _is_porcja_row(iname):
                continue
            qty = si.get("quantity") if isinstance(si, dict) else getattr(si, "quantity", None)
            unit = (si.get("unit") if isinstance(si, dict) else getattr(si, "unit", None)) or "g"
            try:
                qf = float(qty) if qty is not None else 1.0
            except (TypeError, ValueError):
                qf = 1.0
            filled.append(ConfirmMenuIngredient(
                name=_normalize_ingredient_name(iname),
                quantity=max(1.0, qf),
                unit=str(unit) or "g",
            ))
        if filled:
            d.ingredients = filled
        portion = portion_by.get(key)
        if (
            portion
            and (d.portion_weight_value is None or not d.portion_weight_unit)
        ):
            try:
                d.portion_weight_value = float(portion[0])
                d.portion_weight_unit = str(portion[1])
            except (TypeError, ValueError):
                pass


async def menu_confirm_scan(req: ConfirmMenuScanRequest):
    """Zapisuje zatwierdzone potrawy do bazy (menu_items + recipe_ingredients).
    Wielkość porcji jest zapisywana jako parametr nadrzędny w
    `menu_items.portion_size_grams` (i opcjonalnie `portion_size_unit`), NIGDY
    jako wiersz 'Porcja' w recipe_ingredients ani jako produkt w inventory_items."""
    require_tenant_account_key()
    if not req.dishes:
        raise HTTPException(status_code=400, detail="Brak potraw do zapisania.")

    # Ostatnia bramka spójności jednostek przed zapisem receptur.
    _canonicalize_ingredient_units(req.dishes)
    _apply_whole_product_names_to_dishes(req.dishes)
    _apply_integer_quantities_to_dishes(req.dishes)

    inserted = 0
    skipped = 0
    saved: list[dict] = []
    warnings: list[str] = []
    all_ingredient_names: list[str] = []
    portion_column_missing = False

    # Uzupełnianie AI tylko po świadomym TAK (fill_empty_with_ai). NIE = puste pola zostają.
    if req.fill_empty_with_ai:
        try:
            await _fill_empty_ingredients_for_confirm(req.dishes, warnings=warnings)
            _canonicalize_ingredient_units(req.dishes)
            _apply_whole_product_names_to_dishes(req.dishes)
            _apply_integer_quantities_to_dishes(req.dishes)
        except Exception as e:  # noqa: BLE001
            warnings.append(f"Uzupełnianie receptur AI pominięte: {e}")

    async with httpx.AsyncClient(timeout=180.0, verify=_httpx_verify()) as client:
        try:
            existing_menu = await sb_get(client, "menu_items", params={
                "select": "id,name,is_active,category,price_pln", "limit": "10000",
            }) or []
        except httpx.HTTPStatusError:
            existing_menu = await sb_get(client, "menu_items", params={
                "select": "id,name,category,price_pln", "limit": "10000",
            }) or []
        # Dedup tylko względem AKTYWNYCH dań — usunięte nie są przywracane.
        active_menu = [m for m in existing_menu if m.get("is_active") is not False]
        existing_count_rows = active_menu
        base_offset = len(existing_count_rows or [])

        for idx, dish in enumerate(req.dishes):
            name = (dish.name or "").strip()
            if not name:
                continue
            category = dish.category or "Inne"
            # Półprodukty / combo (mise en place) → kategoria Menu „Półprodukty”
            if _is_combo_polprodukt_name(name):
                category = "Półprodukty"
            price = float(dish.price_pln or 0)

            # Deduplikacja: ta sama AKTYWNA potrawa już w menu → nie twórz drugiego dania,
            # ALE zbierz składniki do onboarding magazynu (brakujące produkty / przywrócenie).
            hit, _sc = _resolve_by_fuzzy(name, active_menu, threshold=88)
            if hit:
                skipped += 1
                warnings.append(f"„{hit.get('name') or name}” już jest w menu — pominięto duplikat.")
                for ing in (dish.ingredients or []):
                    iname = (getattr(ing, "name", None) or "").strip()
                    if not iname or _is_porcja_row(iname):
                        continue
                    all_ingredient_names.append(_normalize_ingredient_name(iname))
                continue

            pos_id = _make_pos_id_for_category(category, base_offset + idx + 1)

            # Wielkość porcji → parametr nadrzędny (baza g/ml: 1 ml == 1 g dla płynów gastro).
            portion_grams: Optional[float] = None
            portion_unit: Optional[str] = None
            if dish.portion_weight_value and dish.portion_weight_unit:
                try:
                    pv = float(dish.portion_weight_value)
                except (TypeError, ValueError):
                    pv = 0.0
                pu = _norm_name(dish.portion_weight_unit)
                if pv > 0:
                    if pu == "kg":
                        portion_grams, portion_unit = pv * 1000.0, "g"
                    elif pu in ("l", "litr", "litry"):
                        portion_grams, portion_unit = pv * 1000.0, "ml"
                    elif pu in ("g", "gram", "gramy"):
                        portion_grams, portion_unit = pv, "g"
                    elif pu == "ml":
                        portion_grams, portion_unit = pv, "ml"
                    else:  # szt / opak / porcja itp. — przelicznik domyślny
                        portion_grams, portion_unit = pv * _PIECE_DEFAULT_SIZE, "szt"

            menu_payload: dict = {
                "name": name, "category": category, "price_pln": price,
                "pos_id": pos_id, "is_active": True,
            }
            if portion_grams is not None:
                menu_payload["portion_size_grams"] = portion_grams
                menu_payload["portion_size_unit"] = portion_unit

            try:
                row = await sb_post(client, "menu_items", menu_payload)
            except httpx.HTTPStatusError as e:
                body = e.response.text or ""
                # Fallback: baza bez kolumn portion_size_* → zapisz bez nich i ostrzeż.
                if ("portion_size_grams" in body or "portion_size_unit" in body) and portion_grams is not None:
                    portion_column_missing = True
                    menu_payload.pop("portion_size_grams", None)
                    menu_payload.pop("portion_size_unit", None)
                    try:
                        row = await sb_post(client, "menu_items", menu_payload)
                    except httpx.HTTPStatusError as e2:
                        warnings.append(f"{name}: nie zapisano ({e2.response.text[:120]}).")
                        continue
                else:
                    warnings.append(f"{name}: nie zapisano ({body[:120]}).")
                    continue
            menu_id = (row[0] if isinstance(row, list) else row)["id"]

            recipe_rows: list[dict] = []
            for i, ing in enumerate(dish.ingredients):
                iname = (ing.name or "").strip()
                if not iname:
                    continue
                # Pomiń wielkość porcji — to parametr nadrzędny, nie składnik.
                if _is_porcja_row(iname):
                    continue
                qty_raw = getattr(ing, "quantity", None)
                qty_norm = _normalize_recipe_quantity(qty_raw, ing.unit or "g") if qty_raw is not None else None
                # Brak gramatury z OCR/AI → minimum 1 (użytkownik może edytować), nigdy 0.
                row_ing: dict = {
                    "menu_item_id": menu_id,
                    "ingredient_name": _normalize_ingredient_name(iname),
                    "quantity": float(qty_norm if qty_norm is not None else 1),
                    "unit": ing.unit or "g",
                    "sort_order": i + 1,
                }
                pw = getattr(ing, "piece_weight_g", None)
                if pw is not None:
                    try:
                        pw_f = float(pw)
                        if pw_f > 0:
                            row_ing["piece_weight_g"] = pw_f
                    except (TypeError, ValueError):
                        pass
                recipe_rows.append(row_ing)
                all_ingredient_names.append(str(row_ing["ingredient_name"]))

            if recipe_rows:
                try:
                    await sb_post(client, "recipe_ingredients", recipe_rows)
                except httpx.HTTPStatusError as e:
                    body = e.response.text or ""
                    if "piece_weight_g" in body:
                        for r in recipe_rows:
                            r.pop("piece_weight_g", None)
                        try:
                            await sb_post(client, "recipe_ingredients", recipe_rows)
                        except httpx.HTTPStatusError as e2:
                            warnings.append(f"{name}: składniki niezapisane ({e2.response.text[:120]}).")
                    else:
                        warnings.append(f"{name}: składniki niezapisane ({body[:120]}).")

            inserted += 1
            saved.append({"id": menu_id, "name": name, "category": category, "price_pln": price, "action": "inserted"})
            active_menu.append({"id": menu_id, "name": name, "is_active": True, "category": category, "price_pln": price})

        # Automatyczny onboarding magazynu: utwórz brakujące składniki jako produkty (stan 0).
        inv_created_count = 0
        inv_created_items: list[dict] = []
        try:
            inv_created_count, inv_created_items, inv_warns = await _auto_onboard_inventory(
                client, all_ingredient_names)
            warnings.extend(inv_warns)
        except Exception as e:  # noqa: BLE001
            warnings.append(f"Auto-onboarding magazynu pominięty: {e}")

    if portion_column_missing:
        warnings.append(
            "Uwaga: kolumny `menu_items.portion_size_grams` / `portion_size_unit` "
            "nie istnieją. Uruchom migrację SQL `ADD_PORTION_SIZE.sql`, aby ubytki "
            "płynnych potraw (l/ml) działały poprawnie."
        )

    msg_parts = [f"Dodano {inserted} nowych potraw."]
    if skipped:
        msg_parts.append(f"Pominięto {skipped} duplikatów (już w menu).")

    return {
        "ok": True,
        "inserted": inserted,
        "skipped_duplicates": skipped,
        "restored": 0,
        "saved": saved,
        "inventory_created": inv_created_count,
        "inventory_items": inv_created_items,
        "warnings": warnings,
        "message": " ".join(msg_parts),
    }

__all__ = ['_fill_empty_ingredients_for_confirm', 'menu_confirm_scan']
