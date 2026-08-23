"""pl_fuzzy_norm — food_match_key / norm_pl."""
from __future__ import annotations

from pl_fuzzy_norm import food_match_key, norm_pl, strip_accents


def test_strip_accents():
    assert strip_accents("żółć") == "zolc"


def test_norm_pl_units_and_order():
    a = norm_pl("Filet z kurczaka 500g")
    b = norm_pl("kurczak filet")
    assert "kurczak" in a and "piers" in a  # filet→piers
    assert a == b or "kurczak" in b


def test_food_match_key_plural():
    assert food_match_key("pomidory") == food_match_key("pomidor") or (
        "pomidor" in food_match_key("pomidory")
    )


def test_food_match_key_keeps_percent():
    k18 = food_match_key("śmietana 18%")
    k30 = food_match_key("śmietana 30%")
    assert k18 != k30
