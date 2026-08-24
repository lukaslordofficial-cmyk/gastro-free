"""
Korekta intencji okresów (summarize ↔ compare) po Whisper / LLM.

Wydzielone z server.py (dekalog §I).
"""
from __future__ import annotations

import re
from typing import Any


def strip_pl_month(s: str) -> str:
    t = (s or "").lower().strip()
    for a, b in (
        ("ą", "a"), ("ć", "c"), ("ę", "e"), ("ł", "l"), ("ń", "n"),
        ("ó", "o"), ("ś", "s"), ("ź", "z"), ("ż", "z"),
    ):
        t = t.replace(a, b)
    return t


def guard_period_intent(text: str, data: dict[str, Any]) -> dict[str, Any]:
    """Koryguje mylenie summarize ↔ compare i dokłada alternate_intents przy niskiej pewności."""
    t = strip_pl_month(text or "")
    pl = dict(data.get("payload") or {})
    intent = data.get("intent") or "unknown"
    conf = float(data.get("confidence") or 0.5)

    # „wgraj/zeskanuj menu” → upload_menu (nie oferta dostawcy)
    if (
        re.search(r"\b(wgraj|zeskanuj|skanuj|dodaj)\b.{0,40}\b(menu|karte dan|karte menu|karte potraw)\b", t)
        or re.search(r"\b(menu|karte dan)\b.{0,40}\b(wgraj|zeskanuj|skanuj)\b", t)
    ):
        if intent in ("upload_offer", "upload_document", "upload_invoice", "unknown", "add_supplier"):
            intent = "upload_menu"
            data["intent"] = intent
            data["reason"] = ((data.get("reason") or "") + " | guard: upload_menu").strip(" |")

    # „przywróć magazyn/produkty” ≠ przywróć menu
    if re.search(r"\b(przywroc|przywrocic|cofnij)\b", t):
        if re.search(r"\b(magazyn\w*|produkt\w*|skladnik\w*)\b", t) and not re.search(r"\b(menu|danie|potraw\w*|karte)\b", t):
            intent = "restore_deleted_inventory"
            data["intent"] = intent
        elif re.search(r"\b(menu|danie|potraw\w*|karte)\b", t):
            intent = "restore_last_deleted_menu"
            data["intent"] = intent

    # TYLKO wyraźne porównanie — NIE „a”/„i” jako łącznik (fałszywe trafienia)
    compare_re = re.compile(
        r"\b(porownaj|porownanie|porownac|zestaw|zestawienie|versus|\bvs\b|roznic[ae]?)\b",
        re.I,
    )
    has_compare = bool(compare_re.search(t))
    # dwa miesiące + spójnik „i/oraz/vs” między nimi
    months_found = re.findall(
        r"\b(stycznia|styczen|lutego|luty|marca|marzec|kwietnia|kwiecien|maja|maj|"
        r"czerwca|czerwiec|lipca|lipiec|sierpnia|sierpien|wrzesnia|wrzesien|"
        r"pazdziernika|pazdziernik|listopada|listopad|grudnia|grudzien|grudznia)\b",
        t,
    )
    month_hits = len(months_found)
    if not has_compare and month_hits >= 2 and re.search(r"\b(i|oraz|vs|versus)\b", t):
        has_compare = True

    finance_one = bool(re.search(
        r"\b(zysk|zyski|przychod|przychody|utarg|podsumuj|analiz|dane|raport|sprzedaz)\b",
        t,
    ))

    # TWARDY OVERRIDE: „pokaż zyski z lipca” → zawsze summarize (nigdy compare)
    if finance_one and month_hits <= 1 and not has_compare:
        intent = "summarize_custom_period"
        data["intent"] = intent
        data["confidence"] = max(conf, 0.88)
        data["reason"] = (
            (data.get("reason") or "")
            + " | Wymuszono: analiza jednego okresu (zyski/dane), nie porównanie."
        ).strip(" |")
        if not pl.get("period_1"):
            pl["period_1"] = (text or "").strip()
        pl["period_type"] = pl.get("period_type") or "month"
        pl.pop("period_2", None)

    elif intent == "compare_two_periods" and not has_compare and month_hits <= 1:
        intent = "summarize_custom_period"
        data["intent"] = intent
        data["confidence"] = min(conf, 0.72)
        data["reason"] = (
            (data.get("reason") or "")
            + " | Skorygowano: jeden okres → analiza, nie porównanie."
        ).strip(" |")
        if not pl.get("period_1") and pl.get("period_2"):
            pl["period_1"] = pl["period_2"]
        pl.pop("period_2", None)

    elif intent == "summarize_custom_period" and has_compare and month_hits >= 2:
        intent = "compare_two_periods"
        data["intent"] = intent
        data["reason"] = (
            (data.get("reason") or "")
            + " | Skorygowano: wykryto porównanie dwóch okresów."
        ).strip(" |")

    # Uzupełnij period_1 pełnym tekstem użytkownika
    if intent in (
        "summarize_custom_period",
        "rank_menu_sales",
        "rank_inventory_usage",
        "rank_waste_cost",
        "rank_dead_menu",
        "rank_supplier_spend",
    ):
        if not pl.get("period_1") or len(str(pl.get("period_1") or "")) < 4:
            pl["period_1"] = (text or "").strip()
        pl["period_type"] = pl.get("period_type") or (
            "year" if intent.startswith("rank_") else "month"
        )

    # Zawsze zaproponuj 2 warianty przy finance/compare (żeby FE mógł przełączyć)
    if intent in ("summarize_custom_period", "compare_two_periods") or finance_one:
        if intent == "summarize_custom_period":
            alts = [
                {"intent": "summarize_custom_period", "label": "Pokazanie danych / zysków z okresu"},
                {"intent": "compare_two_periods", "label": "Porównanie dwóch okresów"},
            ]
        else:
            alts = [
                {"intent": "compare_two_periods", "label": "Porównanie dwóch okresów"},
                {"intent": "summarize_custom_period", "label": "Pokazanie danych / zysków z okresu"},
            ]
        data["alternate_intents"] = alts

    data["payload"] = pl
    return data
