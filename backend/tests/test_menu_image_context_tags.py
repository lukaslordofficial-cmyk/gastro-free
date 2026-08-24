"""Unit tests — menu_image_context_tags."""
from __future__ import annotations

from types import SimpleNamespace

from menu_image_context_tags import attach_image_context_tags, extract_image_context_tags


def test_extract_tags_for_duck_and_lemonade():
    tags = extract_image_context_tags("Kaczka pieczona z jabłkami")
    assert "kaczka" in tags
    assert "jabłko" in tags
    drink = extract_image_context_tags("Lemoniada sezonowa")
    assert "lemoniada" in drink or "napój" in drink


def test_attach_skips_existing():
    d = SimpleNamespace(name="Pizza Margherita", image_context_tags=["już"])
    attach_image_context_tags([d])
    assert d.image_context_tags == ["już"]
    d2 = SimpleNamespace(name="Pizza Margherita", image_context_tags=[])
    attach_image_context_tags([d2])
    assert "pizza" in d2.image_context_tags
