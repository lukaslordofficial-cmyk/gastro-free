"""Unit tests — LP paid notify helpers (Resend/SMSAPI wrappers)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from notify_smsapi import normalize_pl_phone  # noqa: E402
from lp_paid_notifications import _email_copy, _sms_body, _restaurant_name  # noqa: E402


def test_normalize_pl_phone():
    assert normalize_pl_phone("500600700") == "+48500600700"
    assert normalize_pl_phone("+48500600700") == "+48500600700"
    assert normalize_pl_phone("48500600700") == "+48500600700"


def test_email_and_sms_copy_include_restaurant():
    mail = _email_copy("Bistro Test")
    assert "Bistro Test" in mail["subject"]
    assert "opłaciła" in mail["text"]
    assert "Furgonetka" in mail["text"]
    sms = _sms_body("Bistro Test")
    assert "Bistro Test" in sms
    assert len(sms) <= 600


def test_restaurant_name_from_lp_ship_notes():
    order = {
        "notes": 'foo | lp_ship:{"name":"Resto Alpha","phone":"500"}',
    }
    assert _restaurant_name(order) == "Resto Alpha"
