#!/usr/bin/env python3
"""CLI Delta-Scrapera — cron / ręczne uruchomienie."""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")


def _verify():
    import ssl
    return ssl.create_default_context()


async def _run_check(force: bool = False, target_ids: list[str] | None = None):
    import httpx
    from server import sb_get, sb_post, sb_patch, _httpx_verify, _process_offer
    from delta_scraper.engine import check_all_targets, _products_to_offer_format

    async def catalog_sync(client, supplier_id, products):
        return await _process_offer(client, supplier_id, {
            "products": _products_to_offer_format(products),
        })

    async with httpx.AsyncClient(timeout=120.0, verify=_verify()) as client:
        return await check_all_targets(
            client,
            sb_get=sb_get, sb_post=sb_post, sb_patch=sb_patch,
            httpx_verify=_httpx_verify,
            catalog_sync_fn=catalog_sync,
            force=force,
            target_ids=target_ids,
        )


async def cmd_add(url: str, supplier_id: str | None, playwright: bool):
    import httpx
    from server import sb_post
    async with httpx.AsyncClient(timeout=30.0, verify=_verify()) as client:
        row = await sb_post(client, "scrape_targets", {
            "url": url,
            "supplier_id": supplier_id,
            "fetch_mode": "playwright" if playwright else "httpx",
            "is_active": True,
        })
        print("Dodano:", row)


async def cmd_list():
    import httpx
    from server import sb_get
    async with httpx.AsyncClient(timeout=30.0, verify=_verify()) as client:
        rows = await sb_get(client, "scrape_targets", params={"select": "*", "order": "created_at.desc"})
        for i, r in enumerate(rows or [], 1):
            print(f"{i}. {r.get('url')} | supplier={r.get('supplier_id')} | hash={r.get('content_hash')}")


async def cmd_check(force: bool):
    results = await _run_check(force=force)
    for r in results:
        print(r.to_dict())


async def cmd_run(hours: int):
    interval = max(1, hours) * 3600
    while True:
        from datetime import datetime
        print(f"--- check @ {datetime.now().isoformat()} ---")
        await cmd_check(force=False)
        print(f"Sleep {hours}h...")
        await asyncio.sleep(interval)


def main():
    p = argparse.ArgumentParser(description="Delta-Scraper CLI")
    sub = p.add_subparsers(dest="cmd")

    a = sub.add_parser("add")
    a.add_argument("url")
    a.add_argument("--supplier-id")
    a.add_argument("--playwright", action="store_true")

    sub.add_parser("list")
    c = sub.add_parser("check")
    c.add_argument("--force", action="store_true")
    r = sub.add_parser("run")
    r.add_argument("--hours", type=int, default=24)

    args = p.parse_args()
    if args.cmd == "add":
        asyncio.run(cmd_add(args.url, args.supplier_id, args.playwright))
    elif args.cmd == "list":
        asyncio.run(cmd_list())
    elif args.cmd == "check":
        asyncio.run(cmd_check(getattr(args, "force", False)))
    elif args.cmd == "run":
        asyncio.run(cmd_run(args.hours))
    else:
        p.print_help()


if __name__ == "__main__":
    main()
