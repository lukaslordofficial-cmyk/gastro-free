"""Smoke testy Stripe (bez karty w przeglądarce) + opcjonalnie confirm nieopłaconej sesji."""
from __future__ import annotations

import asyncio
import os
import sys

import httpx
from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
load_dotenv(os.path.join(ROOT, ".env"))

BACKEND = "http://127.0.0.1:8001"


async def main():
    async with httpx.AsyncClient(timeout=45.0) as c:
        r = await c.get(f"{BACKEND}/api/billing/status")
        print("STATUS", r.status_code, r.json())
        assert r.status_code == 200
        assert r.json().get("stripe_configured") is True

        for body in [
            {"kind": "topup", "package": "small"},
            {"kind": "subscription", "tier_level": 1},
        ]:
            s = await c.post(f"{BACKEND}/api/billing/create-checkout-session", json=body)
            data = s.json()
            print("CHECKOUT", body, "->", s.status_code, (data.get("url") or "")[:70])
            assert s.status_code == 200, data
            assert "checkout.stripe.com" in (data.get("url") or "")
            sid = data.get("id")
            # Nieopłacona sesja — confirm powinien zwrócić paid=false (nie crash)
            conf = await c.post(f"{BACKEND}/api/billing/confirm-session", json={"session_id": sid})
            print("CONFIRM unpaid", conf.status_code, conf.json())
            assert conf.status_code in (200, 400)
            j = conf.json()
            assert j.get("paid") in (False, None) or j.get("ok") is False

    print("OK — Stripe klucze + Checkout + confirm-session działają.")
    print("Pelna platnosc: otworz URL Checkout w przegladarce (karta 4242...), potem Potwierdz platnosc w app.")


if __name__ == "__main__":
    asyncio.run(main())
