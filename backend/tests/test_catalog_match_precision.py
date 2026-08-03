"""Precision of Deal Hunter catalog matching — no random SKUs in carts."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import (  # noqa: E402
    LOCAL_CATALOG_MATCH_MIN,
    _food_names_compatible,
    _local_catalog_match_score,
    _strict_local_catalog_accept,
)


def test_exact_and_pack_variant_auto_accept():
    assert _strict_local_catalog_accept(["ser kozi"], "ser kozi")
    assert _strict_local_catalog_accept(["ser kozi"], "Ser kozi rolka")
    assert _local_catalog_match_score("ser kozi", "ser kozi rolka") >= LOCAL_CATALOG_MATCH_MIN


def test_grzanek_does_not_auto_accept_unrelated():
    """Short / dry-goods names must not latch onto random catalog rows."""
    decoys = [
        "grzybki marynowane",
        "groszek konserwowy",
        "granulat czosnkowy",
        "herbata green",
        "kurczak grillowany",
        "makaron spaghetti",
        "olej rzepakowy",
    ]
    for d in decoys:
        assert not _strict_local_catalog_accept(["grzanek"], d), d
        assert _local_catalog_match_score("grzanek", d) < LOCAL_CATALOG_MATCH_MIN, d


def test_unrelated_spice_vs_meat_not_compatible():
    assert not _food_names_compatible("oregano", "schab wieprzowy")
    assert not _food_names_compatible("grzanek", "filet z kurczaka")
    assert _food_names_compatible("pomidor", "pomidory pelati")


def test_plural_and_word_order_compatible():
    """batat↔bataty, filet z kurczaka↔kurczak filet — ten sam towar."""
    assert _food_names_compatible("batat", "bataty")
    assert _food_names_compatible("bataty", "batat")
    assert _food_names_compatible("filet z kurczaka", "kurczak filet")
    assert _food_names_compatible("pomidor", "pomidory")
    # Auto-accept lokalny dla bliskiej odmiany
    assert _strict_local_catalog_accept(["batat"], "bataty")
    assert _local_catalog_match_score("batat", "bataty") >= 0.7


def test_bad_synonym_cannot_force_auto_accept():
    """Even if a bad synonym looks like a catalog row, primary must still match."""
    # Primary = grzanek; decoy catalog equals a polluted synonym string
    assert not _strict_local_catalog_accept(
        ["grzanek"],
        "makaron spaghetti 500g",
    )


def test_partial_letter_overlap_capped_without_food_stem():
    score = _local_catalog_match_score("grzanek", "granulat czosnkowy")
    assert score <= 0.45
