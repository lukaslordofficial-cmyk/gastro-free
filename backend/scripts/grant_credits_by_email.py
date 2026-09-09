#!/usr/bin/env python3
"""
Jednorazowe dopisanie kredytów AI testerom (lista e-maili → profiles.account_key → subscriptions).

Użycie (z katalogu backend/, z backend/.env):
  python scripts/grant_credits_by_email.py --credits 200 tester1@gmail.com tester2@gmail.com
  python scripts/grant_credits_by_email.py --credits 200 --file testers.txt

Wymaga SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY w .env (service role — nie commituj).
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from supabase_rest import sb_get, sb_patch, sb_post, push_account_key, reset_account_key


async def account_key_for_email(client: httpx.AsyncClient, email: str) -> str | None:
    em = email.strip().lower()
    if not em or "@" not in em:
        return None
    rows = await sb_get(
        client,
        "profiles",
        params={"select": "account_key,email", "email": f"ilike.{em}", "limit": "1"},
    )
    if not rows:
        return None
    ak = str(rows[0].get("account_key") or "").strip()
    return ak if ak and ak != "default" else None


async def grant_credits(client: httpx.AsyncClient, account_key: str, add: int) -> tuple[int, int]:
    token = push_account_key(account_key)
    try:
        rows = await sb_get(
            client,
            "subscriptions",
            params={"select": "credits_balance", "account_key": f"eq.{account_key}", "limit": "1"},
        )
        now = datetime.now(timezone.utc).isoformat()
        if rows:
            before = int(rows[0].get("credits_balance") or 0)
            after = before + add
            await sb_patch(
                client,
                "subscriptions",
                {"account_key": f"eq.{account_key}"},
                {"credits_balance": after, "updated_at": now},
            )
            return before, after
        after = add
        await sb_post(
            client,
            "subscriptions",
            {
                "account_key": account_key,
                "tier_level": 0,
                "credits_balance": after,
                "status": "active",
                "free_starter_claimed": True,
            },
        )
        return 0, after
    finally:
        reset_account_key(token)


async def main() -> None:
    ap = argparse.ArgumentParser(description="Dopisz kredyty AI po e-mailu konta w aplikacji.")
    ap.add_argument("emails", nargs="*", help="Adresy e-mail (musi istnieć w profiles)")
    ap.add_argument("--file", "-f", help="Plik z e-mailami (po jednym w linii)")
    ap.add_argument("--credits", "-c", type=int, default=200, help="Ile dodać (domyślnie 200)")
    args = ap.parse_args()

    emails: list[str] = list(args.emails or [])
    if args.file:
        p = Path(args.file)
        if not p.is_file():
            raise SystemExit(f"Brak pliku: {p}")
        for line in p.read_text(encoding="utf-8").splitlines():
            t = line.strip()
            if t and not t.startswith("#"):
                emails.append(t)
    emails = [e.strip().lower() for e in emails if e.strip()]
    if not emails:
        raise SystemExit("Podaj e-maile jako argumenty lub --file")

    add = max(0, int(args.credits))
    if add <= 0:
        raise SystemExit("--credits musi być > 0")

    async with httpx.AsyncClient(timeout=30.0) as client:
        ok = 0
        for em in emails:
            ak = await account_key_for_email(client, em)
            if not ak:
                print(f"SKIP  {em} — brak profilu / account_key")
                continue
            before, after = await grant_credits(client, ak, add)
            print(f"OK    {em}  {ak[:12]}…  {before} → {after} (+{add})")
            ok += 1
        print(f"\nZaktualizowano {ok}/{len(emails)} kont.")


if __name__ == "__main__":
    asyncio.run(main())
