"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `catalog_offer_impl`."""
from __future__ import annotations

from pl_fuzzy_norm import norm_pl as _norm_pl
from supabase_rest import sb_get
from supabase_rest import sb_patch
from supabase_rest import sb_post
from typing import Optional
import asyncio
import httpx
import json
from app_core import CHAT_MODEL, _openai, logger
from matching_utils import _fuzzy_match_token_only, _norm



# upload-catalog: backend/supplier_catalog_scan_routes.py (include_router)


_catalog_extra_cols: Optional[bool] = None


async def _has_catalog_extra_cols(client: httpx.AsyncClient) -> bool:
    """True jeśli supplier_catalog ma kolumny `unit` i `product_code`.
    Cache'ujemy tylko wynik pozytywny — dzięki temu po dodaniu kolumn (SQL) backend
    automatycznie zacznie ich używać bez restartu."""
    global _catalog_extra_cols
    if _catalog_extra_cols:
        return True
    try:
        await sb_get(client, "supplier_catalog", params={"select": "unit,product_code", "limit": "1"})
        _catalog_extra_cols = True
    except Exception:
        _catalog_extra_cols = False
        logger.warning("supplier_catalog: brak kolumn unit/product_code — zapisuję w trybie zgodności.")
    return bool(_catalog_extra_cols)


_catalog_visible_col: Optional[bool] = None


async def _has_catalog_visible(client: httpx.AsyncClient) -> bool:
    global _catalog_visible_col
    if _catalog_visible_col:
        return True
    try:
        await sb_get(client, "supplier_catalog", params={"select": "is_visible", "limit": "1"})
        _catalog_visible_col = True
    except Exception:
        _catalog_visible_col = False
    return bool(_catalog_visible_col)


async def _load_menu_lista_for_classification(client: httpx.AsyncClient) -> list[dict]:
    """LISTA_MENU: dania aktywne + kluczowe składniki z recipe_ingredients."""
    active_ids: Optional[set[str]] = None
    try:
        menu_rows = await sb_get(client, "menu_items", params={
            "select": "id,name,category",
            "is_active": "eq.true",
            "limit": "2000",
        }) or []
        active_ids = {r["id"] for r in menu_rows}
    except Exception:
        menu_rows = await sb_get(client, "menu_items", params={
            "select": "id,name,category", "limit": "2000",
        }) or []
        active_ids = None

    ri = []
    try:
        ri = await sb_get(client, "recipe_ingredients", params={
            "select": "menu_item_id,ingredient_name,quantity,unit",
            "limit": "30000",
        }) or []
    except Exception as e:
        logger.warning(f"_load_menu_lista: recipe_ingredients failed: {e}")

    by_menu: dict[str, list[dict]] = {}
    for r in ri:
        mid = r.get("menu_item_id")
        if not mid:
            continue
        if active_ids is not None and mid not in active_ids:
            continue
        name = (r.get("ingredient_name") or "").strip()
        if not name:
            continue
        by_menu.setdefault(mid, []).append({
            "name": name,
            "quantity": r.get("quantity"),
            "unit": r.get("unit") or "g",
        })

    out: list[dict] = []
    for m in menu_rows:
        ings = by_menu.get(m["id"], [])
        out.append({
            "danie": m.get("name") or "",
            "kategoria": m.get("category") or "",
            "skladniki": [i["name"] for i in ings],
            "skladniki_szczegoly": ings[:40],
        })
    return out


def _recipe_ingredient_keys(menu_lista: list[dict]) -> tuple[list[str], dict[str, str]]:
    """Zwraca (keys_norm, map norm→oryginał) wyłącznie ze składników receptur."""
    terms: dict[str, str] = {}
    for m in menu_lista:
        for s in (m.get("skladniki") or []):
            k = _norm_pl(s)
            if k:
                terms.setdefault(k, s)
    return list(terms.keys()), terms


async def _classify_offer_vs_menu_ai(
    menu_lista: list[dict],
    products: list[dict],
) -> dict[str, dict]:
    """Klasyfikacja produktów oferty vs MENU (tylko składniki dań — bez magazynu).

    Zwraca mapę: _norm_pl(nazwa) → {
      is_visible: bool, matched_to, matched_via, score, reason
    }
    """
    if not products:
        return {}

    # Kompaktowa LISTA_MENU (limit tokenów)
    menu_compact = []
    for m in menu_lista[:120]:
        ings = (m.get("skladniki") or [])[:25]
        menu_compact.append({
            "danie": m.get("danie"),
            "skladniki": ings,
        })

    prod_compact = []
    for p in products:
        name = (p.get("product_name") or "").strip()
        if not name:
            continue
        prod_compact.append({
            "nazwa": name,
            "cena": float(p.get("price_netto") or 0),
            "jednostka": (p.get("unit") or "").strip(),
        })

    if not prod_compact:
        return {}

    system = (
        "Jesteś precyzyjnym systemem kulinarno-magazynowym dla aplikacji Gastro Manager. "
        "Twój cel to przeanalizowanie listy produktów ze skanu oferty dostawcy i przypisanie "
        "ich do jednej z DWÓCH kategorii na podstawie aktualnego MENU restauracji.\n\n"
        "Otrzymujesz LISTA_MENU (dania + składniki z receptur) oraz PRODUKTY_DOSTAWCY.\n\n"
        "Kategoria wystepujace_w_menu:\n"
        "- Produkt MUSI być bezpośrednim, niezbędnym składnikiem do przygotowania przynajmniej "
        "jednego dania — nazwa musi odpowiadać wpisowi ze `skladniki` (np. burger wołowy → "
        "mięso mielone wołowe / bułki, JEŚLI te nazwy są na liście składników).\n"
        "- Jeśli danie NIE MA żadnych składników na liście, NIE zgaduj — idź do dodatkowe.\n"
        "- Bądź precyzyjny: baza dania lub kluczowy półprodukt → tu TYLKO gdy wynika ze składników.\n\n"
        "Kategoria dodatkowe:\n"
        "- WSZYSTKIE POZOSTAŁE produkty.\n"
        "- Jeśli produkt NIE jest bezpośrednio w recepturze/składzie dań.\n"
        "- Wątpliwości lub dopasowanie naciągane → dodatkowe "
        "(np. sok pomarańczowy ≠ świeża pomarańcza z herbaty zimowej).\n"
        "- Chemia, opakowania, kartony, produkty niezwiązane z menu → zawsze dodatkowe.\n\n"
        "BŁĄD DO UNIKNIĘCIA: Nie stosuj ogólnych skojarzeń. Fakt, że coś jest jedzeniem "
        "(np. makaron / kiełbasa śląska), nie oznacza, że występuje w menu, jeśli restauracja "
        "tego nie ma w `skladniki`!\n\n"
        "KAŻDY produkt z PRODUKTY_DOSTAWCY musi trafić DOKŁADNIE do jednej kategorii "
        "(preferuj dodatkowe przy wątpliwościach).\n\n"
        "Zwróć WYŁĄCZNIE czysty JSON:\n"
        '{"wystepujace_w_menu":[{"nazwa_dostawcy":"...","cena":0.0,"pasuje_do_dania":"...",'
        '"powod_dopasowania":"..."}],'
        '"dodatkowe":[{"nazwa_dostawcy":"...","cena":0.0}]}'
    )
    user = (
        f"LISTA_MENU ({len(menu_compact)} dań):\n{json.dumps(menu_compact, ensure_ascii=False)}\n\n"
        f"PRODUKTY_DOSTAWCY ({len(prod_compact)} poz.):\n{json.dumps(prod_compact, ensure_ascii=False)}"
    )

    result_map: dict[str, dict] = {}
    try:
        client = _openai()
        resp = await client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
        parsed = json.loads(raw) if raw else {}
        for item in (parsed.get("wystepujace_w_menu") or []):
            nazwa = (item.get("nazwa_dostawcy") or "").strip()
            if not nazwa:
                continue
            result_map[_norm_pl(nazwa)] = {
                "is_visible": True,
                "matched_via": "menu_ai",
                "matched_to": item.get("pasuje_do_dania") or "",
                "score": 95.0,
                "reason": item.get("powod_dopasowania") or "",
            }
        for item in (parsed.get("dodatkowe") or []):
            nazwa = (item.get("nazwa_dostawcy") or "").strip()
            if not nazwa:
                continue
            key = _norm_pl(nazwa)
            if key not in result_map:
                result_map[key] = {
                    "is_visible": False,
                    "matched_via": None,
                    "matched_to": None,
                    "score": 0.0,
                    "reason": "dodatkowe",
                }
    except Exception as e:
        logger.warning(f"_classify_offer_vs_menu_ai failed: {e}")
        return {}

    return result_map


async def _process_offer(client: httpx.AsyncClient, supplier_id: str, data: dict) -> dict:
    """Ścieżka 2: oferta handlowa → zapis do supplier_catalog.

    Widoczność (`is_visible` = „Występujące w menu”) wg precyzyjnej klasyfikacji
    względem MENU (dania + składniki receptur), NIE względem całego magazynu.
    Magazyn często zawiera produkty z ofert / onboarding — to NIE oznacza użycia w menu.
    """
    warnings: list[str] = []
    products = data.get("products") or []

    has_extra = await _has_catalog_extra_cols(client)
    has_visible = await _has_catalog_visible(client)

    # LISTA_MENU + klasyfikacja AI
    menu_lista = await _load_menu_lista_for_classification(client)
    recipe_keys, recipe_terms = _recipe_ingredient_keys(menu_lista)
    if products and not recipe_keys:
        warnings.append(
            "Brak składników w recepturach menu — wszystkie pozycje oferty trafią do „Dodatkowe”. "
            "Dodaj receptury w zakładce Menu (lub zaproponuj AI)."
        )
    # Bez receptur AI i tak wrzuci wszystko do „dodatkowe” — pomijamy kosztowny call.
    # Z recepturami: twardy timeout, żeby cały /documents/process mieścił się w ~20–40 s.
    ai_map: dict = {}
    if recipe_keys and products:
        try:
            ai_map = await asyncio.wait_for(
                _classify_offer_vs_menu_ai(menu_lista, products),
                timeout=18.0,
            )
        except asyncio.TimeoutError:
            logger.warning("_classify_offer_vs_menu_ai timed out — fuzzy fallback")
            ai_map = {}
            # Bez ostrzeżenia UI — fallback na receptury jest domyślną ścieżką.
        except Exception as e:
            logger.warning(f"_classify_offer_vs_menu_ai error: {e}")
            ai_map = {}
            # Bez ostrzeżenia UI — użytkownik i tak widzi wynik segregacji katalogu.

    # Fallback + weryfikacja AI: TYLKO składniki receptur (bez magazynu)
    RECIPE_VERIFY_THRESHOLD = 74
    RECIPE_FALLBACK_THRESHOLD = 78

    existing = await sb_get(client, "supplier_catalog",
                            params={"select": "id,name,sort_order", "supplier_id": f"eq.{supplier_id}"})
    by_name = {_norm(r["name"]): r for r in (existing or [])}
    max_sort = max((int(r.get("sort_order") or 0) for r in (existing or [])), default=0)

    visible_count = 0
    hidden_count = 0

    for p in products:
        name = (p.get("product_name") or "").strip()
        if not name:
            continue
        try:
            from product_name_validation import is_valid_product_name
            if not is_valid_product_name(name):
                warnings.append(f"Pominięto niepoprawną nazwę: {name!r}")
                continue
        except Exception:
            pass
        norm_key = _norm_pl(name)

        matched_via: Optional[str] = None
        matched_to: Optional[str] = None
        matched_score: float = 0.0
        reason = ""
        is_visible = False

        ai_hit = ai_map.get(norm_key)
        if ai_hit is None and ai_map:
            # Tylko ścisłe fuzzy po kluczach AI (bez substring „ser”∈„deser”)
            ak_hit, ak_score = _fuzzy_match_token_only(norm_key, list(ai_map.keys()), threshold=90)
            if ak_hit is not None:
                ai_hit = ai_map[ak_hit]
                matched_score = ak_score

        if ai_hit is not None and bool(ai_hit.get("is_visible")):
            # Bramka: AI może zaproponować „w menu” tylko jeśli produkt
            # pokrywa się ze składnikiem receptury (kiełbasa ≠ menu sushi).
            rec_hit, rec_score = _fuzzy_match_token_only(
                norm_key, recipe_keys, threshold=RECIPE_VERIFY_THRESHOLD
            )
            if rec_hit is not None:
                is_visible = True
                matched_via = "menu_ai+recipe"
                matched_to = ai_hit.get("matched_to") or recipe_terms.get(rec_hit, rec_hit)
                matched_score = max(float(ai_hit.get("score") or 0), rec_score)
                reason = ai_hit.get("reason") or ""
            else:
                is_visible = False
                matched_via = "menu_ai_rejected"
                matched_to = ai_hit.get("matched_to")
                reason = (
                    "AI wskazało menu, ale brak dopasowania do składników receptur — dodatkowe"
                )
        elif ai_hit is not None:
            is_visible = False
            matched_via = ai_hit.get("matched_via")
            reason = ai_hit.get("reason") or "dodatkowe"
        else:
            # Ścisły fallback: tylko receptury, bez partial_ratio
            rec_hit, rec_score = _fuzzy_match_token_only(
                norm_key, recipe_keys, threshold=RECIPE_FALLBACK_THRESHOLD
            )
            if rec_hit is not None:
                is_visible = True
                matched_via = "recipe_strict"
                matched_to = recipe_terms.get(rec_hit, rec_hit)
                matched_score = rec_score
            else:
                is_visible = False

        if is_visible:
            visible_count += 1
        else:
            hidden_count += 1

        price = float(p.get("price_netto") or 0)
        volume_label = (p.get("volume_label") or "").strip()
        unit = (p.get("unit") or "szt").strip()
        variant = volume_label
        if not variant and unit and unit.lower() not in ("szt", "szt.", "sztuki"):
            variant = unit
        if not variant:
            variant = name

        payload: dict = {
            "supplier_id": supplier_id, "name": name, "variant": variant,
            "volume_label": volume_label, "price_pln": price,
            "unit_count": 1, "liters_total": 0,
        }
        if has_extra:
            payload["unit"] = unit
            payload["product_code"] = (p.get("product_code") or None)
        if has_visible:
            payload["is_visible"] = is_visible

        match = by_name.get(_norm(name))
        try:
            if match:
                upd = {"price_pln": price, "variant": variant, "volume_label": volume_label}
                if has_extra:
                    upd["unit"] = unit
                    upd["product_code"] = (p.get("product_code") or None)
                if has_visible:
                    upd["is_visible"] = is_visible
                await sb_patch(client, "supplier_catalog", {"id": f"eq.{match['id']}"}, upd)
            else:
                max_sort += 1
                payload["sort_order"] = max_sort
                row = await sb_post(client, "supplier_catalog", payload)
                if row:
                    by_name[_norm(name)] = (row[0] if isinstance(row, list) else row)
        except httpx.HTTPStatusError as e:
            warnings.append(f"{name}: {e.response.text[:100]}")

    if not has_visible:
        warnings.append("Kolumna is_visible nie istnieje — wszystkie produkty widoczne (uruchom migrację SQL).")

    return {
        "products_total": len(products),
        "visible_count": visible_count,
        "hidden_count": hidden_count,
        "menu_dishes": len(menu_lista),
        "classification": "menu_ai" if ai_map else "recipe_strict_fallback",
        "warnings": warnings,
    }

__all__ = ['_catalog_extra_cols', '_catalog_visible_col', '_classify_offer_vs_menu_ai', '_has_catalog_extra_cols', '_has_catalog_visible', '_load_menu_lista_for_classification', '_process_offer', '_recipe_ingredient_keys']
