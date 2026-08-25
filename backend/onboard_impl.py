"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `onboard_impl`."""
from __future__ import annotations

from ingredient_name_norm import combo_default_ingredients as _combo_default_ingredients
from ingredient_name_norm import is_combo_polprodukt_name as _is_combo_polprodukt_name
from ingredient_name_norm import norm_name as _norm_name
from ingredient_name_norm import normalize_ingredient_name as _normalize_ingredient_name
from pl_fuzzy_norm import food_match_key as _food_match_key
from supabase_rest import sb_get
from supabase_rest import sb_patch
from supabase_rest import sb_post
from typing import Optional
import httpx
import json
from app_core import CHAT_MODEL, _openai, logger
from billing_credits import _bill_openai_response
from constants import WAREHOUSE_CATEGORIES, _WAREHOUSE_CAT_COLORS
from inventory_match import _find_inventory_duplicate, _resolve_category_id_cached
from matching_utils import _is_porcja_row, _norm



def _make_pos_id_for_category(category: str, offset: int) -> str:
    prefix_map = {
        "Burgery": "BRG", "Dania główne": "DAN", "Sałatki": "SAL",
        "Makarony": "MAK", "Zupy": "ZUP", "Pizza": "PIZ",
        "Przystawki": "PRZ", "Desery": "DESR", "Napoje": "NAP",
        "Alkohole": "ALK", "Inne": "INN",
    }
    return f"{prefix_map.get(category, 'INN')}-{str(offset).zfill(3)}"


async def _ensure_warehouse_categories(client: httpx.AsyncClient) -> dict:
    """Zapewnia istnienie sztywnych kategorii magazynowych. Zwraca mapę {norm_name: id}."""
    existing = await sb_get(client, "inventory_categories", params={"select": "id,name,sort_order"}) or []
    by_norm = {_norm(r["name"]): r["id"] for r in existing}
    max_sort = max((int(r.get("sort_order") or 0) for r in existing), default=0)
    for cat in WAREHOUSE_CATEGORIES:
        if _norm(cat) in by_norm:
            continue
        max_sort += 1
        try:
            row = await sb_post(client, "inventory_categories", {
                "name": cat, "color": _WAREHOUSE_CAT_COLORS.get(cat, "#94A3B8"),
                "sort_order": max_sort,
            })
            created = row[0] if isinstance(row, list) else row
            by_norm[_norm(cat)] = created["id"]
        except httpx.HTTPStatusError:
            pass
    return by_norm


async def _gpt_categorize_ingredients(names: list[str],
                                      httpx_c: Optional[httpx.AsyncClient] = None) -> dict:
    """GPT-4o-mini przypisuje każdy składnik do jednej ze sztywnych kategorii magazynowych.
    Zwraca {name: category}. Best-effort — brakujące → 'Inne'."""
    result = {n: "Inne" for n in names}
    if not names:
        return result
    try:
        client = _openai()
        cats = ", ".join(WAREHOUSE_CATEGORIES)
        prompt = (
            "Przypisz każdy produkt spożywczy/gastronomiczny do JEDNEJ kategorii magazynowej.\n"
            f"Dozwolone kategorie (użyj DOKŁADNIE tych nazw): {cats}.\n"
            "Zwróć JSON: {\"items\": [{\"name\": <nazwa>, \"category\": <kategoria>}]}.\n"
            f"Produkty: {json.dumps(names, ensure_ascii=False)}"
        )
        resp = await client.chat.completions.create(
            model=CHAT_MODEL, temperature=0.0,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        if httpx_c is not None:
            await _bill_openai_response(
                httpx_c, resp,
                endpoint="/api/menu/confirm-scan",
                model=CHAT_MODEL,
                extras={"categorize_count": len(names)},
            )
        data = json.loads(resp.choices[0].message.content or "{}")
        for it in (data.get("items") or []):
            nm = (it.get("name") or "").strip()
            cat = (it.get("category") or "Inne").strip()
            if cat not in WAREHOUSE_CATEGORIES:
                cat = "Inne"
            # dopasuj do oryginalnej nazwy (case-insensitive)
            for orig in names:
                if _norm(orig) == _norm(nm):
                    result[orig] = cat
                    break
    except Exception as e:  # noqa: BLE001
        logger.warning(f"_gpt_categorize_ingredients failed: {e}")
    return result


async def _auto_onboard_inventory(client: httpx.AsyncClient, ingredient_names: list[str]):
    """Dla każdego składnika receptury, którego NIE MA w aktywnym magazynie, tworzy produkt
    (stan 0, min 5, bufor 20%) z kategorią GPT — jak w gastro-manager-15.

    Soft-deleted (`is_active=false`) NIE blokują: najpierw przywracamy po nazwie, potem tworzymy.
    Soft-deleted wczytywane RAZ na start (bez N×5000 przy każdym UNIQUE).
    """
    warnings: list[str] = []
    seen: dict[str, str] = {}
    for n in ingredient_names:
        nm = _normalize_ingredient_name((n or "").strip())
        if not nm or _is_porcja_row(nm):
            continue
        key = _food_match_key(nm) or _norm_name(nm)
        if key and key not in seen:
            seen[key] = nm
    if not seen:
        return 0, [], warnings

    has_active_col = True
    try:
        active = await sb_get(client, "inventory_items", params={
            "select": "id,name,is_combo_polprodukt",
            "is_active": "eq.true",
            "limit": "5000",
        }) or []
    except httpx.HTTPStatusError as e:
        if "is_active" not in (e.response.text or ""):
            raise
        has_active_col = False
        active = await sb_get(client, "inventory_items", params={
            "select": "id,name,is_combo_polprodukt", "limit": "5000",
        }) or []

    inactive: list[dict] = []
    if has_active_col:
        try:
            inactive = await sb_get(client, "inventory_items", params={
                "select": "id,name,is_combo_polprodukt",
                "is_active": "eq.false",
                "limit": "5000",
            }) or []
        except httpx.HTTPStatusError:
            inactive = []

    created: list[dict] = []
    to_create: list[str] = []

    async def _reactivate(row: dict, label: str) -> dict:
        await sb_patch(
            client, "inventory_items", {"id": f"eq.{row['id']}"},
            {"is_active": True},
        )
        info = {
            "name": row.get("name") or label,
            "category": "Przywrócony",
            "is_combo_polprodukt": bool(row.get("is_combo_polprodukt")),
            "restored": True,
        }
        active.append({"id": row.get("id"), "name": info["name"],
                       "is_combo_polprodukt": info["is_combo_polprodukt"]})
        # Bez żółtych komunikatów „było usunięte / przywrócono” — to szum dla użytkownika.
        return info

    for _k, orig in seen.items():
        if _find_inventory_duplicate(orig, active, threshold=86):
            continue
        dead = _find_inventory_duplicate(orig, inactive, threshold=86) if inactive else None
        if dead and dead.get("id"):
            try:
                created.append(await _reactivate(dead, orig))
                inactive = [r for r in inactive if r.get("id") != dead.get("id")]
            except Exception as re:  # noqa: BLE001
                logger.warning("%s: nie przywrócono (%s) — spróbuję utworzyć.", orig, re)
                to_create.append(orig)
            continue
        to_create.append(orig)

    if not to_create:
        return len(created), created, warnings

    await _ensure_warehouse_categories(client)
    cat_map = await _gpt_categorize_ingredients(to_create, client)
    cat_cache: dict = {}

    for name in to_create:
        is_combo = _is_combo_polprodukt_name(name)
        cat_name = "Półprodukty" if is_combo else cat_map.get(name, "Inne")
        if cat_name not in WAREHOUSE_CATEGORIES:
            cat_name = "Inne"
        cat_id = await _resolve_category_id_cached(client, cat_name, cat_cache)
        payload = {
            "name": name, "category_id": cat_id, "quantity": 0,
            "unit": "porcja" if is_combo else "szt",
            "min_quantity": 5, "safety_buffer_percent": 20,
            "is_combo_polprodukt": is_combo, "unit_cost": 0,
        }
        try:
            row = await sb_post(client, "inventory_items", payload)
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "")
            body_l = body.lower()
            if "safety_buffer_percent" in body:
                payload.pop("safety_buffer_percent", None)
                try:
                    row = await sb_post(client, "inventory_items", payload)
                except httpx.HTTPStatusError as e2:
                    body2 = (e2.response.text or "")
                    if any(x in body2.lower() for x in ("duplicate", "unique", "23505")):
                        # Dokładne dopasowanie po nazwie (także soft-deleted).
                        try:
                            hit_rows = await sb_get(client, "inventory_items", params={
                                "select": "id,name,is_combo_polprodukt,is_active",
                                "name": f"eq.{name}",
                                "limit": "5",
                            }) or []
                        except httpx.HTTPStatusError:
                            hit_rows = []
                        restored_ok = False
                        for hr in hit_rows:
                            if hr.get("is_active") is False and hr.get("id"):
                                try:
                                    created.append(await _reactivate(hr, name))
                                    restored_ok = True
                                    break
                                except Exception:
                                    pass
                        if not restored_ok:
                            warnings.append(f"{name}: nie utworzono w magazynie ({body2[:100]}).")
                        continue
                    warnings.append(f"{name}: nie utworzono w magazynie ({body2[:100]}).")
                    continue
            elif any(x in body_l for x in ("duplicate", "unique", "23505")):
                try:
                    hit_rows = await sb_get(client, "inventory_items", params={
                        "select": "id,name,is_combo_polprodukt,is_active",
                        "name": f"eq.{name}",
                        "limit": "5",
                    }) or []
                except httpx.HTTPStatusError:
                    hit_rows = []
                restored_ok = False
                for hr in hit_rows:
                    if hr.get("is_active") is False and hr.get("id"):
                        try:
                            created.append(await _reactivate(hr, name))
                            restored_ok = True
                            break
                        except Exception:
                            pass
                if not restored_ok:
                    warnings.append(f"{name}: nie utworzono w magazynie ({body[:100]}).")
                continue
            else:
                warnings.append(f"{name}: nie utworzono w magazynie ({body[:100]}).")
                continue
        inv_id = None
        try:
            inv_id = (row[0] if isinstance(row, list) else row).get("id")
        except Exception:
            inv_id = None
        item_info: dict = {"name": name, "category": cat_name, "is_combo_polprodukt": is_combo}
        if is_combo and inv_id:
            combo_ings = _combo_default_ingredients(name)
            item_info["combo_ingredients_proposed"] = combo_ings
            for i, cname in enumerate(combo_ings):
                cname_n = _normalize_ingredient_name(cname)
                try:
                    await sb_post(client, "inventory_combo_ingredients", {
                        "inventory_item_id": inv_id,
                        "ingredient_name": cname_n,
                        "quantity": 1,
                        "unit": "szt",
                        "sort_order": i + 1,
                    })
                except Exception as ce:  # noqa: BLE001
                    warnings.append(f"{name}: składnik combo „{cname_n}” nie zapisany ({ce}).")
            warnings.append(
                f"„{name}” oznaczono jako półprodukt combo — zaproponowano składniki "
                f"({', '.join(combo_ings) if combo_ings else 'edytuj w Magazynie'})."
            )
        created.append(item_info)
        active.append({"id": inv_id, "name": name, "is_combo_polprodukt": is_combo})
    return len(created), created, warnings

__all__ = ['_auto_onboard_inventory', '_ensure_warehouse_categories', '_gpt_categorize_ingredients', '_make_pos_id_for_category']
