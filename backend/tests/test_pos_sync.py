"""Unit tests: POS sync idempotency helpers (bez sieci)."""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pos_sync import extract_event_id, missing_event_ids, payload_hash  # noqa: E402


def test_extract_event_id_priority():
    body = {"order_id": "o1", "idempotency_key": "ik", "event_id": "e1"}
    canonical = {"external_order_id": "ext"}
    assert extract_event_id(body, canonical) == "e1"
    assert extract_event_id({"idempotency_key": "ik"}, {}) == "ik"
    assert extract_event_id({}, {"external_order_id": "ext"}) == "ext"
    assert extract_event_id({}, {}) is None


def test_payload_hash_stable():
    a = {"items": [{"a": 1}], "external_order_id": "x"}
    b = {"external_order_id": "x", "items": [{"a": 1}]}
    assert payload_hash(a) == payload_hash(b)
    assert payload_hash(a) != payload_hash({**a, "items": [{"a": 2}]})


def test_missing_event_ids_logic(monkeypatch):
    import pos_sync as ps

    async def fake_sb_get(client, table, params=None):
        return [
            {"event_id": "e1", "status": "processed"},
            {"event_id": "e2", "status": "error"},
            {"event_id": "e4", "status": "processing"},
        ]

    monkeypatch.setattr(ps, "sb_get", fake_sb_get)

    missing = asyncio.run(missing_event_ids(None, ["e1", "e2", "e3", "e4"]))
    assert "e1" not in missing
    assert "e2" in missing  # error → POS ma dosłać ponownie
    assert "e3" in missing
    assert "e4" not in missing  # processing — nie flooduj retry
