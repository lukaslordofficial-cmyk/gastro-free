"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `catalog_units`."""
from __future__ import annotations

from culinary_units import PIECE_DEFAULT_SIZE as _PIECE_DEFAULT_SIZE
from order_email_format import fmt_qty as _fmt_qty
from typing import Optional
from typing import Tuple
from matching_utils import _norm_unit



def _catalog_base_price(row: dict):
    """(base_dim, cena_za_jednostke_bazowa) na podstawie wiersza supplier_catalog."""
    try:
        price = float(row.get("price_pln") or 0)
    except (TypeError, ValueError):
        price = 0.0
    if price <= 0:
        return None
    try:
        liters = float(row.get("liters_total") or 0)
    except (TypeError, ValueError):
        liters = 0.0
    # Produkty płynne mają wypełnione liters_total → cena za litr
    if liters > 0:
        return ("l", price / liters)
    # Produkty sztukowe/opakowaniowe z podaną wagą (kg_total) → cena za kg.
    try:
        kg = float(row.get("kg_total") or 0)
    except (TypeError, ValueError):
        kg = 0.0
    if kg > 0:
        return ("kg", price / kg)
    base_dim, _ = _norm_unit(row.get("unit"))
    if base_dim in ("kg", "l"):
        # W tym katalogu cena dla jednostek wagowych/objętościowych jest za 1 kg / 1 l
        return (base_dim, price)
    # Sztuki / opakowania: dzielimy cenę paczki przez liczbę sztuk
    try:
        count = float(row.get("unit_count") or 1) or 1.0
    except (TypeError, ValueError):
        count = 1.0
    return ("szt", price / count)


def _catalog_pack_base_qty(row: dict, base_dim: str) -> float:
    """Wielkość jednego opakowania katalogowego w jednostce bazowej (kg/l/szt)."""
    try:
        liters = float(row.get("liters_total") or 0)
    except (TypeError, ValueError):
        liters = 0.0
    if liters > 0 and base_dim == "l":
        return liters
    try:
        kg = float(row.get("kg_total") or 0)
    except (TypeError, ValueError):
        kg = 0.0
    if kg > 0 and base_dim == "kg":
        return kg
    try:
        count = float(row.get("unit_count") or 0)
    except (TypeError, ValueError):
        count = 0.0
    if count > 0 and base_dim == "szt":
        return count
    return 1.0


def _catalog_available_base_qty(row: dict, base_dim: str) -> Optional[float]:
    """Max. dostępna ilość oferty w jednostce bazowej (kg/l/szt).

    Dla hurtowników (brak stocku w katalogu) → None (= bez limitu).
    Dla lokalnych dostawców `available_stock` / `stock` jest w jednostce produktu.
    """
    raw = row.get("available_stock")
    if raw is None:
        raw = row.get("stock")
    if raw is None:
        return None
    try:
        stock = float(raw)
    except (TypeError, ValueError):
        return None
    if stock <= 0:
        return 0.0

    unit_raw = (row.get("unit") or "szt").strip() or "szt"
    stock_dim, stock_factor = _norm_unit(unit_raw)
    stock_in_unit_dim = stock * stock_factor

    try:
        kg_pack = float(row.get("kg_total") or 0)
    except (TypeError, ValueError):
        kg_pack = 0.0
    try:
        l_pack = float(row.get("liters_total") or 0)
    except (TypeError, ValueError):
        l_pack = 0.0

    if base_dim == stock_dim:
        return round(stock_in_unit_dim, 6)
    # Opakowania sztukowe z wagą/objętością → przelicz na kg/l
    if base_dim == "kg" and kg_pack > 0 and stock_dim == "szt":
        return round(stock * kg_pack, 6)
    if base_dim == "l" and l_pack > 0 and stock_dim == "szt":
        return round(stock * l_pack, 6)
    if base_dim == "szt" and stock_dim == "szt":
        return round(stock, 6)
    # Brak bezpiecznej konwersji — traktuj stock jako już w base_dim (np. unit=kg)
    if stock_dim in ("kg", "l", "szt") and base_dim in ("kg", "l", "szt"):
        return None
    return round(stock_in_unit_dim, 6)


def _cap_order_qty_to_available_stock(
    order_base: float,
    pack: float,
    row: dict,
    base_dim: str,
) -> Tuple[float, bool]:
    """Ogranicza ilość zamówienia do stocku lokalnego dostawcy.

    Przykład: potrzeba 5 kg, stock 3 kg → zamów 3 kg (nawet poniżej pasma ±10%).
    Zwraca (qty, stock_capped).
    """
    import math

    avail = _catalog_available_base_qty(row, base_dim)
    if avail is None:
        return float(order_base or 0), False
    if avail <= 0:
        return 0.0, True

    qty = float(order_base or 0)
    if qty <= avail + 1e-9:
        return qty, False

    pack_v = float(pack or 0) or 0.0
    # Ciągłe / jednostkowe (kg luzem, litry) — utnij do stocku
    if pack_v <= 1.0001:
        return round(avail, 4), True

    # Pełne opakowania mieszczące się w stocku
    n = int(math.floor(avail / pack_v + 1e-9))
    if n >= 1:
        return round(n * pack_v, 4), True
    # Stock mniejszy niż 1 opakowanie, ale > 0 — sprzedaj dostępne (np. 0.5 kg z worka 1 kg)
    return round(avail, 4), True


def _qty_in_band(target: float, lo: float, hi: float, pack: float) -> Tuple[float, bool]:
    """Dobiera ilość w paśmie [lo, hi] (±10% wokół targetu), preferując pełne opakowania.

    Zwraca (qty, pack_adjusted). pack_adjusted=True gdy żadne opakowanie nie dało
    dokładnie żądanej ilości / nie mieściło się w paśmie — wybrano najmniejsze
    pełne opakowanie pokrywające zapotrzebowanie (może być powyżej hi).
    """
    import math
    t = max(0.0, float(target or 0))
    lo_v = max(0.0, float(lo if lo is not None else t * 0.9))
    hi_v = max(lo_v, float(hi if hi is not None else t * 1.1))
    if t <= 0:
        return 0.0, False
    pack_v = float(pack or 1.0)
    if pack_v <= 0:
        pack_v = 1.0
    # ciągłe / jednostkowe — trzymaj target w paśmie
    if pack_v <= 1.0001 and abs(pack_v - 1.0) < 1e-6:
        return round(min(hi_v, max(lo_v, t)), 4), False
    # pełne paczki w paśmie
    n_lo = max(1, int(math.ceil(lo_v / pack_v - 1e-9)))
    n_hi = max(n_lo, int(math.floor(hi_v / pack_v + 1e-9)))
    best_n = None
    best_score = None
    for n in range(n_lo, n_hi + 1):
        qty = n * pack_v
        if qty < lo_v - 1e-9 or qty > hi_v + 1e-9:
            continue
        under = max(0.0, t - qty)
        dist = abs(qty - t)
        score = (under, dist, qty)
        if best_score is None or score < best_score:
            best_score = score
            best_n = n
    if best_n is not None:
        qty = round(best_n * pack_v, 4)
        adjusted = abs(qty - t) > max(0.001, t * 0.02)
        return qty, adjusted
    # Żadna paczka w paśmie — zaokrąglij w górę do pokrycia targetu (nawet powyżej hi)
    n_need = max(1, int(math.ceil(t / pack_v - 1e-9)))
    qty_up = round(n_need * pack_v, 4)
    return qty_up, True


def _fmt_base_qty(q: float, dim: str) -> str:
    """Czytelna PL etykieta ilości w jednostce bazowej kg/l/szt."""
    qq = float(q or 0)
    if dim == "kg":
        if qq >= 1:
            return f"{_fmt_qty(qq)} kg"
        return f"{_fmt_qty(qq * 1000)} g"
    if dim == "l":
        if qq >= 1:
            return f"{_fmt_qty(qq)} l"
        return f"{_fmt_qty(qq * 1000)} ml"
    return f"{_fmt_qty(qq)} szt"


def _piece_mass_base(pieces: float, unit_weight_volume, weight_volume_unit: Optional[str]):
    """Przelicza sztuki → (base_dim, qty) przez gramaturę 1 szt. (unit_weight_volume)."""
    try:
        uwv = float(unit_weight_volume) if unit_weight_volume is not None else 0.0
    except (TypeError, ValueError):
        uwv = 0.0
    if uwv <= 0:
        uwv = _PIECE_DEFAULT_SIZE
    wvu = (weight_volume_unit or "g").strip().lower().rstrip(".")
    pcs = float(pieces or 0)
    if wvu in ("kg", "kilogram"):
        return "kg", pcs * uwv
    if wvu in ("l", "litr", "litry"):
        return "l", pcs * uwv
    if wvu in ("ml", "mililitr"):
        return "l", pcs * uwv * 0.001
    # domyślnie g
    return "kg", pcs * uwv * 0.001


def _convert_req_to_catalog_dim(
    req_base_qty: float,
    req_dim: str,
    catalog_dim: str,
    unit_weight_volume=None,
    weight_volume_unit: Optional[str] = None,
) -> Optional[float]:
    """Przelicza zapotrzebowanie do wymiaru oferty katalogowej (kg/l/szt)."""
    if req_dim == catalog_dim:
        return float(req_base_qty)
    if req_dim == "szt" and catalog_dim in ("kg", "l"):
        dim, qty = _piece_mass_base(req_base_qty, unit_weight_volume, weight_volume_unit)
        if dim != catalog_dim:
            return None
        return qty
    if catalog_dim == "szt" and req_dim in ("kg", "l"):
        try:
            uwv = float(unit_weight_volume) if unit_weight_volume is not None else 0.0
        except (TypeError, ValueError):
            uwv = 0.0
        if uwv <= 0:
            uwv = _PIECE_DEFAULT_SIZE
        wvu = (weight_volume_unit or "g").strip().lower().rstrip(".")
        if req_dim == "kg":
            per = uwv if wvu in ("kg", "kilogram") else uwv * 0.001
        else:
            per = uwv if wvu in ("l", "litr", "litry") else uwv * 0.001
        if per <= 0:
            return None
        import math
        return float(math.ceil(float(req_base_qty) / per - 1e-9))
    return None


def _pack_mismatch_note(product: str, needed_base: float, ordered_base: float, dim: str) -> Optional[str]:
    """Polska notatka gdy opakowanie nie daje dokładnie żądanej ilości."""
    if ordered_base <= 0 or needed_base <= 0:
        return None
    if abs(ordered_base - needed_base) <= max(0.001, needed_base * 0.02):
        return None
    need_s = _fmt_base_qty(needed_base, dim)
    got_s = _fmt_base_qty(ordered_base, dim)
    return (
        f"{product}: dostawcy nie mają opakowań dających dokładnie {need_s} — "
        f"dodano {got_s} jako najmniejszą / najlepszą opcję pokrywającą zapotrzebowanie."
    )

__all__ = ['_cap_order_qty_to_available_stock', '_catalog_available_base_qty', '_catalog_base_price', '_catalog_pack_base_qty', '_convert_req_to_catalog_dim', '_fmt_base_qty', '_pack_mismatch_note', '_piece_mass_base', '_qty_in_band']
