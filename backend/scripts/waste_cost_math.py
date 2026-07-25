#!/usr/bin/env python3
"""
Pure-Python oracle kosztów strat + P&L (bez DB).

Formuła zysku (zgodnie z wymaganiem biznesowym):
  zysk = przychód − stałe − straty − (zmienne_brutto − straty)
       = przychód − stałe − zmienne_brutto

Straty są pokazywane osobno; zmienne netto = max(0, brutto − straty).
"""
from __future__ import annotations

from typing import Any, Optional


def _norm(s: str) -> str:
    return (
        (s or "")
        .lower()
        .replace("ł", "l")
        .replace("ą", "a")
        .replace("ę", "e")
        .replace("ó", "o")
        .replace("ś", "s")
        .replace("ć", "c")
        .replace("ń", "n")
        .replace("ż", "z")
        .replace("ź", "z")
        .strip()
    )


def _is_piece(u: str) -> bool:
    return _norm(u) in ("szt", "sztuki", "op", "opak", "opakowanie", "porcja", "porcje")


def to_gml(qty: float, unit: str, piece_size: float = 200.0) -> Optional[float]:
    u = _norm(unit)
    if u == "kg":
        return qty * 1000.0
    if u in ("g", "gram", "gramy"):
        return qty
    if u in ("l", "litr", "litry"):
        return qty * 1000.0
    if u == "ml":
        return qty
    if _is_piece(u) and u not in ("porcja", "porcje"):
        return qty * piece_size
    return None


def from_gml(val: float, unit: str, piece_size: float = 200.0) -> Optional[float]:
    u = _norm(unit)
    if u == "kg":
        return val / 1000.0
    if u in ("g", "gram", "gramy"):
        return val
    if u in ("l", "litr", "litry"):
        return val / 1000.0
    if u == "ml":
        return val
    if _is_piece(u) and u not in ("porcja", "porcje"):
        return val / piece_size if piece_size else None
    return None


def convert_culinary(qty: float, from_u: str, to_u: str, piece_size: float = 200.0) -> Optional[float]:
    gml = to_gml(qty, from_u, piece_size)
    if gml is None:
        return None
    return from_gml(gml, to_u, piece_size)


def dish_portions(qty: float, unit: str, portion_g: float) -> float:
    u = _norm(unit)
    if u in ("porcja", "porcje", "szt") or (_is_piece(u) and u not in ("op", "opak", "opakowanie")):
        return float(qty)
    if u in ("l", "ml") and portion_g > 0:
        ml = qty * (1000.0 if u == "l" else 1.0)
        return ml / portion_g
    if u in ("kg", "g") and portion_g > 0:
        g = qty * (1000.0 if u == "kg" else 1.0)
        return g / portion_g
    return float(qty)


def ingredient_qty_in_inv_unit(qty: float, from_unit: str, inv: dict) -> float:
    inv_u = (inv.get("unit") or "").strip().lower()
    waste_u = (from_unit or inv_u or "").strip().lower()
    if not inv_u or not waste_u or inv_u == waste_u:
        return float(qty)
    converted = convert_culinary(float(qty), waste_u, inv_u)
    return float(converted) if converted is not None else float(qty)


def inv_index(inventory: list[dict]) -> dict[str, dict]:
    return {_norm(i["name"]): i for i in inventory}


def dish_index(dishes: list[dict]) -> dict[str, dict]:
    return {_norm(d["name"]): d for d in dishes}


def ingredient_waste_cost(qty: float, unit: str, inv: dict) -> float:
    base = ingredient_qty_in_inv_unit(qty, unit, inv)
    return round(base * float(inv.get("unit_cost") or 0), 4)


def dish_waste_cost(qty: float, unit: str, dish: dict, by_inv: dict[str, dict]) -> float:
    portions = dish_portions(qty, unit, float(dish.get("portion_size_grams") or 0))
    total = 0.0
    for line in dish.get("recipe") or []:
        name = line["name"]
        iq = float(line["qty"]) * portions
        iunit = line.get("unit") or "g"
        inv = by_inv.get(_norm(name))
        if not inv:
            continue
        base = ingredient_qty_in_inv_unit(iq, iunit, inv)
        total += base * float(inv.get("unit_cost") or 0)
    return round(total, 4)


def event_cost(event: dict, by_inv: dict, by_dish: dict) -> float:
    name = event["name"]
    qty = float(event["qty"])
    unit = event.get("unit") or ""
    if event.get("item_type") == "dish":
        dish = by_dish.get(_norm(name))
        if not dish:
            return 0.0
        return round(dish_waste_cost(qty, unit, dish, by_inv), 2)
    inv = by_inv.get(_norm(name))
    if not inv:
        return 0.0
    return round(ingredient_waste_cost(qty, unit, inv), 2)


def sum_losses(env: dict[str, Any]) -> dict[str, Any]:
    by_inv = inv_index(env["inventory"])
    by_dish = dish_index(env["dishes"])
    rows = []
    total = 0.0
    qty_by_key: dict[str, float] = {}
    for ev in env["losses"]:
        cost = event_cost(ev, by_inv, by_dish)
        total += cost
        key = f"{ev['item_type']}:{_norm(ev['name'])}"
        qty_by_key[key] = round(qty_by_key.get(key, 0.0) + float(ev["qty"]), 4)
        rows.append({**ev, "cost_pln": cost})
    return {
        "total_cost_pln": round(total, 2),
        "events": rows,
        "qty_by_key": qty_by_key,
        "events_count": len(rows),
    }


def compute_pnl(finance: dict, waste_pln: float) -> dict[str, float]:
    revenue = float(finance["revenue"])
    fixed = float(finance["fixed"])
    variable_gross = float(finance["variable_gross"])
    waste = float(waste_pln)
    variable_net = round(max(0.0, variable_gross - waste), 2)
    net = round(revenue - fixed - waste - variable_net, 2)
    # Równoważnie bez podwójnego liczenia:
    net_equiv = round(revenue - fixed - variable_gross, 2)
    double_count_wrong = round(revenue - fixed - variable_gross - waste, 2)
    return {
        "revenue": revenue,
        "fixed": fixed,
        "variable_gross": variable_gross,
        "variable_net": variable_net,
        "waste": round(waste, 2),
        "net_profit": net,
        "net_equiv_gross": net_equiv,
        "wrong_double_count": double_count_wrong,
    }


def evaluate_env(env: dict[str, Any]) -> dict[str, Any]:
    waste = sum_losses(env)
    pnl = compute_pnl(env["finance"], waste["total_cost_pln"])
    ok_equiv = abs(pnl["net_profit"] - pnl["net_equiv_gross"]) < 0.02
    ok_not_double = abs(pnl["net_profit"] - pnl["wrong_double_count"]) > 0.01 or waste["total_cost_pln"] == 0
    return {
        "id": env["id"],
        "title": env["title"],
        "window": env["window"],
        "waste": waste,
        "pnl": pnl,
        "checks": {
            "net_equals_rev_minus_fixed_minus_var_gross": ok_equiv,
            "not_double_counting_waste": ok_not_double if waste["total_cost_pln"] > 0 else True,
            "waste_events_costed": all(r["cost_pln"] > 0 for r in waste["events"]),
        },
    }
