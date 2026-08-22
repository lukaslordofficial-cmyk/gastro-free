"""supplier_intent_routes mount smoke."""
from __future__ import annotations

import supplier_intent_routes


def test_supplier_intent_router_wired():
    paths = {getattr(r, "path", None) for r in supplier_intent_routes.router.routes}
    assert "/api/suppliers/flip-order" in paths
    assert "/api/suppliers/budget-cap-order" in paths
    assert "/api/suppliers/top-savings" in paths
    assert "/api/suppliers/predictive-restock" in paths


def test_flip_model():
    req = supplier_intent_routes.FlipOrderRequest(
        from_supplier="A",
        to_supplier="B",
    )
    assert req.from_supplier == "A"
