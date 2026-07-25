"""Smoke: tworzy Stripe Checkout Session (nie pobiera karty)."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from billing_stripe import create_checkout_session, stripe_configured


async def main():
    assert stripe_configured(), "Brak STRIPE_SECRET_KEY"
    for kind, kwargs in [
        ("subscription", {"tier_level": 1}),
        ("subscription", {"tier_level": 2}),
        ("topup", {"package": "small"}),
        ("topup", {"package": "large"}),
    ]:
        s = await create_checkout_session(
            account_key="default",
            kind=kind,
            success_url="http://localhost:8081/billing-success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url="http://localhost:8081/billing-cancel",
            idempotency_key=f"test_{kind}_{kwargs}_{os.getpid()}",
            **kwargs,
        )
        assert s["url"].startswith("https://checkout.stripe.com"), s
        print("OK", kind, kwargs, "->", s["url"][:60], "...")
    print("Wszystkie sesje Checkout OK (tryb TEST).")


if __name__ == "__main__":
    asyncio.run(main())
