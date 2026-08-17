import asyncio

from lp_receive import (
    _map_lp_category_hint,
    apply_lp_inventory_and_cost,
    lp_order_note_tag,
    order_paid_total_pln,
    producer_category_name,
    receive_producer_order_into_warehouse,
)


def test_map_vegetables():
    assert _map_lp_category_hint("Warzywa sezonowe", "Pomidory malinowe") == "Warzywa i owoce"
    assert _map_lp_category_hint(None, "Ziemniaki młode") == "Warzywa i owoce"


def test_map_meat_and_preserves():
    assert _map_lp_category_hint("Mięso", "Schab wieprzowy") == "Mięso i wędliny"
    assert _map_lp_category_hint("Przetwory", "Dżem truskawkowy") == "Inne"
    assert _map_lp_category_hint(None, "Ser kozi") == "Nabiał"


def test_producer_category_name_array_and_object():
    assert producer_category_name({"name": "Warzywa"}) == "Warzywa"
    assert producer_category_name([{"name": "Nabiał"}]) == "Nabiał"
    assert producer_category_name(None) is None
    assert producer_category_name("Pieczywo") == "Pieczywo"


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


class _Store:
    def __init__(self):
        self.inventory = []
        self.costs = []
        self.categories = []
        self.orders = {}
        self.order_items = []
        self.products = {}
        self.producers = {}
        self.ids = 0

    def _id(self) -> str:
        self.ids += 1
        return f"id-{self.ids}"

    async def get(self, _client, table, params=None):
        params = params or {}
        if table == "inventory_items":
            return list(self.inventory)
        if table == "inventory_categories":
            return list(self.categories)
        if table == "variable_cost_entries":
            note = str(params.get("note") or "")
            name = str(params.get("name") or "")
            rows = list(self.costs)
            if note.startswith("ilike."):
                needle = note[len("ilike."):].strip("*")
                rows = [r for r in rows if needle in str(r.get("note") or "")]
            if name.startswith("eq."):
                rows = [r for r in rows if r.get("name") == name[3:]]
            return rows
        if table == "producer_orders":
            oid = str(params.get("id") or "").replace("eq.", "")
            row = self.orders.get(oid)
            return [row] if row else []
        if table == "producer_order_items":
            return list(self.order_items)
        if table == "producer_products":
            return list(self.products.values())
        if table == "local_producers":
            pid = str(params.get("id") or "").replace("eq.", "")
            row = self.producers.get(pid)
            return [row] if row else []
        return []

    async def post(self, _client, table, payload):
        row = dict(payload)
        row["id"] = self._id()
        if table == "inventory_items":
            self.inventory.append(row)
        elif table == "variable_cost_entries":
            self.costs.append(row)
        elif table == "inventory_categories":
            self.categories.append(row)
        return [row]

    async def patch(self, _client, table, params, payload):
        oid = str((params or {}).get("id") or "").replace("eq.", "")
        if table == "inventory_items":
            for row in self.inventory:
                if row.get("id") == oid:
                    row.update(payload)
                    return [row]
        if table == "variable_cost_entries":
            for row in self.costs:
                if row.get("id") == oid:
                    row.update(payload)
                    return [row]
        if table == "producer_orders":
            row = self.orders.get(oid)
            if row:
                row.update(payload)
                return [row]
        return []


def _products():
    return [
        {"product_name": "Ser kozi", "quantity": 2, "unit": "kg", "price_netto": 40, "category": "Nabiał"},
        {"product_name": "Dżem truskawkowy", "quantity": 6, "unit": "szt", "price_netto": 12, "category": "Inne"},
    ]


def test_apply_creates_two_items_and_cost():
    store = _Store()

    async def run():
        return await apply_lp_inventory_and_cost(
            client=None,
            sb_get=store.get,
            sb_post=store.post,
            sb_patch=store.patch,
            invoice_products=_products(),
            company="Gospodarstwo Test",
            total=144.0,
            order_id="ord-1",
            source="manual",
            producer_amount=120.0,
            materials_total=120.0,
            delivery_cost=18.0,
            platform_fee=6.0,
            add_qty_to_existing=True,
        )

    saved = asyncio.run(run())
    assert saved["ok"] is True
    assert len(saved["created"]) == 2
    assert len(store.inventory) == 2
    assert all(r.get("is_active") is True for r in store.inventory)
    assert saved["cost_id"]
    assert len(store.costs) == 1
    assert store.costs[0]["amount_pln"] == 144.0
    assert lp_order_note_tag("ord-1") in (store.costs[0].get("note") or "")


def test_apply_fails_when_inventory_post_returns_no_id():
    store = _Store()

    async def bad_post(_client, table, payload):
        if table == "inventory_items":
            return [{}]
        return await store.post(_client, table, payload)

    async def run():
        return await apply_lp_inventory_and_cost(
            client=None,
            sb_get=store.get,
            sb_post=bad_post,
            sb_patch=store.patch,
            invoice_products=_products(),
            company="Gospodarstwo Test",
            total=144.0,
            order_id="ord-1",
            source="manual",
            producer_amount=120.0,
            materials_total=120.0,
            delivery_cost=0,
            platform_fee=0,
            add_qty_to_existing=True,
        )

    saved = asyncio.run(run())
    assert saved["ok"] is False
    assert saved.get("stock_ok") is False


def test_repair_does_not_double_qty_and_inserts_missing_cost():
    store = _Store()
    store.inventory = [
        {"id": "inv-1", "name": "Ser kozi", "quantity": 2, "unit": "kg", "is_active": True},
        {"id": "inv-2", "name": "Dżem truskawkowy", "quantity": 6, "unit": "szt", "is_active": True},
    ]

    async def run():
        return await apply_lp_inventory_and_cost(
            client=None,
            sb_get=store.get,
            sb_post=store.post,
            sb_patch=store.patch,
            invoice_products=_products(),
            company="Gospodarstwo Test",
            total=144.0,
            order_id="ord-1",
            source="manual",
            producer_amount=120.0,
            materials_total=120.0,
            delivery_cost=0,
            platform_fee=0,
            add_qty_to_existing=False,
        )

    saved = asyncio.run(run())
    assert saved["ok"] is True
    assert saved["created"] == []
    assert saved["updated"] == []
    assert store.inventory[0]["quantity"] == 2
    assert store.inventory[1]["quantity"] == 6
    assert saved["cost_id"]
    assert len(store.costs) == 1


def test_receive_does_not_mark_order_when_stock_write_fails(monkeypatch):
    store = _Store()
    store.orders["ord-1"] = {
        "id": "ord-1",
        "producer_id": "prod-1",
        "restaurant_account_key": "rest-1",
        "notes": "",
        "payment_status": "paid",
        "total_price": 144,
        "producer_amount": 120,
        "delivery_cost": 18,
        "platform_fee": 6,
    }
    store.producers["prod-1"] = {"id": "prod-1", "company_name": "Gospodarstwo Test"}
    store.order_items = [
        {"product_id": "p1", "quantity": 2, "unit_price": 40},
        {"product_id": "p2", "quantity": 6, "unit_price": 12},
    ]
    store.products = {
        "p1": {"id": "p1", "title": "Ser kozi", "unit": "kg"},
        "p2": {"id": "p2", "title": "Dżem truskawkowy", "unit": "szt"},
    }

    async def bad_post(_client, table, payload):
        if table == "inventory_items":
            return [{}]
        return await store.post(_client, table, payload)

    import supabase_rest as sb_mod

    monkeypatch.setattr(sb_mod, "push_account_key", lambda *_a, **_k: "tok")
    monkeypatch.setattr(sb_mod, "reset_account_key", lambda *_a, **_k: None)

    async def run():
        return await receive_producer_order_into_warehouse(
            client=None,
            sb_get=store.get,
            sb_patch=store.patch,
            sb_post=bad_post,
            order_id="ord-1",
            source="manual",
        )

    result = asyncio.run(run())
    assert result["ok"] is False
    assert not store.orders["ord-1"].get("warehouse_received_at")
    assert "warehouse_received:1" not in str(store.orders["ord-1"].get("notes") or "")
