#!/usr/bin/env python3
"""
Środowiska symulacyjne strat produktowych 2025 (offline fixtures).

Każde env zawiera:
  - inventory (produkty magazynowe + unit_cost)
  - dishes (receptury + portion_size_grams)
  - losses (zdarzenia: dania i składniki, różne jednostki, różne dni)
  - finance (przychód / stałe / zmienne brutto dla okna P&L)

Oracle: waste_cost_math.py + reguła zysku:
  zysk = przychód − stałe − straty − (zmienne_brutto − straty)
"""
from __future__ import annotations

from typing import Any


def _inv(name: str, unit: str, unit_cost: float, **extra) -> dict:
    return {"name": name, "unit": unit, "unit_cost": unit_cost, **extra}


def _dish(name: str, portion_g: float, recipe: list[dict]) -> dict:
    return {"name": name, "portion_size_grams": portion_g, "recipe": recipe}


def _loss(
    date: str,
    item_type: str,
    name: str,
    qty: float,
    unit: str,
    reason: str = "",
) -> dict:
    return {
        "date": date,
        "item_type": item_type,
        "name": name,
        "qty": qty,
        "unit": unit,
        "reason": reason or f"sim {date}",
    }


def _recipe_line(name: str, qty: float, unit: str) -> dict:
    return {"name": name, "qty": qty, "unit": unit}


# ── Env A: miesiąc marca 2025 — mieszane jednostki ───────────────────────────

def build_env_march_mixed() -> dict[str, Any]:
    inventory = [
        _inv("Kurczak filet", "kg", 28.0),
        _inv("Smietana 30%", "l", 12.5),
        _inv("Makaron", "kg", 8.0),
        _inv("Pomidory", "kg", 6.5),
        _inv("Oliwa", "l", 22.0),
        _inv("Bulki hamburgerowe", "szt", 1.8),
        _inv("Losos", "kg", 85.0),
        _inv("Salata lodowa", "kg", 9.0),
        _inv("Mleko", "l", 4.2),
        _inv("Maka", "kg", 3.5),
    ]
    dishes = [
        _dish(
            "Zupa pomidorowa",
            350.0,
            [
                _recipe_line("Pomidory", 200, "g"),
                _recipe_line("Smietana 30%", 40, "ml"),
                _recipe_line("Oliwa", 5, "ml"),
            ],
        ),
        _dish(
            "Pasta carbonara",
            400.0,
            [
                _recipe_line("Makaron", 120, "g"),
                _recipe_line("Kurczak filet", 80, "g"),
                _recipe_line("Smietana 30%", 50, "ml"),
            ],
        ),
        _dish(
            "Burger klasik",
            280.0,
            [
                _recipe_line("Kurczak filet", 150, "g"),
                _recipe_line("Bulki hamburgerowe", 1, "szt"),
                _recipe_line("Salata lodowa", 30, "g"),
            ],
        ),
        _dish(
            "Losos grillowany",
            320.0,
            [
                _recipe_line("Losos", 180, "g"),
                _recipe_line("Oliwa", 10, "ml"),
                _recipe_line("Salata lodowa", 50, "g"),
            ],
        ),
    ]
    losses = [
        # składniki — różne jednostki
        _loss("2025-03-03", "ingredient", "Kurczak filet", 1.2, "kg", "przeterminowany"),
        _loss("2025-03-05", "ingredient", "Smietana 30%", 0.5, "l", "kwaśna"),
        _loss("2025-03-07", "ingredient", "Pomidory", 800, "g", "zgniłe"),  # → 0.8 kg
        _loss("2025-03-10", "ingredient", "Bulki hamburgerowe", 6, "szt", "czerstwe"),
        _loss("2025-03-12", "ingredient", "Losos", 350, "g", "nie sprzedany"),  # → 0.35 kg
        _loss("2025-03-15", "ingredient", "Oliwa", 250, "ml", "rozlana"),  # → 0.25 l
        _loss("2025-03-18", "ingredient", "Mleko", 1.0, "l", "przeterminowane"),
        _loss("2025-03-20", "ingredient", "Makaron", 0.4, "kg", "uszkodzone opakowanie"),
        # dania — porcje / litry / kg
        _loss("2025-03-04", "dish", "Zupa pomidorowa", 3, "porcja", "zwrot gościa"),
        _loss("2025-03-08", "dish", "Zupa pomidorowa", 1.5, "l", "wyrzucona zupa dnia"),
        _loss("2025-03-11", "dish", "Pasta carbonara", 2, "porcja", "błąd kuchni"),
        _loss("2025-03-14", "dish", "Burger klasik", 4, "porcja", "nie odebrane"),
        _loss("2025-03-17", "dish", "Losos grillowany", 1, "porcja", "przypalony"),
        _loss("2025-03-22", "dish", "Pasta carbonara", 0.6, "kg", "partia z bufetu"),
        _loss("2025-03-25", "ingredient", "Salata lodowa", 1.5, "kg", "zwiędła"),
        _loss("2025-03-28", "dish", "Zupa pomidorowa", 2, "porcja", "koniec zmiany"),
    ]
    return {
        "id": "march_2025_mixed",
        "title": "Marzec 2025 — mieszane straty (składniki + dania)",
        "window": ("2025-03-01", "2025-03-31"),
        "inventory": inventory,
        "dishes": dishes,
        "losses": losses,
        "finance": {
            "revenue": 52000.0,
            "fixed": 27800.0,
            "variable_gross": 15600.0,  # zakupy materiałów (już zawierają koszt zmarnowanych)
        },
    }


def build_env_july_peak() -> dict[str, Any]:
    """Lipiec — wyższy ruch, więcej strat zup/sosów w litrach."""
    base = build_env_march_mixed()
    inventory = list(base["inventory"]) + [
        _inv("Sos hollandaise", "l", 45.0),
        _inv("Bulion warzywny", "l", 8.0),
    ]
    dishes = list(base["dishes"]) + [
        _dish(
            "Sos hollandaise porcja",
            80.0,
            [
                _recipe_line("Sos hollandaise", 80, "ml"),
                _recipe_line("Mleko", 10, "ml"),
            ],
        ),
    ]
    losses = [
        _loss("2025-07-02", "ingredient", "Losos", 2.0, "kg", "awaria lodówki"),
        _loss("2025-07-05", "ingredient", "Smietana 30%", 2.0, "l", "upał"),
        _loss("2025-07-08", "dish", "Zupa pomidorowa", 4.0, "l", "zbyt dużo ugotowane"),
        _loss("2025-07-10", "dish", "Sos hollandaise porcja", 12, "porcja", "sos się zwarzył"),
        _loss("2025-07-12", "ingredient", "Sos hollandaise", 1.2, "l", "reszta z produkcji"),
        _loss("2025-07-15", "dish", "Burger klasik", 8, "porcja", "event odwołany"),
        _loss("2025-07-18", "ingredient", "Kurczak filet", 3.5, "kg", "dostawa za duża"),
        _loss("2025-07-20", "ingredient", "Pomidory", 2500, "g", "przegrzane"),
        _loss("2025-07-22", "dish", "Pasta carbonara", 5, "porcja", "błąd zamówienia"),
        _loss("2025-07-25", "ingredient", "Bulion warzywny", 3.0, "l", "wylany"),
        _loss("2025-07-28", "dish", "Losos grillowany", 2, "porcja", "zwrot"),
        _loss("2025-07-30", "ingredient", "Oliwa", 0.4, "l", "rozlana"),
    ]
    return {
        "id": "july_2025_peak",
        "title": "Lipiec 2025 — szczyt sezonu, straty zup/sosów",
        "window": ("2025-07-01", "2025-07-31"),
        "inventory": inventory,
        "dishes": dishes,
        "losses": losses,
        "finance": {
            "revenue": 68500.0,
            "fixed": 29200.0,
            "variable_gross": 20550.0,
        },
    }


def build_env_year_sample() -> dict[str, Any]:
    """Próbka całego roku — po kilka dni z każdego kwartału."""
    base = build_env_march_mixed()
    losses = [
        # Q1
        _loss("2025-01-12", "ingredient", "Kurczak filet", 0.8, "kg"),
        _loss("2025-01-20", "dish", "Zupa pomidorowa", 2, "porcja"),
        _loss("2025-02-08", "ingredient", "Smietana 30%", 750, "ml"),
        _loss("2025-02-18", "dish", "Burger klasik", 3, "porcja"),
        # Q2
        _loss("2025-04-03", "ingredient", "Losos", 1.1, "kg"),
        _loss("2025-04-15", "dish", "Pasta carbonara", 1.2, "l"),
        _loss("2025-05-09", "ingredient", "Pomidory", 1.0, "kg"),
        _loss("2025-05-22", "dish", "Losos grillowany", 2, "porcja"),
        _loss("2025-06-11", "ingredient", "Oliwa", 300, "ml"),
        _loss("2025-06-27", "dish", "Zupa pomidorowa", 2.5, "l"),
        # Q3
        _loss("2025-08-04", "ingredient", "Makaron", 2.0, "kg"),
        _loss("2025-08-19", "dish", "Burger klasik", 6, "porcja"),
        _loss("2025-09-07", "ingredient", "Salata lodowa", 2.2, "kg"),
        _loss("2025-09-21", "dish", "Pasta carbonara", 4, "porcja"),
        # Q4
        _loss("2025-10-14", "ingredient", "Mleko", 2.0, "l"),
        _loss("2025-10-28", "dish", "Zupa pomidorowa", 5, "porcja"),
        _loss("2025-11-09", "ingredient", "Kurczak filet", 1.5, "kg"),
        _loss("2025-11-23", "dish", "Losos grillowany", 1, "porcja"),
        _loss("2025-12-12", "ingredient", "Bulki hamburgerowe", 10, "szt"),
        _loss("2025-12-28", "dish", "Burger klasik", 2, "porcja"),
    ]
    return {
        "id": "year_2025_sample",
        "title": "Rok 2025 — próbka strat po kwartałach",
        "window": ("2025-01-01", "2025-12-31"),
        "inventory": base["inventory"],
        "dishes": base["dishes"],
        "losses": losses,
        "finance": {
            "revenue": 620000.0,
            "fixed": 340000.0,
            "variable_gross": 186000.0,
        },
    }


def build_env_units_edge() -> dict[str, Any]:
    """Krawędzie jednostek: g↔kg, ml↔l, porcja vs litr zupy."""
    inventory = [
        _inv("Smietana 30%", "l", 12.5),
        _inv("Pomidory", "kg", 6.5),
        _inv("Maka", "g", 0.0035),  # unit_cost za 1 g
    ]
    dishes = [
        _dish(
            "Zupa pomidorowa",
            350.0,
            [
                _recipe_line("Pomidory", 200, "g"),
                _recipe_line("Smietana 30%", 40, "ml"),
            ],
        ),
    ]
    losses = [
        # 1000 g pomidorów = 1 kg → 6.5 zł
        _loss("2025-03-01", "ingredient", "Pomidory", 1000, "g"),
        # 1000 ml śmietany = 1 l → 12.5 zł
        _loss("2025-03-01", "ingredient", "Smietana 30%", 1000, "ml"),
        # 350 ml zupy = 1 porcja (portion_size_grams=350)
        _loss("2025-03-02", "dish", "Zupa pomidorowa", 350, "ml"),
        # 1 porcja — ta sama wartość co wyżej
        _loss("2025-03-02", "dish", "Zupa pomidorowa", 1, "porcja"),
        # mąka w gramach magazynowych
        _loss("2025-03-03", "ingredient", "Maka", 500, "g"),
    ]
    return {
        "id": "units_edge_2025",
        "title": "Krawędzie jednostek g/kg/ml/l/porcja",
        "window": ("2025-03-01", "2025-03-03"),
        "inventory": inventory,
        "dishes": dishes,
        "losses": losses,
        "finance": {
            "revenue": 9000.0,
            "fixed": 2700.0,
            "variable_gross": 2500.0,
        },
    }


ALL_ENV_BUILDERS = [
    build_env_march_mixed,
    build_env_july_peak,
    build_env_year_sample,
    build_env_units_edge,
]


def all_envs() -> list[dict[str, Any]]:
    return [b() for b in ALL_ENV_BUILDERS]
