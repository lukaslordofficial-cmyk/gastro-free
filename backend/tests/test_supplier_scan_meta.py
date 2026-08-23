"""Unit tests: merge pól panelu Dostawcy ze skanu faktury/oferty."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from supplier_scan_meta import (  # noqa: E402
    build_supplier_patch_from_scan,
    compose_supplier_notes_from_scan as _compose_supplier_notes_from_scan,
    merge_supplier_notes as _merge_supplier_notes,
    normalize_supplier_scan_meta as _normalize_supplier_scan_meta,
    supplier_meta_preview,
)


def test_normalize_supplier_scan_meta_strips_and_parses():
    meta = _normalize_supplier_scan_meta({
        "nip": " 525-000-00-00 ",
        "phone": "",
        "email": None,
        "contact_person": "Anna",
        "address": "ul. Test 1",
        "payment_terms": "14 dni",
        "shipping_cost": "25.5",
        "min_order_value": 300,
        "free_shipping_threshold": "",
        "lead_time_days": 2.4,
    })
    assert meta["nip"] == "525-000-00-00"
    assert meta["phone"] is None
    assert meta["email"] is None
    assert meta["contact_person"] == "Anna"
    assert meta["shipping_cost"] == 25.5
    assert meta["min_order_value"] == 300.0
    assert meta["free_shipping_threshold"] is None
    assert meta["lead_time_days"] == 2


def test_notes_compose_and_merge_no_wipe():
    composed = _compose_supplier_notes_from_scan({
        "address": "Warszawa, ul. Prosta 1",
        "payment_terms": "przelew 7 dni",
    })
    assert "Adres:" in composed
    assert "Termin płatności:" in composed

    # Nie nadpisuj pustym
    assert _merge_supplier_notes("istniejące", None) is None
    assert _merge_supplier_notes("istniejące", "") is None

    # Uzupełnij brakujące linie
    merged = _merge_supplier_notes("Notatka ręczna", composed)
    assert "Notatka ręczna" in merged
    assert "Adres: Warszawa, ul. Prosta 1" in merged

    # Bez duplikatów
    assert _merge_supplier_notes(merged, composed) is None


def test_build_patch_fills_missing_keeps_existing_on_empty():
    existing = {
        "nip": "5250000000",
        "phone": "",
        "email": "old@firma.pl",
        "contact_person": None,
        "notes": "",
        "shipping_cost": 0,
        "min_order_value": 0,
        "free_shipping_threshold": 0,
        "lead_time_days": None,
    }
    meta = {
        "nip": None,  # nie kasuj istniejącego
        "phone": "+48 500 100 200",
        "email": None,
        "contact_person": "Jan Kowalski",
        "address": "Kraków, Rynek 1",
        "bank_account": "PL61 1090 1014 0000 0712 1981 2874",
        "payment_terms": "14 dni",
        "shipping_cost": 40.0,
        "min_order_value": 500.0,
        "free_shipping_threshold": 1000.0,
        "lead_time_days": 2,
    }
    patch = build_supplier_patch_from_scan(existing, meta)
    assert "nip" not in patch  # pusty z dokumentu nie nadpisuje
    assert patch["phone"] == "+48 500 100 200"
    assert "email" not in patch  # pusty z dokumentu — zostaw old@
    assert patch["contact_person"] == "Jan Kowalski"
    assert patch["address"] == "Kraków, Rynek 1"
    assert patch["bank_account"] == "PL61 1090 1014 0000 0712 1981 2874"
    assert "Adres: Kraków, Rynek 1" in patch["notes"]
    assert patch["shipping_cost"] == 40.0
    assert patch["min_order_value"] == 500.0
    assert patch["free_shipping_threshold"] == 1000.0
    assert patch["lead_time_days"] == 2


def test_build_patch_updates_clearer_nip_and_shipping_zero():
    existing = {
        "nip": "525",
        "phone": "500100200",
        "email": "a@b.pl",
        "contact_person": "X",
        "notes": "Adres: stary",
        "shipping_cost": 50,
        "min_order_value": 200,
        "free_shipping_threshold": 0,
        "lead_time_days": 5,
    }
    meta = {
        "nip": "525-244-80-31",
        "phone": "+48 500 100 200",
        "email": "a@b.pl",
        "contact_person": "X",
        "address": None,
        "payment_terms": None,
        "shipping_cost": 0.0,  # jawnie darmowa
        "min_order_value": 200.0,  # bez zmiany
        "free_shipping_threshold": None,
        "lead_time_days": 5,
    }
    patch = build_supplier_patch_from_scan(existing, meta)
    assert patch["nip"] == "525-244-80-31"
    assert patch.get("shipping_cost") == 0.0
    assert "min_order_value" not in patch
    assert "lead_time_days" not in patch


def test_supplier_meta_preview_drops_empty():
    prev = supplier_meta_preview({
        "nip": "123",
        "phone": None,
        "email": "",
        "min_order_value": 100,
        "shipping_cost": 0,
    })
    assert prev == {"nip": "123", "min_order_value": 100, "shipping_cost": 0}
