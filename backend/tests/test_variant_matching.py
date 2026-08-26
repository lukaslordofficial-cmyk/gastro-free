"""Testy jednostkowe dopasowania po odmianie/wariancie (Łowca Okazji)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from variant_matching import (  # noqa: E402
    base_matches_offer,
    classify_offer,
    normalize_variant,
    offer_variant_label,
    variant_matches_offer,
)


# ── base_matches_offer: ten sam produkt podstawowy ──────────────────────────
def test_base_match_same_product_with_variant_and_size():
    assert base_matches_offer("ziemniak", "Ziemniak Gala 5kg")
    assert base_matches_offer("ziemniak", "Ziemniaki Irys jadalne")


def test_base_match_plural_apple():
    assert base_matches_offer("jabłko", "Jabłka Jonagold 70+")
    assert base_matches_offer("jabłko", "JABŁKO JONAGOLD 65/70")


def test_base_match_different_product():
    assert not base_matches_offer("ziemniak", "marchew myta")
    assert not base_matches_offer("jabłko", "gruszka konferencja")


# ── variant_matches_offer: dokładna odmiana ─────────────────────────────────
def test_variant_exact_jonagold_variations():
    assert variant_matches_offer("Jonagold", "Jabłka Jonagold 70+")
    assert variant_matches_offer("Jonagold", "Jabłko Jonagold kl. I")
    assert variant_matches_offer("Jonagold", "JABŁKO JONAGOLD 65/70")


def test_variant_not_matching_other_variety():
    assert not variant_matches_offer("Jonagold", "Jabłko Gala")
    assert not variant_matches_offer("Irys", "Ziemniak Gala 5kg")


def test_variant_descriptive_bio_premium():
    assert variant_matches_offer("BIO", "Marchew BIO luz")
    assert variant_matches_offer("Premium", "Pomidor Premium malinowy")
    assert variant_matches_offer("bezglutenowy", "Makaron bezglutenowy 500g")


# ── classify_offer: exact / substitute / none ───────────────────────────────
def test_classify_exact():
    assert classify_offer("Irys", "ziemniak", "Ziemniak Irys jadalny") == "exact"


def test_classify_substitute_same_base_other_variant():
    assert classify_offer("Irys", "ziemniak", "Ziemniak Gala 5kg") == "substitute"
    assert classify_offer("Irys", "ziemniak", "Ziemniak Lord") == "substitute"


def test_classify_none_different_product():
    assert classify_offer("Irys", "ziemniak", "Marchew myta") == "none"


def test_classify_no_variant_is_backward_compatible():
    # Brak odmiany → zachowanie jak dotychczas (każdy pasujący produkt = exact)
    assert classify_offer(None, "ziemniak", "Ziemniak Gala 5kg") == "exact"
    assert classify_offer("", "ziemniak", "Ziemniaki Irys") == "exact"
    assert classify_offer("  ", "ziemniak", "Marchew") == "none"


# ── offer_variant_label: etykieta zamiennika ────────────────────────────────
def test_offer_variant_label_extracts_variety():
    assert offer_variant_label("ziemniak", "Ziemniak Gala 5kg") == "Gala"
    assert offer_variant_label("jabłko", "Jabłka Jonagold 70+") == "Jonagold"
    assert offer_variant_label("ziemniak", "Ziemniak Lord") == "Lord"


def test_offer_variant_label_empty_when_only_base():
    assert offer_variant_label("ziemniak", "Ziemniaki 5kg") == ""


# ── normalize_variant ───────────────────────────────────────────────────────
def test_normalize_variant():
    assert normalize_variant("Jonagold") == "jonagold"
    assert normalize_variant("  Irys  ") == "irys"
    assert normalize_variant(None) == ""
