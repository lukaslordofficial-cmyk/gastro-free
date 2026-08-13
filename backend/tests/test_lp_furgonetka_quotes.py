from lp_furgonetka_quotes import (
    bookable_quotes,
    is_bookable_quote,
    mock_quotes_for_parcels,
    normalize_services_prices,
    service_label,
)
from local_producers_commerce import courier_line_item_name
from furgonetka_broker import _is_client_auth_error
from lp_packaging import parcels_for_weight_kg, size_for_weight_kg


def test_mock_quotes_scale_with_weight():
    light = mock_quotes_for_parcels([{
        "weight": 1, "width": 20, "height": 15, "depth": 20, "quantity": 1,
    }])
    heavy = mock_quotes_for_parcels([{
        "weight": 30, "width": 40, "height": 30, "depth": 30, "quantity": 1,
    }])
    assert light and heavy
    assert heavy[0]["price_gross"] > light[0]["price_gross"]
    names = {q["service"] for q in heavy}
    assert "inpost" in names and "dpd" in names


def test_normalize_services_prices():
    raw = {
        "services_prices": [
            {
                "service_id": 9,
                "service": "inpost",
                "available": True,
                "pricing": {"price_net": 10, "price_gross": 12.3, "tax": 23},
            },
            {
                "service_id": 8,
                "service": "dpd",
                "available": False,
                "errors": [{"message": "za duża paczka"}],
                "pricing": {},
            },
        ]
    }
    rows = normalize_services_prices(raw)
    assert rows[0]["service"] == "inpost"
    assert rows[0]["price_gross"] == 12.3
    assert rows[1]["available"] is False
    assert service_label("inpost") == "InPost Kurier"


def test_bookable_quotes_hide_unavailable_and_fake_orlen():
    rows = [
        {"service": "orlen", "name": "Orlen Paczka", "available": True, "price_gross": 1.23},
        {"service": "poczta", "name": "Poczta Polska", "available": True, "price_gross": 18.5},
        {"service": "dhl", "name": "DHL Express International", "available": True, "price_gross": 90},
        {"service": "ups", "name": "UPS", "available": False, "price_gross": 22, "error": "brak PL"},
        {"service": "inpost", "name": "InPost Kurier", "available": True, "price_gross": 16.4},
    ]
    visible = bookable_quotes(rows, weight_kg=20)
    names = {q["service"] for q in visible}
    assert "orlen" not in names
    assert "dhl" not in names
    assert "ups" not in names
    assert names == {"poczta", "inpost"}
    assert not is_bookable_quote(rows[0], weight_kg=20)


def test_courier_stripe_label_uses_selected_name():
    assert courier_line_item_name({"courier_name": "Orlen Paczka"}) == "Kurier — Orlen Paczka"
    assert courier_line_item_name({"courier_name": "inpost"}) == "Kurier InPost"
    assert "Orlen Paczka" in courier_line_item_name({
        "courier_name": None,
        "notes": 'lp_courier:{"name":"Orlen Paczka","service":"orlen"}',
    })


def test_20kg_suggests_l_box_not_small_default():
    assert size_for_weight_kg(20) == "L"
    p = parcels_for_weight_kg(20)[0]
    assert p["width"] == 40 and p["height"] == 30 and p["depth"] == 30
    assert p["weight"] == 20


def test_client_auth_error_detection():
    assert _is_client_auth_error("Client authentication failed")
    assert _is_client_auth_error("invalid_client")
    assert not _is_client_auth_error("package too heavy")
