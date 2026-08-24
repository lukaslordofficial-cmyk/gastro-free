"""
Spójność jednostek / ilości składników z Vision (menu scan / suggest).

Bug history: AI raz zwracało g, raz ml dla tego samego składnika.
Wydzielone z server.py (dekalog §I).
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Callable, Optional

from culinary_units import canon_dim, convert_culinary
from ingredient_name_norm import norm_name

LIQUID_NAME_HINTS = (
    "smietan", "śmietan", "mlek", "olej", "sos", "bulion", "wywar", "woda",
    "sok", "krem", "ocet", "syrop", "wino", "piwo", "śmieta", "majonez",
    "musztard", "ketchup", "passata", "przecier", "esencj", "napój", "napoj",
)


def iter_ingredients(dish: Any) -> list[Any]:
    """Lista składników niezależnie od modelu (scan/suggest/confirm)."""
    for attr in ("suggested_ingredients", "ingredients"):
        val = getattr(dish, attr, None)
        if val is not None:
            return list(val)
    return []


def normalize_recipe_quantity(qty: Any, unit: str = "") -> int:
    """Ilości w recepturze: zawsze całkowite ≥ 1."""
    try:
        q = float(qty)
    except (TypeError, ValueError):
        return 1
    if q <= 0:
        return 1
    if q < 1:
        return 1
    return max(1, int(round(q)))


def apply_integer_quantities_to_dishes(dishes: list[Any]) -> None:
    """In-place: quantity → int ≥ 1. Null → 1."""
    for d in dishes:
        for ing in iter_ingredients(d):
            if isinstance(ing, dict):
                q = ing.get("quantity")
                ing["quantity"] = normalize_recipe_quantity(
                    1 if q is None else q, ing.get("unit") or ""
                )
            else:
                q = getattr(ing, "quantity", None)
                setattr(
                    ing,
                    "quantity",
                    normalize_recipe_quantity(
                        1 if q is None else q, getattr(ing, "unit", "") or ""
                    ),
                )


def canonicalize_ingredient_units(dishes: list[Any]) -> None:
    """In-place: ta sama nazwa składnika → ta sama jednostka w całym skanie."""
    votes: dict[str, Counter] = {}
    for d in dishes:
        for ing in iter_ingredients(d):
            name = norm_name(getattr(ing, "name", "") or "")
            unit = getattr(ing, "unit", "") or ""
            if not name or canon_dim(unit) != "mass":
                continue
            u = unit.strip().lower().rstrip(".")
            base = "g" if u in ("g", "gram", "gramy", "kg", "kilogram") else "ml"
            votes.setdefault(name, Counter())[base] += 1

    canon: dict[str, str] = {}
    for name, ctr in votes.items():
        top = ctr.most_common()
        best = top[0][1]
        tied = [u for u, c in top if c == best]
        if len(tied) == 1:
            canon[name] = tied[0]
        else:
            canon[name] = "ml" if any(h in name for h in LIQUID_NAME_HINTS) else "g"

    for d in dishes:
        for ing in iter_ingredients(d):
            name = norm_name(getattr(ing, "name", "") or "")
            if name not in canon:
                continue
            target = canon[name]
            cur = getattr(ing, "unit", "") or ""
            q = getattr(ing, "quantity", None)
            if q is not None and (cur or "").strip().lower().rstrip(".") != target:
                conv = convert_culinary(float(q), cur, target)
                if conv is not None:
                    try:
                        ing.quantity = round(conv, 2)
                    except Exception:  # noqa: BLE001
                        pass
            ing.unit = target


def is_porcja_row(name: str, *, norm_name_fn: Optional[Callable[[str], str]] = None) -> bool:
    """Wiersz „porcja / gramatura” — nie jest składnikiem magazynowym."""
    nn = (norm_name_fn or norm_name)(name)
    return nn in (
        "porcja", "porcje", "wielkosc porcji", "wielkość porcji",
        "wielkosc porc) i", "gramatura", "gramatura porcji",
    )
