"""
Konwersje jednostek kulinarnych (g/kg/ml/l/szt) — pure helpers.
Wydzielone z server.py (dekalog §I).
"""
from __future__ import annotations

from typing import Optional

PIECE_DEFAULT_SIZE = 200.0  # domyślnie 1 szt/opak ≈ 200 g/ml

PIECE_UNITS = {
    "szt", "szt.", "sztuka", "sztuki", "op", "op.", "opak", "opakowanie",
    "peczek", "peczki", "peczka", "wiazka", "wiazki", "bunch", "bunches",
}


def is_piece_unit(u: str) -> bool:
    x = (u or "").strip().lower()
    return x in PIECE_UNITS or x.startswith("szt") or x.startswith("op")


def to_base(qty: float, unit: str) -> tuple[float, str]:
    """Sprowadza do wspólnej bazy. Gęstość gastronomiczna 1 g == 1 ml."""
    u = (unit or "").lower().strip().rstrip(".")
    if u in ("kg", "kilogram"):
        return qty * 1000.0, "g"
    if u in ("g", "gram", "gramy"):
        return qty, "g"
    if u in ("l", "litr", "litry"):
        return qty * 1000.0, "g"
    if u in ("ml", "mililitr"):
        return qty, "g"
    return qty, u


def convert(qty: float, from_unit: str, to_unit: str) -> Optional[float]:
    a, ua = to_base(qty, from_unit)
    b, ub = to_base(1.0, to_unit)
    if ua != ub:
        return None
    return a / b


def to_gml(qty: float, unit: str, unit_size: float) -> Optional[float]:
    """Zamiana na wspólną bazę g/ml. None dla nieznanej jednostki."""
    u = " ".join((unit or "").lower().split())
    if u == "kg":
        return qty * 1000.0
    if u in ("g", "gram", "gramy"):
        return qty
    if u in ("l", "litr", "litry"):
        return qty * 1000.0
    if u == "ml":
        return qty
    if is_piece_unit(u):
        return qty * unit_size
    return None


def from_gml(val: float, unit: str, unit_size: float) -> Optional[float]:
    u = " ".join((unit or "").lower().split())
    if u == "kg":
        return val / 1000.0
    if u in ("g", "gram", "gramy"):
        return val
    if u in ("l", "litr", "litry"):
        return val / 1000.0
    if u == "ml":
        return val
    if is_piece_unit(u):
        return (val / unit_size) if unit_size else None
    return None


def convert_culinary(
    qty: float,
    from_unit: str,
    to_unit: str,
    unit_size: Optional[float] = None,
) -> Optional[float]:
    """Konwersja g/kg/ml/l/szt/opak. g↔ml = 1:1. None dla nieznanej jednostki."""
    try:
        size = float(unit_size) if (unit_size and float(unit_size) > 0) else PIECE_DEFAULT_SIZE
    except (TypeError, ValueError):
        size = PIECE_DEFAULT_SIZE
    gml = to_gml(qty, from_unit, size)
    if gml is None:
        return None
    return from_gml(gml, to_unit, size)


def canon_dim(u: str) -> Optional[str]:
    """Wymiar: 'gml' dla g/kg/ml/l, 'szt' dla sztuk."""
    x = (u or "").strip().lower().rstrip(".")
    if x in ("g", "gram", "gramy", "kg", "kilogram", "ml", "mililitr", "l", "litr", "litry"):
        return "gml"
    if x in (
        "szt", "sztuka", "sztuki", "opak", "op", "opakowanie",
        "plaster", "plasterek", "listek", "list", "zabek", "ząbek",
    ):
        return "szt"
    return None


def yield_available(
    stock_qty: float,
    stock_unit: str,
    uwv: Optional[float],
    wvu: Optional[str],
    recipe_unit: str,
) -> tuple[Optional[float], bool]:
    """Ile surowca (w jednostce receptury) mamy w magazynie."""
    direct = convert(stock_qty, stock_unit, recipe_unit)
    if direct is not None:
        return direct, True
    if is_piece_unit(stock_unit) and uwv and wvu:
        total_wv = float(stock_qty) * float(uwv)
        conv = convert(total_wv, wvu, recipe_unit)
        if conv is not None:
            return conv, True
    return None, False
