"""supplier_min_order_routes mount smoke."""
from __future__ import annotations

import supplier_min_order_routes


def test_min_order_router_wired():
    paths = {getattr(r, "path", None) for r in supplier_min_order_routes.router.routes}
    assert "/api/suppliers/check-minimum-order" in paths


def test_check_min_order_model():
    req = supplier_min_order_routes.CheckMinOrderRequest(
        supplier_name="Hurt X",
        current_cart_total=40,
    )
    assert req.current_cart_total == 40
