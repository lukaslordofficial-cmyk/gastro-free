"""
Syntetyczne środowiska testowe dla symulacji Łowcy Okazji.

Każdy builder zwraca dict z kluczami: id, title, description, suppliers, catalog, tasks.
Brak zewnętrznych zależności — Python 3.11+.
"""
from __future__ import annotations

from typing import Any, Callable


def _sup(
    name: str,
    min_order_value: float,
    shipping_cost: float = 0,
    free_shipping_threshold: float = 0,
) -> dict[str, Any]:
    return {
        "name": name,
        "min_order_value": min_order_value,
        "shipping_cost": shipping_cost,
        "free_shipping_threshold": free_shipping_threshold,
    }


def _it(name: str, qty: float, unit: str = "kg") -> dict[str, Any]:
    row: dict[str, Any] = {"name": name, "qty": qty}
    if unit != "kg":
        row["unit"] = unit
    return row


def _task(task_id: str, label: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    return {"id": task_id, "label": label, "items": items}


def env_full_coverage() -> dict:
    """Bistro z 3 hurtowniami; prawie pełne pokrycie katalogu; min. ~250–350 zł."""
    suppliers = {
        "makro": _sup("Makro", 300, 25, 600),
        "selgros": _sup("Selgros", 350, 29, 700),
        "euro": _sup("Eurocash", 250, 35, 550),
    }
    catalog = {
        "wolowina": {"makro": 42.0, "selgros": 40.0, "euro": 43.5},
        "kurczak_filet": {"makro": 18.5, "selgros": 19.0, "euro": 17.8},
        "schab": {"makro": 28.0, "selgros": 27.0, "euro": 29.0},
        "mleko": {"makro": 3.2, "selgros": 3.0, "euro": 3.1},
        "smietana": {"makro": 6.5, "selgros": 6.0, "euro": 6.2},
        "maslo": {"makro": 8.0, "selgros": 7.5, "euro": 7.8},
        "cebula": {"makro": 2.5, "selgros": 2.2, "euro": 2.4},
        "ziemniak": {"makro": 1.8, "selgros": 1.5, "euro": 1.7},
        "makaron": {"makro": 5.0, "selgros": 4.5, "euro": 4.8},
        "ryz": {"makro": 4.0, "selgros": 4.2, "euro": 3.9},
        "olej": {"makro": 9.0, "selgros": 8.5, "euro": 8.8},
        "sol": {"makro": 2.0, "selgros": 1.8, "euro": 1.9},
    }
    tasks = [
        _task(
            "weekly_restock",
            "Cotygodniowe zatowarowanie 10 pozycji",
            [
                _it("wolowina", 8),
                _it("kurczak_filet", 12),
                _it("schab", 6),
                _it("mleko", 24, "l"),
                _it("smietana", 10, "l"),
                _it("maslo", 5),
                _it("cebula", 15),
                _it("ziemniak", 25),
                _it("makaron", 8),
                _it("olej", 6),
            ],
        ),
        _task(
            "meat_only",
            "Tylko mięso (3 SKU) — ryzyko mini-koszyków",
            [_it("wolowina", 5), _it("kurczak_filet", 8), _it("schab", 4)],
        ),
        _task(
            "dairy_bulk",
            "Nabiał + suchy — domknięcie min u Euro",
            [
                _it("mleko", 40, "l"),
                _it("smietana", 15, "l"),
                _it("maslo", 8),
                _it("makaron", 12),
                _it("ryz", 10),
                _it("sol", 4),
            ],
        ),
        _task(
            "veg_pantry",
            "Warzywa + spiżarnia — porównanie split vs monolith",
            [
                _it("cebula", 20),
                _it("ziemniak", 30),
                _it("makaron", 10),
                _it("ryz", 8),
                _it("olej", 5),
                _it("sol", 3),
            ],
        ),
        _task(
            "single_category_meat",
            "Duże zamówienie mięsne — powinno domknąć min u jednego",
            [
                _it("wolowina", 10),
                _it("kurczak_filet", 15),
                _it("schab", 8),
            ],
        ),
        _task(
            "mixed_small",
            "Małe mieszane — test praktyczności splitu",
            [
                _it("kurczak_filet", 3),
                _it("mleko", 6, "l"),
                _it("cebula", 4),
                _it("makaron", 2),
            ],
        ),
    ]
    return {
        "id": "full_coverage",
        "title": "Pełne pokrycie katalogu",
        "description": (
            "3 hurtownie mają niemal wszystkie produkty. Minima 250–350 zł. "
            "Sprawdza, czy Łowca wybiera najtańszy split bez rozbijania na niepraktyczne koszyki."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_sparse_catalog() -> dict:
    """Nie każdy dostawca ma każdy produkt — klasyczny ból realnych restauracji."""
    suppliers = {
        "rzeznia": _sup("Rzeźnia Lokalna", 400, 0, 0),
        "warzywa_pl": _sup("Warzywa PL", 200, 40, 450),
        "cashcarry": _sup("Cash&Carry", 500, 30, 800),
        "specialty": _sup("Specialty Import", 150, 55, 400),
    }
    catalog = {
        "wolowina": {"rzeznia": 38.0, "cashcarry": 41.0},
        "kurczak_filet": {"rzeznia": 17.0, "cashcarry": 18.5},
        "schab": {"rzeznia": 26.0, "cashcarry": 28.0},
        "cebula": {"warzywa_pl": 2.0, "cashcarry": 2.8},
        "ziemniak": {"warzywa_pl": 1.4, "cashcarry": 2.0},
        "pomidor": {"warzywa_pl": 6.5},
        "salata": {"warzywa_pl": 4.0},
        "makaron": {"cashcarry": 4.2, "specialty": 5.5},
        "ryz": {"cashcarry": 3.8, "specialty": 4.9},
        "olej": {"cashcarry": 8.0, "specialty": 9.5},
        "ocet_balsamiczny": {"specialty": 22.0},
        "trufla_olej": {"specialty": 45.0},
        "mleko": {"cashcarry": 3.1},
        "maslo": {"cashcarry": 7.6},
    }
    tasks = [
        _task(
            "full_menu_restock",
            "Pełne menu: mięso+warzywa+suchy+nabiał+specialty",
            [
                _it("wolowina", 6),
                _it("kurczak_filet", 10),
                _it("cebula", 12),
                _it("ziemniak", 20),
                _it("pomidor", 8),
                _it("makaron", 6),
                _it("mleko", 20, "l"),
                _it("ocet_balsamiczny", 2),
            ],
        ),
        _task(
            "specialty_trap",
            "Pułapka specialty: 2 drogie SKU poniżej min bez dopełnienia",
            [_it("ocet_balsamiczny", 1), _it("trufla_olej", 1)],
        ),
        _task(
            "veg_heavy",
            "Warzywa + ziemniak — czy domknie Warzywa PL (min 200)",
            [
                _it("cebula", 30),
                _it("ziemniak", 40),
                _it("pomidor", 15),
                _it("salata", 10),
            ],
        ),
        _task(
            "missing_product",
            "Produkt bez oferty (salata_iceberg) — musi w missing",
            [
                _it("kurczak_filet", 5),
                _it("salata_iceberg", 10),
                _it("mleko", 15, "l"),
            ],
        ),
        _task(
            "meat_vs_carry",
            "Mięso tylko u rzeźni vs cashcarry — wybór splitu",
            [
                _it("wolowina", 8),
                _it("kurczak_filet", 12),
                _it("schab", 5),
                _it("makaron", 4),
                _it("ryz", 4),
            ],
        ),
        _task(
            "specialty_only_order",
            "Same specialty — min 150, droga dostawa",
            [
                _it("ocet_balsamiczny", 3),
                _it("trufla_olej", 2),
                _it("olej", 4),
            ],
        ),
        _task(
            "dairy_dry_combo",
            "Nabiał + suchy u cashcarry — czy wystarczy na min 500",
            [
                _it("mleko", 30, "l"),
                _it("maslo", 6),
                _it("makaron", 15),
                _it("ryz", 12),
                _it("olej", 8),
            ],
        ),
    ]
    return {
        "id": "sparse_catalog",
        "title": "Dziurawe katalogi (niepełne pokrycie)",
        "description": (
            "4 dostawców specjalistycznych — żaden nie ma pełnego asortymentu. "
            "Kluczowy test: Łowca musi łączyć koszyki bez tworzenia luk >100 zł."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_uneven_mins() -> dict:
    """Tani dostawca z wysokim min vs droższy z niskim — klasyczny trade-off."""
    suppliers = {
        "cheap_bigmin": _sup("Hurt Tani (min 800)", 800, 0, 0),
        "mid_ok": _sup("Średniak (min 250)", 250, 20, 500),
        "local_exp": _sup("Lokalny droższy (min 100)", 100, 15, 300),
    }
    catalog = {
        "wolowina": {"cheap_bigmin": 36.0, "mid_ok": 40.0, "local_exp": 44.0},
        "kurczak_filet": {"cheap_bigmin": 15.0, "mid_ok": 18.0, "local_exp": 20.0},
        "schab": {"cheap_bigmin": 24.0, "mid_ok": 27.0, "local_exp": 30.0},
        "mleko": {"cheap_bigmin": 2.6, "mid_ok": 3.0, "local_exp": 3.4},
        "cebula": {"cheap_bigmin": 1.8, "mid_ok": 2.3, "local_exp": 2.8},
        "olej": {"cheap_bigmin": 7.0, "mid_ok": 8.5, "local_exp": 9.5},
        "makaron": {"cheap_bigmin": 3.5, "mid_ok": 4.5, "local_exp": 5.5},
        "ryz": {"cheap_bigmin": 3.2, "mid_ok": 4.0, "local_exp": 4.8},
        "przyprawa_premium": {"local_exp": 28.0},
    }
    tasks = [
        _task(
            "small_order_avoid_bigmin",
            "Małe zamówienie — NIE wolno iść do cheap_bigmin (luka >>100)",
            [_it("kurczak_filet", 4), _it("cebula", 5), _it("olej", 2)],
        ),
        _task(
            "large_order_use_cheap",
            "Duże zamówienie — cheap_bigmin powinien wygrać ceną",
            [
                _it("wolowina", 12),
                _it("kurczak_filet", 15),
                _it("schab", 10),
                _it("mleko", 30, "l"),
                _it("cebula", 20),
                _it("olej", 10),
                _it("makaron", 12),
                _it("ryz", 10),
            ],
        ),
        _task(
            "forced_local_sku",
            "SKU tylko u local_exp + reszta — czy nie rozwali min innych",
            [
                _it("przyprawa_premium", 2),
                _it("kurczak_filet", 6),
                _it("mleko", 12, "l"),
            ],
        ),
        _task(
            "mid_threshold",
            "Średnie zamówienie — mid_ok vs local_exp",
            [
                _it("wolowina", 4),
                _it("schab", 3),
                _it("cebula", 10),
                _it("makaron", 6),
            ],
        ),
        _task(
            "almost_bigmin",
            "Prawie min 800 u cheap — czy warto dopiąć vs mid_ok",
            [
                _it("wolowina", 8),
                _it("kurczak_filet", 10),
                _it("schab", 8),
                _it("mleko", 20, "l"),
                _it("olej", 6),
            ],
        ),
    ]
    return {
        "id": "uneven_mins",
        "title": "Nierówne minima logistyczne",
        "description": (
            "Najtańszy dostawca ma min 800 zł. Średniak 250, lokalny 100. "
            "Testuje, czy Łowca nie buduje koszyka u tanich gdy luka >100."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_single_supplier() -> dict:
    """Jeden dostawca — test min hard/soft/all bez splitu."""
    suppliers = {
        "solo": _sup("Jedyny Hurtownik", 300, 25, 600),
    }
    catalog = {
        "wolowina": {"solo": 40.0},
        "kurczak_filet": {"solo": 18.0},
        "cebula": {"solo": 2.5},
        "mleko": {"solo": 3.2},
        "makaron": {"solo": 5.0},
        "olej": {"solo": 9.0},
    }
    tasks = [
        _task(
            "enough_for_min",
            "Wystarczająco duże — spełnia min 300",
            [
                _it("wolowina", 5),
                _it("kurczak_filet", 8),
                _it("mleko", 20, "l"),
                _it("makaron", 6),
            ],
        ),
        _task(
            "below_min_hard",
            "Poniżej min — luka >>100, brak koszyka",
            [_it("cebula", 5), _it("makaron", 2)],
        ),
        _task(
            "below_min_soft",
            "Poniżej min — luka ≤100, miękkie dopięcie możliwe",
            [
                _it("wolowina", 4),
                _it("kurczak_filet", 3),
                _it("olej", 2),
            ],
        ),
        _task(
            "all_items_small",
            "Wszystkie SKU małymi ilościami — łącznie może domknąć min",
            [
                _it("wolowina", 2),
                _it("kurczak_filet", 3),
                _it("cebula", 8),
                _it("mleko", 10, "l"),
                _it("makaron", 4),
                _it("olej", 3),
            ],
        ),
    ]
    return {
        "id": "single_supplier",
        "title": "Jeden dostawca",
        "description": (
            "Tylko jeden hurtownik. Testuje obsługę min bez splitu: "
            "wystarczające zamówienie, hard-fail (luka >>100), soft-gap, pełny koszyk."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_zero_mins() -> dict:
    """Wszystkie min=0 — czysta optymalizacja ceny + dostawa."""
    suppliers = {
        "a": _sup("Dostawca A", 0, 30, 500),
        "b": _sup("Dostawca B", 0, 15, 400),
        "c": _sup("Dostawca C", 0, 45, 600),
    }
    catalog = {
        "wolowina": {"a": 41.0, "b": 42.5, "c": 39.0},
        "kurczak_filet": {"a": 19.0, "b": 17.5, "c": 18.0},
        "cebula": {"a": 2.8, "b": 2.2, "c": 2.5},
        "mleko": {"a": 3.3, "b": 3.0, "c": 3.1},
        "makaron": {"a": 5.2, "b": 4.8, "c": 5.0},
        "olej": {"a": 9.5, "b": 8.0, "c": 9.0},
    }
    tasks = [
        _task(
            "cheapest_per_sku",
            "Najtańsze per SKU — shipping może zmienić wybór",
            [
                _it("wolowina", 6),
                _it("kurczak_filet", 10),
                _it("cebula", 15),
                _it("mleko", 20, "l"),
            ],
        ),
        _task(
            "free_shipping_threshold",
            "Próg darmowej dostawy — monolith vs split",
            [
                _it("wolowina", 8),
                _it("kurczak_filet", 12),
                _it("makaron", 10),
                _it("olej", 8),
            ],
        ),
        _task(
            "single_cheap_item",
            "Jeden tani produkt — czy warto osobny koszyk",
            [_it("cebula", 20), _it("makaron", 5)],
        ),
    ]
    return {
        "id": "zero_mins",
        "title": "Zerowe minima",
        "description": (
            "Wszyscy dostawcy mają min=0. Czysta gra cena + koszt dostawy + próg free shipping."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_all_high_mins() -> dict:
    """Wysokie minima 600–700 — trudne domknięcie koszyków."""
    suppliers = {
        "wh_a": _sup("Hurtownia A", 600, 0, 0),
        "wh_b": _sup("Hurtownia B", 650, 0, 0),
        "wh_c": _sup("Hurtownia C", 700, 0, 0),
    }
    catalog = {
        "wolowina": {"wh_a": 38.0, "wh_b": 39.0, "wh_c": 37.5},
        "kurczak_filet": {"wh_a": 17.0, "wh_b": 16.5, "wh_c": 17.5},
        "schab": {"wh_a": 26.0, "wh_b": 25.5, "wh_c": 26.5},
        "mleko": {"wh_a": 3.0, "wh_b": 2.9, "wh_c": 3.1},
        "cebula": {"wh_a": 2.0, "wh_b": 1.9, "wh_c": 2.1},
        "makaron": {"wh_a": 4.5, "wh_b": 4.3, "wh_c": 4.6},
        "olej": {"wh_a": 8.5, "wh_b": 8.0, "wh_c": 8.8},
    }
    tasks = [
        _task(
            "consolidate_one",
            "Konsolidacja u jednego — duże ilości",
            [
                _it("wolowina", 10),
                _it("kurczak_filet", 15),
                _it("schab", 8),
                _it("mleko", 40, "l"),
                _it("cebula", 25),
            ],
        ),
        _task(
            "too_small",
            "Za małe — żaden koszyk nie powinien powstać",
            [_it("kurczak_filet", 3), _it("cebula", 5)],
        ),
        _task(
            "one_fill_basket",
            "Jeden koszyk do domknięcia — reszta missing lub dopięcie",
            [
                _it("wolowina", 8),
                _it("makaron", 4),
                _it("olej", 2),
            ],
        ),
    ]
    return {
        "id": "all_high_mins",
        "title": "Wysokie minima (600–700 zł)",
        "description": (
            "Trzech dostawców z min 600–700 zł. Test konsolidacji, odrzucenia za małych "
            "zamówień i dopięcia jednego koszyka."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_exclusive_partition() -> dict:
    """Każdy SKU tylko u jednego dostawcy: mięso / warzywa / suchy."""
    suppliers = {
        "meat": _sup("Mięsny", 350, 20, 600),
        "veg": _sup("Warzywny", 200, 35, 450),
        "dry": _sup("Suchy", 250, 25, 500),
    }
    catalog = {
        "wolowina": {"meat": 39.0},
        "kurczak_filet": {"meat": 17.5},
        "schab": {"meat": 27.0},
        "cebula": {"veg": 2.1},
        "ziemniak": {"veg": 1.6},
        "pomidor": {"veg": 6.0},
        "makaron": {"dry": 4.5},
        "ryz": {"dry": 3.8},
        "olej": {"dry": 8.5},
        "sol": {"dry": 1.8},
    }
    tasks = [
        _task(
            "full_partition",
            "Pełne menu — 3 obowiązkowe koszyki",
            [
                _it("wolowina", 6),
                _it("kurczak_filet", 10),
                _it("cebula", 15),
                _it("ziemniak", 20),
                _it("makaron", 8),
                _it("olej", 5),
            ],
        ),
        _task(
            "meat_only_gap",
            "Tylko mięso — luka u meat >>100?",
            [_it("wolowina", 4), _it("schab", 3)],
        ),
        _task(
            "veg_dry_combo",
            "Warzywa + suchy — dwa koszyki do min",
            [
                _it("cebula", 25),
                _it("pomidor", 12),
                _it("makaron", 10),
                _it("ryz", 8),
                _it("sol", 4),
            ],
        ),
        _task(
            "dry_heavy",
            "Suchy dominuje — jeden koszyk dry",
            [
                _it("makaron", 20),
                _it("ryz", 15),
                _it("olej", 12),
                _it("sol", 6),
            ],
        ),
    ]
    return {
        "id": "exclusive_partition",
        "title": "Ekskluzywna partycja SKU",
        "description": (
            "Każdy produkt dostępny tylko u jednego z trzech specjalistów (mięso/warzywa/suchy). "
            "Wymusza wielokoszykowość bez alternatyw cenowych."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_shipping_dominates() -> dict:
    """Tani daleko (droga dostawa) vs drogi lokalnie (tanio)."""
    suppliers = {
        "far_cheap": _sup("Tani Daleko", 200, 80, 1000),
        "local_ok": _sup("Lokalny OK", 150, 10, 350),
    }
    catalog = {
        "wolowina": {"far_cheap": 35.0, "local_ok": 42.0},
        "kurczak_filet": {"far_cheap": 14.0, "local_ok": 19.0},
        "schab": {"far_cheap": 22.0, "local_ok": 28.0},
        "cebula": {"far_cheap": 1.5, "local_ok": 2.8},
        "mleko": {"far_cheap": 2.4, "local_ok": 3.2},
        "makaron": {"far_cheap": 3.5, "local_ok": 5.0},
    }
    tasks = [
        _task(
            "small_local_wins",
            "Małe zamówienie — dostawa zabija far_cheap",
            [_it("kurczak_filet", 4), _it("cebula", 8)],
        ),
        _task(
            "large_far_wins",
            "Duże zamówienie — far_cheap + free shipping",
            [
                _it("wolowina", 12),
                _it("kurczak_filet", 20),
                _it("schab", 10),
                _it("mleko", 30, "l"),
                _it("makaron", 15),
            ],
        ),
        _task(
            "mixed_shipping_tradeoff",
            "Mieszane — split vs monolith przy shipping",
            [
                _it("wolowina", 5),
                _it("kurczak_filet", 8),
                _it("cebula", 15),
                _it("makaron", 6),
            ],
        ),
    ]
    return {
        "id": "shipping_dominates",
        "title": "Dostawa dominuje cenę",
        "description": (
            "Tani dostawca z drogą dostawą (80 zł) vs lokalny droższy ale tanio dostarcza. "
            "Test kiedy shipping przeważa nad ceną produktów."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_gap_boundary() -> dict:
    """Dwa dostawcy testujące regułę ~100 zł luki."""
    suppliers = {
        "sup_a": _sup("Dostawca A", 400, 0, 0),
        "sup_b": _sup("Dostawca B", 350, 0, 0),
    }
    catalog = {
        "wolowina": {"sup_a": 40.0, "sup_b": 41.0},
        "kurczak_filet": {"sup_a": 18.0, "sup_b": 17.5},
        "schab": {"sup_a": 28.0, "sup_b": 27.0},
        "cebula": {"sup_a": 2.5, "sup_b": 2.3},
        "mleko": {"sup_a": 3.2, "sup_b": 3.0},
        "makaron": {"sup_a": 5.0, "sup_b": 4.8},
    }
    tasks = [
        _task(
            "gap_95_soft",
            "Luka ~95 zł u A — w strefie soft (≤100)",
            [_it("wolowina", 7), _it("kurczak_filet", 2)],
        ),
        _task(
            "gap_105_hard",
            "Luka ~105 zł u B — hard fail (>100)",
            [_it("kurczak_filet", 8), _it("cebula", 10)],
        ),
        _task(
            "fill_to_min",
            "Dopięcie min — przenieś SKU między A i B",
            [
                _it("wolowina", 5),
                _it("schab", 4),
                _it("mleko", 15, "l"),
                _it("makaron", 6),
            ],
        ),
        _task(
            "exact_boundary",
            "Granica 100 zł — sub ~300 przy min 400",
            [_it("wolowina", 6), _it("cebula", 20), _it("makaron", 4)],
        ),
    ]
    return {
        "id": "gap_boundary",
        "title": "Granica luki 100 zł",
        "description": (
            "Dwa dostawcy z min 350–400 zł. Zadania celują w luki ~95, ~105 i ~100 zł "
            "wokół reguły MAX_GAP_NEW_BASKET."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_price_ties() -> dict:
    """Identyczne ceny — decyzja po min/shipping/praktyczności."""
    suppliers = {
        "tie_x": _sup("Tie X", 300, 25, 600),
        "tie_y": _sup("Tie Y", 280, 30, 550),
        "tie_z": _sup("Tie Z", 320, 20, 650),
    }
    catalog = {
        "wolowina": {"tie_x": 40.0, "tie_y": 40.0, "tie_z": 40.0},
        "kurczak_filet": {"tie_x": 18.0, "tie_y": 18.0, "tie_z": 18.0},
        "cebula": {"tie_x": 2.5, "tie_y": 2.5, "tie_z": 2.5},
        "mleko": {"tie_x": 3.0, "tie_y": 3.0, "tie_z": 3.0},
        "makaron": {"tie_x": 5.0, "tie_y": 5.0, "tie_z": 5.0},
    }
    tasks = [
        _task(
            "all_tied_split",
            "Remis cen — wybór po min i shipping",
            [
                _it("wolowina", 5),
                _it("kurczak_filet", 8),
                _it("cebula", 12),
                _it("mleko", 15, "l"),
            ],
        ),
        _task(
            "monolith_preferred",
            "Jeden dostawca wystarczy — unikaj splitu",
            [
                _it("wolowina", 8),
                _it("kurczak_filet", 10),
                _it("makaron", 10),
            ],
        ),
        _task(
            "tie_small_order",
            "Małe zamówienie przy remisie — brak koszyka?",
            [_it("cebula", 6), _it("mleko", 8, "l")],
        ),
    ]
    return {
        "id": "price_ties",
        "title": "Remisy cenowe",
        "description": (
            "Trzech dostawców z identycznymi cenami jednostkowymi. "
            "Decyzja powinna opierać się na min, dostawie i liczbie koszyków."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_expensive_monopolist() -> dict:
    """Drogi monopolista z pełnym katalogiem vs tani niepełny."""
    suppliers = {
        "monopolist": _sup("Drogi Monopolista", 200, 15, 500),
        "budget": _sup("Tani Niepełny", 250, 30, 600),
    }
    catalog = {
        "wolowina": {"monopolist": 48.0, "budget": 36.0},
        "kurczak_filet": {"monopolist": 22.0, "budget": 16.0},
        "schab": {"monopolist": 32.0, "budget": 24.0},
        "cebula": {"monopolist": 3.5},
        "ziemniak": {"monopolist": 2.2},
        "pomidor": {"monopolist": 7.0},
        "makaron": {"monopolist": 6.0, "budget": 4.5},
        "ryz": {"monopolist": 5.0, "budget": 3.8},
        "olej": {"monopolist": 10.0, "budget": 8.0},
        "mleko": {"monopolist": 3.8, "budget": 3.0},
    }
    tasks = [
        _task(
            "meat_budget_only",
            "Mięso tylko u budget — monopolista niepotrzebny",
            [_it("wolowina", 6), _it("kurczak_filet", 10), _it("schab", 5)],
        ),
        _task(
            "veg_monopolist_only",
            "Warzywa tylko u monopolisty — musi iść tam",
            [_it("cebula", 15), _it("ziemniak", 25), _it("pomidor", 10)],
        ),
        _task(
            "full_menu_split",
            "Pełne menu — mix budget + monopolista",
            [
                _it("wolowina", 5),
                _it("kurczak_filet", 8),
                _it("cebula", 12),
                _it("makaron", 6),
                _it("mleko", 15, "l"),
            ],
        ),
        _task(
            "avoid_monopolist_if_possible",
            "Tylko produkty wspólne — unikaj monopolisty",
            [
                _it("wolowina", 4),
                _it("makaron", 8),
                _it("ryz", 6),
                _it("olej", 4),
            ],
        ),
    ]
    return {
        "id": "expensive_monopolist",
        "title": "Drogi monopolista vs tani niepełny",
        "description": (
            "Monopolista ma pełny katalog ale drogo. Budget ma tanie mięso i suchy, "
            "brak warzyw. Test kiedy płacić premium za pokrycie."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_fine_dining() -> dict:
    """Drogie specjalności, małe ilości — fine dining."""
    suppliers = {
        "gourmet": _sup("Gourmet Direct", 180, 45, 400),
        "premium_meat": _sup("Premium Meat Co", 220, 35, 450),
    }
    catalog = {
        "wagyu": {"premium_meat": 280.0},
        "homar": {"gourmet": 190.0},
        "trufla_swieza": {"gourmet": 120.0},
        "kawior": {"gourmet": 350.0},
        "szparagi": {"gourmet": 45.0},
        "mascarpone": {"gourmet": 28.0},
        "ocet_szampanski": {"gourmet": 55.0},
    }
    tasks = [
        _task(
            "tasting_menu",
            "Menu degustacyjne — małe ilości drogich SKU",
            [
                _it("wagyu", 1.5),
                _it("homar", 2),
                _it("trufla_swieza", 0.2),
                _it("szparagi", 3),
            ],
        ),
        _task(
            "luxury_trap",
            "Pułapka luksusu — kawior poniżej min",
            [_it("kawior", 0.1), _it("ocet_szampanski", 1)],
        ),
        _task(
            "single_premium",
            "Jedna premium pozycja + dopełnienie",
            [
                _it("wagyu", 2),
                _it("mascarpone", 4),
                _it("szparagi", 5),
            ],
        ),
    ]
    return {
        "id": "fine_dining",
        "title": "Fine dining — specjalności",
        "description": (
            "Drogie produkty specialty w małych ilościach. Niskie minima ale wysokie ceny "
            "jednostkowe i koszt dostawy."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_fast_volume() -> dict:
    """Wysokie wolumeny tanich produktów — fast food / volume."""
    suppliers = {
        "volume_a": _sup("Volume A", 400, 0, 0),
        "volume_b": _sup("Volume B", 350, 15, 800),
    }
    catalog = {
        "bulka": {"volume_a": 0.45, "volume_b": 0.42},
        "frytki_mrozone": {"volume_a": 4.5, "volume_b": 4.2},
        "kurczak_panierka": {"volume_a": 12.0, "volume_b": 11.5},
        "ser_plastry": {"volume_a": 8.0, "volume_b": 7.8},
        "sos_burger": {"volume_a": 6.5, "volume_b": 6.0},
        "napoj_sok": {"volume_a": 2.8, "volume_b": 2.5},
        "papier_opakowania": {"volume_a": 15.0, "volume_b": 14.0},
    }
    tasks = [
        _task(
            "weekly_volume",
            "Tygodniowy volume — setki sztuk",
            [
                _it("bulka", 500, "szt"),
                _it("frytki_mrozone", 80),
                _it("kurczak_panierka", 40),
                _it("ser_plastry", 20),
            ],
        ),
        _task(
            "sauce_packaging",
            "Sosy + opakowania — tanie linie",
            [
                _it("sos_burger", 30, "l"),
                _it("papier_opakowania", 10),
                _it("napoj_sok", 50, "l"),
            ],
        ),
        _task(
            "burger_day",
            "Dzień burgerowy — ekstremalny volume bułek",
            [
                _it("bulka", 800, "szt"),
                _it("kurczak_panierka", 25),
                _it("ser_plastry", 15),
                _it("sos_burger", 20, "l"),
            ],
        ),
    ]
    return {
        "id": "fast_volume",
        "title": "Fast volume — wysokie ilości",
        "description": (
            "Tanio, dużo: bułki, frytki, panierka. Test optymalizacji przy setkach "
            "sztuk i niskich cenach jednostkowych."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_many_suppliers_chaos() -> dict:
    """5 dostawców s1–s5 z chaotycznym pokryciem."""
    suppliers = {
        "s1": _sup("Supplier 1", 300, 20, 550),
        "s2": _sup("Supplier 2", 250, 25, 500),
        "s3": _sup("Supplier 3", 400, 15, 700),
        "s4": _sup("Supplier 4", 180, 40, 400),
        "s5": _sup("Supplier 5", 350, 30, 650),
    }
    catalog = {
        "wolowina": {"s1": 41.0, "s3": 39.5, "s5": 40.5},
        "kurczak_filet": {"s2": 17.0, "s4": 18.5, "s5": 17.5},
        "schab": {"s1": 28.0, "s3": 27.0},
        "cebula": {"s2": 2.2, "s4": 2.5},
        "ziemniak": {"s2": 1.5, "s4": 1.7, "s5": 1.6},
        "makaron": {"s1": 4.8, "s3": 4.5, "s5": 4.6},
        "ryz": {"s3": 3.9, "s5": 4.0},
        "olej": {"s1": 8.8, "s2": 9.0},
        "mleko": {"s4": 3.1, "s5": 3.0},
        "maslo": {"s4": 7.5},
        "pomidor": {"s2": 6.2},
        "ocet": {"s5": 4.5},
    }
    tasks = [
        _task(
            "chaos_full",
            "Pełne zamówienie — 5 dostawców w grze",
            [
                _it("wolowina", 5),
                _it("kurczak_filet", 8),
                _it("cebula", 12),
                _it("makaron", 6),
                _it("mleko", 15, "l"),
                _it("maslo", 4),
                _it("pomidor", 8),
            ],
        ),
        _task(
            "limit_suppliers",
            "Małe zamówienie — max 2–3 dostawców praktycznie",
            [
                _it("kurczak_filet", 5),
                _it("ziemniak", 15),
                _it("ryz", 4),
            ],
        ),
        _task(
            "s3_s5_overlap",
            "Overlap s3/s5 — wybór tańszy",
            [
                _it("wolowina", 6),
                _it("schab", 4),
                _it("makaron", 8),
                _it("ryz", 6),
            ],
        ),
        _task(
            "orphan_skus",
            "SKU tylko u jednego z pięciu",
            [_it("maslo", 3), _it("ocet", 2), _it("olej", 4)],
        ),
    ]
    return {
        "id": "many_suppliers_chaos",
        "title": "Chaos wielu dostawców (s1–s5)",
        "description": (
            "Pięciu dostawców z chaotycznym, częściowo nakładającym się katalogiem. "
            "Test praktyczności i unikania zbyt wielu koszyków."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


def env_scarce() -> dict:
    """Prawie pusty katalog + produkty-ghost bez ofert."""
    suppliers = {
        "ghost_a": _sup("Ghost A", 300, 25, 600),
        "ghost_b": _sup("Ghost B", 200, 40, 450),
    }
    catalog = {
        "mleko": {"ghost_a": 3.5},
        "cebula": {"ghost_b": 2.8},
        "makaron": {"ghost_a": 5.5, "ghost_b": 5.2},
    }
    tasks = [
        _task(
            "all_missing",
            "Wszystkie SKU bez oferty — same ghosty",
            [
                _it("wolowina", 5),
                _it("kurczak_filet", 8),
                _it("salata_iceberg", 10),
            ],
        ),
        _task(
            "partial_one_offer",
            "Jedna oferta — reszta missing",
            [_it("mleko", 10, "l"), _it("wolowina", 4), _it("ziemniak", 15)],
        ),
        _task(
            "two_items_feasible",
            "Dwa dostępne SKU — czy domknąć min",
            [_it("cebula", 20), _it("makaron", 8)],
        ),
        _task(
            "ghost_product_in_list",
            "Produkt ghost (trufla) + dostępne",
            [
                _it("makaron", 5),
                _it("mleko", 8, "l"),
                _it("trufla_olej", 1),
            ],
        ),
    ]
    return {
        "id": "scarce",
        "title": "Skąpe oferty + ghost SKU",
        "description": (
            "Prawie pusty katalog (3 produkty) i zadania z produktami bez żadnej oferty. "
            "Test obsługi missing i braku feasible."
        ),
        "suppliers": suppliers,
        "catalog": catalog,
        "tasks": tasks,
    }


ALL_ENV_BUILDERS: list[Callable[[], dict]] = [
    env_full_coverage,
    env_sparse_catalog,
    env_uneven_mins,
    env_single_supplier,
    env_zero_mins,
    env_all_high_mins,
    env_exclusive_partition,
    env_shipping_dominates,
    env_gap_boundary,
    env_price_ties,
    env_expensive_monopolist,
    env_fine_dining,
    env_fast_volume,
    env_many_suppliers_chaos,
    env_scarce,
]
