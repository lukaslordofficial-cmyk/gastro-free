"""Testy normalizacji profilu lokalu / stopki zamówienia."""
from restaurant_profile import normalize_restaurant_profile, order_footer


def test_normalize_strips_and_fills_keys():
    out = normalize_restaurant_profile(
        {"contact_email": "  a@b.pl ", "company_name": " Gastro ", "extra": "x"}
    )
    assert out["contact_email"] == "a@b.pl"
    assert out["company_name"] == "Gastro"
    assert out["delivery_address"] == ""
    assert "extra" not in out


def test_order_footer_uses_fallback_email():
    text = order_footer({"contact_email": "", "contact_phone": "500"}, fallback_email="owner@x.pl")
    assert "owner@x.pl" in text
    assert "500" in text
