from lp_furgonetka_quotes import mock_quotes_for_parcels, normalize_services_prices, service_label


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
