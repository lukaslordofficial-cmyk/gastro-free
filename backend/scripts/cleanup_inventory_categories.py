#!/usr/bin/env python3
"""
Jednorazowe czyszczenie magazynu (bezpłatne, bez LLM):
  - scala near-duplikaty nazw (pomidor / Pomidory świeże / …)
  - przenosi produkty z „Inne” do pasującej kategorii (słowa kluczowe)

Użycie (z katalogu backend):
  python scripts/cleanup_inventory_categories.py --dry-run
  python scripts/cleanup_inventory_categories.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from server import (  # noqa: E402
    _find_inventory_duplicate,
    _food_match_key,
    _guess_category_free,
    _httpx_verify,
    _norm,
)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_KEY")
    or ""
).strip()


def _headers(prefer: str = "return=representation"):
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


async def main(apply: bool):
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("Brak SUPABASE_URL / KEY w .env")

    async with httpx.AsyncClient(verify=_httpx_verify(), timeout=60) as client:
        cats = (await client.get(
            f"{SUPABASE_URL}/rest/v1/inventory_categories",
            headers=_headers(),
            params={"select": "id,name", "limit": "200"},
        )).json()
        inv = (await client.get(
            f"{SUPABASE_URL}/rest/v1/inventory_items",
            headers=_headers(),
            params={"select": "id,name,quantity,unit,unit_cost,category_id", "limit": "5000"},
        )).json() or []

        cat_by_id = {str(c["id"]): c["name"] for c in (cats or [])}
        inne_ids = {str(c["id"]) for c in (cats or []) if _norm(c.get("name") or "") == "inne"}

        # ── 1) merge duplicates by food stem ────────────────────────────────
        by_stem: dict[str, list[dict]] = {}
        for r in inv:
            k = _food_match_key(r.get("name") or "")
            if not k:
                continue
            by_stem.setdefault(k, []).append(r)

        merges = 0
        for stem, rows in by_stem.items():
            if len(rows) < 2:
                continue
            # kanoniczna = najkrótsza nazwa
            rows.sort(key=lambda r: (len(r.get("name") or ""), r.get("name") or ""))
            keep = rows[0]
            for dup in rows[1:]:
                new_qty = float(keep.get("quantity") or 0) + float(dup.get("quantity") or 0)
                print(f"MERGE  „{dup['name']}” → „{keep['name']}”  (qty {dup.get('quantity')} + {keep.get('quantity')} = {new_qty})")
                merges += 1
                if not apply:
                    continue
                await client.patch(
                    f"{SUPABASE_URL}/rest/v1/inventory_items",
                    headers=_headers("return=minimal"),
                    params={"id": f"eq.{keep['id']}"},
                    json={"quantity": new_qty},
                )
                # soft-delete dup jeśli jest is_active, inaczej quantity=0 + rename
                r = await client.patch(
                    f"{SUPABASE_URL}/rest/v1/inventory_items",
                    headers=_headers("return=minimal"),
                    params={"id": f"eq.{dup['id']}"},
                    json={"is_active": False, "quantity": 0, "name": f"{dup['name']} (dup)"},
                )
                if r.status_code >= 400:
                    await client.patch(
                        f"{SUPABASE_URL}/rest/v1/inventory_items",
                        headers=_headers("return=minimal"),
                        params={"id": f"eq.{dup['id']}"},
                        json={"quantity": 0, "name": f"{dup['name']} (dup)"},
                    )
                keep["quantity"] = new_qty

        # ── 2) re-categorize „Inne” ─────────────────────────────────────────
        recat = 0
        name_to_id = {_norm(c["name"]): c["id"] for c in (cats or [])}
        for r in inv:
            cid = str(r.get("category_id") or "")
            cur_name = cat_by_id.get(cid) or ""
            if cid and cid not in inne_ids and _norm(cur_name) != "inne":
                continue
            if (r.get("name") or "").endswith("(dup)"):
                continue
            guessed = _guess_category_free(
                r.get("name") or "",
                user_categories=cats or [],
            )
            if _norm(guessed) == "inne":
                continue
            # resolve id
            gid = name_to_id.get(_norm(guessed))
            if not gid:
                # fuzzy
                hit = _find_inventory_duplicate(guessed, [{"name": c["name"], "id": c["id"]} for c in (cats or [])], threshold=70)
                # wrong - find_inventory is for products. simple loop:
                for c in (cats or []):
                    if _norm(c["name"]) == _norm(guessed):
                        gid = c["id"]
                        break
            if not gid:
                print(f"SKIP cat „{r['name']}” → {guessed} (brak kategorii w DB)")
                continue
            print(f"CAT    „{r['name']}”  Inne → {guessed}")
            recat += 1
            if apply:
                await client.patch(
                    f"{SUPABASE_URL}/rest/v1/inventory_items",
                    headers=_headers("return=minimal"),
                    params={"id": f"eq.{r['id']}"},
                    json={"category_id": gid},
                )

        print(f"\nGotowe. merge={merges}, recat={recat}, apply={apply}")
        if not apply:
            print("Uruchom ponownie z --apply, żeby zapisać zmiany.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    asyncio.run(main(apply=bool(args.apply) and not args.dry_run))
