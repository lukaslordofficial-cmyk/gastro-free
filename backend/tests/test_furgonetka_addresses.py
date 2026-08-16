from furgonetka_broker import (
    _ensure_person_name,
    _missing_party_fields,
    _normalize_postcode,
    _party,
)


def test_postcode_normalizes():
    assert _normalize_postcode("00123") == "00-123"
    assert _normalize_postcode("00-123") == "00-123"


def test_ensure_person_name_appends_kontakt_for_single_word():
    assert _ensure_person_name("alkor") == "alkor Kontakt"
    assert _ensure_person_name("Jan Kowalski") == "Jan Kowalski"
    assert _ensure_person_name("") == "Odbiorca Kontakt"
    assert _ensure_person_name("  Firma   XYZ  ") == "Firma XYZ"


def test_party_single_word_restaurant_gets_two_part_name():
    p = _party(
        name="alkor",
        company="alkor",
        email="a@b.pl",
        phone="323262655",
        street="ul. Przykladowa 12",
        city="Jaroslaw",
        postcode="37-500",
    )
    assert p["name"] == "alkor Kontakt"
    assert p["company"] == "alkor"


def test_api_base_normalizes_sandbox_host():
    from furgonetka_broker import api_base
    import os

    os.environ.pop("FURGONETKA_API_URL", None)
    assert api_base() == "https://api.furgonetka.pl"
    os.environ["FURGONETKA_API_URL"] = "https://api.sandbox.furgonetka.pl"
    assert api_base() == "https://api.furgonetka.pl"
    os.environ["FURGONETKA_API_URL"] = "https://api.furgonetka.pl"
    assert api_base() == "https://api.furgonetka.pl"
    os.environ.pop("FURGONETKA_API_URL", None)


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
    assert p["name"] == "Odbiorca Kontakt"
    miss = _missing_party_fields(p, who="nadawca")
    assert any("miasto" in m for m in miss)
    assert any("telefon" in m for m in miss)
