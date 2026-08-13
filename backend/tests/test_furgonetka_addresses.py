from furgonetka_broker import _missing_party_fields, _normalize_postcode, _party


def test_postcode_normalizes():
    assert _normalize_postcode("00123") == "00-123"
    assert _normalize_postcode("00-123") == "00-123"


def test_missing_dummy_warsaw_not_injected():
    p = _party(
        name="",
        company="",
        email="",
        phone="",
        street="",
        city="",
        postcode="",
    )
    assert p["city"] == ""
    assert p["postcode"] == ""
    miss = _missing_party_fields(p, who="nadawca")
    assert any("miasto" in m for m in miss)
    assert any("telefon" in m for m in miss)
