"""Backend tests for Gastro Manager voice-intent brain.

Covers:
- /api/health
- /api/actions/apply for add_inventory_item (bug fix)
- /api/actions/apply for non-destructive intents (navigate_screen, scale_recipe,
  bulk_edit_menu_prices_percentage with non-existent category, toggle_menu_item_availability)
- /api/actions/apply for bulk_delete_suppliers (must be safely blocked with needs_migration)
- /api/voice/interpret classification of Polish commands to new intents

The tests are read-only or safely reversible with the exception of one
POST /api/actions/apply add_inventory_item (creates a QA row that the request
explicitly said we do NOT need to clean up).
"""
from __future__ import annotations

import time
import pytest


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
class TestHealth:
    def test_health_ok(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/health", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "ok"
        assert data.get("supabase") is True
        assert data.get("openai_configured") is True


# ---------------------------------------------------------------------------
# Bug fix: add_inventory_item must return 200 ok:true (previously 500)
# ---------------------------------------------------------------------------
class TestAddInventoryItemBugFix:
    def test_add_inventory_item_returns_ok(self, api_client, base_url):
        payload = {
            "intent": "add_inventory_item",
            "payload": {
                "product_name": "QA Test Product",
                "category_name": "Testy",
                "quantity": 5,
                "unit": "kg",
                "min_quantity": 1,
                "safety_buffer_percent": 20,
            },
            "transcript": "test",
            "source": "voice",
        }
        r = api_client.post(f"{base_url}/api/actions/apply", json=payload, timeout=30)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("ok") is True, f"ok=False, body={data}"
        assert data.get("intent") == "add_inventory_item"


# ---------------------------------------------------------------------------
# /api/actions/apply for non-destructive intents
# ---------------------------------------------------------------------------
class TestActionsApplyNonDestructive:
    def test_navigate_screen(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/actions/apply",
            json={
                "intent": "navigate_screen",
                "payload": {"screen": "magazyn"},
                "transcript": "otwórz magazyn",
                "source": "voice",
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        extras = data.get("extras") or {}
        assert extras.get("screen") == "magazyn"

    def test_scale_recipe_burger_bacon(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/actions/apply",
            json={
                "intent": "scale_recipe",
                "payload": {"dish_name": "Burger Bacon", "portions": 10},
                "transcript": "przelicz Burger Bacon na 10 porcji",
                "source": "voice",
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True, data
        extras = data.get("extras") or {}
        assert isinstance(extras.get("ingredients"), list), f"extras missing ingredients: {extras}"

    def test_bulk_edit_prices_non_existent_category_is_safe(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/actions/apply",
            json={
                "intent": "bulk_edit_menu_prices_percentage",
                "payload": {"percentage": 10, "action": "increase", "category": "NIEISTNIEJACA_XYZ"},
                "transcript": "test",
                "source": "voice",
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True, data
        extras = data.get("extras") or {}
        assert extras.get("affected") == 0, f"Expected affected=0 for non-existent category, got {extras}"

    def test_toggle_menu_item_availability_off_then_on(self, api_client, base_url):
        # OFF
        r_off = api_client.post(
            f"{base_url}/api/actions/apply",
            json={
                "intent": "toggle_menu_item_availability",
                "payload": {"dish_name": "Burger Bacon", "available": False},
                "transcript": "wyłącz danie Burger Bacon",
                "source": "voice",
            },
            timeout=30,
        )
        assert r_off.status_code == 200, r_off.text
        d_off = r_off.json()
        assert d_off.get("ok") is True, d_off
        # ON (revert)
        r_on = api_client.post(
            f"{base_url}/api/actions/apply",
            json={
                "intent": "toggle_menu_item_availability",
                "payload": {"dish_name": "Burger Bacon", "available": True},
                "transcript": "włącz danie Burger Bacon",
                "source": "voice",
            },
            timeout=30,
        )
        assert r_on.status_code == 200, r_on.text
        d_on = r_on.json()
        assert d_on.get("ok") is True, d_on


# ---------------------------------------------------------------------------
# bulk_delete_suppliers must be safely blocked with needs_migration
# ---------------------------------------------------------------------------
class TestBulkDeleteSuppliersBlocked:
    def _count_suppliers(self, api_client, base_url) -> int | None:
        # Try a few likely endpoints; return None if none work.
        for path in ("/api/suppliers", "/api/suppliers/list"):
            try:
                r = api_client.get(f"{base_url}{path}", timeout=15)
                if r.status_code == 200:
                    body = r.json()
                    if isinstance(body, list):
                        return len(body)
                    if isinstance(body, dict) and isinstance(body.get("items"), list):
                        return len(body["items"])
            except Exception:
                continue
        return None

    def test_bulk_delete_suppliers_needs_migration(self, api_client, base_url):
        before = self._count_suppliers(api_client, base_url)
        r = api_client.post(
            f"{base_url}/api/actions/apply",
            json={
                "intent": "bulk_delete_suppliers",
                "payload": {},
                "transcript": "usuń wszystkich dostawców",
                "source": "voice",
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is False, f"Expected ok:false, got {data}"
        extras = data.get("extras") or {}
        assert extras.get("needs_migration") is True, f"Expected needs_migration:true, extras={extras}"
        # The warning about ADD_SOFT_DELETE.sql should be included.
        warnings_text = " ".join(data.get("warnings") or []) + " " + str(extras)
        assert "ADD_SOFT_DELETE" in warnings_text, f"Expected ADD_SOFT_DELETE reference in warnings/extras, got: {warnings_text}"
        after = self._count_suppliers(api_client, base_url)
        if before is not None and after is not None:
            assert before == after, f"Suppliers count changed! before={before} after={after}"


# ---------------------------------------------------------------------------
# /api/voice/interpret classification (OpenAI-backed – slow)
# ---------------------------------------------------------------------------
INTERPRET_CASES = [
    ("usuń wszystkie pozycje z menu", "bulk_delete_menu", None),
    ("usuń wszystkich dostawców", "bulk_delete_suppliers", None),
    ("zresetuj magazyn do zera", "bulk_reset_inventory", None),
    ("otwórz zakładkę magazyn", "navigate_screen", {"screen": "magazyn"}),
    ("pokaż zablokowane potrawy", "filter_ui_menu_blocked", None),
    ("wyłącz danie Burger Bacon", "toggle_menu_item_availability", {"available": False}),
    ("przelicz Burger Bacon na 10 porcji", "scale_recipe", {"portions": 10}),
    ("podnieś ceny wszystkich dań o 10 procent", "bulk_edit_menu_prices_percentage",
     {"percentage": 10, "action": "increase"}),
]


@pytest.mark.parametrize("transcript,expected_intent,payload_hints", INTERPRET_CASES)
class TestVoiceInterpret:
    def test_intent_classified(self, api_client, base_url, transcript, expected_intent, payload_hints):
        r = api_client.post(
            f"{base_url}/api/voice/interpret",
            json={"text": transcript},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        got_intent = data.get("intent")
        assert got_intent == expected_intent, (
            f"transcript={transcript!r} expected {expected_intent} got {got_intent}. Body={data}"
        )
        if payload_hints:
            p = data.get("payload") or {}
            for k, v in payload_hints.items():
                assert k in p, f"Missing payload key '{k}' in {p}"
                if isinstance(v, (int, float)):
                    assert float(p.get(k)) == float(v), f"payload.{k}={p.get(k)} != {v}"
                else:
                    assert p.get(k) == v, f"payload.{k}={p.get(k)} != {v}"
        # small delay to be nice to OpenAI
        time.sleep(0.2)


# Special extra check for toggle: dish_name_resolved presence.
class TestVoiceInterpretToggleResolved:
    def test_toggle_has_resolved_dish(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/voice/interpret",
            json={"text": "wyłącz danie Burger Bacon"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("intent") == "toggle_menu_item_availability"
        p = data.get("payload") or {}
        # Accept either dish_name_resolved or resolved_dish_name / dish_id as evidence of resolution.
        resolved = p.get("dish_name_resolved") or p.get("resolved_dish_name") or p.get("dish_id")
        assert resolved, f"Expected fuzzy-resolved dish reference in payload, got {p}"
