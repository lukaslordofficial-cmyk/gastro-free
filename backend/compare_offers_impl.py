"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `compare_offers_impl`."""
from __future__ import annotations

from deal_hunter_catalog import load_catalog_for_search_scope as _load_catalog_for_search_scope
from fastapi import HTTPException
from http_ssl import httpx_verify as _httpx_verify
from pl_fuzzy_norm import food_match_key as _food_match_key
from pl_fuzzy_norm import norm_pl as _norm_pl
from rapidfuzz import fuzz
from supabase_rest import sb_get
from token_billing import merge_billing_events
import httpx
import uuid
from app_core import logger
from catalog_units import _cap_order_qty_to_available_stock, _catalog_available_base_qty, _catalog_base_price, _catalog_pack_base_qty, _convert_req_to_catalog_dim, _pack_mismatch_note, _qty_in_band
from compare_ai import _ai_catalog_agent_match, _load_supplier_reliability_scores, _persist_synonyms
from compare_merge import _merge_duplicate_compare_items, _sanitize_optimize_unique_products
from constants import AI_CATALOG_CANDIDATE_MIN, AI_CATALOG_MAX_CANDIDATES, AI_CATALOG_MAX_ITEM_CALLS, AI_MAX_CHECKS, AI_SYNONYM_CONF_MIN, AI_SYNONYM_SIM_MIN
from deal_hunter_signals import _enrich_deal_hunter_ai_tips, _load_deal_hunter_kitchen_signals
from matching_utils import _food_names_compatible, _local_catalog_match_score, _norm_unit, _resolve_by_fuzzy, _strict_local_catalog_accept
from models import CompareOffersRequest
from subscription_core import _check_ai_access
from supplier_meta import _has_inventory_synonyms
from variant_matching import (
    base_matches_offer,
    classify_offer,
    offer_variant_label,
)


def _build_variant_report(
    product_name: str,
    requested_variant: str,
    base_name: str,
    base_offers: list[dict],
    exact_found: bool,
    sup_by_id: dict,
) -> dict:
    """Raport odmiany: exact vs zamienniki (inne odmiany tego samego produktu)."""
    subs: dict[str, dict] = {}
    for c in base_offers:
        row = c["row"]
        name = row.get("name") or ""
        if classify_offer(requested_variant, base_name, name) != "substitute":
            continue
        sid = row.get("supplier_id")
        if not sid:
            continue
        label = offer_variant_label(base_name, name) or "inna odmiana"
        sup = sup_by_id.get(str(sid)) or sup_by_id.get(sid) or {}
        entry = {
            "supplier_id": str(sid),
            "supplier_name": (sup.get("name") or "").strip() or "Dostawca",
            "supplier_email": sup.get("email"),
            "unit_price_base": round(float(c["price_base"]), 2),
            "base_dim": c["base_dim"],
            "unit": (row.get("unit") or c["base_dim"]),
            "matched_name": name,
            "matched_variant": row.get("variant"),
            "catalog_product_id": str(row.get("producer_product_id") or row.get("id") or ""),
            "order_base_qty": round(float(c.get("order_base") or 0), 4),
        }
        if row.get("is_local_producer") or row.get("source") == "local_producer":
            entry["is_local_producer"] = True
        group = subs.setdefault(label, {})
        prev = group.get(str(sid))
        if prev is None or entry["unit_price_base"] < prev["unit_price_base"]:
            group[str(sid)] = entry

    substitutes: list[dict] = []
    for label, by_sid in subs.items():
        offers = sorted(by_sid.values(), key=lambda e: e["unit_price_base"])
        substitutes.append({
            "variant_label": label,
            "offer_count": len(offers),
            "min_unit_price_base": offers[0]["unit_price_base"] if offers else 0.0,
            "base_dim": offers[0]["base_dim"] if offers else "",
            "offers": offers,
        })
    substitutes.sort(key=lambda s: s["min_unit_price_base"])

    return {
        "product_name": product_name,
        "base_name": base_name,
        "requested_variant": requested_variant,
        "exact_found": bool(exact_found),
        "substitute_variant_count": len(substitutes),
        "substitutes": substitutes,
    }



async def compare_offers(req: CompareOffersRequest):
    if not req.items:
        raise HTTPException(status_code=400, detail="Brak pozycji do porównania.")

    request_id = str(uuid.uuid4())
    per_item = []

    async with httpx.AsyncClient(timeout=90.0, verify=_httpx_verify()) as client:
        await _check_ai_access(client, needs_credits=True, needs_deal_hunter=True)
        catalog, suppliers, search_scope = await _load_catalog_for_search_scope(
            client, req.search_scope,
        )
        lp_suppliers = [s for s in suppliers if s.get("is_local_producer")]
        wholesaler_suppliers = [s for s in suppliers if not s.get("is_local_producer")]
        # Twarda bramka zakresu — nigdy nie mieszaj hurtowników przy „tylko lokalni”
        # i odwrotnie (obrona przed regresją / złym cache).
        if search_scope == "local_producers_only":
            suppliers = list(lp_suppliers)
            catalog = [
                r for r in catalog
                if r.get("is_local_producer") or r.get("source") == "local_producer"
            ]
        elif search_scope == "suppliers_only":
            suppliers = list(wholesaler_suppliers)
            catalog = [
                r for r in catalog
                if not (r.get("is_local_producer") or r.get("source") == "local_producer")
            ]
        sup_by_id = {str(s["id"]): s for s in suppliers if s.get("id")}

        if search_scope == "local_producers_only" and not catalog:
            return {
                "ok": True,
                "optimizer_version": 2,
                "search_scope": search_scope,
                "includes_local_producers": False,
                "items_requested": [
                    {
                        "product_name": it.product_name_or_id,
                        "quantity": it.quantity,
                        "unit": it.unit,
                        "found": False,
                    }
                    for it in req.items
                ],
                "best_option": None,
                "option_optimized": {"suppliers": [], "total_pln": 0},
                "scenarios": [],
                "assistant_speech": (
                    "Brak ofert u lokalnych dostawców (Lokalni Przetwórcy). "
                    "Sprawdź, czy dystrybutorzy są active/verified/approved "
                    "i mają Stripe Connect, oraz czy produkty mają stan > 0."
                ),
                "message": (
                    "Nie znaleziono katalogu lokalnych dostawców dla wybranego zakresu."
                ),
            }

        # Magazyn (nazwa + synonimy + gramatura 1 szt.) — natychmiastowe dopasowanie bez AI.
        has_syn = await _has_inventory_synonyms(client)
        inv_select = (
            "id,name,synonyms,unit,unit_weight_volume,weight_volume_unit"
            if has_syn else
            "id,name,unit,unit_weight_volume,weight_volume_unit"
        )
        try:
            inv_rows = await sb_get(client, "inventory_items",
                                    params={
                                        "select": inv_select + ",is_active",
                                        "is_active": "eq.true",
                                        "limit": "2000",
                                    }) or []
        except httpx.HTTPStatusError as e:
            text = (e.response.text if e.response is not None else "") or ""
            if "is_active" in text:
                inv_rows = await sb_get(client, "inventory_items",
                                        params={"select": inv_select, "limit": "2000"}) or []
            elif "unit_weight_volume" in text or "weight_volume_unit" in text:
                inv_select = "id,name,synonyms" if has_syn else "id,name"
                try:
                    inv_rows = await sb_get(client, "inventory_items",
                                            params={
                                                "select": inv_select + ",is_active",
                                                "is_active": "eq.true",
                                                "limit": "2000",
                                            }) or []
                except httpx.HTTPStatusError:
                    inv_rows = await sb_get(client, "inventory_items",
                                            params={"select": inv_select, "limit": "2000"}) or []
            else:
                raise
        inv_rows = [r for r in inv_rows if r.get("is_active") is not False]

        # Odmiana/wariant produktu z magazynu (opcjonalne, fail-soft gdy brak kolumny).
        # Pozwala honorować preferencję odmiany także w ścieżkach bez `variant`
        # w requeście (voice / krytyczne braki).
        inv_variant_by_id: dict = {}
        try:
            vrows = await sb_get(client, "inventory_items", params={
                "select": "id,variant", "limit": "2000",
            }) or []
            inv_variant_by_id = {
                str(r["id"]): (r.get("variant") or "").strip()
                for r in vrows if r.get("id") and (r.get("variant") or "").strip()
            }
        except Exception:
            inv_variant_by_id = {}

        ai_item_budget = AI_CATALOG_MAX_ITEM_CALLS  # agent katalogowy (1 call / pozycja)
        ai_budget = AI_MAX_CHECKS  # legacy pairwise fallback
        synonym_additions: dict = {}   # inv_id -> {"existing": [...], "new": set()}
        billing_events: list[dict] = []
        pack_notes: list[str] = []
        variant_reports: list[dict] = []

        def _consider(bbs: dict, row: dict, price_base: float, base_dim: str,
                      order_base_qty: float, target_base_qty: float, via: str,
                      pack_base_qty: float = 0.0, band_hi_base: float = 0.0,
                      stock_capped: bool = False) -> None:
            sid = row.get("supplier_id")
            if not sid:
                return
            # Lokalny dostawca: nigdy nie zamawiaj więcej niż ma na stanie
            capped_qty, did_cap = _cap_order_qty_to_available_stock(
                order_base_qty, pack_base_qty, row, base_dim,
            )
            if capped_qty <= 0:
                return
            stock_capped = bool(stock_capped or did_cap)
            order_base_qty = capped_qty
            line_total = round(price_base * order_base_qty, 2)
            prev = bbs.get(sid)
            # Tańsza linia wygrywa; przy remisie — ilość bliżej targetu
            better = False
            if prev is None:
                better = True
            elif line_total < prev["line_total"] - 1e-9:
                better = True
            elif abs(line_total - prev["line_total"]) < 1e-9:
                if abs(order_base_qty - target_base_qty) < abs(
                    float(prev.get("order_base_qty") or 0) - target_base_qty
                ):
                    better = True
            if better:
                sup = sup_by_id.get(sid, {})
                is_lp = bool(
                    row.get("is_local_producer")
                    or sup.get("is_local_producer")
                    or row.get("source") == "local_producer"
                    or sup.get("source") == "local_producer"
                )
                entry = {
                    "supplier_id": sid,
                    "supplier_name": (sup.get("name") or "").strip() or "Dostawca",
                    "supplier_email": sup.get("email"),
                    "matched_name": row.get("name"),
                    "matched_variant": row.get("variant"),
                    "unit_price_base": round(price_base, 2),
                    "base_dim": base_dim,
                    "line_total": line_total,
                    "matched_via": via,
                    "order_base_qty": round(order_base_qty, 4),
                    "target_base_qty": round(target_base_qty, 4),
                    "pack_base_qty": round(float(pack_base_qty or 0), 4),
                    "band_hi_base": round(float(band_hi_base or 0), 4),
                }
                if stock_capped:
                    entry["stock_capped"] = True
                    avail = _catalog_available_base_qty(row, base_dim)
                    if avail is not None:
                        entry["available_stock_base"] = round(float(avail), 4)
                if is_lp:
                    entry["is_local_producer"] = True
                    if row.get("producer_product_id") or row.get("id"):
                        entry["catalog_product_id"] = str(
                            row.get("producer_product_id") or row.get("id")
                        )
                    try:
                        wg = float(row.get("weight_g") or 0)
                        if wg > 0:
                            entry["weight_g"] = wg
                    except (TypeError, ValueError):
                        pass
                bbs[sid] = entry

        for it in req.items:
            req_dim, req_factor = _norm_unit(it.unit)
            req_base_qty = float(it.quantity) * req_factor
            qty_lo_base = (
                float(it.quantity_min) * req_factor
                if it.quantity_min is not None else req_base_qty * 0.9
            )
            qty_hi_base = (
                float(it.quantity_max) * req_factor
                if it.quantity_max is not None else req_base_qty * 1.1
            )
            if qty_hi_base < qty_lo_base:
                qty_lo_base, qty_hi_base = qty_hi_base, qty_lo_base

            # Rozpoznaj produkt w magazynie → id + istniejące synonimy + gramatura 1 szt.
            inv_row, _ = _resolve_by_fuzzy(it.product_name_or_id, inv_rows, threshold=70)
            inv_id = inv_row.get("id") if inv_row else None
            existing_syn = list(inv_row.get("synonyms") or []) if inv_row else []
            # Preferuj gramaturę z requestu (UI „gramatura 1 sztuki”), potem magazyn
            uwv = it.unit_weight_volume
            if uwv is None:
                uwv = (inv_row or {}).get("unit_weight_volume")
            wvu = it.weight_volume_unit
            if not wvu:
                wvu = (inv_row or {}).get("weight_volume_unit")
            # Primary = nazwa z zamówienia (+ ewentualnie kanoniczna z magazynu).
            # Synonimy pomagają score'ować, ale NIE otwierają auto-accept bez zgodności z primary.
            primary_names = [it.product_name_or_id]
            if inv_row and inv_row.get("name"):
                primary_names.append(inv_row.get("name"))
            primary_names = [n for n in primary_names if n and str(n).strip()]
            known_names = list(primary_names)
            known_names.extend(existing_syn)
            known_names = [n for n in known_names if n]
            known_norm = [_norm_pl(n) for n in known_names]
            warehouse_name = (inv_row.get("name") if inv_row else None) or it.product_name_or_id

            # Odmiana/wariant preferowany przez restauratora (opcjonalny).
            # Priorytet: request → magazyn. Gdy pusty, zachowanie jak dotychczas.
            it_variant = (getattr(it, "variant", None) or "").strip()
            if not it_variant and inv_id:
                it_variant = inv_variant_by_id.get(str(inv_id), "")
            variant_base_name = warehouse_name
            base_offers: list[dict] = []  # tylko dla pozycji z odmianą

            best_by_supplier: dict[str, dict] = {}
            # Pula do agenta AI: realne wiersze katalogu (nie wymyślone)
            ai_pool: list[tuple] = []  # (score, row, base_dim, price_base, order_base, pack, target, hi)
            item_pack_adjusted = False
            match_dim_used = req_dim
            match_target_base = req_base_qty
            accepted_catalog_ids: set[str] = set()

            for row in catalog:
                # is_visible = „występuje w recepturach menu” — NIE „dostępny u dostawcy”.
                # Zamówienia braków muszą szukać w CAŁYM katalogu (W menu + poza menu).
                row_name = row.get("name", "")
                bp = _catalog_base_price(row)
                if bp is None:
                    continue
                base_dim, price_base = bp
                # Ten sam wymiar LUB konwersja przez gramaturę 1 szt. (magazyn szt ↔ oferta kg/g)
                target_in_dim = _convert_req_to_catalog_dim(
                    req_base_qty, req_dim, base_dim, uwv, wvu,
                )
                # Brak przeliczenia jednostek NIE blokuje matchingu nazw
                # (warzywa kg↔szt bez gramatury i tak muszą trafić do agenta AI).
                unit_fallback = target_in_dim is None
                if target_in_dim is None:
                    target_in_dim = float(req_base_qty)
                lo_in_dim = _convert_req_to_catalog_dim(
                    qty_lo_base, req_dim, base_dim, uwv, wvu,
                )
                hi_in_dim = _convert_req_to_catalog_dim(
                    qty_hi_base, req_dim, base_dim, uwv, wvu,
                )
                if lo_in_dim is None:
                    lo_in_dim = target_in_dim * 0.9
                if hi_in_dim is None:
                    hi_in_dim = target_in_dim * 1.1
                if hi_in_dim < lo_in_dim:
                    lo_in_dim, hi_in_dim = hi_in_dim, lo_in_dim
                pack = _catalog_pack_base_qty(row, base_dim)
                if unit_fallback:
                    order_base = max(float(pack or 0), float(target_in_dim), 1.0)
                    adjusted = True
                else:
                    order_base, adjusted = _qty_in_band(
                        target_in_dim, lo_in_dim, hi_in_dim, pack,
                    )
                order_base, stock_capped = _cap_order_qty_to_available_stock(
                    order_base, pack, row, base_dim,
                )
                if order_base <= 0:
                    continue
                if stock_capped:
                    adjusted = True
                if adjusted:
                    item_pack_adjusted = True
                    match_dim_used = base_dim
                    match_target_base = target_in_dim
                # ── Ścieżka ODMIANY: nie zaśmiecaj koszyka innymi odmianami. ──
                # Zbieramy WSZYSTKIE oferty tego samego produktu podstawowego,
                # a exact vs zamiennik rozstrzygamy po pętli.
                if it_variant:
                    if base_matches_offer(variant_base_name, row_name):
                        base_offers.append({
                            "row": row,
                            "price_base": price_base,
                            "base_dim": base_dim,
                            "order_base": order_base,
                            "target_in_dim": target_in_dim,
                            "pack": pack,
                            "hi": hi_in_dim,
                            "stock_capped": stock_capped,
                        })
                    continue
                score = max(
                    (_local_catalog_match_score(n, row_name) for n in known_names),
                    default=0.0,
                )
                food_ok = any(_food_names_compatible(n, row_name) for n in primary_names)
                # Auto-accept TYLKO prawie pewne + kompatybilne z primary (anty-FP)
                if _strict_local_catalog_accept(primary_names, row_name):
                    _consider(best_by_supplier, row, price_base, base_dim,
                              order_base, target_in_dim, "fuzzy",
                              pack_base_qty=pack, band_hi_base=hi_in_dim,
                              stock_capped=stock_capped)
                    cid = str(row.get("id") or "")
                    if cid:
                        accepted_catalog_ids.add(cid)
                    continue
                rn = _norm_pl(row_name)
                try:
                    sim = max(
                        (
                            max(
                                float(fuzz.token_set_ratio(kn, rn)),
                                float(fuzz.token_sort_ratio(kn, rn)),
                            )
                            for kn in known_norm
                        ),
                        default=0.0,
                    )
                except Exception:
                    sim = 0.0
                sim = max(sim, score * 100.0)
                # Do agenta: score / token_set / zgodność stemów (batat↔bataty)
                if (
                    score >= AI_CATALOG_CANDIDATE_MIN
                    or sim >= AI_SYNONYM_SIM_MIN
                    or food_ok
                ):
                    ai_pool.append(
                        (score, row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, sim, stock_capped)
                    )

            # Agent OpenAI: przeszukaj REALNE oferty z katalogów dostawców
            # (W menu + poza menu). Preferuj zgodność stemów, potem score.
            ai_pool.sort(
                key=lambda t: (
                    1 if any(
                        _food_names_compatible(n, (t[1].get("name") or ""))
                        for n in primary_names
                    ) else 0,
                    t[0],
                    t[8],
                ),
                reverse=True,
            )
            # Gdy już mamy pewne lokalne trafienia — agent może dociągnąć innych dostawców
            # (synonimy). Gdy brak — agent decyduje, czy cokolwiek pasuje.
            # Przy żądanej odmianie agent NIE wstawia zamienników do koszyka.
            run_agent = bool(ai_pool and ai_item_budget > 0 and not it_variant)
            if run_agent:
                ai_item_budget -= 1
                # Top kandydaci spoza już zaakceptowanych id
                agent_candidates: list[dict] = []
                by_id: dict[str, tuple] = {}
                for score, row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, sim, stock_capped in ai_pool:
                    cid = str(row.get("id") or "")
                    if not cid or cid in accepted_catalog_ids:
                        continue
                    if cid in by_id:
                        continue
                    by_id[cid] = (row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, stock_capped)
                    sup = sup_by_id.get(row.get("supplier_id"), {})
                    agent_candidates.append({
                        "id": cid,
                        "name": row.get("name") or "",
                        "supplier_name": sup.get("name") or "Dostawca",
                        "variant": row.get("variant") or "",
                        "sim": sim,
                        # Tag UI — nie filtr dostępności
                        "in_menu": row.get("is_visible") is not False,
                    })
                    if len(agent_candidates) >= AI_CATALOG_MAX_CANDIDATES:
                        break
                if agent_candidates:
                    matched_ids, conf, bill = await _ai_catalog_agent_match(
                        client, warehouse_name, agent_candidates, request_id=request_id,
                    )
                    billing_events.append(bill)
                    for cid in matched_ids:
                        slot = by_id.get(cid)
                        if not slot:
                            continue
                        row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, stock_capped = slot
                        # Agent AI już potwierdził (conf ≥ AI_SYNONYM_CONF_MIN) —
                        # nie odrzucaj batat/bataty ani filet↔kurczak filet drugim filtrem.
                        row_name = row.get("name") or ""
                        _consider(best_by_supplier, row, price_base, base_dim,
                                  order_base, target_in_dim, "ai",
                                  pack_base_qty=pack, band_hi_base=hi_in_dim,
                                  stock_capped=stock_capped)
                        accepted_catalog_ids.add(cid)
                        if inv_id and conf >= AI_SYNONYM_CONF_MIN:
                            syn_slot = synonym_additions.setdefault(
                                inv_id, {"existing": existing_syn, "new": set()})
                            syn_slot["new"].add(row_name)

            # II pass: gdy nadal brak oferty — szersza pula z całego katalogu tenanta
            # (token_sort + stem), żeby AI zobaczył bataty / kurczak filet mimo luźnego fuzzy.
            if not it_variant and not best_by_supplier and ai_item_budget > 0:
                wide: list[tuple] = []
                for row in catalog:
                    cid = str(row.get("id") or "")
                    if not cid or cid in accepted_catalog_ids:
                        continue
                    bp = _catalog_base_price(row)
                    if bp is None:
                        continue
                    base_dim, price_base = bp
                    row_name = row.get("name") or ""
                    if not row_name:
                        continue
                    rn = _norm_pl(row_name)
                    try:
                        sim = max(
                            (
                                max(
                                    float(fuzz.token_set_ratio(kn, rn)),
                                    float(fuzz.token_sort_ratio(kn, rn)),
                                )
                                for kn in known_norm
                            ),
                            default=0.0,
                        )
                    except Exception:
                        sim = 0.0
                    food_ok = any(_food_names_compatible(n, row_name) for n in primary_names)
                    if sim < 35 and not food_ok:
                        continue
                    target_in_dim = _convert_req_to_catalog_dim(
                        req_base_qty, req_dim, base_dim, uwv, wvu,
                    )
                    if target_in_dim is None:
                        target_in_dim = float(req_base_qty)
                    pack = _catalog_pack_base_qty(row, base_dim)
                    order_base = max(float(pack or 0), float(target_in_dim), 1.0)
                    order_base, stock_capped = _cap_order_qty_to_available_stock(
                        order_base, pack, row, base_dim,
                    )
                    if order_base <= 0:
                        continue
                    wide.append(
                        (sim, row, base_dim, price_base, order_base, pack, target_in_dim, target_in_dim * 1.1, sim, stock_capped)
                    )
                wide.sort(key=lambda t: t[0], reverse=True)
                if wide:
                    ai_item_budget -= 1
                    agent_candidates = []
                    by_id = {}
                    for sim, row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, _s, stock_capped in wide:
                        cid = str(row.get("id") or "")
                        if cid in by_id:
                            continue
                        by_id[cid] = (row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, stock_capped)
                        sup = sup_by_id.get(row.get("supplier_id"), {})
                        agent_candidates.append({
                            "id": cid,
                            "name": row.get("name") or "",
                            "supplier_name": sup.get("name") or "Dostawca",
                            "variant": row.get("variant") or "",
                            "sim": sim,
                            "in_menu": row.get("is_visible") is not False,
                        })
                        if len(agent_candidates) >= AI_CATALOG_MAX_CANDIDATES:
                            break
                    matched_ids, conf, bill = await _ai_catalog_agent_match(
                        client, warehouse_name, agent_candidates, request_id=request_id,
                    )
                    billing_events.append(bill)
                    for cid in matched_ids:
                        slot = by_id.get(cid)
                        if not slot:
                            continue
                        row, base_dim, price_base, order_base, pack, target_in_dim, hi_in_dim, stock_capped = slot
                        _consider(best_by_supplier, row, price_base, base_dim,
                                  order_base, target_in_dim, "ai",
                                  pack_base_qty=pack, band_hi_base=hi_in_dim,
                                  stock_capped=stock_capped)
                        if inv_id and conf >= AI_SYNONYM_CONF_MIN:
                            syn_slot = synonym_additions.setdefault(
                                inv_id, {"existing": existing_syn, "new": set()})
                            syn_slot["new"].add(row.get("name") or "")

            # ── Rozstrzygnięcie ODMIANY: exact ma bezwzględne pierwszeństwo. ──
            # Do koszyka trafiają WYŁĄCZNIE oferty z żądaną odmianą. Inne odmiany
            # tego samego produktu prezentujemy jako zamiennik (za zgodą usera).
            if it_variant:
                exact = [
                    c for c in base_offers
                    if classify_offer(it_variant, variant_base_name, c["row"].get("name") or "") == "exact"
                ]
                # Wyczyść ewentualne wcześniejsze trafienia (AI/fuzzy) — bez auto-zamiennika.
                best_by_supplier.clear()
                for c in exact:
                    _consider(
                        best_by_supplier, c["row"], c["price_base"], c["base_dim"],
                        c["order_base"], c["target_in_dim"], "variant_exact",
                        pack_base_qty=c["pack"], band_hi_base=c["hi"],
                        stock_capped=c["stock_capped"],
                    )
                variant_reports.append(_build_variant_report(
                    it.product_name_or_id, it_variant, variant_base_name,
                    base_offers, bool(exact), sup_by_id,
                ))

            # Ilość zamówienia: mediana order_base z dopasowań (albo target)
            ordered_bases = [
                float(v.get("order_base_qty") or req_base_qty)
                for v in best_by_supplier.values()
            ]
            chosen_dim = req_dim
            if ordered_bases:
                ordered_bases.sort()
                chosen_base = ordered_bases[len(ordered_bases) // 2]
                # wymiar z najlepszej oferty (po konwersji może być kg mimo req szt)
                sample = next(iter(best_by_supplier.values()), None)
                if sample and sample.get("base_dim"):
                    chosen_dim = sample["base_dim"]
                    match_target_base = float(sample.get("target_base_qty") or match_target_base)
            else:
                chosen_base = req_base_qty

            # Notatka PL gdy opakowanie ≠ dokładne zapotrzebowanie
            note_target = match_target_base if item_pack_adjusted else req_base_qty
            note_dim = match_dim_used if item_pack_adjusted else chosen_dim
            if best_by_supplier:
                note = _pack_mismatch_note(
                    it.product_name_or_id, note_target, chosen_base, note_dim,
                )
                if note:
                    pack_notes.append(note)
                    item_pack_adjusted = True

            # Wyświetl ilość w jednostce żądania gdy da się przeliczyć z powrotem
            if chosen_dim == req_dim:
                display_qty = chosen_base / req_factor if req_factor else chosen_base
                display_unit = it.unit
            else:
                display_qty = chosen_base
                display_unit = chosen_dim

            per_item.append({
                "product_name": it.product_name_or_id,
                "quantity": round(display_qty, 4),
                "unit": display_unit,
                "base_dim": chosen_dim,
                "base_quantity": round(chosen_base, 4),
                "target_quantity": float(it.quantity),
                "quantity_min": float(it.quantity_min) if it.quantity_min is not None else round(float(it.quantity) * 0.9, 4),
                "quantity_max": float(it.quantity_max) if it.quantity_max is not None else round(float(it.quantity) * 1.1, 4),
                "best_by_supplier": best_by_supplier,
                "inventory_id": inv_id,
                "pack_adjusted": item_pack_adjusted,
                "unit_weight_volume": uwv,
                "weight_volume_unit": wvu,
                "food_key": _food_match_key(it.product_name_or_id),
            })

        # Scal warianty tej samej pozycji (filet z kurczaka / kurczak filet) → 1 linia w koszyku
        per_item = _merge_duplicate_compare_items(per_item)

        # Zapamiętaj potwierdzone synonimy (kolejne porównania bez tokenów AI).
        if has_syn and synonym_additions:
            await _persist_synonyms(client, synonym_additions)

        reliability_by_sid: dict = {}
        try:
            reliability_by_sid = await _load_supplier_reliability_scores(client)
        except Exception as e:
            logger.debug(f"reliability scores skipped: {e}")

        suppliers_meta = {
            sid: {
                "name": (s.get("name") or "").strip() or "Dostawca",
                "email": s.get("email"),
                "min_order_value": float(s.get("min_order_value") or 0),
                "shipping_cost": float(s.get("shipping_cost") or 0),
                "free_shipping_threshold": float(s.get("free_shipping_threshold") or 0),
                **({"lead_time_days": float(s["lead_time_days"])}
                   if s.get("lead_time_days") is not None else {}),
                **({"reliability_score": float(reliability_by_sid[sid])}
                   if sid in reliability_by_sid else {}),
                **({"is_local_producer": True}
                   if (s.get("is_local_producer") or s.get("source") == "local_producer") else {}),
                **({"city": s["city"]} if s.get("city") else {}),
                **({"voivodeship": s["voivodeship"]} if s.get("voivodeship") else {}),
            }
            for sid, s in sup_by_id.items()
        }
        # Kitchen priority signals (POS/usage/waste/stock) — fail-soft
        kitchen_priorities: dict = {}
        waste_top: list = []
        fillers: list = []
        try:
            signals = await _load_deal_hunter_kitchen_signals(client, days=30)
            kitchen_priorities = signals.get("kitchen_priorities") or {}
            waste_top = signals.get("waste_top") or []
            fillers = signals.get("fillers") or []
        except Exception as e:
            logger.warning(f"deal_hunter kitchen signals skipped: {e}")

        from smart_basket_optimizer import build_smart_optimize_response, apply_cart_objective
        result = build_smart_optimize_response(
            per_item,
            suppliers_meta,
            kitchen_priorities=kitchen_priorities,
            waste_top=waste_top,
            fillers=fillers,
        )
        result = apply_cart_objective(result, req.cart_objective, suppliers_meta)
        result = _sanitize_optimize_unique_products(result)
        # Flaga: czy w ofercie / koszykach są lokalni przetwórcy
        lp_in_quotes = any(
            bool((q or {}).get("is_local_producer"))
            for pi in per_item
            for q in ((pi.get("best_by_supplier") or {}).values())
        )
        result["includes_local_producers"] = bool(lp_in_quotes or lp_suppliers)
        result["search_scope"] = search_scope
        if lp_in_quotes or (search_scope != "suppliers_only" and lp_suppliers):
            speech = (result.get("assistant_speech") or "").strip()
            if search_scope == "local_producers_only":
                note = "Szukam wyłącznie wśród Lokalnych Przetwórców (aktywni i zweryfikowani)."
            elif search_scope == "both":
                note = (
                    "W porównaniu uwzględniam hurtowników i Lokalnych Przetwórców "
                    "(aktywnych i zweryfikowanych)."
                )
            else:
                note = ""
            if note and note not in speech:
                result["assistant_speech"] = f"{speech} {note}".strip() if speech else note
        if pack_notes:
            result["pack_adjustment_notes"] = pack_notes
            # Dołącz do speech, żeby FE / Jarvis widziały od razu
            speech = (result.get("assistant_speech") or "").strip()
            extra = " ".join(pack_notes)
            result["assistant_speech"] = f"{speech} {extra}".strip() if speech else extra
        # Raporty odmian (exact vs zamienniki) — FE prezentuje sekcję "Szukasz: …".
        if variant_reports:
            result["variant_reports"] = variant_reports
            speech = (result.get("assistant_speech") or "").strip()
            miss = [
                r for r in variant_reports
                if not r.get("exact_found") and r.get("substitute_variant_count")
            ]
            if miss:
                r0 = miss[0]
                note = (
                    f"Nie znaleźliśmy odmiany „{r0['requested_variant']}” "
                    f"dla: {r0['base_name']}. Znaleźliśmy jednak "
                    f"{r0['substitute_variant_count']} inn(ą/e) odmian(ę/y) — "
                    "możesz dodać zamiennik do koszyka."
                )
                result["assistant_speech"] = f"{speech} {note}".strip() if speech else note
        # Warstwa AI: tylko interpretacja tipów (koszyki już policzone matematycznie)
        try:
            result = await _enrich_deal_hunter_ai_tips(client, result, per_item)
        except Exception as e:
            logger.warning(f"deal_hunter AI tips skipped: {e}")
        if billing_events:
            result.update(merge_billing_events(billing_events))
        else:
            result.setdefault("credits_deducted", 0)
        return result


async def bargain_hunter_optimize(req: CompareOffersRequest):
    return await compare_offers(req)

__all__ = ['bargain_hunter_optimize', 'compare_offers']
