#!/usr/bin/env python3
"""
Wipe shared `default` tenant + first test profile via service_role REST.

Does NOT print secrets. Scope is driven by env (no hard-coded PII in git):

  WIPE_ACCOUNT_KEYS=default,ak_...
  WIPE_PROFILE_ID=<uuid>
  WIPE_PROFILE_EMAIL=<email>

Safe defaults wipe only the shared `default` tenant when optional vars are unset.
See supabase_migrations/WIPE_FIRST_TEST_TENANT.sql for the SQL equivalent (placeholders).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*_a, **_k):
        return False

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "backend" / ".env")

URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""

WIPE_KEYS = [
    k.strip()
    for k in (os.environ.get("WIPE_ACCOUNT_KEYS") or "default").split(",")
    if k.strip()
]
FIRST_PROFILE_ID = (os.environ.get("WIPE_PROFILE_ID") or "").strip()
FIRST_EMAIL = (os.environ.get("WIPE_PROFILE_EMAIL") or "").strip()

TENANT_TABLES = [
    "inventory_expiry_batches",
    "recipe_ingredients",  # may lack account_key — skipped if filter fails
    "supplier_catalog",
    "supplier_offer_items",
    "supplier_offers",
    "waste_logs",
    "warehouse_inventory",
    "inventory_items",
    "inventory_categories",
    "menu_items",
    "suppliers",
    "revenue_entries",
    "fixed_costs",
    "variable_cost_entries",
    "daily_reports",
    "token_usage",
    "sales_log",
    "financial_records",
    "subscriptions",
]


def req(method: str, path: str, *, params: str = "", body: bytes | None = None, extra: dict | None = None):
    headers = {
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Accept": "application/json",
        "Prefer": "return=minimal",
    }
    if extra:
        headers.update(extra)
    url = f"{URL}/rest/v1/{path}"
    if params:
        url = f"{url}?{params}"
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.read().decode() if resp.length else ""
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]


def delete_eq(table: str, col: str, val: str) -> str:
    status, body = req("DELETE", table, params=f"{col}=eq.{urllib.parse.quote(val)}")
    if status in (200, 204):
        return "ok"
    if status == 404 or "does not exist" in body.lower() or "PGRST" in body:
        return f"skip({status})"
    return f"err({status}:{body[:120]})"


def main() -> int:
    if not URL or not KEY:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    print("Wiping tenants:", ", ".join(WIPE_KEYS))
    results: dict[str, list[str]] = {}

    for ak in WIPE_KEYS:
        # Children via supplier ids
        status, raw = req(
            "GET",
            "suppliers",
            params=f"select=id&account_key=eq.{urllib.parse.quote(ak)}",
            extra={"Prefer": "return=representation"},
        )
        supplier_ids = []
        if status == 200 and raw:
            try:
                supplier_ids = [row["id"] for row in json.loads(raw) if row.get("id")]
            except json.JSONDecodeError:
                supplier_ids = []

        if supplier_ids:
            in_list = ",".join(supplier_ids)
            for child, col in (("supplier_catalog", "supplier_id"), ("supplier_offer_items", "supplier_id")):
                st, bd = req("DELETE", child, params=f"{col}=in.({in_list})")
                results.setdefault(ak, []).append(f"{child}:{st}")

        status, raw = req(
            "GET",
            "menu_items",
            params=f"select=id&account_key=eq.{urllib.parse.quote(ak)}",
            extra={"Prefer": "return=representation"},
        )
        menu_ids = []
        if status == 200 and raw:
            try:
                menu_ids = [row["id"] for row in json.loads(raw) if row.get("id")]
            except json.JSONDecodeError:
                menu_ids = []
        if menu_ids:
            in_list = ",".join(menu_ids)
            st, _ = req("DELETE", "recipe_ingredients", params=f"menu_item_id=in.({in_list})")
            results.setdefault(ak, []).append(f"recipe_ingredients:{st}")

        status, raw = req(
            "GET",
            "inventory_items",
            params=f"select=id&account_key=eq.{urllib.parse.quote(ak)}",
            extra={"Prefer": "return=representation"},
        )
        inv_ids = []
        if status == 200 and raw:
            try:
                inv_ids = [row["id"] for row in json.loads(raw) if row.get("id")]
            except json.JSONDecodeError:
                inv_ids = []
        if inv_ids:
            in_list = ",".join(inv_ids)
            st, _ = req("DELETE", "inventory_expiry_batches", params=f"inventory_item_id=in.({in_list})")
            results.setdefault(ak, []).append(f"inventory_expiry_batches:{st}")

        for table in TENANT_TABLES:
            if table in ("supplier_catalog", "supplier_offer_items", "recipe_ingredients", "inventory_expiry_batches"):
                continue
            r = delete_eq(table, "account_key", ak)
            results.setdefault(ak, []).append(f"{table}:{r}")

    if FIRST_PROFILE_ID:
        st, bd = req("DELETE", "profiles", params=f"id=eq.{FIRST_PROFILE_ID}")
        print(f"profiles delete by id: {st}")
    if FIRST_EMAIL:
        st2, _ = req("DELETE", "profiles", params=f"email=eq.{urllib.parse.quote(FIRST_EMAIL)}")
        print(f"profiles delete by email: {st2}")

    # Neutralize default wallet (no Premium leftovers)
    payload = json.dumps({
        "account_key": "default",
        "tier_level": 0,
        "credits_balance": 0,
        "status": "active",
        "free_starter_claimed": True,
    }).encode()
    st, bd = req(
        "POST",
        "subscriptions",
        body=payload,
        extra={
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    if st not in (200, 201):
        st, bd = req(
            "PATCH",
            "subscriptions",
            params="account_key=eq.default",
            body=json.dumps({
                "tier_level": 0,
                "credits_balance": 0,
                "status": "active",
                "free_starter_claimed": True,
            }).encode(),
            extra={"Content-Type": "application/json", "Prefer": "return=minimal"},
        )
    print(f"default subscription neutralize: {st}")

    if FIRST_PROFILE_ID:
        auth_url = f"{URL}/auth/v1/admin/users/{FIRST_PROFILE_ID}"
        ar = urllib.request.Request(
            auth_url,
            headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"},
            method="DELETE",
        )
        try:
            with urllib.request.urlopen(ar, timeout=30) as resp:
                print(f"auth user delete: {resp.status}")
        except urllib.error.HTTPError as e:
            print(f"auth user delete: {e.code} (may already be gone)")

    print("Per-tenant delete summary:")
    for ak, rows in results.items():
        print(ak, ";", "; ".join(rows))
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
