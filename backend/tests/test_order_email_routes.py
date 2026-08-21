"""Order email format helpers + router wiring."""
from __future__ import annotations

import order_email_routes
from order_email_format import (
    build_supplier_order_message,
    fmt_pln,
    fmt_qty,
    is_internal_order_note,
    resolve_restaurant_label,
)


def test_fmt_helpers():
    assert fmt_pln(12.5) == "12,50 zł"
    assert fmt_qty(3.0) == "3"
    assert fmt_qty(1.5) == "1,50"


def test_internal_notes():
    assert is_internal_order_note("") is True
    assert is_internal_order_note("Łowca Okazji — draft") is True
    assert is_internal_order_note("Dostawa rano") is False


def test_resolve_restaurant_label():
    assert resolve_restaurant_label(
        profile={"company_name": "Gastro Sp. z o.o."},
        req_restaurant_name="Nasza restauracja",
    ) == "Gastro Sp. z o.o."
    assert resolve_restaurant_label(
        profile={"company_name": ""},
        req_restaurant_name="Bistro X",
    ) == "Bistro X"


def test_build_message_has_no_internal_notes_in_body():
    msg = build_supplier_order_message(
        supplier_hello="Hurt X",
        supplier_email="h@x.pl",
        supplier_id="s1",
        restaurant="Lokale",
        today="21.08.2026",
        delivery="ul. Test 1",
        items=[{"product_name": "Mąka", "quantity": 2, "unit": "kg", "line_total": 10}],
        subtotal=10,
        notes="Łowca Okazji — zapisane na później",
        contact_block="Kontakt: a@b.pl",
        contact_phone="500",
        footer="--- footer ---",
    )
    assert "Mąka" in msg["email_body_text"]
    assert "Łowca" not in msg["email_body_text"]
    assert "ul. Test 1" in msg["email_body_text"]
    assert msg["email_subject"].startswith("Zamówienie towaru")


def test_order_email_routes_wired():
    paths = {getattr(r, "path", None) for r in order_email_routes.router.routes}
    assert "/api/orders/generate-messages" in paths
    assert "/api/orders/send-email" in paths
