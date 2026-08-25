"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `orders_impl`."""
from __future__ import annotations

from deal_hunter_catalog import normalize_deal_hunter_search_scope as _normalize_deal_hunter_search_scope
from fastapi import HTTPException
from http_ssl import httpx_verify as _httpx_verify
from pl_fuzzy_norm import norm_pl as _norm_pl
from rapidfuzz import fuzz
from supabase_rest import sb_get
from typing import Optional
import httpx
from compare_merge import _filter_compare_to_requested_products, _sanitize_optimize_unique_products
from compare_offers_impl import compare_offers
from models import CompareItem, CompareOffersRequest, CriticalByCategoryRequest, CriticalOrderRequest, ExtraOrderItem
from orders_helpers import _category_syn_index, _dedupe_critical_products, _product_in_wanted_categories, _resolve_warehouse_categories



async def optimizer_critical_order(req: CriticalOrderRequest):
    """
    Łowca Okazji v2 — krytyczne braki → do 3 scenariuszy koszyka.
    Cache 2h po fingerprintcie listy krytycznej (soft).
    """
    from smart_basket_optimizer import cache_get, cache_set, fingerprint_critical, make_cache_key

    cats = req.categories or ["all"]
    det = await orders_critical_by_category(CriticalByCategoryRequest(
        categories=cats,
        restaurant_name=req.restaurant_name,
        skip_compare=True,
    ))
    critical = det.get("critical_products") or []
    if not critical:
        return {
            "ok": bool(det.get("ok", True)),
            "optimizer_version": 2,
            "message": det.get("message") or "Brak produktów krytycznych.",
            "critical_products": [],
            "matched_categories": det.get("matched_categories"),
            "unmatched_categories": det.get("unmatched_categories"),
            "compare": None,
            "from_cache": False,
        }

    crit_fp = fingerprint_critical(critical)
    scope = _normalize_deal_hunter_search_scope(req.search_scope)
    soft_key = make_cache_key(f"{crit_fp}|scope:{scope}", "soft")
    if not req.force_refresh:
        cached = cache_get(soft_key)
        if cached and cached.get("compare"):
            return cached

    compare_req = CompareOffersRequest(
        items=[
            CompareItem(
                product_name_or_id=c["name"],
                quantity=c["deficit"],
                unit=c["unit"],
                quantity_min=c.get("order_qty_min"),
                quantity_max=c.get("order_qty_max"),
            )
            for c in critical
        ],
        restaurant_name=req.restaurant_name,
        search_scope=scope,
    )
    try:
        compare_result = await compare_offers(compare_req)
    except HTTPException as e:
        return {
            "ok": False,
            "optimizer_version": 2,
            "message": f"Optymalizacja nieudana: {e.detail}",
            "critical_products": critical,
            "compare": None,
            "from_cache": False,
        }

    payload = {
        "ok": True,
        "optimizer_version": 2,
        "action": "critical_order",
        "matched_categories": det.get("matched_categories"),
        "unmatched_categories": det.get("unmatched_categories"),
        "critical_products": critical,
        "compare": compare_result,
        "is_multivariable": compare_result.get("is_multivariable"),
        "savings_amount": compare_result.get("savings_amount"),
        "message": (
            f"Przeliczono {len(critical)} krytycznych pozycji · "
            f"{'3 scenariusze' if compare_result.get('is_multivariable') else '1 optymalny koszyk'}."
        ),
        "from_cache": False,
    }
    cache_set(soft_key, payload)
    return payload


async def orders_critical_by_category(req: CriticalByCategoryRequest):
    """Zbiorcze zamówienie braków magazynowych z filtrem kategorii.

    Krok po kroku:
      1. Rozpoznaj żądane kategorie (`['all']` = wszystkie).
      2. Pobierz z `inventory_items` produkty krytyczne (quantity <= min_quantity).
      3. Filtruj po kategoriach (jeśli != ['all']).
      4. Wylicz deficyt: `deficit = min_quantity * (1 + safety_buffer_percent/100) - quantity`.
      5. Przekaż listę pozycji do `/api/orders/compare-offers` (algorytm Łowcy Okazji).
      6. Zwróć wynik + `matched_categories`, `critical_products`, `unmatched_categories`.
    """
    matched, unmatched = _resolve_warehouse_categories(req.categories or [])
    # Nazwane produkty z komendy (MIX: „ser kozi … i brakujące warzywa”)
    named_raw: list[dict] = []
    for it in (req.items or []):
        if isinstance(it, ExtraOrderItem):
            n = (it.product_name or "").strip()
            if not n:
                continue
            try:
                q = float(it.quantity) if it.quantity is not None else None
            except (TypeError, ValueError):
                q = None
            if q is not None and q <= 0:
                q = None
            named_raw.append({
                "name": n,
                "quantity": q,
                "unit": (it.unit or "szt").strip() or "szt",
                "unit_weight_volume": it.unit_weight_volume,
                "weight_volume_unit": it.weight_volume_unit,
            })
        elif isinstance(it, dict):
            n = str(it.get("product_name") or it.get("name") or "").strip()
            if not n:
                continue
            try:
                raw_q = it.get("quantity")
                q = float(raw_q) if raw_q is not None and raw_q != "" else None
            except (TypeError, ValueError):
                q = None
            if q is not None and q <= 0:
                q = None
            try:
                raw_uwv = it.get("unit_weight_volume")
                uwv = float(raw_uwv) if raw_uwv is not None and raw_uwv != "" else None
            except (TypeError, ValueError):
                uwv = None
            named_raw.append({
                "name": n,
                "quantity": q,
                "unit": str(it.get("unit") or "szt").strip() or "szt",
                "unit_weight_volume": uwv,
                "weight_volume_unit": (str(it.get("weight_volume_unit") or "").strip() or None),
            })

    # LLM często wrzuca nazwę produktu do categories[] („ser kozi”).
    # Nierozpoznane „kategorie” → traktuj jako nazwiane produkty, NIE jako „all”.
    if unmatched:
        already = {_norm_pl(x["name"]) for x in named_raw}
        kept_unmatched: list[str] = []
        for u in unmatched:
            uk = _norm_pl(u)
            if not uk or uk in already:
                continue
            # Krótkie / ogólne tokeny zostaw jako unmatched (nie produkt)
            if uk in {"inne", "all", "wszystko", "braki"}:
                kept_unmatched.append(u)
                continue
            named_raw.append({"name": u.strip(), "quantity": None, "unit": "szt",
                              "unit_weight_volume": None, "weight_volume_unit": None})
            already.add(uk)
        unmatched = kept_unmatched

    if not matched and not named_raw:
        return {
            "ok": False,
            "action": "order_critical_items_by_category",
            "matched_categories": [],
            "unmatched_categories": unmatched,
            "critical_products": [],
            "named_products": [],
            "compare": None,
            "message": ("Nie rozpoznano kategorii ani produktów. Powiedz np. "
                        "'zamów wszystkie braki', 'zamów mięso i nabiał', "
                        "lub 'zamów ser kozi i brakujące warzywa'."),
        }

    named_added: list[dict] = []
    critical: list[dict] = []
    category_total = 0
    want_all = matched == ["all"]

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        # Pobierz magazyn wraz z powiązaną kategorią — TYLKO aktywne (is_active).
        inv_all: list[dict] = []
        base_sel = (
            "id,name,quantity,unit,min_quantity,optimal_quantity,safety_buffer_percent,"
            "unit_weight_volume,weight_volume_unit,is_active,"
            "category_id,inventory_categories(name)"
        )
        try:
            inv_all = await sb_get(
                client, "inventory_items",
                params={
                    "select": base_sel,
                    "is_active": "eq.true",
                    "limit": "5000",
                },
            ) or []
        except httpx.HTTPStatusError as e:
            # Fallback: bez optimal_quantity / safety_buffer / joina / gramatury / is_active
            text = (e.response.text if e.response is not None else "") or ""
            if "is_active" in text:
                try:
                    inv_all = await sb_get(
                        client, "inventory_items",
                        params={
                            "select": base_sel.replace("is_active,", ""),
                            "limit": "5000",
                        },
                    ) or []
                except httpx.HTTPStatusError:
                    inv_all = []
            if "unit_weight_volume" in text or "weight_volume_unit" in text:
                try:
                    inv_all = await sb_get(
                        client, "inventory_items",
                        params={
                            "select": ("id,name,quantity,unit,min_quantity,optimal_quantity,safety_buffer_percent,"
                                       "is_active,category_id,inventory_categories(name)"),
                            "is_active": "eq.true",
                            "limit": "5000",
                        },
                    ) or []
                except httpx.HTTPStatusError:
                    inv_all = []
            if not inv_all and "optimal_quantity" in text:
                try:
                    inv_all = await sb_get(
                        client, "inventory_items",
                        params={
                            "select": ("id,name,quantity,unit,min_quantity,safety_buffer_percent,"
                                       "is_active,category_id,inventory_categories(name)"),
                            "is_active": "eq.true",
                            "limit": "5000",
                        },
                    ) or []
                except httpx.HTTPStatusError:
                    inv_all = []
            if not inv_all:
                inv_all = await sb_get(
                    client, "inventory_items",
                    params={"select": "id,name,quantity,unit,min_quantity,category_id",
                            "limit": "5000"},
                ) or []
                cat_rows = await sb_get(client, "inventory_categories",
                                        params={"select": "id,name", "limit": "500"}) or []
                cat_by_id = {c["id"]: c.get("name") for c in cat_rows}
                for r in inv_all:
                    r["inventory_categories"] = {"name": cat_by_id.get(r.get("category_id"))}
        # Twardy filtr po stronie (gdy kolumna jest, a filtr query nie zadziałał)
        inv_all = [r for r in inv_all if r.get("is_active") is not False]

        want_all = matched == ["all"]
        target_mode = (req.stock_target or "critical").strip().lower()
        if target_mode not in ("critical", "optimal"):
            target_mode = "critical"

        # Dowolna kategoria z magazynu użytkownika (nie tylko sztywne WAREHOUSE_CATEGORIES).
        # FE wysyła nazwy z inventory_categories — mapuj 1:1 po norm + synonimach.
        wanted_ids: set[str] = set()
        raw_cat_norms = {
            _norm_pl(x) for x in (req.categories or [])
            if isinstance(x, str) and x.strip() and x.strip().lower() != "all"
        }
        try:
            cat_rows = await sb_get(
                client, "inventory_categories",
                params={"select": "id,name", "limit": "500"},
            ) or []
        except Exception:
            cat_rows = []
        user_cat_by_norm = {
            _norm_pl((c.get("name") or "").strip()): c
            for c in cat_rows
            if (c.get("name") or "").strip()
        }

        # Nierozpoznane przez synonimy, ale istniejące w magazynie użytkownika → matched
        if not want_all:
            still_unmatched: list[str] = []
            for u in unmatched:
                uk = _norm_pl(u)
                hit = user_cat_by_norm.get(uk)
                if hit:
                    cname = (hit.get("name") or "").strip()
                    if cname and cname not in matched:
                        matched.append(cname)
                else:
                    still_unmatched.append(u)
            unmatched = still_unmatched
            # Surowy wybór z FE (nazwa pilla) też musi trafić do matched
            for rn in raw_cat_norms:
                hit = user_cat_by_norm.get(rn)
                if not hit:
                    continue
                cname = (hit.get("name") or "").strip()
                if cname and cname not in matched:
                    matched.append(cname)

        wanted_set = {_norm_pl(x) for x in matched} if matched and not want_all else set()
        # Dołącz też surowe normy z FE (gdy FE wysłał dokładną nazwę z DB)
        if not want_all:
            wanted_set |= raw_cat_norms

        if matched and not want_all:
            for cr in cat_rows:
                cname = (cr.get("name") or "").strip()
                if not cname:
                    continue
                cn = _norm_pl(cname)
                if cn in wanted_set or cn in raw_cat_norms:
                    wanted_ids.add(str(cr["id"]))
                    continue
                resolved, _ = _resolve_warehouse_categories([cname])
                if any(_norm_pl(r) in wanted_set for r in resolved if r != "all"):
                    wanted_ids.add(str(cr["id"]))

        # Nazwy kategorii NIE mogą zostać „produktami nazwanymi” (to wciągało warzywa).
        if not want_all:
            syn_idx = _category_syn_index()
            cat_block = set(wanted_set) | set(raw_cat_norms) | {_norm_pl(m) for m in matched}
            named_raw = [
                n for n in named_raw
                if _norm_pl(n.get("name") or "") not in cat_block
                and _norm_pl(n.get("name") or "") not in syn_idx
            ]

        # Ile produktów jest w wybranych kategoriach (mianownik do X/Y)
        category_total = 0
        critical = []
        # Braki z kategorii — pomiń skan gdy brak categories (tylko named items)
        if matched:
            # Stabilna kolejność skanu magazynu
            inv_all_sorted = sorted(
                inv_all,
                key=lambda r: (_norm_pl((r.get("name") or "").strip()), str(r.get("id") or "")),
            )
            for r in inv_all_sorted:
                name = (r.get("name") or "").strip()
                if not name or "(dup)" in name.lower():
                    continue
                if r.get("is_active") is False:
                    continue
                try:
                    qty = float(r.get("quantity") or 0)
                    minq = float(r.get("min_quantity") or 0)
                except (TypeError, ValueError):
                    continue
                cat_obj = r.get("inventory_categories") or {}
                cat_name = (cat_obj.get("name") if isinstance(cat_obj, dict) else None) or ""
                # FE: brak category_id → wyświetla „Inne” (mapDbRow). Backend musi robić to samo.
                effective_cat = (cat_name or "").strip() or "Inne"
                if not want_all:
                    if not _product_in_wanted_categories(
                        effective_cat,
                        r.get("category_id"),
                        wanted_set,
                        wanted_ids,
                    ):
                        continue
                category_total += 1
                buf_pct = float(r.get("safety_buffer_percent") or 20.0)
                try:
                    opt_user = float(r.get("optimal_quantity") or 0)
                except (TypeError, ValueError):
                    opt_user = 0.0
                if opt_user > 0:
                    optimal = opt_user
                elif minq > 0:
                    optimal = minq * (1.0 + buf_pct / 100.0)
                else:
                    optimal = 0.0

                if target_mode == "critical":
                    # Brak: poniżej min (gdy ustawione) ALBO stan < 1 gdy brak progu
                    if minq > 0:
                        is_short = qty <= minq
                    else:
                        is_short = qty < 1.0
                    if not is_short:
                        continue
                    if optimal <= 0:
                        optimal = max(minq, 1.0)
                else:
                    # optimal: wszystko poniżej progu; pusty stan bez progu → zamów 1
                    if optimal <= 0:
                        if qty > 0:
                            continue
                        optimal = 1.0
                    if qty >= optimal:
                        continue

                deficit = max(0.0, round(optimal - qty, 4))
                if deficit <= 0:
                    if qty <= 0:
                        deficit = max(1.0, optimal or 1.0)
                    else:
                        continue
                qty_lo = round(deficit * 0.9, 4)
                qty_hi = round(deficit * 1.1, 4)
                critical.append({
                    "id": r["id"],
                    "name": name,
                    "unit": r.get("unit") or "szt",
                    "current_quantity": qty,
                    "min_quantity": minq,
                    "safety_buffer_percent": buf_pct,
                    "optimal_quantity": round(optimal, 4),
                    "deficit": deficit,
                    "order_qty_min": qty_lo,
                    "order_qty_max": qty_hi,
                    "category": effective_cat,
                    "category_id": r.get("category_id"),
                    "source": "category_shortage",
                    "unit_weight_volume": r.get("unit_weight_volume"),
                    "weight_volume_unit": r.get("weight_volume_unit"),
                })

        # MIX: dorzuć nazwiane produkty (ser kozi, filet…) — dedupe po nazwie
        named_added = []
        seen = {_norm_pl(c["name"]) for c in critical}
        inv_by_norm = {
            _norm_pl((r.get("name") or "").strip()): r
            for r in inv_all
            if (r.get("name") or "").strip()
        }
        for nr in named_raw:
            key = _norm_pl(nr["name"])
            # Fuzzy match do magazynu (lepsza nazwa / jednostka)
            hit = inv_by_norm.get(key)
            if not hit:
                best_score, best_row = 0.0, None
                for nk, row in inv_by_norm.items():
                    sc = float(fuzz.token_set_ratio(key, nk))
                    if sc > best_score:
                        best_score, best_row = sc, row
                if best_row and best_score >= 78:
                    hit = best_row
            display_name = (hit.get("name") if hit else nr["name"]).strip()
            unit = (hit.get("unit") if hit else None) or nr["unit"]
            qty_order = nr.get("quantity")
            # Brak jawnej ilości + produkt w magazynie → dopełnij do stanu optymalnego
            if hit is not None and qty_order is None:
                try:
                    cur = float(hit.get("quantity") or 0)
                    minq = float(hit.get("min_quantity") or 0)
                except (TypeError, ValueError):
                    cur, minq = 0.0, 0.0
                buf_pct = float(hit.get("safety_buffer_percent") or 20.0)
                try:
                    opt_user = float(hit.get("optimal_quantity") or 0)
                except (TypeError, ValueError):
                    opt_user = 0.0
                if opt_user > 0:
                    optimal = opt_user
                elif minq > 0:
                    optimal = minq * (1.0 + buf_pct / 100.0)
                else:
                    optimal = 1.0
                qty_order = max(0.0, round(optimal - cur, 4))
            if qty_order is None:
                qty_order = 1.0
            qty_order = float(qty_order)
            if qty_order <= 0:
                # Już na optymalnym — nie dodawaj pustej pozycji
                continue
            nkey = _norm_pl(display_name)
            if nkey in seen:
                # Już w brakach kategorii — podnieś qty do max(deficit, żądane)
                for c in critical:
                    if _norm_pl(c["name"]) == nkey:
                        if qty_order > float(c.get("deficit") or 0):
                            c["deficit"] = qty_order
                            c["order_qty_min"] = round(qty_order * 0.9, 4)
                            c["order_qty_max"] = round(qty_order * 1.1, 4)
                        c["source"] = "named+category"
                        named_added.append(c)
                        break
                continue
            seen.add(nkey)
            entry = {
                "id": (hit or {}).get("id"),
                "name": display_name,
                "unit": unit or "szt",
                "current_quantity": float((hit or {}).get("quantity") or 0) if hit else None,
                "min_quantity": float((hit or {}).get("min_quantity") or 0) if hit else None,
                "deficit": qty_order,
                "order_qty_min": round(qty_order * 0.9, 4),
                "order_qty_max": round(qty_order * 1.1, 4),
                "category": (
                    ((hit.get("inventory_categories") or {}) if hit else {}).get("name")
                    if hit else None
                ) or "—",
                "source": "named",
                "unit_weight_volume": (
                    nr.get("unit_weight_volume")
                    if nr.get("unit_weight_volume") is not None
                    else (hit or {}).get("unit_weight_volume")
                ),
                "weight_volume_unit": (
                    nr.get("weight_volume_unit")
                    or (hit or {}).get("weight_volume_unit")
                ),
            }
            critical.append(entry)
            named_added.append(entry)

        # Twarda bramka zakresu: braki z kategorii NIE mogą wypłynąć poza matched
        if matched and not want_all:
            kept: list[dict] = []
            for c in critical:
                src = str(c.get("source") or "")
                if src in ("named", "named+category"):
                    kept.append(c)
                    continue
                if _product_in_wanted_categories(
                    str(c.get("category") or "Inne"),
                    c.get("category_id"),
                    wanted_set,
                    wanted_ids,
                ):
                    kept.append(c)
            critical = kept

        critical = _dedupe_critical_products(critical)

        # Deterministyczna kolejność (powtarzalność koszyka)
        critical.sort(key=lambda c: (_norm_pl(c.get("name") or ""), str(c.get("id") or "")))

        if not critical:
            return {
                "ok": True,
                "action": "order_critical_items_by_category",
                "matched_categories": matched,
                "unmatched_categories": unmatched,
                "category_total": category_total,
                "critical_products": [],
                "named_products": [],
                "compare": None,
                "message": (
                    f"Brak produktów do zamówienia w kategoriach: {', '.join(matched)} "
                    f"(w kategorii: {category_total} pozycji)."
                    if matched and not want_all else
                    "Nie znaleziono braków w magazynie."
                    if matched else
                    "Nie udało się dodać nazwanych produktów do koszyka."
                ),
            }

    if req.skip_compare:
        return {
            "ok": True,
            "action": "order_critical_items_by_category",
            "matched_categories": matched,
            "unmatched_categories": unmatched,
            "category_total": category_total,
            "critical_products": critical,
            "named_products": named_added,
            "critical_count": len(critical),
            "compare": None,
            "message": (
                f"Znaleziono {len(critical)} pozycji do zamówienia "
                f"(w kategorii łącznie {category_total} pozycji)."
            ),
        }

    # Wywołaj Łowcę Okazji na wyliczonym koszyku (własny async client w środku).
    compare_req = CompareOffersRequest(
        items=[
            CompareItem(
                product_name_or_id=c["name"],
                quantity=c["deficit"],
                unit=c["unit"],
                quantity_min=c.get("order_qty_min"),
                quantity_max=c.get("order_qty_max"),
                unit_weight_volume=c.get("unit_weight_volume"),
                weight_volume_unit=c.get("weight_volume_unit"),
            )
            for c in critical
        ],
        restaurant_name=req.restaurant_name,
        cart_objective=req.cart_objective,
        search_scope=req.search_scope,
    )
    compare_result: Optional[dict] = None
    compare_error: Optional[str] = None
    try:
        compare_result = await compare_offers(compare_req)
    except HTTPException as e:
        compare_error = f"compare-offers HTTP {e.status_code}: {e.detail}"
    except Exception as e:  # noqa: BLE001
        compare_error = f"compare-offers: {str(e)[:120]}"

    found_in_offers = 0
    not_found_names: list[str] = []
    if isinstance(compare_result, dict):
        # Twarda bramka: koszyki dostawców TYLKO z zamówionych braków (bez warzyw „znikąd”)
        allowed_names = [str(c.get("name") or "").strip() for c in critical if c.get("name")]
        compare_result = _filter_compare_to_requested_products(compare_result, allowed_names)
        compare_result = _sanitize_optimize_unique_products(compare_result)

        req_items = compare_result.get("items_requested") or []
        found_in_offers = sum(1 for it in req_items if it.get("found"))
        not_found_names = [
            str(it.get("product_name") or "").strip()
            for it in req_items
            if not it.get("found") and str(it.get("product_name") or "").strip()
        ]
        # Metadane zakresu — FE Łowca pokazuje rozpiskę (nie panel Jarvisa)
        compare_result["scope_categories"] = matched
        compare_result["scope_products"] = [
            {
                "name": c.get("name"),
                "category": c.get("category"),
                "quantity": c.get("deficit"),
                "unit": c.get("unit"),
                "source": c.get("source"),
            }
            for c in critical
        ]
        compare_result["scope_summary"] = (
            f"Zakres: {', '.join(matched) if matched and not want_all else 'wszystkie kategorie'}"
            f" · {len(critical)} poz. do zamówienia"
            f" · w ofertach {found_in_offers}/{len(critical) if critical else 0}."
        )
        if not_found_names:
            speech = (compare_result.get("assistant_speech") or "").strip()
            listed = ", ".join(not_found_names[:12])
            if len(not_found_names) > 12:
                listed += "…"
            miss_msg = (
                f"W ofertach dostawców nie znaleziono {len(not_found_names)} "
                f"z {len(req_items)} zamówionych produktów: {listed}."
            )
            compare_result["assistant_speech"] = f"{speech} {miss_msg}".strip() if speech else miss_msg
            compare_result["not_found_products"] = not_found_names
            compare_result["not_found_count"] = len(not_found_names)

    # Krótki komunikat do panelu Jarvisa — bez listy nazw produktów.
    # Pełna rozpiska found/missing jest w compare → Deal Hunter (scope_*).
    denom = len(critical) if critical else 0
    named_n = sum(1 for c in critical if c.get("source") in ("named", "named+category"))
    msg_parts = [
        f"Otworzono Łowcę Okazji · {len(critical)} pozycji"
        + (f" · {', '.join(matched)}" if matched and not want_all else
           " · wszystkie kategorie" if matched else "")
        + (f" · w tym {named_n} nazwanych" if named_n else "")
        + "."
    ]
    if denom > 0:
        msg_parts.append(
            f"W ofertach: {found_in_offers}/{denom}."
            " Szczegóły pozycji są w Łowcy Okazji."
        )
    if unmatched:
        msg_parts.append(f"Nierozpoznane kategorie: {', '.join(unmatched)}.")
    if compare_error:
        msg_parts.append(compare_error)

    return {
        "ok": True,
        "action": "order_critical_items_by_category",
        "matched_categories": matched,
        "unmatched_categories": unmatched,
        "category_total": category_total,
        "critical_products": critical,
        "named_products": [c for c in critical if c.get("source") in ("named", "named+category")],
        "critical_count": len(critical),
        "found_in_offers_count": found_in_offers,
        "not_found_count": len(not_found_names),
        "not_found_products": not_found_names,
        "compare": compare_result,
        "message": " ".join(msg_parts),
    }

__all__ = ['optimizer_critical_order', 'orders_critical_by_category']
