from __future__ import annotations

from bargain_hunter import _item_line_entry
from bargain_hunter import _min_order_value
from bargain_hunter import compute_monolith
from typing import Optional
from ._p0 import _enrich_group
from ._p2 import _scenario_from_groups



def compute_monolith_scenario(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    max_suppliers: int = 2,
) -> dict:
    """
    Monolit / konsolidacja: NAJPIERW 1 dostawca z pełnym pokryciem (wygoda),
    dopiero gdy żaden nie pokrywa 100% — para (max 2).
    Wybór 1 dostawcy: min total z shippingiem (nie tylko suma produktów).
    """
    # --- 1 dostawca: pełne pokrycie, najniższy total z dostawą ---
    best_one: Optional[dict] = None
    all_sids: set[str] = set()
    for pi in items:
        all_sids.update((pi.get("best_by_supplier") or {}).keys())
    for sid in all_sids:
        quotes = []
        ok = True
        for pi in items:
            q = (pi.get("best_by_supplier") or {}).get(sid)
            if not q:
                ok = False
                break
            quotes.append((pi, q))
        if not ok or not quotes:
            continue
        g = {
            "supplier_id": sid,
            "supplier_name": quotes[0][1]["supplier_name"],
            "supplier_email": quotes[0][1].get("supplier_email"),
            "items": [_item_line_entry(pi, q) for pi, q in quotes],
            "subtotal_pln": round(sum(float(q["line_total"]) for _, q in quotes), 2),
            "min_order_value": _min_order_value(suppliers_meta, sid),
        }
        enriched = _enrich_group(g, suppliers_meta)
        if not enriched.get("meets_minimum_order"):
            continue
        if best_one is None or float(enriched["total_pln"]) < float(best_one["total_pln"]):
            best_one = enriched

    if best_one:
        return _scenario_from_groups(
            "monolith",
            "Wygoda (mało dostaw)",
            "Skupiamy zamówienie u 1–2 dostawców — mniej paczek, prostsza logistyka.",
            [{
                "supplier_id": best_one["supplier_id"],
                "supplier_name": best_one["supplier_name"],
                "supplier_email": best_one.get("supplier_email"),
                "items": best_one["items"],
                "subtotal_pln": best_one["subtotal_pln"],
                "min_order_value": best_one.get("min_order_value", 0),
            }],
            [],
            suppliers_meta,
        )

    mono = compute_monolith(items, suppliers_meta)

    if max_suppliers < 2 or not items:
        if mono:
            g = {
                "supplier_id": mono["supplier_id"],
                "supplier_name": mono["supplier_name"],
                "supplier_email": mono.get("supplier_email"),
                "items": mono["items"],
                "subtotal_pln": mono["subtotal_pln"],
                "min_order_value": mono.get("min_order_value", 0),
            }
            return _scenario_from_groups(
                "monolith",
                "Wygoda (mało dostaw)",
                "Najlepszy pojedynczy dostawca (częściowe pokrycie).",
                [g],
                list(mono.get("missing") or []),
                suppliers_meta,
            )
        return _empty_monolith()

    # --- Pary tylko gdy 1 dostawca nie pokrywa asortymentu ---
    all_sids: set[str] = set()
    for pi in items:
        all_sids.update((pi.get("best_by_supplier") or {}).keys())
    coverage = []
    for sid in all_sids:
        cov = sum(1 for pi in items if sid in (pi.get("best_by_supplier") or {}))
        coverage.append((cov, sid))
    coverage.sort(reverse=True)
    top = [sid for _, sid in coverage[:12]]

    best: Optional[dict] = None
    for i, a in enumerate(top):
        for b in top[i + 1:]:
            groups_map: dict[str, dict] = {}
            miss: list[str] = []
            ok = True
            for pi in items:
                bbs = pi.get("best_by_supplier") or {}
                qa, qb = bbs.get(a), bbs.get(b)
                if qa is None and qb is None:
                    miss.append(pi["product_name"])
                    ok = False
                    break
                if qa is None:
                    sid, quote = b, qb
                elif qb is None:
                    sid, quote = a, qa
                else:
                    sid, quote = (a, qa) if qa["line_total"] <= qb["line_total"] else (b, qb)
                g = groups_map.setdefault(
                    sid,
                    {
                        "supplier_id": sid,
                        "supplier_name": quote["supplier_name"],
                        "supplier_email": quote.get("supplier_email"),
                        "items": [],
                        "subtotal_pln": 0.0,
                        "min_order_value": _min_order_value(suppliers_meta, sid),
                    },
                )
                g["items"].append(_item_line_entry(pi, quote))
                g["subtotal_pln"] = round(g["subtotal_pln"] + quote["line_total"], 2)
            if not ok or miss:
                continue
            viable_groups = []
            fail = False
            for g in groups_map.values():
                if g["min_order_value"] > 0 and g["subtotal_pln"] < g["min_order_value"]:
                    fail = True
                    break
                viable_groups.append(g)
            if fail:
                continue
            sc = _scenario_from_groups(
                "monolith",
                "Wygoda (mało dostaw)",
                "Zamówienie u maksymalnie 2 dostawców (żaden nie ma pełnego asortymentu solo).",
                viable_groups,
                [],
                suppliers_meta,
            )
            if best is None or (sc["viable"] and sc["total_pln"] < best["total_pln"]):
                best = sc

    if best:
        return best
    if mono:
        g = {
            "supplier_id": mono["supplier_id"],
            "supplier_name": mono["supplier_name"],
            "supplier_email": mono.get("supplier_email"),
            "items": mono["items"],
            "subtotal_pln": mono["subtotal_pln"],
            "min_order_value": mono.get("min_order_value", 0),
        }
        return _scenario_from_groups(
            "monolith",
            "Wygoda (mało dostaw)",
            "Najlepszy pojedynczy dostawca (częściowe pokrycie).",
            [g],
            list(mono.get("missing") or []),
            suppliers_meta,
        )
    return _empty_monolith()


def _empty_monolith() -> dict:
    return {
        "id": "monolith",
        "label": "Wygoda (mało dostaw)",
        "description": "Brak dostawcy pokrywającego asortyment.",
        "suppliers": [],
        "products_pln": 0.0,
        "shipping_pln": 0.0,
        "total_pln": 0.0,
        "supplier_count": 0,
        "meets_all_minimums": False,
        "missing": [],
        "viable": False,
    }

__all__ = ['_empty_monolith', 'compute_monolith_scenario']
