from __future__ import annotations

from bargain_hunter import _supplier_meta
from bargain_hunter import find_tied_suppliers
from bargain_hunter import to_pricing_matrix
from typing import Any
from typing import Optional
from ._p0 import MULTIVAR_SAVINGS_RATIO
from ._p2 import attach_kitchen_priorities, compute_split_max, sort_items_by_kitchen_priority
from ._p3 import build_deal_hunter_suggestions
from ._p4 import compute_monolith_scenario
from ._p5 import build_math_tip_fallback, compute_smart_hybrid
from ._p6 import build_smart_speech



def build_smart_optimize_response(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    *,
    kitchen_priorities: Optional[dict[str, dict]] = None,
    waste_top: Optional[list[dict]] = None,
    fillers: Optional[list[dict]] = None,
    cart_objective: Optional[str] = None,
) -> dict[str, Any]:
    """Pełna odpowiedź v2: do 3 scenariuszy + flaga is_multivariable.

    kitchen_priorities: mapa id/nazwa → {score, class_a, reasons} (POS/usage/waste/stock).
    waste_top / fillers: sygnały do suggestions (math-first).
    cart_objective: lowest_price | min_deliveries | fast_delivery — wpływa na przydział SKU.
    """
    items = attach_kitchen_priorities(items, kitchen_priorities)
    items = sort_items_by_kitchen_priority(items)

    split_sc = compute_split_max(items, suppliers_meta, cart_objective=cart_objective)
    mono_sc = compute_monolith_scenario(items, suppliers_meta)
    hybrid_sc = compute_smart_hybrid(items, suppliers_meta, split_sc, mono_sc)

    scenarios = [split_sc, mono_sc, hybrid_sc]
    viable = [s for s in scenarios if s.get("viable")]
    unique_count = len(items)

    # Najlepszy: among viable prefer (1) mniej missing / większe pokrycie (2) niższy total
    best = None
    if viable:
        def _rank(s: dict) -> tuple:
            miss = len(s.get("missing") or [])
            cov = sum(len(g.get("items") or []) for g in (s.get("suppliers") or []))
            return (miss, -cov, float(s.get("total_pln") or 1e18))
        best = min(viable, key=_rank)
    elif scenarios:
        # Fallback: najmniejszy total niezależnie od viable
        ranked = sorted(
            [s for s in scenarios if s.get("suppliers")],
            key=lambda s: (not s.get("meets_all_minimums"), s.get("total_pln") or 1e18),
        )
        best = ranked[0] if ranked else None

    # Savings vs najdroższy viable / vs monolith
    savings_amount = 0.0
    ref_total = mono_sc["total_pln"] if mono_sc.get("viable") else None
    if best and ref_total and ref_total > best["total_pln"]:
        savings_amount = round(ref_total - best["total_pln"], 2)

    # UX Shield — różnica ≥5% ALBO ≥2 scenariusze z dostawcami (zawsze pokaż kafle)
    is_multivariable = False
    suppliers_present = sum(1 for s in scenarios if s.get("suppliers"))
    if unique_count > 1 and suppliers_present >= 2:
        is_multivariable = True
    elif unique_count > 1 and len(viable) >= 2:
        totals = sorted(s["total_pln"] for s in viable)
        spread = totals[-1] - totals[0]
        base = totals[-1] if totals[-1] > 0 else 1.0
        if spread / base >= MULTIVAR_SAVINGS_RATIO:
            is_multivariable = True

    pricing_matrix = to_pricing_matrix(items, suppliers_meta)
    items_requested = []
    for pi in items:
        bbs = pi.get("best_by_supplier") or {}
        offers_sorted = sorted(
            bbs.values(),
            key=lambda q: float(q.get("line_total") or 1e18),
        )
        best_q = offers_sorted[0] if offers_sorted else None
        meta_best = _supplier_meta(suppliers_meta, best_q["supplier_id"]) if best_q else {}
        best_name = (
            ((best_q or {}).get("supplier_name") or meta_best.get("name") or "").strip()
            or None
        )
        items_requested.append({
            "product_name": pi["product_name"],
            "quantity": pi["quantity"],
            "unit": pi["unit"],
            "found": bool(bbs),
            "supplier_id": (best_q or {}).get("supplier_id"),
            "supplier_name": best_name,
            "matched_name": (best_q or {}).get("matched_name"),
            "offers": [
                {
                    "supplier_id": q.get("supplier_id"),
                    "supplier_name": (
                        (q.get("supplier_name")
                         or (_supplier_meta(suppliers_meta, q.get("supplier_id") or {}).get("name"))
                         or "").strip()
                        or "Dostawca"
                    ),
                    "line_total": q.get("line_total"),
                    "matched_name": q.get("matched_name"),
                }
                for q in offers_sorted[:6]
            ],
        })

    # Kompatybilność z DealHunterModal v1
    variant_monolith = None
    if mono_sc.get("suppliers") and len(mono_sc["suppliers"]) == 1:
        g = mono_sc["suppliers"][0]
        variant_monolith = {
            "type": "all_one_supplier",
            "supplier_id": g["supplier_id"],
            "supplier_name": g["supplier_name"],
            "supplier_email": g.get("supplier_email"),
            "items": g["items"],
            "subtotal_pln": g["subtotal_pln"],
            "total_pln": g["total_pln"],
            "shipping_pln": g.get("shipping_pln", 0),
            "min_order_value": g.get("min_order_value", 0),
            "meets_minimum_order": g.get("meets_minimum_order", True),
            "missing": mono_sc.get("missing") or [],
        }
    elif mono_sc.get("suppliers"):
        # multi → potraktuj jak option_optimized-style w monolicie
        variant_monolith = {
            "type": "all_one_supplier",
            "supplier_id": mono_sc["suppliers"][0]["supplier_id"],
            "supplier_name": mono_sc["suppliers"][0]["supplier_name"]
            + (f" +{len(mono_sc['suppliers']) - 1}" if len(mono_sc["suppliers"]) > 1 else ""),
            "supplier_email": mono_sc["suppliers"][0].get("supplier_email"),
            "items": [i for g in mono_sc["suppliers"] for i in g["items"]],
            "subtotal_pln": mono_sc["products_pln"],
            "total_pln": mono_sc["total_pln"],
            "shipping_pln": mono_sc["shipping_pln"],
            "min_order_value": 0,
            "meets_minimum_order": mono_sc.get("meets_all_minimums", False),
            "missing": mono_sc.get("missing") or [],
        }

    variant_split = {
        "type": "optimized",
        "suppliers": split_sc.get("suppliers") or [],
        "total_pln": split_sc.get("total_pln") or 0,
        "missing": split_sc.get("missing") or [],
    }

    best_option = None
    tied: list[dict] = []
    if not is_multivariable and best and best.get("suppliers"):
        if len(best["suppliers"]) == 1:
            g = best["suppliers"][0]
            best_option = {
                "type": "single",
                "supplier_id": g["supplier_id"],
                "supplier_name": g["supplier_name"],
                "supplier_email": g.get("supplier_email"),
                "items": g["items"],
                "subtotal_pln": g["subtotal_pln"],
                "total_pln": g["total_pln"],
                "shipping_pln": g.get("shipping_pln", 0),
                "min_order_value": g.get("min_order_value", 0),
                "meets_minimum_order": g.get("meets_minimum_order", True),
                "missing": best.get("missing") or [],
            }
            if unique_count == 1 and items:
                tied = find_tied_suppliers(items[0], g["subtotal_pln"], suppliers_meta)
        else:
            best_option = {
                "type": "split_single_view",
                "suppliers": best["suppliers"],
                "subtotal_pln": best["products_pln"],
                "total_pln": best["total_pln"],
                "shipping_pln": best.get("shipping_pln", 0),
                "missing": best.get("missing") or [],
            }

    # Zawsze trzy kafle strategii gdy ≥2 scenariusze mają dostawców
    out_scenarios = scenarios if (is_multivariable or suppliers_present >= 2) else ([best] if best else [])

    result: dict[str, Any] = {
        "currency": "PLN",
        "optimizer_version": 2,
        # Jeden SKU → zawsze widok „single”, nawet gdy 3 scenariusze mają tego samego dostawcę
        "is_multivariable": (is_multivariable or suppliers_present >= 2) and unique_count > 1,
        "is_optimized": (is_multivariable or suppliers_present >= 2) and unique_count > 1,
        "items_requested": items_requested,
        "scenarios": out_scenarios,
        "scenario_split_max": split_sc,
        "scenario_monolith": mono_sc,
        "scenario_smart_hybrid": hybrid_sc,
        "recommended_scenario_id": best["id"] if best else None,
        "savings_amount": savings_amount,
        "savings_pln": savings_amount,
        "best_option": best_option,
        "tied_suppliers": tied,
        "variant_monolith": variant_monolith,
        "variant_split": variant_split,
        "option_all_one": variant_monolith,
        "option_optimized": variant_split,
        "cheaper_variant": (
            "split" if best and best["id"] == "split_max"
            else ("monolith" if best and best["id"] == "monolith" else "hybrid")
        ) if best else None,
        "pricing_matrix": pricing_matrix,
    }
    result["assistant_speech"] = build_smart_speech(result)
    result = build_math_tip_fallback(result)

    # Sugestie Łowcy (math) — decision_log + soft gap + waste + lead-time (gdy dostępne)
    dlog = result.get("decision_log") or (split_sc.get("decision_log") if isinstance(split_sc, dict) else None)
    suggestions = build_deal_hunter_suggestions(
        items,
        suppliers_meta,
        split_scenario=split_sc,
        decision_log=dlog if isinstance(dlog, list) else None,
        waste_top=waste_top,
        fillers=fillers,
    )
    result["suggestions"] = suggestions
    if suggestions and not result.get("smart_tip"):
        # kompaktowy tip z pierwszej sugestii (FE / speech)
        top = suggestions[0]
        result["smart_tip"] = top.get("message")
        if result.get("analysis_summary") and top.get("message"):
            # dołącz krótką wzmiankę jeśli summary już jest
            pass
        elif top.get("message"):
            result["analysis_summary"] = top["message"]
    # Kitchen priorities echo (debug / FE badges)
    result["kitchen_priorities"] = {
        pi["product_name"]: {
            "score": pi.get("kitchen_priority"),
            "class_a": pi.get("kitchen_class_a"),
            "reasons": pi.get("kitchen_priority_reasons") or [],
        }
        for pi in items
        if pi.get("product_name")
    }
    return result

__all__ = ['build_smart_optimize_response']
