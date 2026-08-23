"""local_producers_routes — mount paths."""
from __future__ import annotations

import local_producers_routes


def test_lp_routes_mounted():
    paths = {getattr(r, "path", None) for r in local_producers_routes.router.routes}
    assert "/api/local-producers/checkout" in paths
    assert "/api/local-producers/confirm-payment" in paths
    assert "/api/local-producers/create-shipment" in paths
    assert "/api/local-producers/orders/{order_id}/mark-received" in paths
