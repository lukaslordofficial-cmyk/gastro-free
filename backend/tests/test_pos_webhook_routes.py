"""POS webhook extraction + menu availability helper sanity."""
from __future__ import annotations

import inspect

import pos_webhook_routes
from pos_webhook_routes import PosSaleItem, PosWebhookRequest


def test_pos_webhook_router_wired():
    paths = {getattr(r, "path", None) for r in pos_webhook_routes.router.routes}
    assert "/api/pos/webhook" in paths
    assert "/w/{code}" in paths
    methods = {
        (getattr(r, "path", None), tuple(sorted(getattr(r, "methods", set()) or [])))
        for r in pos_webhook_routes.router.routes
    }
    assert ("/api/pos/webhook", ("GET", "POST")) in methods or any(
        p == "/api/pos/webhook" and "GET" in m and "POST" in m for p, m in methods
    )


def test_empty_sales_body_handshake():
    assert pos_webhook_routes._is_empty_sales_body(None) is True
    assert pos_webhook_routes._is_empty_sales_body({}) is True
    assert pos_webhook_routes._is_empty_sales_body({"ping": True}) is True
    assert pos_webhook_routes._is_empty_sales_body({"items": []}) is True
    assert pos_webhook_routes._is_empty_sales_body(
        {"items": [{"pos_external_id": "1", "quantity_sold": 1}]}
    ) is False


def test_pos_webhook_models():
    item = PosSaleItem(dish_name="Pizza", quantity_sold=2, unit_price_pln=25.5)
    req = PosWebhookRequest(external_order_id="o-1", items=[item])
    assert req.items[0].quantity_sold == 2


def test_single_recompute_definition():
    import importlib
    import server as srv

    # Po podziale monolitu funkcja mieszka w module domenowym; sprawdzamy tam,
    # że istnieje dokładnie jedna pełna definicja (bez cienia/stubu).
    fn = srv._recompute_menu_availability
    mod = importlib.import_module(fn.__module__)
    src = inspect.getsource(mod)
    assert src.count("async def _recompute_menu_availability") == 1
    sig = inspect.signature(fn)
    assert "changed_inventory_ids" in sig.parameters


def test_availability_changed_count_helper():
    import server as srv

    assert srv._availability_changed_count({"changed": 3}) == 3
    assert srv._availability_changed_count({"skipped": True}) == 0
    assert srv._availability_changed_count(7) == 7
