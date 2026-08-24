"""Regression: waste / voice fuzzy must not map bataty → bakłażan."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pl_fuzzy_norm import norm_pl  # noqa: E402
from voice_fuzzy_resolve import resolve_by_fuzzy, verify_related_name  # noqa: E402


def _food_compat(a: str, b: str) -> bool:
    """Minimalny port logiki stem/prefix (bez pełnego server importu)."""
    from server import _food_names_compatible

    return _food_names_compatible(a, b)


def test_bataty_does_not_resolve_to_baklazan():
    rows = [
        {"id": "1", "name": "Bakłażan"},
        {"id": "2", "name": "Batat"},
        {"id": "3", "name": "Marchew"},
    ]
    hit, score = resolve_by_fuzzy(
        "bataty",
        rows,
        norm_pl=norm_pl,
        food_names_compatible=_food_compat,
        strict_food=True,
    )
    assert hit is not None
    assert hit["name"] == "Batat"
    assert score >= 65


def test_bataty_without_batat_row_returns_none_not_baklazan():
    rows = [
        {"id": "1", "name": "Bakłażan"},
        {"id": "3", "name": "Marchew"},
        {"id": "4", "name": "Brokuł"},
    ]
    hit, _score = resolve_by_fuzzy(
        "bataty",
        rows,
        norm_pl=norm_pl,
        food_names_compatible=_food_compat,
        strict_food=True,
    )
    assert hit is None


def test_permissive_mode_still_prefers_food_stem_when_present():
    rows = [
        {"id": "1", "name": "Bakłażan"},
        {"id": "2", "name": "Bataty luz"},
    ]
    hit, _ = resolve_by_fuzzy(
        "bataty",
        rows,
        norm_pl=norm_pl,
        food_names_compatible=_food_compat,
        strict_food=False,
    )
    assert hit is not None
    assert "Batat" in hit["name"] or "batat" in hit["name"].lower()


def test_verify_related_rejects_wrong_uuid_name():
    assert not verify_related_name(
        "bataty",
        {"id": "x", "name": "Bakłażan"},
        food_names_compatible=_food_compat,
    )
    assert verify_related_name(
        "bataty",
        {"id": "y", "name": "Batat"},
        food_names_compatible=_food_compat,
    )
