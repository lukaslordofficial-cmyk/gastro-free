"""Integracja: compare_offers z odmianą (exact vs zamiennik) — mockowane I/O."""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import compare_offers_impl as coi  # noqa: E402
from models import CompareItem, CompareOffersRequest  # noqa: E402


class _DummyClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


def _suppliers():
    return [
        {"id": "s1", "name": "Dostawca A", "email": "a@x.pl", "min_order_value": 0},
        {"id": "s2", "name": "Dostawca B", "email": "b@x.pl", "min_order_value": 0},
        {"id": "s3", "name": "Dostawca C", "email": "c@x.pl", "min_order_value": 0},
        {"id": "s4", "name": "Dostawca D", "email": "d@x.pl", "min_order_value": 0},
    ]


def _catalog():
    return [
        {"id": "c1", "supplier_id": "s1", "name": "Ziemniak Irys", "variant": None,
         "unit": "kg", "price_pln": 3.10, "is_visible": True},
        {"id": "c2", "supplier_id": "s2", "name": "Ziemniak Gala 5kg", "variant": None,
         "unit": "kg", "price_pln": 2.49, "is_visible": True},
        {"id": "c3", "supplier_id": "s3", "name": "Ziemniak Lord", "variant": None,
         "unit": "kg", "price_pln": 2.69, "is_visible": True},
        {"id": "c4", "supplier_id": "s4", "name": "Marchew myta", "variant": None,
         "unit": "kg", "price_pln": 1.50, "is_visible": True},
    ]


def _patch(monkeypatch, catalog=None, suppliers=None, inv_rows=None, inv_variant=None):
    catalog = catalog if catalog is not None else _catalog()
    suppliers = suppliers if suppliers is not None else _suppliers()
    inv_rows = inv_rows or []
    inv_variant = inv_variant or []

    async def fake_check(*a, **k):
        return None

    async def fake_load(client, scope):
        return list(catalog), list(suppliers), "suppliers_only"

    async def fake_has_syn(client):
        return False

    async def fake_sb_get(client, table, params=None):
        params = params or {}
        if table == "inventory_items":
            sel = (params.get("select") or "").strip()
            if sel == "id,variant":
                return list(inv_variant)
            return list(inv_rows)
        return []

    async def fake_reliability(client):
        return {}

    async def fake_signals(client, days=30):
        return {}

    async def fake_tips(client, result, per_item):
        return result

    monkeypatch.setattr(coi.httpx, "AsyncClient", lambda *a, **k: _DummyClient())
    monkeypatch.setattr(coi, "_check_ai_access", fake_check)
    monkeypatch.setattr(coi, "_load_catalog_for_search_scope", fake_load)
    monkeypatch.setattr(coi, "_has_inventory_synonyms", fake_has_syn)
    monkeypatch.setattr(coi, "sb_get", fake_sb_get)
    monkeypatch.setattr(coi, "_load_supplier_reliability_scores", fake_reliability)
    monkeypatch.setattr(coi, "_load_deal_hunter_kitchen_signals", fake_signals)
    monkeypatch.setattr(coi, "_enrich_deal_hunter_ai_tips", fake_tips)


def _run(req):
    return asyncio.get_event_loop().run_until_complete(coi.compare_offers(req))


def test_exact_variant_found(monkeypatch):
    _patch(monkeypatch)
    req = CompareOffersRequest(items=[
        CompareItem(product_name_or_id="ziemniak", quantity=10, unit="kg", variant="Irys"),
    ])
    res = _run(req)
    reports = res.get("variant_reports")
    assert reports and len(reports) == 1
    r = reports[0]
    assert r["requested_variant"] == "Irys"
    assert r["exact_found"] is True
    # koszyk zawiera dokładny wariant (Irys u s1)
    assert res.get("best_option") is not None
    # zamienniki: Gala i Lord
    labels = {s["variant_label"] for s in r["substitutes"]}
    assert "Gala" in labels and "Lord" in labels
    assert "Marchew" not in " ".join(labels)


def test_variant_not_found_shows_substitutes(monkeypatch):
    _patch(monkeypatch)
    req = CompareOffersRequest(items=[
        CompareItem(product_name_or_id="ziemniak", quantity=10, unit="kg", variant="Denar"),
    ])
    res = _run(req)
    r = res["variant_reports"][0]
    assert r["exact_found"] is False
    # nie ma exact → koszyk pusty dla tej pozycji (brak auto-zamiennika)
    assert res.get("best_option") is None
    groups = (
        (res.get("scenario_split_max") or {}).get("suppliers")
        or (res.get("option_optimized") or {}).get("suppliers")
        or []
    )
    assert not any(
        (it.get("matched_name") or it.get("product_name") or "")
        for g in groups
        for it in (g.get("items") or [])
    ), "zamiennik nie może wejść do koszyka bez decyzji użytkownika"
    labels = {s["variant_label"] for s in r["substitutes"]}
    assert {"Irys", "Gala", "Lord"}.issubset(labels)
    # cheapest substitute variant first (Gala 2.49)
    assert r["substitutes"][0]["variant_label"] == "Gala"
    # each substitute carries a catalog_product_id for add-to-cart
    for s in r["substitutes"]:
        for off in s["offers"]:
            assert off["catalog_product_id"]
            assert off["supplier_id"]


def test_no_variant_is_backward_compatible(monkeypatch):
    # Plain exact-name row → dopasowanie bez AI (norm_pl equal).
    _patch(monkeypatch, catalog=[
        {"id": "p1", "supplier_id": "s1", "name": "Ziemniak", "variant": None,
         "unit": "kg", "price_pln": 2.20, "is_visible": True},
        {"id": "p2", "supplier_id": "s2", "name": "Ziemniak", "variant": None,
         "unit": "kg", "price_pln": 2.40, "is_visible": True},
    ])
    req = CompareOffersRequest(items=[
        CompareItem(product_name_or_id="ziemniak", quantity=10, unit="kg"),
    ])
    res = _run(req)
    # brak odmiany → brak raportu odmian, normalne dopasowanie działa
    assert not res.get("variant_reports")
    assert res.get("best_option") is not None


def test_no_base_product_at_all(monkeypatch):
    _patch(monkeypatch, catalog=[
        {"id": "c9", "supplier_id": "s1", "name": "Marchew myta", "variant": None,
         "unit": "kg", "price_pln": 1.5, "is_visible": True},
    ])
    req = CompareOffersRequest(items=[
        CompareItem(product_name_or_id="ziemniak", quantity=10, unit="kg", variant="Irys"),
    ])
    res = _run(req)
    r = res["variant_reports"][0]
    assert r["exact_found"] is False
    assert r["substitute_variant_count"] == 0


def test_variant_honored_from_warehouse_when_request_has_none(monkeypatch):
    # Auto-zamówienia braków NIE ustawiają CompareItem.variant — odmiana pochodzi
    # z magazynu (inv_variant_by_id). Musi być honorowana jak w ręcznym zamawianiu.
    _patch(
        monkeypatch,
        inv_rows=[{"id": "inv1", "name": "ziemniak", "unit": "kg"}],
        inv_variant=[{"id": "inv1", "variant": "Irys"}],
    )
    req = CompareOffersRequest(items=[
        CompareItem(product_name_or_id="ziemniak", quantity=10, unit="kg"),  # brak variant
    ])
    res = _run(req)
    reports = res.get("variant_reports")
    assert reports and reports[0]["requested_variant"] == "Irys"
    assert reports[0]["exact_found"] is True
    labels = {s["variant_label"] for s in reports[0]["substitutes"]}
    assert "Gala" in labels and "Lord" in labels
