import asyncio
import types
import actions_core


def test_inventory_dedup_increments_existing(monkeypatch):
    """„Jabłko Jonagold" istnieje; dodanie „Jabłko jonagold" (ta sama, inna wielkość liter)
    ma ZWIĘKSZYĆ stan istniejącej pozycji, nie tworzyć nowej."""
    calls = {"post": [], "patch": []}

    async def fake_sb_get(client, path, params=None):
        if path == "inventory_items":
            return [{"id": "abc-1", "name": "Jabłko Jonagold", "quantity": 3.0, "unit": "szt"}]
        return []

    async def fake_sb_post(client, path, payload):
        calls["post"].append((path, payload))
        return [{"id": "new-999"}]

    async def fake_sb_patch(client, path, params, payload):
        calls["patch"].append((path, params, payload))
        return [{"id": "abc-1"}]

    async def fake_resolve_cat(client, name):
        return "cat-1"

    monkeypatch.setattr(actions_core, "sb_get", fake_sb_get)
    monkeypatch.setattr(actions_core, "sb_post", fake_sb_post)
    monkeypatch.setattr(actions_core, "sb_patch", fake_sb_patch)
    monkeypatch.setattr(actions_core, "_resolve_category_id", fake_resolve_cat)

    p = {"product_name": "Jabłko jonagold", "unit": "szt", "quantity": 2}
    _id, summary, warnings = asyncio.run(
        actions_core._apply_inventory_item(None, p, None, "test")
    )

    assert _id == "abc-1"
    assert summary.get("merged_into_existing") is True
    assert summary["quantity"] == 5.0  # 3 + 2
    assert len(calls["patch"]) == 1 and calls["patch"][0][1] == {"id": "eq.abc-1"}
    assert calls["patch"][0][2] == {"quantity": 5.0}
    assert calls["post"] == []  # NIE utworzono nowej pozycji


def test_inventory_dedup_baklazan_plural(monkeypatch):
    """Magazyn „Bakłażan” + dodanie „bakłażany” ma scalić stan, nie tworzyć nowej pozycji."""
    calls = {"post": [], "patch": []}

    async def fake_sb_get(client, path, params=None):
        if path == "inventory_items":
            return [{"id": "egg-1", "name": "Bakłażan", "quantity": 2.0, "unit": "kg"}]
        return []

    async def fake_sb_post(client, path, payload):
        calls["post"].append(payload)
        return [{"id": "new-bad"}]

    async def fake_sb_patch(client, path, params, payload):
        calls["patch"].append((path, params, payload))
        return [{"id": "egg-1"}]

    async def fake_resolve_cat(client, name):
        return "cat-1"

    monkeypatch.setattr(actions_core, "sb_get", fake_sb_get)
    monkeypatch.setattr(actions_core, "sb_post", fake_sb_post)
    monkeypatch.setattr(actions_core, "sb_patch", fake_sb_patch)
    monkeypatch.setattr(actions_core, "_resolve_category_id", fake_resolve_cat)

    p = {"product_name": "bakłażany", "unit": "kg", "quantity": 1.5}
    _id, summary, _w = asyncio.run(
        actions_core._apply_inventory_item(None, p, None, "test")
    )
    assert _id == "egg-1"
    assert summary.get("merged_into_existing") is True
    assert summary["quantity"] == 3.5
    assert calls["post"] == []


def test_inventory_new_product_inserts(monkeypatch):
    """Zupełnie nowy produkt (brak dopasowania) tworzy nową pozycję."""
    calls = {"post": []}

    async def fake_sb_get(client, path, params=None):
        return [{"id": "abc-1", "name": "Marchew", "quantity": 3.0, "unit": "kg"}]

    async def fake_sb_post(client, path, payload):
        calls["post"].append(payload)
        return [{"id": "new-1"}]

    async def fake_resolve_cat(client, name):
        return "cat-1"

    monkeypatch.setattr(actions_core, "sb_get", fake_sb_get)
    monkeypatch.setattr(actions_core, "sb_post", fake_sb_post)
    monkeypatch.setattr(actions_core, "_resolve_category_id", fake_resolve_cat)

    p = {"product_name": "Filet z kurczaka", "unit": "kg", "quantity": 5}
    _id, summary, _w = asyncio.run(
        actions_core._apply_inventory_item(None, p, None, "test")
    )
    assert _id == "new-1"
    assert len(calls["post"]) == 1
    assert summary.get("merged_into_existing") is None
