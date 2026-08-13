from lp_courier_price import courier_price_for_weight_kg, quote_courier_for_items


def test_heavier_parcel_costs_more_than_stub_15():
    cheap = courier_price_for_weight_kg(1)
    mid = courier_price_for_weight_kg(7)
    heavy = courier_price_for_weight_kg(22)
    assert cheap < mid < heavy
    assert mid != 15
    assert mid == 18.99


def test_quote_from_kg_lines():
    items = [
        {"product_id": "a", "quantity": 1},
        {"product_id": "b", "quantity": 1},
        {"product_id": "c", "quantity": 4},
        {"product_id": "d", "quantity": 1},
    ]
    products = {
        "a": {"unit": "kg"},
        "b": {"unit": "kg"},
        "c": {"unit": "kg"},
        "d": {"unit": "kg"},
    }
    q = quote_courier_for_items(items, products)
    assert q["weight_kg"] == 7.0
    assert q["price_pln"] == 18.99
