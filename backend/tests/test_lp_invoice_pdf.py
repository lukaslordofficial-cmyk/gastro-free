# -*- coding: utf-8 -*-
"""PDF rachunku LP: sprzedawca z profilu przetwórcy + polskie znaki."""
from lp_invoice_pdf import (
    build_invoice_pdf,
    format_pln,
    invoice_filename,
    seller_from_producer,
)


def _norm(text: str) -> str:
    return text.replace("\u00a0", " ")


def test_format_pln_uses_polish_currency():
    assert format_pln(5) == "5,00 z\u0142"
    assert format_pln(61.5) == "61,50 z\u0142"
    assert "?" not in format_pln(5)
    assert "\u00a0" not in format_pln(1234.5)


def test_seller_from_producer_profile_not_platform():
    seller = seller_from_producer(
        {
            "company_name": "Gospodarstwo Kowalski",
            "owner_name": "Jan Kowalski",
            "billing_address": "Lakowa 1",
            "billing_zip": "00-001",
            "billing_city": "Warszawa",
            "tax_identifier": "1234567890",
            "bank_account": "PL61109010140000071219812874",
        }
    )
    assert seller["name"] == "Gospodarstwo Kowalski"
    assert "Gastro" not in seller["name"]
    assert "Lakowa 1" in (seller["address"] or "")
    assert seller["tax_id"] == "1234567890"


def test_seller_skips_platform_placeholder():
    seller = seller_from_producer(
        {
            "company_name": "Gastro Manager",
            "billing_first_name": "Anna",
            "billing_last_name": "Nowak",
            "owner_name": "Gastro Manager",
        }
    )
    assert seller["name"] == "Anna Nowak"


def test_invoice_pdf_contains_polish_and_seller():
    import fitz

    seller_name = "Przetw\u00f3rnia TESTSELLER"
    product = "M\u0105ka \u017cytnia"
    pdf = build_invoice_pdf(
        producer={
            "company_name": seller_name,
            "billing_address": "Swietokrzyska 5",
            "billing_zip": "25-001",
            "billing_city": "Kielce",
            "tax_identifier": "5252345678",
            "settlement_document_type": "receipt",
        },
        order={
            "id": "abcd1234-xxxx",
            "invoice_number": "R/2026/TEST",
            "restaurant_name": "Bistro Zielone",
            "delivery_address": "Dluga 2",
            "delivery_city": "Krakow",
            "delivery_postal_code": "30-001",
            "shipping_cost": 12.5,
            "created_at": "2026-08-13T10:00:00",
        },
        items=[
            {
                "quantity": 2,
                "unit_price": 30.75,
                "producer_products": {"title": product, "unit": "kg"},
            }
        ],
    )
    assert pdf.startswith(b"%PDF")
    doc = fitz.open(stream=pdf, filetype="pdf")
    text = _norm("".join(page.get_text() for page in doc))
    doc.close()
    assert seller_name in text
    assert "SPRZEDAWCA" in text
    seller_block = text.split("SPRZEDAWCA")[1].split("NABYWCA")[0]
    assert "Gastro Manager" not in seller_block
    assert "z\u0142" in text
    assert product in text
    assert "5,00?l" not in text
    assert "61,50?l" not in text
    assert "61,50 z\u0142" in text
    assert invoice_filename("receipt", "abcd1234-xxxx") == "rachunek-ABCD1234.pdf"
