from voice_system_prompt import build_system_prompt


def test_build_system_prompt_includes_catalog():
    text = build_system_prompt(
        [{"id": "d1", "name": "Barszcz"}],
        [{"id": "i1", "name": "Burak", "unit": "kg"}],
        [{"id": "s1", "name": "Hurtownia X"}],
    )
    assert "Barszcz" in text
    assert "Burak" in text
    assert "Hurtownia X" in text
    assert '"waste"' in text
