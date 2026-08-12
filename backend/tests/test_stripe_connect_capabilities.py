"""Unit tests — Stripe Connect capabilities + LP checkout money split."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from billing_stripe import _form_encode  # noqa: E402
from local_producers_commerce import _pln_to_grosze  # noqa: E402
from stripe_connect import _capability_status  # noqa: E402


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


def test_capability_status_string_and_dict():
    assert _capability_status({"capabilities": {"transfers": "active"}}, "transfers") == "active"
    assert _capability_status(
        {"capabilities": {"transfers": {"status": "pending"}}}, "transfers",
    ) == "pending"
    assert _capability_status({}, "transfers") == ""


def test_pln_to_grosze_rounding():
    assert _pln_to_grosze(12.34) == 1234
    assert _pln_to_grosze(10.01) == 1001
    assert _pln_to_grosze(0) == 0
    assert _pln_to_grosze(None) == 0
