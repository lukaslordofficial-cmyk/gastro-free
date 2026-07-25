"""Pure functions for Łowca Okazji (Monolith vs Split optimization)."""
from __future__ import annotations

from typing import Any, Optional

PRICE_TOLERANCE = 0.01


def line_total(unit_price_base: float, base_qty: float) -> float:
    return round(float(unit_price_base) * float(base_qty), 2)


def _supplier_meta(suppliers_meta: dict[str, dict], sid: str) -> dict:
    return suppliers_meta.get(sid) or {}


def _min_order_value(suppliers_meta: dict[str, dict], sid: str) -> float:
    try:
        return float(_supplier_meta(suppliers_meta, sid).get("min_order_value") or 0)
    except (TypeError, ValueError):
        return 0.0


def _meets_minimum(subtotal: float, min_val: float) -> bool:
    if min_val <= 0:
        return True
    return subtotal >= min_val


def _item_line_entry(pi: dict, b: dict) -> dict:
    return {
        "product_name": pi["product_name"],
        "quantity": pi["quantity"],
        "unit": pi["unit"],
        "base_dim": pi["base_dim"],
        "unit_price_base": b["unit_price_base"],
        "matched_name": b["matched_name"],
        "line_total": b["line_total"],
    }


def compute_monolith(
    items: list[dict],
    suppliers_meta: dict[str, dict],
) -> Optional[dict]:
    """Variant A: single supplier with best coverage, then lowest subtotal."""
    all_supplier_ids: set[str] = set()
    for pi in items:
        all_supplier_ids.update(pi.get("best_by_supplier") or {})

    best_single = None
    for sid in all_supplier_ids:
        covered = [pi for pi in items if sid in (pi.get("best_by_supplier") or {})]
        total = round(
            sum(pi["best_by_supplier"][sid]["line_total"] for pi in covered), 2
        )
        meta = _supplier_meta(suppliers_meta, sid)
        cand = {
            "supplier_id": sid,
            "supplier_name": meta.get("name") or "Dostawca",
            "supplier_email": meta.get("email"),
            "covered_count": len(covered),
            "subtotal_pln": total,
            "min_order_value": _min_order_value(suppliers_meta, sid),
        }
        if best_single is None:
            best_single = cand
        else:
            better = (cand["covered_count"], -cand["subtotal_pln"]) > (
                best_single["covered_count"],
                -best_single["subtotal_pln"],
            )
            if better:
                best_single = cand

    if best_single is None:
        return None

    sid = best_single["supplier_id"]
    items_o1: list[dict] = []
    missing_o1: list[str] = []
    for pi in items:
        b = (pi.get("best_by_supplier") or {}).get(sid)
        if b is None:
            missing_o1.append(pi["product_name"])
            continue
        items_o1.append(_item_line_entry(pi, b))

    subtotal = best_single["subtotal_pln"]
    min_val = best_single["min_order_value"]
    return {
        "type": "all_one_supplier",
        "supplier_id": sid,
        "supplier_name": best_single["supplier_name"],
        "supplier_email": best_single["supplier_email"],
        "items": items_o1,
        "subtotal_pln": subtotal,
        "total_pln": subtotal,
        "min_order_value": min_val,
        "meets_minimum_order": _meets_minimum(subtotal, min_val),
        "missing": missing_o1,
    }


def compute_split(
    items: list[dict],
    suppliers_meta: dict[str, dict],
) -> dict:
    """Variant B: cheapest supplier per SKU, grouped by supplier.

    Preferuje oferty, które same spełniają min_order (can_solo), żeby nie
    tworzyć koszyków typu „jajka za 8 zł przy minimum 800 zł”.
    """
    groups: dict[str, dict] = {}
    missing_o2: list[str] = []

    for pi in items:
        bbs = pi.get("best_by_supplier") or {}
        if not bbs:
            missing_o2.append(pi["product_name"])
            continue

        def _score(kv: tuple[str, dict]) -> tuple:
            sid, b = kv
            lt = float(b["line_total"])
            min_v = _min_order_value(suppliers_meta, sid)
            can_solo = min_v <= 0 or lt >= min_v
            return (0 if can_solo else 1, lt)

        sid, b = min(bbs.items(), key=_score)
        g = groups.setdefault(
            sid,
            {
                "supplier_id": sid,
                "supplier_name": b["supplier_name"],
                "supplier_email": b["supplier_email"],
                "items": [],
                "subtotal_pln": 0.0,
                "min_order_value": _min_order_value(suppliers_meta, sid),
            },
        )
        g["items"].append(_item_line_entry(pi, b))
        g["subtotal_pln"] = round(g["subtotal_pln"] + b["line_total"], 2)

    for g in groups.values():
        g["meets_minimum_order"] = _meets_minimum(
            g["subtotal_pln"], g["min_order_value"]
        )

    optimized_suppliers = list(groups.values())
    optimized_total = round(sum(g["subtotal_pln"] for g in optimized_suppliers), 2)
    return {
        "type": "optimized",
        "suppliers": optimized_suppliers,
        "total_pln": optimized_total,
        "missing": missing_o2,
    }


def find_tied_suppliers(
    item: dict,
    target_total: float,
    suppliers_meta: dict[str, dict],
    tol: float = PRICE_TOLERANCE,
) -> list[dict]:
    """For a single SKU: all suppliers with the same line total and min_order_value."""
    bbs = item.get("best_by_supplier") or {}
    if not bbs:
        return []

    target = round(float(target_total), 2)
    ref_min: Optional[float] = None
    tied: list[dict] = []

    for sid, b in bbs.items():
        total = round(float(b["line_total"]), 2)
        if abs(total - target) > tol:
            continue
        min_val = _min_order_value(suppliers_meta, sid)
        if ref_min is None:
            ref_min = min_val
        if abs(min_val - ref_min) > tol:
            continue
        meta = _supplier_meta(suppliers_meta, sid)
        tied.append(
            {
                "supplier_id": sid,
                "supplier_name": b.get("supplier_name") or meta.get("name") or "Dostawca",
                "supplier_email": b.get("supplier_email") or meta.get("email"),
                "total_pln": total,
                "subtotal_pln": total,
                "min_order_value": min_val,
                "meets_minimum_order": _meets_minimum(total, min_val),
                "matched_name": b.get("matched_name"),
                "unit_price_base": b.get("unit_price_base"),
            }
        )

    tied.sort(key=lambda x: x["supplier_name"])
    return tied


def to_pricing_matrix(items: list[dict], suppliers_meta: dict[str, dict]) -> list[dict]:
    matrix: list[dict] = []
    for pi in items:
        quotes = []
        for sid, b in (pi.get("best_by_supplier") or {}).items():
            min_val = _min_order_value(suppliers_meta, sid)
            quotes.append(
                {
                    "supplier_id": sid,
                    "supplier_name": b.get("supplier_name"),
                    "supplier_email": b.get("supplier_email"),
                    "unit_price_base": b["unit_price_base"],
                    "matched_name": b.get("matched_name"),
                    "min_order_value": min_val,
                }
            )
        matrix.append(
            {
                "product_key": pi["product_name"],
                "product_name": pi["product_name"],
                "quantity": pi["quantity"],
                "unit": pi["unit"],
                "base_dim": pi["base_dim"],
                "base_quantity": pi.get("base_quantity"),
                "quotes": quotes,
            }
        )
    return matrix


def _effective_total(option: Optional[dict]) -> Optional[float]:
    if option is None:
        return None
    if option.get("missing"):
        return None
    try:
        return round(float(option.get("total_pln") or 0), 2)
    except (TypeError, ValueError):
        return None


def _split_total(split: dict) -> Optional[float]:
    if split.get("missing"):
        return None
    if not split.get("suppliers"):
        return None
    try:
        return round(float(split.get("total_pln") or 0), 2)
    except (TypeError, ValueError):
        return None


def _monolith_to_best(monolith: dict) -> dict:
    return {
        "type": "single",
        "supplier_id": monolith["supplier_id"],
        "supplier_name": monolith["supplier_name"],
        "supplier_email": monolith.get("supplier_email"),
        "items": monolith["items"],
        "subtotal_pln": monolith["subtotal_pln"],
        "total_pln": monolith["total_pln"],
        "min_order_value": monolith.get("min_order_value", 0),
        "meets_minimum_order": monolith.get("meets_minimum_order", True),
        "missing": monolith.get("missing") or [],
    }


def _split_to_best(split: dict) -> dict:
    suppliers = split.get("suppliers") or []
    if len(suppliers) == 1:
        g = suppliers[0]
        return {
            "type": "single",
            "supplier_id": g["supplier_id"],
            "supplier_name": g["supplier_name"],
            "supplier_email": g.get("supplier_email"),
            "items": g["items"],
            "subtotal_pln": g["subtotal_pln"],
            "total_pln": g["subtotal_pln"],
            "min_order_value": g.get("min_order_value", 0),
            "meets_minimum_order": g.get("meets_minimum_order", True),
            "missing": split.get("missing") or [],
        }
    return {
        "type": "split_single_view",
        "suppliers": suppliers,
        "subtotal_pln": split["total_pln"],
        "total_pln": split["total_pln"],
        "missing": split.get("missing") or [],
    }


def build_optimize_response(
    items: list[dict],
    suppliers_meta: dict[str, dict],
) -> dict[str, Any]:
    monolith = compute_monolith(items, suppliers_meta)
    split = compute_split(items, suppliers_meta)

    total_a = _effective_total(monolith)
    total_b = _split_total(split)

    unique_count = len(items)
    same_total = (
        total_a is not None
        and total_b is not None
        and abs(total_a - total_b) <= PRICE_TOLERANCE
    )
    is_optimized = (
        unique_count > 1
        and total_a is not None
        and total_b is not None
        and not same_total
    )

    pricing_matrix = to_pricing_matrix(items, suppliers_meta)
    items_requested = [
        {
            "product_name": pi["product_name"],
            "quantity": pi["quantity"],
            "unit": pi["unit"],
            "found": bool(pi.get("best_by_supplier")),
        }
        for pi in items
    ]

    if not is_optimized:
        best_option = None
        tied: list[dict] = []

        if total_a is not None and (total_b is None or total_a <= total_b):
            if monolith and not monolith.get("missing"):
                best_option = _monolith_to_best(monolith)
        if best_option is None and total_b is not None:
            if split and not split.get("missing"):
                best_option = _split_to_best(split)
        if best_option is None and monolith:
            best_option = _monolith_to_best(monolith)
        if best_option is None and split.get("suppliers"):
            best_option = _split_to_best(split)

        if unique_count == 1 and items and best_option:
            target = best_option.get("total_pln") or best_option.get("subtotal_pln") or 0
            tied = find_tied_suppliers(items[0], target, suppliers_meta)

        result = {
            "currency": "PLN",
            "is_optimized": False,
            "items_requested": items_requested,
            "best_option": best_option,
            "tied_suppliers": tied,
            "variant_monolith": monolith,
            "variant_split": split,
            "savings_pln": 0.0,
            "cheaper_variant": None,
            "pricing_matrix": pricing_matrix,
        }
    else:
        savings = round(abs(total_a - total_b), 2)
        cheaper = "split" if (total_b or 0) < (total_a or 0) else "monolith"
        result = {
            "currency": "PLN",
            "is_optimized": True,
            "items_requested": items_requested,
            "best_option": None,
            "tied_suppliers": [],
            "variant_monolith": monolith,
            "variant_split": split,
            "savings_pln": savings,
            "cheaper_variant": cheaper,
            "pricing_matrix": pricing_matrix,
        }

    result["option_all_one"] = monolith
    result["option_optimized"] = split
    if is_optimized:
        if cheaper == "split":
            result["savings_pln"] = round((total_a or 0) - (total_b or 0), 2)
        else:
            result["savings_pln"] = round((total_b or 0) - (total_a or 0), 2)
        if result["savings_pln"] < 0:
            result["savings_pln"] = 0.0
    else:
        result["savings_pln"] = 0.0

    result["assistant_speech"] = build_offer_speech(result)
    return result


def fmt_pln(v: float) -> str:
    return f"{v:.2f}".replace(".", ",") + " zł"


def build_offer_speech(result: dict) -> str:
    if not result.get("items_requested") or not any(
        i.get("found") for i in result["items_requested"]
    ):
        return (
            "Niestety nie znalazłem tych produktów w katalogu dostawców. "
            "Sprawdź nazwę lub dodaj produkt do oferty dostawcy."
        )

    if not result.get("is_optimized"):
        best = result.get("best_option")
        tied = result.get("tied_suppliers") or []
        if tied and len(tied) > 1:
            names = ", ".join(t["supplier_name"] for t in tied)
            price = fmt_pln(tied[0]["total_pln"])
            return (
                f"Ten produkt możesz zamówić u {len(tied)} dostawców po tej samej cenie "
                f"({price}): {names}."
            )
        if best and best.get("supplier_name"):
            total = best.get("total_pln") or best.get("subtotal_pln") or 0
            return (
                f"Najlepsza oferta: {best['supplier_name']} za {fmt_pln(total)}. "
                "Możesz od razu przygotować zamówienie."
            )
        return "Znalazłem oferty — wybierz dostawcę poniżej."

    mono = result.get("variant_monolith")
    split = result.get("variant_split") or {}
    savings = float(result.get("savings_pln") or 0)
    parts: list[str] = []

    if mono and not mono.get("missing"):
        parts.append(
            f"Opcja 1, wszystko u jednego dostawcy — {mono['supplier_name']} "
            f"za {fmt_pln(mono['total_pln'])}"
        )
    suppliers = split.get("suppliers") or []
    if suppliers:
        names = " i ".join(g["supplier_name"] for g in suppliers)
        if len(suppliers) == 1:
            parts.append(
                f"Opcja 2, najtaniej u {names} za {fmt_pln(split['total_pln'])}"
            )
        else:
            parts.append(
                f"Opcja 2, z rozbiciem na {names} za {fmt_pln(split['total_pln'])}"
            )

    speech = ". ".join(parts) + "." if parts else "Porównaj obie opcje poniżej."
    if savings > PRICE_TOLERANCE:
        speech += f" Oszczędzasz {fmt_pln(savings)} wybierając tańszą opcję."
    speech += " Którą wybierasz?"
    return speech
