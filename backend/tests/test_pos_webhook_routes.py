"""POS webhook extraction + menu availability helper sanity."""
from __future__ import annotations

import inspect

import pos_webhook_routes
from pos_webhook_routes import PosSaleItem, PosWebhookRequest


def test_pos_webhook_router_wired():
    paths = {getattr(r, "path", None) for r in pos_webhook_routes.router.routes}
    assert "/api/pos/webhook" in paths


def test_pos_webhook_models():
    item = PosSaleItem(dish_name="Pizza", quantity_sold=2, unit_price_pln=25.5)
    req = PosWebhookRequest(external_order_id="o-1", items=[item])
    assert req.items[0].quantity_sold == 2


def test_single_recompute_definition():
    import server as srv

    src = inspect.getsource(srv)
    # dokładnie jedna definicja (pełna), bez cienia stubu
    assert src.count("async def _recompute_menu_availability") == 1
    sig = inspect.signature(srv._recompute_menu_availability)
    assert "changed_inventory_ids" in sig.parameters


def test_availability_changed_count_helper():
    import server as srv

    assert srv._availability_changed_count({"changed": 3}) == 3
    assert srv._availability_changed_count({"skipped": True}) == 0
    assert srv._availability_changed_count(7) == 7
