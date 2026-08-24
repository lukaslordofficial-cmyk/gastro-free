"""Importy krytyczne dla startu Railway (healthcheck)."""


def test_ingredient_name_norm_server_exports():
    from ingredient_name_norm import (
        apply_normalize_ingredient_names_to_dishes,
        apply_whole_product_names_to_dishes,
        combo_default_ingredients,
        is_combo_polprodukt_name,
        norm_name,
        normalize_ingredient_name,
        strip_diacritics_pl,
        whole_product_name,
    )
    assert callable(apply_normalize_ingredient_names_to_dishes)
    assert callable(apply_whole_product_names_to_dishes)
    assert callable(normalize_ingredient_name)
    assert callable(whole_product_name)
    assert callable(combo_default_ingredients)
    assert callable(is_combo_polprodukt_name)
    assert callable(norm_name)
    assert callable(strip_diacritics_pl)


def test_voice_period_guard_import():
    from voice_period_intent_guard import guard_period_intent, strip_pl_month
    data = {"intent": "compare_two_periods", "confidence": 0.5, "payload": {}, "reason": ""}
    out = guard_period_intent("pokaz zyski z lipca", data)
    assert out["intent"] == "summarize_custom_period"
    assert "lipca" in strip_pl_month("lipca") or strip_pl_month("lipca") == "lipca"
