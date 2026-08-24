"""
Akcja waste — resolve celu + apply (odjęcie ze stanu).

Wydzielone z server.py. Normalizuje item_type i nie ufa ślepo related_id z LLM.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Optional

import httpx
from fastapi import HTTPException

from culinary_units import convert_culinary
from supabase_rest import sb_get, sb_patch, sb_post

logger = logging.getLogger("gastro")


def normalize_waste_item_type(raw: Any) -> str:
    """Sprowadza item_type z FE/LLM do 'dish' | 'ingredient' | ''."""
    s = str(raw or "").strip().lower()
    if s in ("ingredient", "skladnik", "składnik", "magazyn", "product", "produkt", "ing"):
        return "ingredient"
    if s in ("dish", "danie", "potrawa", "menu", "recipe", "receptura"):
        return "dish"
    if s in ("unknown", "null", "none", ""):
        return ""
    return s if s in ("dish", "ingredient") else ""


def resolve_ingredient_target(
    item_name: str,
    related_id: Optional[str],
    inv_rows: list[dict[str, Any]],
    *,
    resolve_by_fuzzy: Callable[..., tuple[Optional[dict], float]],
    food_names_compatible: Callable[[str, str], bool],
) -> tuple[Optional[str], str, list[str]]:
    """Zwraca (related_id | None, canonical_name, warnings)."""
    warnings: list[str] = []
    name = (item_name or "").strip()
    claimed = next((r for r in inv_rows if str(r.get("id")) == str(related_id)), None) if related_id else None
    if claimed and name and not food_names_compatible(name, str(claimed.get("name") or "")):
        warnings.append(
            f"Odrzucono niespójne ID magazynu ({claimed.get('name')}) dla „{name}”."
        )
        claimed = None
        related_id = None
    if claimed:
        return str(claimed["id"]), str(claimed.get("name") or name), warnings
    if name and inv_rows:
        row, _score = resolve_by_fuzzy(name, inv_rows, strict_food=True)
        if row:
            return str(row["id"]), str(row.get("name") or name), warnings
    return None, name, warnings


def _piece_size_from_payload(p: dict, inv: dict) -> Optional[float]:
    """Opcjonalna waga/objętość 1 szt z payloadu lub magazynu."""
    for key in ("piece_weight_g", "unit_weight_volume", "piece_ml"):
        raw = p.get(key)
        if raw is None or raw == "":
            continue
        try:
            v = float(raw)
            if v > 0:
                return v
        except (TypeError, ValueError):
            continue
    inv_uw = inv.get("unit_weight_volume")
    try:
        if inv_uw is not None and float(inv_uw) > 0:
            return float(inv_uw)
    except (TypeError, ValueError):
        pass
    return None


async def apply_waste(
    client: httpx.AsyncClient,
    p: dict,
    transcript: Optional[str],
    source: str,
    *,
    resolve_by_fuzzy: Callable[..., tuple[Optional[dict], float]],
    food_names_compatible: Callable[[str, str], bool],
    norm_pl: Callable[[str], str],
    fuzz_token_set_ratio: Callable[[str, str], float],
    is_porcja_row: Callable[[Any], bool],
    to_gml: Callable[..., Optional[float]],
    norm_name: Callable[[str], str],
    piece_default_size: float,
    recompute_menu_availability: Callable,
) -> tuple[Any, dict, list[str]]:
    """Zapis waste_logs + odjęcie ze stanu. Zwraca (log_id, extras, warnings)."""
    warnings: list[str] = []
    deductions: list[dict] = []

    item_type = normalize_waste_item_type(p.get("item_type") or p.get("kind"))
    if not item_type:
        # Ręczny formularz: brak typu + related_id → składnik
        if p.get("related_id"):
            item_type = "ingredient"
        else:
            raise HTTPException(
                status_code=400,
                detail="Waste: item_type musi być 'dish' lub 'ingredient'.",
            )
    p["item_type"] = item_type

    related_id = p.get("related_id")
    item_name = (p.get("item_name") or "").strip()

    if item_type == "ingredient":
        inv_all: list = []
        try:
            inv_all = await sb_get(
                client, "inventory_items",
                params={"select": "id,name,quantity,unit,unit_weight_volume", "limit": "2000"},
            ) or []
        except httpx.HTTPStatusError:
            try:
                inv_all = await sb_get(
                    client, "inventory_items",
                    params={"select": "id,name,quantity,unit", "limit": "2000"},
                ) or []
            except httpx.HTTPStatusError:
                inv_all = []
        related_id, item_name, resolve_warnings = resolve_ingredient_target(
            item_name,
            related_id,
            inv_all,
            resolve_by_fuzzy=resolve_by_fuzzy,
            food_names_compatible=food_names_compatible,
        )
        warnings.extend(resolve_warnings)
        p["related_id"] = related_id
        p["item_name"] = item_name
        if not related_id:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Nie znaleziono w magazynie produktu pasującego do „{item_name or '—'}”. "
                    "Wybierz pozycję z podpowiedzi — bez tego nie odejmiemy stanu."
                ),
            )
    elif item_type == "dish" and related_id and item_name:
        try:
            mi = await sb_get(
                client, "menu_items",
                params={"select": "id,name", "id": f"eq.{related_id}", "limit": "1"},
            )
        except httpx.HTTPStatusError:
            mi = []
        if mi:
            sc = float(fuzz_token_set_ratio(norm_pl(item_name), norm_pl(str(mi[0].get("name") or ""))))
            if sc < 80:
                warnings.append(f"Odrzucono niespójne ID dania ({mi[0].get('name')}) dla „{item_name}”.")
                related_id = None
                p["related_id"] = None
                dishes: list = []
                try:
                    dishes = await sb_get(
                        client, "menu_items",
                        params={"select": "id,name", "is_active": "eq.true", "limit": "1000"},
                    ) or []
                except httpx.HTTPStatusError:
                    dishes = []
                row, _score = resolve_by_fuzzy(item_name, dishes)
                if row:
                    related_id = row["id"]
                    item_name = row["name"]
                    p["related_id"] = related_id
                    p["item_name"] = item_name

    log_payload = {
        "item_id": related_id if item_type == "ingredient" else None,
        "item_name": item_name or p.get("item_name") or "",
        "quantity": p.get("quantity") or 0,
        "unit": p.get("unit") or "",
        "reason": p.get("reason_text") or "",
        "item_type": item_type,
        "related_id": related_id,
        "source": source,
        "transcript": transcript,
    }
    try:
        log_rows = await sb_post(client, "waste_logs", log_payload)
    except httpx.HTTPStatusError as e:
        body = e.response.text or ""
        if any(k in body for k in ("item_type", "related_id", "source", "transcript")):
            warnings.append("Migracja SQL nie zastosowana — zapisano tylko podstawowe pola.")
            log_rows = await sb_post(client, "waste_logs", {
                "item_id": log_payload["item_id"], "item_name": log_payload["item_name"],
                "quantity": log_payload["quantity"], "unit": log_payload["unit"],
                "reason": log_payload["reason"],
            })
        else:
            raise HTTPException(status_code=502, detail=f"waste_logs insert: {body}") from e
    log_id = (log_rows[0] if isinstance(log_rows, list) else log_rows)["id"]

    qty = float(p.get("quantity") or 0)
    unit_in = p.get("unit") or ""

    if item_type == "ingredient" and related_id:
        rows: list = []
        try:
            rows = await sb_get(client, "inventory_items",
                                params={"select": "id,name,quantity,unit,unit_weight_volume",
                                        "id": f"eq.{related_id}"})
        except httpx.HTTPStatusError:
            try:
                rows = await sb_get(client, "inventory_items",
                                    params={"select": "id,name,quantity,unit", "id": f"eq.{related_id}"})
            except httpx.HTTPStatusError as e:
                warnings.append(
                    f"Nie udało się pobrać produktu z magazynu "
                    f"(kod {e.response.status_code}) — magazyn niezmieniony."
                )
                rows = []
        if rows:
            inv = rows[0]
            if item_name and not food_names_compatible(item_name, str(inv.get("name") or "")):
                warnings.append(
                    f"Zablokowano odjęcie: magazyn „{inv.get('name')}” ≠ „{item_name}”."
                )
            else:
                unit_size = _piece_size_from_payload(p, inv)
                conv = convert_culinary(qty, unit_in, inv["unit"], unit_size)
                delta = conv if conv is not None else qty
                new_qty = max(0.0, float(inv.get("quantity") or 0) - float(delta))
                try:
                    await sb_patch(client, "inventory_items", {"id": f"eq.{related_id}"}, {"quantity": new_qty})
                    deductions.append({
                        "inventory_id": inv["id"], "name": inv["name"],
                        "deducted": round(float(delta), 4), "unit": inv["unit"],
                        "new_quantity": round(new_qty, 4),
                    })
                except Exception as e:  # noqa: BLE001
                    warnings.append(f"Nie udało się zaktualizować stanu {inv['name']} ({str(e)[:60]}).")
        else:
            warnings.append(
                f"Zgłoszono stratę. Uwaga: Składnik [{p.get('item_name') or 'surowiec'}] "
                "nie był wcześniej wprowadzony na magazyn – stan ustawiono na 0."
            )
    elif item_type == "dish" and related_id:
        try:
            recipe = await sb_get(client, "recipe_ingredients",
                                  params={"select": "ingredient_name,quantity,unit",
                                          "menu_item_id": f"eq.{related_id}"}) or []
        except httpx.HTTPStatusError as e:
            warnings.append(
                f"Nie udało się odczytać receptury (kod {e.response.status_code}) — "
                "zapisano tylko log straty, magazyn niezmieniony."
            )
            recipe = []
        portion_base: Optional[float] = None
        try:
            mi = await sb_get(client, "menu_items",
                              params={"select": "portion_size_grams", "id": f"eq.{related_id}", "limit": "1"})
            if mi and mi[0].get("portion_size_grams"):
                portion_base = float(mi[0]["portion_size_grams"])
        except httpx.HTTPStatusError:
            portion_base = None
        if portion_base is None:
            for r in recipe:
                if is_porcja_row(r.get("ingredient_name")):
                    pv = to_gml(float(r.get("quantity") or 0), r.get("unit") or "g", piece_default_size)
                    if pv:
                        portion_base = pv
                    break
        wu = norm_name(unit_in)
        if wu in ("", "szt", "szt.", "porcja", "porcje", "opak", "danie", "dania"):
            portions = qty
        else:
            waste_base = to_gml(qty, unit_in, piece_default_size)
            portions = (waste_base / portion_base) if (waste_base and portion_base) else qty
        if not portions or portions <= 0:
            portions = 1.0

        inv_all2: list = []
        try:
            inv_all2 = await sb_get(client, "inventory_items",
                                    params={"select": "id,name,quantity,unit,unit_weight_volume",
                                            "limit": "1000"}) or []
        except httpx.HTTPStatusError:
            try:
                inv_all2 = await sb_get(client, "inventory_items",
                                        params={"select": "id,name,quantity,unit", "limit": "1000"}) or []
            except httpx.HTTPStatusError as e:
                warnings.append(
                    f"Nie udało się pobrać magazynu (kod {e.response.status_code}) — "
                    "zapisano tylko log straty."
                )
                inv_all2 = []
        inv_map = {norm_name(r["name"]): r for r in inv_all2}
        for ing in recipe:
            iname = ing.get("ingredient_name") or ""
            if is_porcja_row(iname):
                continue
            try:
                key = norm_name(iname)
                inv = inv_map.get(key)
                if not inv:
                    hit, _sc = resolve_by_fuzzy(iname, inv_all2, strict_food=True)
                    inv = hit
                if not inv:
                    warnings.append(
                        f"Zgłoszono stratę. Uwaga: Składnik [{iname}] nie był wcześniej "
                        "wprowadzony na magazyn – stan ustawiono na 0."
                    )
                    continue
                used = float(ing.get("quantity") or 0) * portions
                conv = convert_culinary(
                    used, ing.get("unit") or "g", inv["unit"], inv.get("unit_weight_volume"),
                )
                if conv is None:
                    warnings.append(
                        f"Pominięto {iname}: nieobsługiwana jednostka "
                        f"{ing.get('unit')}→{inv['unit']}."
                    )
                    continue
                new_qty = max(0.0, float(inv.get("quantity") or 0) - conv)
                await sb_patch(client, "inventory_items", {"id": f"eq.{inv['id']}"}, {"quantity": new_qty})
                deductions.append({
                    "inventory_id": inv["id"], "name": inv["name"],
                    "deducted": round(conv, 4), "unit": inv["unit"],
                    "new_quantity": round(new_qty, 4),
                })
            except Exception as e:  # noqa: BLE001
                warnings.append(
                    f"Zgłoszono stratę. Uwaga: składnik [{iname}] pominięto przy "
                    f"odejmowaniu ({str(e)[:60]})."
                )
                continue

    if deductions:
        try:
            await recompute_menu_availability(
                client, changed_inventory_ids={d["inventory_id"] for d in deductions},
            )
        except Exception as e:
            logger.debug("recompute_menu_availability skipped: %s", e)

    return log_id, {"deductions": deductions}, warnings
