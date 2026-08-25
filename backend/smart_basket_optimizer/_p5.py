from __future__ import annotations

from bargain_hunter import _item_line_entry
from bargain_hunter import _min_order_value
from bargain_hunter import _supplier_meta
from typing import Optional
from ._p0 import MAX_GAP_NEW_BASKET_PLN
from ._p2 import _scenario_from_groups



def compute_smart_hybrid(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    split_scenario: dict,
    monolith_scenario: dict,
) -> dict:
    """
    Hybrid: start od split_max; pozycje z małych / niespełniających minimów
    koszyków dorzuć do największego koszyka (nawet drożej).
    """
    # Punkt startowy: grupy ze split (nawet jeśli nieviable — naprawiamy)
    groups = {
        g["supplier_id"]: {
            "supplier_id": g["supplier_id"],
            "supplier_name": g["supplier_name"],
            "supplier_email": g.get("supplier_email"),
            "items": [dict(x) for x in (g.get("items") or [])],
            "subtotal_pln": float(g.get("subtotal_pln") or 0),
            "min_order_value": float(g.get("min_order_value") or 0),
        }
        for g in (split_scenario.get("suppliers") or [])
    }
    missing = list(split_scenario.get("missing") or [])
    item_by_name = {pi["product_name"]: pi for pi in items}

    if not groups:
        # Nie ma split — skopiuj monolith
        return {
            **monolith_scenario,
            "id": "smart_hybrid",
            "label": "Optymalizacja progów (Smart)",
            "description": "Manipulacja koszykami i progami (minima / darmowa dostawa), by uniknąć ukrytych kosztów.",
        }

    def largest_sid(exclude: Optional[str] = None) -> Optional[str]:
        cands = [(g["subtotal_pln"], sid) for sid, g in groups.items() if sid != exclude]
        if not cands:
            return None
        cands.sort(reverse=True)
        return cands[0][1]

    for _ in range(12):
        small = [
            sid for sid, g in groups.items()
            if g["min_order_value"] > 0 and g["subtotal_pln"] < g["min_order_value"]
        ]
        if not small:
            break
        small.sort(key=lambda s: groups[s]["subtotal_pln"])
        src = small[0]
        dest = largest_sid(exclude=src)
        if dest is None:
            # Brak dużego koszyka — spróbuj wchłonąć wszystko do monolit-owego dostawcy
            mono_sid = None
            if monolith_scenario.get("suppliers"):
                mono_sid = monolith_scenario["suppliers"][0]["supplier_id"]
            if not mono_sid or mono_sid == src:
                break
            dest = mono_sid
            if dest not in groups:
                meta = _supplier_meta(suppliers_meta, dest)
                groups[dest] = {
                    "supplier_id": dest,
                    "supplier_name": meta.get("name") or "Dostawca",
                    "supplier_email": meta.get("email"),
                    "items": [],
                    "subtotal_pln": 0.0,
                    "min_order_value": _min_order_value(suppliers_meta, dest),
                }

        src_g = groups[src]
        for line in list(src_g["items"]):
            pi = item_by_name.get(line["product_name"])
            if not pi:
                continue
            quote = (pi.get("best_by_supplier") or {}).get(dest)
            if quote is None:
                # Zostaw u src — nie da się przenieść
                continue
            src_g["items"] = [x for x in src_g["items"] if x["product_name"] != line["product_name"]]
            src_g["subtotal_pln"] = round(sum(x["line_total"] for x in src_g["items"]), 2)
            dg = groups[dest]
            dg["items"] = [x for x in dg["items"] if x["product_name"] != line["product_name"]]
            dg["items"].append(_item_line_entry(pi, quote))
            dg["subtotal_pln"] = round(sum(x["line_total"] for x in dg["items"]), 2)
        if not src_g["items"]:
            del groups[src]

    return _scenario_from_groups(
        "smart_hybrid",
        "Optymalizacja progów (Smart)",
        "Drobne koszyki poniżej minimum dołączamy do dużych — plus wskazówki do progów darmowej dostawy.",
        list(groups.values()),
        missing,
        suppliers_meta,
    )


def attach_logistics_hints(scenario: dict) -> dict:
    """Dokłada do scenariusza luki do minimum / darmowej dostawy (dla AI tipów)."""
    hints: list[dict] = []
    for g in scenario.get("suppliers") or []:
        sub = float(g.get("subtotal_pln") or 0)
        min_val = float(g.get("min_order_value") or 0)
        free_at = float(g.get("free_shipping_threshold") or 0)
        ship_list = float(g.get("shipping_cost_list") or 0)
        gap_min = round(max(0.0, min_val - sub), 2) if min_val > 0 else 0.0
        gap_free = round(max(0.0, free_at - sub), 2) if free_at > 0 and ship_list > 0 else 0.0
        blocked = min_val > 0 and sub < min_val
        tco = round(sub + float(g.get("shipping_pln") or 0) + gap_min, 2)
        hints.append({
            "supplier_id": g.get("supplier_id"),
            "supplier_name": g.get("supplier_name"),
            "subtotal_pln": sub,
            "min_order_value": min_val,
            "gap_to_minimum_pln": gap_min,
            "blocked_by_minimum": blocked,
            "free_shipping_threshold": free_at,
            "gap_to_free_shipping_pln": gap_free,
            "shipping_pln": float(g.get("shipping_pln") or 0),
            "shipping_list_pln": ship_list,
            "tco_pln": tco,
        })
    out = dict(scenario)
    out["logistics_hints"] = hints
    tip_parts: list[str] = []
    for h in hints:
        name = h["supplier_name"] or "Dostawca"
        if h["blocked_by_minimum"] and h["gap_to_minimum_pln"] > 0:
            tip_parts.append(
                f"U {name} brakuje {h['gap_to_minimum_pln']:.0f} zł do minimum "
                f"({h['min_order_value']:.0f} zł) — TCO z karą ≈ {h['tco_pln']:.0f} zł."
            )
        elif h["gap_to_free_shipping_pln"] > 0 and h["gap_to_free_shipping_pln"] <= 80:
            tip_parts.append(
                f"U {name} brakuje {h['gap_to_free_shipping_pln']:.0f} zł do darmowej dostawy "
                f"(próg {h['free_shipping_threshold']:.0f} zł, shipping {h['shipping_list_pln']:.0f} zł)."
            )
    # Dołącz konkretne powody z decision_log (exclusive / hard gap)
    for entry in (scenario.get("decision_log") or [])[:6]:
        code = entry.get("reason_code") or ""
        prod = entry.get("product") or "?"
        if code in ("EXCLUSIVE_BELOW_50PCT", "EXCLUSIVE_HARD_GAP", "EXCLUSIVE_TCO_WORSE", "NO_LEGAL_BASKET"):
            note = entry.get("tco_note") or code
            tip_parts.append(f"{prod}: {note}")
        elif code == "TCO_CONSOLIDATE" and entry.get("price_delta"):
            tip_parts.append(
                f"{prod}: konsolidacja (+{entry['price_delta']:.0f} zł vs najtańszy) "
                f"obniża TCO ({entry.get('tco_note') or ''})."
            )
    out["smart_tip"] = " ".join(tip_parts) if tip_parts else (
        "Koszyk spełnia minima. Sprawdź, czy nie da się ograniczyć liczby dostaw bez dużej dopłaty."
    )
    return out


def _analysis_summary_from_log(result: dict) -> str:
    """Krótkie podsumowanie z decision_log + liczb."""
    parts: list[str] = []
    rec = result.get("recommended_scenario_id")
    sav = float(result.get("savings_amount") or 0)
    parts.append(f"Porównano do 3 strategii koszyka. Rekomendacja: {rec or 'brak'}")
    if sav > 0:
        parts.append(f"Potencjalna oszczędność vs konsolidacja: {sav:.0f} zł.")
    split = result.get("scenario_split_max") or {}
    log = split.get("decision_log") or []
    excl_miss = [e for e in log if (e.get("reason_code") or "").startswith("EXCLUSIVE_") and not e.get("chosen_supplier")]
    consolidations = [e for e in log if e.get("reason_code") == "TCO_CONSOLIDATE"]
    if excl_miss:
        names = ", ".join(e.get("product") or "?" for e in excl_miss[:3])
        parts.append(f"Exclusive bez koszyka: {names}.")
    if consolidations:
        parts.append(f"Konsolidacja TCO: {len(consolidations)} pozycji przeniesionych mimo droższej linii.")
    gap_soft = [
        g for g in (split.get("suppliers") or [])
        if not g.get("meets_minimum_order") and float(g.get("gap_to_minimum_pln") or 0) > 0
    ]
    if gap_soft:
        g0 = gap_soft[0]
        parts.append(
            f"Soft-luka u {g0.get('supplier_name')}: {float(g0.get('gap_to_minimum_pln') or 0):.0f} zł "
            f"(≤{MAX_GAP_NEW_BASKET_PLN:.0f} zł)."
        )
    return " ".join(parts)


def build_math_tip_fallback(result: dict) -> dict:
    """Wzbogaca scenariusze o logistics_hints + smart_tip bez LLM."""
    for key in ("scenario_split_max", "scenario_monolith", "scenario_smart_hybrid"):
        sc = result.get(key)
        if isinstance(sc, dict) and sc.get("suppliers") is not None:
            result[key] = attach_logistics_hints(sc)
    scenarios = []
    for sc in (result.get("scenarios") or []):
        if isinstance(sc, dict):
            scenarios.append(attach_logistics_hints(sc))
    if scenarios:
        result["scenarios"] = scenarios
    # Preferuj full 3 kafle gdy mamy ≥2 scenariusze z produktami
    all_three = [
        result.get("scenario_split_max"),
        result.get("scenario_monolith"),
        result.get("scenario_smart_hybrid"),
    ]
    with_items = [s for s in all_three if s and (s.get("suppliers") or s.get("missing") is not None)]
    if len(with_items) >= 2 and len(result.get("items_requested") or []) > 1:
        result["scenarios"] = [attach_logistics_hints(s) if "smart_tip" not in s else s for s in with_items]
        result["is_multivariable"] = True
        result["is_optimized"] = True
    result["analysis_summary"] = _analysis_summary_from_log(result)
    # decision_log na top-level (z split — główny silnik przydziału)
    split = result.get("scenario_split_max") or {}
    if isinstance(split, dict) and split.get("decision_log") is not None:
        result["decision_log"] = split["decision_log"]
    return result

__all__ = ['_analysis_summary_from_log', 'attach_logistics_hints', 'build_math_tip_fallback', 'compute_smart_hybrid']
