from lp_tracking import (
    latest_tracking_state,
    shipment_status_for_state,
    timeline_index,
)


def test_state_mapping():
    assert shipment_status_for_state("ordered") == "preparing"
    assert shipment_status_for_state("collected") == "shipped"
    assert shipment_status_for_state("transit") == "shipped"
    assert shipment_status_for_state("delivered") == "delivered"
    assert shipment_status_for_state("canceled") == "cancelled"


def test_timeline():
    assert timeline_index("waiting") == 0
    assert timeline_index("ordered", has_pickup=True) == 1
    assert timeline_index("collected") == 2
    assert timeline_index("transit") == 3
    assert timeline_index("delivery") == 4
    assert timeline_index("delivered") == 5


def test_latest_tracking_state():
    payload = {
        "tracking": [
            {"state": "ordered", "status": "Zamówiono"},
            {"state": "collected", "status": "Odebrano", "datetime": "2026-08-13T10:00:00"},
        ]
    }
    assert latest_tracking_state(payload) == "collected"
