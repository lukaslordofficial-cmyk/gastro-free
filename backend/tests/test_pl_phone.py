"""Unit tests for PL courier phone helpers used by Furgonetka."""
from __future__ import annotations

from pl_phone import (
    assign_courier_phones,
    humanize_courier_phone_error,
    is_pl_mobile,
    pl_phone_digits,
)


def test_landline_katowice_is_not_mobile():
    assert pl_phone_digits("323262655") == "323262655"
    assert is_pl_mobile("323262655") is False
    assert is_pl_mobile("500600700") is True
    assert is_pl_mobile("+48 500 600 700") is True


def test_assign_uses_producer_mobile_when_restaurant_is_landline():
    pickup, receiver = assign_courier_phones(
        "500111222",
        "323262655",
    )
    assert pickup == "500111222"
    assert receiver == "500111222"


def test_humanize_hides_seven_digit_message():
    raw = (
        "Podano numer telefonu stacjonarnego. "
        "Wpisz poprawny numer komórkowy (9 cyfr). Podano 7 cyfr."
    )
    out = humanize_courier_phone_error(raw)
    assert "7 cyfr" not in out
    assert "komórkowego" in out
