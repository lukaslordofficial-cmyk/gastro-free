"""Unit tests — Stripe Connect capabilities + LP checkout money split."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from billing_stripe import _form_encode  # noqa: E402
from local_producers_commerce import _pln_to_grosze  # noqa: E402
from stripe_connect import (  # noqa: E402
    _capability_status,
    connect_refresh_token,
    connect_refresh_url,
    verify_connect_refresh_token,
)


def test_form_encode_capabilities_nested():
    items = dict(_form_encode({
        "type": "express",
        "capabilities": {
            "card_payments": {"requested": True},
            "transfers": {"requested": True},
        },
    }))
    assert items["capabilities[card_payments][requested]"] == "true"
    assert items["capabilities[transfers][requested]"] == "true"
    assert items["type"] == "express"


def test_form_encode_application_fee_destination():
    items = dict(_form_encode({
        "mode": "payment",
        "payment_intent_data": {
            "application_fee_amount": 1500,
            "transfer_data": {"destination": "acct_test123"},
        },
    }))
    assert items["payment_intent_data[application_fee_amount]"] == "1500"
    assert items["payment_intent_data[transfer_data][destination]"] == "acct_test123"
    assert "payment_intent_data[transfer_data][amount]" not in items


def test_form_encode_daily_payout_schedule():
    from stripe_connect import EXPRESS_PAYOUT_SETTINGS, EXPRESS_REQUESTED_CAPABILITIES

    items = dict(_form_encode({
        "type": "express",
        "capabilities": EXPRESS_REQUESTED_CAPABILITIES,
        "settings": EXPRESS_PAYOUT_SETTINGS,
    }))
    assert items["settings[payouts][schedule][interval]"] == "daily"
    assert items["capabilities[transfers][requested]"] == "true"
    assert items["capabilities[card_payments][requested]"] == "true"


def test_capability_status_string_and_dict():
    assert _capability_status({"capabilities": {"transfers": "active"}}, "transfers") == "active"
    assert _capability_status(
        {"capabilities": {"transfers": {"status": "pending"}}}, "transfers",
    ) == "pending"
    assert _capability_status({}, "transfers") == ""


def test_insufficient_capabilities_error_detect():
    from stripe_connect import is_insufficient_capabilities_error, distributor_inactive_message

    assert is_insufficient_capabilities_error(
        RuntimeError(
            "Your destination account needs to have at least one of the following "
            "capabilities enabled: transfers, crypto_transfers, or legacy_payments."
        )
    )
    assert is_insufficient_capabilities_error(
        RuntimeError("insufficient_capabilities_for_transfer")
    )
    assert not is_insufficient_capabilities_error(RuntimeError("card declined"))
    msg = distributor_inactive_message(account_id="acct_123")
    assert "dystrybutor" in msg.lower()
    assert "acct_123" in msg


def test_account_looks_restricted():
    from stripe_connect import _account_looks_restricted

    assert _account_looks_restricted({
        "requirements": {"disabled_reason": "requirements.past_due"},
    })
    assert not _account_looks_restricted({"requirements": {}})


def test_pln_to_grosze_rounding():
    assert _pln_to_grosze(12.34) == 1234
    assert _pln_to_grosze(10.01) == 1001
    assert _pln_to_grosze(0) == 0
    assert _pln_to_grosze(None) == 0


def test_connect_refresh_token_hmac(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "unit-test-secret")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://api.example.com")
    tok = connect_refresh_token("prod_abc")
    assert len(tok) == 40
    assert verify_connect_refresh_token("prod_abc", tok)
    assert not verify_connect_refresh_token("prod_abc", "deadbeef" * 5)
    assert not verify_connect_refresh_token("other", tok)
    url = connect_refresh_url("prod_abc")
    assert "token=" in url
    assert tok in url
