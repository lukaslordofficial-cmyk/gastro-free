from lp_receive import _map_lp_category_hint, order_paid_total_pln


def test_map_vegetables():
    assert _map_lp_category_hint("Warzywa sezonowe", "Pomidory malinowe") == "Warzywa"
    assert _map_lp_category_hint(None, "Ziemniaki młode") == "Warzywa"


def test_map_meat_and_preserves():
    assert _map_lp_category_hint("Mięso", "Schab wieprzowy") == "Mięso"
    assert _map_lp_category_hint("Przetwory", "Dżem truskawkowy") == "Inne"
    assert _map_lp_category_hint(None, "Ser kozi") == "Nabiał"


def test_order_paid_total_includes_courier_and_fee():
    assert order_paid_total_pln({
        "total_price": 123.45,
        "producer_amount": 100,
        "delivery_cost": 15,
        "platform_fee": 5,
    }) == 123.45
    assert order_paid_total_pln({
        "total_price": 0,
        "producer_amount": 100,
        "delivery_cost": 15.5,
        "platform_fee": 5,
    }) == 120.5
    assert order_paid_total_pln({
        "total_price": 0,
        "producer_amount": 0,
        "delivery_cost": 10,
        "platform_fee": 5,
    }, materials_total=80) == 95.0
