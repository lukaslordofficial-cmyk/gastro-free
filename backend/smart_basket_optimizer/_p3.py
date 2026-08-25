from __future__ import annotations

from bargain_hunter import _supplier_meta
from typing import Optional
from ._p0 import LEAD_TIME_SLOW_DAYS, MAX_GAP_NEW_BASKET_PLN, RELIABILITY_TCO_THRESHOLD, resolve_lead_time_days
from ._p2 import _product_norm_key



def build_deal_hunter_suggestions(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    *,
    split_scenario: Optional[dict] = None,
    decision_log: Optional[list] = None,
    waste_top: Optional[list[dict]] = None,
    fillers: Optional[list[dict]] = None,
) -> list[dict]:
    """
    Math-first suggestions from DB / basket signals.
    Types: soft_gap_filler | waste_qty_reduce | lead_time_note | decision_note
    """
    suggestions: list[dict] = []
    waste_keys = {
        _product_norm_key(str(w.get("name") or w.get("item_name") or w.get("ingredient_name") or ""))
        for w in (waste_top or [])
        if (w.get("name") or w.get("item_name") or w.get("ingredient_name"))
    }
    waste_keys.discard("")

    # Soft gap ≤ MAX_GAP → filler suggestions from long-shelf / high-rotation catalog
    for g in (split_scenario or {}).get("suppliers") or []:
        gap = float(g.get("gap_to_minimum_pln") or 0)
        meets = g.get("meets_minimum_order")
        if gap <= 0 or meets is True:
            continue
        if gap > MAX_GAP_NEW_BASKET_PLN:
            continue
        sid = g.get("supplier_id")
        sname = g.get("supplier_name") or sid
        filler_names = [f.get("name") for f in (fillers or []) if f.get("name")][:5]
        sub = float(g.get("subtotal_pln") or 0)
        min_v = float(g.get("min_order_value") or 0)
        if filler_names:
            msg = (
                f"U {sname} brakuje {gap:.0f} zł do minimum "
                f"({sub:.0f}/{min_v:.0f} zł, luka ≤{MAX_GAP_NEW_BASKET_PLN:.0f}). "
                f"Dopnij koszyk: {', '.join(str(n) for n in filler_names[:4])}."
            )
        else:
            msg = (
                f"U {sname} brakuje {gap:.0f} zł do minimum zamówienia "
                f"(obecnie {sub:.0f} zł, próg {min_v:.0f} zł). "
                "Dodaj pozycje o długim terminie / wysokiej rotacji u tego dostawcy, "
                "zamiast otwierać drugi koszyk."
            )
        suggestions.append({
            "type": "soft_gap_filler",
            "supplier_id": sid,
            "message": msg,
            "evidence": {
                "gap_to_minimum_pln": gap,
                "max_gap_pln": MAX_GAP_NEW_BASKET_PLN,
                "subtotal_pln": sub,
                "min_order_value": min_v,
                "filler_candidates": filler_names,
            },
            "action": "add_filler",
        })

    # TOP waste + large order qty → reduce suggestion
    for pi in items:
        pname = str(pi.get("product_name") or "")
        key = _product_norm_key(pname)
        if key not in waste_keys:
            continue
        qty = float(pi.get("quantity") or pi.get("target_quantity") or 0)
        # "large" heuristic: quantity clearly above small retail pack
        if qty < 2:
            continue
        # bump if class A waste reason or simply in top list
        suggestions.append({
            "type": "waste_qty_reduce",
            "product_name": pname,
            "message": (
                f"„{pname}” jest w TOP strat (30 dni), a zamawiasz {qty:g} "
                f"{pi.get('unit') or ''}. Rozważ mniejszą ilość / krótszy cykl."
            ).strip(),
            "evidence": {
                "in_waste_top_30d": True,
                "order_qty": qty,
                "unit": pi.get("unit"),
            },
            "action": "reduce_qty",
        })

    # Class A + cheaper supplier has long lead_time (NULL → DEFAULT_LEAD_TIME_DAYS)
    for pi in items:
        if not pi.get("kitchen_class_a"):
            continue
        bbs = pi.get("best_by_supplier") or {}
        if len(bbs) < 2:
            continue
        quotes = sorted(bbs.items(), key=lambda kv: float(kv[1].get("line_total") or 1e18))
        cheap_sid, cheap_q = quotes[0]
        cheap_meta = _supplier_meta(suppliers_meta, cheap_sid)
        lead_d = resolve_lead_time_days(cheap_meta)
        lead_assumed = cheap_meta.get("lead_time_days") is None
        if lead_d < LEAD_TIME_SLOW_DAYS:
            continue
        alt_sid, alt_q = quotes[1] if len(quotes) > 1 else (None, None)
        alt_meta = _supplier_meta(suppliers_meta, alt_sid) if alt_sid else {}
        alt_lead = resolve_lead_time_days(alt_meta) if alt_sid else None
        alt_name = (alt_q or {}).get("supplier_name") if alt_q else None
        cheap_name = cheap_q.get("supplier_name") or cheap_sid
        assumed = " (domyślnie — uzupełnij czas dostawy)" if lead_assumed else ""
        msg = (
            f"Krytyczny SKU „{pi.get('product_name')}”: najtańszy ({cheap_name}) "
            f"ma czas dostawy ~{lead_d:.0f} dni{assumed}."
        )
        if alt_name and alt_lead is not None:
            msg += f" Alternatywa: {alt_name} (~{float(alt_lead):.0f} dni)."
        elif alt_name:
            msg += f" Rozważ szybszego dostawcę: {alt_name}."
        suggestions.append({
            "type": "lead_time_note",
            "product_name": pi.get("product_name"),
            "supplier_id": cheap_sid,
            "message": msg,
            "evidence": {
                "lead_time_days": lead_d,
                "lead_time_is_default": lead_assumed,
                "cheaper_supplier_id": cheap_sid,
                "alt_supplier_id": alt_sid,
                "alt_lead_time_days": alt_lead,
            },
            "action": "review_lead_time",
        })

    # Reliability note when score is known and below threshold
    for sid, meta in (suppliers_meta or {}).items():
        score = meta.get("reliability_score")
        if score is None:
            continue
        try:
            s = float(score)
        except (TypeError, ValueError):
            continue
        if s >= RELIABILITY_TCO_THRESHOLD:
            continue
        suggestions.append({
            "type": "reliability_note",
            "supplier_id": sid,
            "message": (
                f"Dostawca {meta.get('name') or sid}: Reliability Score {s:.0%} "
                f"(< {RELIABILITY_TCO_THRESHOLD:.0%}) — TCO lekko podniesione."
            ),
            "evidence": {"reliability_score": s, "threshold": RELIABILITY_TCO_THRESHOLD},
            "action": "review_reliability",
        })

    # Expose key decision_log entries as suggestion notes
    for entry in (decision_log or [])[:12]:
        code = entry.get("reason_code") or ""
        if code not in (
            "EXCLUSIVE_TCO_OK",
            "EXCLUSIVE_BELOW_50PCT",
            "EXCLUSIVE_SIBLING_OK",
            "PACK_OVERSIZE",
            "HARD_GAP",
            "TCO_CONSOLIDATE",
        ):
            continue
        suggestions.append({
            "type": "decision_note",
            "product_name": entry.get("product"),
            "supplier_id": entry.get("chosen_supplier"),
            "message": entry.get("tco_note") or f"Decyzja: {code}",
            "evidence": {
                "reason_code": code,
                "price_delta": entry.get("price_delta"),
                "gap_to_min": entry.get("gap_to_min"),
            },
        })

    return suggestions

__all__ = ['build_deal_hunter_suggestions']
