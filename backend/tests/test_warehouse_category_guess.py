"""warehouse_category_guess — kategorie bez LLM."""
from __future__ import annotations

from warehouse_category_guess import (
    expiry_status,
    guess_category_free,
    keyword_token_hit,
)


def test_keyword_token_hit_no_virgin_gin():
    assert keyword_token_hit("gin", "gin tonic")
    assert not keyword_token_hit("gin", "virgin olive oil")


def test_guess_oil_not_alcohol():
    cat = guess_category_free("oliwa z oliwek extra virgin", ai_category="Alkohole")
    assert cat == "Oleje i tłuszcze"


def test_guess_vegetable():
    assert guess_category_free("pomidory cherry") == "Warzywa i owoce"


def test_guess_dairy():
    assert guess_category_free("śmietana 18%") == "Nabiał"


def test_expiry_status():
    assert expiry_status("1999-01-01") == "expired"
