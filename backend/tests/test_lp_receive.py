from lp_receive import _map_lp_category_hint


def test_map_vegetables():
    assert _map_lp_category_hint("Warzywa sezonowe", "Pomidory malinowe") == "Warzywa"
    assert _map_lp_category_hint(None, "Ziemniaki młode") == "Warzywa"


def test_map_meat_and_preserves():
    assert _map_lp_category_hint("Mięso", "Schab wieprzowy") == "Mięso"
    assert _map_lp_category_hint("Przetwory", "Dżem truskawkowy") == "Inne"
    assert _map_lp_category_hint(None, "Ser kozi") == "Nabiał"
