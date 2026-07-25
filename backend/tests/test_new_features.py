"""
Regression + new-feature tests for Gastro Manager backend.

Covers:
- FEATURE A: POST /api/menu/confirm-scan auto-creates inventory items with
  quantity=0, min_quantity=5, safety_buffer_percent=20, and a category assigned
  by GPT-4o-mini. Idempotency: second call must not duplicate inventory.
- FEATURE B: POST /api/pos/close-day and GET /api/reports/daily handle the
  needs_migration=true path gracefully with a non-empty Polish AI summary.
- Regression: GET /api/health returns ok.

All test rows are prefixed 'QA_' / 'QA ' and cleaned up via Supabase REST
(service key from backend/.env).
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import requests

# Load env
from dotenv import load_dotenv  # noqa: E402
load_dotenv(dotenv_path=Path("/app/backend/.env"))

FRONT_ENV = Path("/app/frontend/.env").read_text()
BASE_URL = None
for line in FRONT_ENV.splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
        break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
API = f"{BASE_URL}/api"

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

QA_INGREDIENTS = ["QA Kurczak Filet", "QA Maka Pszenna"]
# Unique names guaranteed to NOT fuzzy-match any existing inventory row.
QA_INGREDIENTS_UNIQUE = ["QATEST Xyzowa Papryka Fioletowa", "QATEST Zzzeta Ryzalpina Sucha"]
QA_DISH = "QA_DISH_ONBOARD"


def _sb_get(path, params=None):
    return requests.get(f"{SUPABASE_URL}/rest/v1/{path}",
                        headers=SB_HEADERS, params=params or {}, timeout=15)


def _sb_delete(path, params):
    return requests.delete(f"{SUPABASE_URL}/rest/v1/{path}",
                           headers=SB_HEADERS, params=params, timeout=15)


def _cleanup():
    # Find menu_items with QA_DISH name
    r = _sb_get("menu_items",
                {"select": "id,name", "name": f"eq.{QA_DISH}"})
    if r.status_code == 200:
        for row in r.json():
            _sb_delete("recipe_ingredients", {"menu_item_id": f"eq.{row['id']}"})
        _sb_delete("menu_items", {"name": f"eq.{QA_DISH}"})
    for name in QA_INGREDIENTS + QA_INGREDIENTS_UNIQUE:
        _sb_delete("inventory_items", {"name": f"eq.{name}"})


@pytest.fixture(scope="module", autouse=True)
def cleanup_around():
    _cleanup()
    yield
    _cleanup()


# --- Regression --------------------------------------------------------------

def test_health():
    r = requests.get(f"{API}/health", timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert j.get("status") == "ok"


# --- FEATURE A: Menu-to-Inventory Onboarding --------------------------------

class TestFeatureAConfirmScan:
    def test_confirm_scan_creates_inventory(self):
        """Uses ingredient names guaranteed NOT to fuzzy-match any existing row.
        Spec: create new inventory when ingredient does NOT already exist (fuzzy).
        """
        n1, n2 = QA_INGREDIENTS_UNIQUE
        body = {
            "dishes": [{
                "name": QA_DISH,
                "category": "Inne",
                "price_pln": 25,
                "ingredients": [
                    {"name": n1, "quantity": 150, "unit": "g"},
                    {"name": n2, "quantity": 200, "unit": "g"},
                ],
            }]
        }
        r = requests.post(f"{API}/menu/confirm-scan", json=body, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("inserted") == 1, f"inserted={j.get('inserted')} body={j}"
        assert j.get("inventory_created") == 2, f"inventory_created={j.get('inventory_created')} body={j}"

        inv_items = j.get("inventory_items") or []
        assert len(inv_items) == 2
        for it in inv_items:
            assert it.get("category"), f"Missing category in inventory_items entry: {it}"

        # Verify persisted rows
        for name in QA_INGREDIENTS_UNIQUE:
            rr = _sb_get("inventory_items",
                         {"select": "id,name,quantity,min_quantity,safety_buffer_percent,category_id",
                          "name": f"eq.{name}"})
            assert rr.status_code == 200, rr.text
            rows = rr.json()
            assert rows, f"inventory row not found for {name}"
            row = rows[0]
            assert float(row["quantity"]) == 0.0
            assert float(row["min_quantity"]) == 5.0
            assert float(row["safety_buffer_percent"]) == 20.0
            assert row.get("category_id") is not None, f"category_id null for {name}"

    def test_confirm_scan_fuzzy_dedup_against_existing(self):
        """Ingredient names similar to existing inventory should NOT create new
        rows (fuzzy dedup). 'QA Kurczak Filet' matches existing 'Filet z piersi kurczaka'.
        """
        body = {
            "dishes": [{
                "name": QA_DISH + "_FUZZY",
                "category": "Inne",
                "price_pln": 25,
                "ingredients": [
                    {"name": "QA Kurczak Filet", "quantity": 150, "unit": "g"},
                ],
            }]
        }
        r = requests.post(f"{API}/menu/confirm-scan", json=body, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        # Should fuzzy-dedupe to 0 new inventory rows
        assert j.get("inventory_created") == 0, f"expected fuzzy-dedupe, got {j}"
        # Cleanup
        rr = _sb_get("menu_items", {"select": "id", "name": f"eq.{QA_DISH}_FUZZY"})
        for row in (rr.json() if rr.status_code == 200 else []):
            _sb_delete("recipe_ingredients", {"menu_item_id": f"eq.{row['id']}"})
        _sb_delete("menu_items", {"name": f"eq.{QA_DISH}_FUZZY"})

    def test_confirm_scan_idempotent(self):
        """Second call with same UNIQUE ingredient names should create 0 new inventory rows."""
        n1, n2 = QA_INGREDIENTS_UNIQUE
        body = {
            "dishes": [{
                "name": QA_DISH + "_2",
                "category": "Inne",
                "price_pln": 30,
                "ingredients": [
                    {"name": n1, "quantity": 100, "unit": "g"},
                    {"name": n2, "quantity": 150, "unit": "g"},
                ],
            }]
        }
        r = requests.post(f"{API}/menu/confirm-scan", json=body, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("inventory_created") == 0, f"expected 0 dup rows, got {j.get('inventory_created')}"

        # Cleanup extra menu row
        _sb_get("menu_items", {"select": "id", "name": f"eq.{QA_DISH}_2"})
        rr = _sb_get("menu_items", {"select": "id", "name": f"eq.{QA_DISH}_2"})
        for row in (rr.json() if rr.status_code == 200 else []):
            _sb_delete("recipe_ingredients", {"menu_item_id": f"eq.{row['id']}"})
        _sb_delete("menu_items", {"name": f"eq.{QA_DISH}_2"})


# --- FEATURE B: End-of-Day Reports (needs_migration path) -------------------

class TestFeatureBCloseDay:
    def test_close_day_needs_migration_with_ai_summary(self):
        body = {
            "date": "2026-07-12",
            "total_revenue": 2500,
            "total_waste_cost": 120,
            "total_invoice_cost": 800,
        }
        r = requests.post(f"{API}/pos/close-day", json=body, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is False, f"expected ok:false, got {j}"
        assert j.get("needs_migration") is True, f"expected needs_migration:true, got {j}"

        report = j.get("report") or {}
        assert report.get("year") == 2026
        assert report.get("month") == 7
        assert report.get("week_of_month") == 2, f"week_of_month={report.get('week_of_month')}"
        ai = (report.get("ai_summary") or "").strip()
        assert ai, f"ai_summary empty; report={report}"
        assert len(ai) > 20, f"ai_summary too short: {ai!r}"

    def test_reports_daily_needs_migration(self):
        r = requests.get(f"{API}/reports/daily", timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        # needs_migration path expected
        assert j.get("needs_migration") is True or j.get("ok") is True, f"unexpected shape {j}"
        # reports should be a list
        assert isinstance(j.get("reports", []), list)
