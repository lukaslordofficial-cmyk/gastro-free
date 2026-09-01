"""Webhook billing — ignoruj usunięcie starej subskrypcji po upgrade."""
from __future__ import annotations

import asyncio

from billing_stripe import handle_stripe_event


class _FakeSB:
    def __init__(self, current_sid: str):
        self.current_sid = current_sid
        self.patched: list[dict] = []

    async def get(self, _client, table, params=None):
        if table == "stripe_webhook_events":
            return []
        return [{"stripe_subscription_id": self.current_sid, "status": "active", "tier_level": 2}]

    async def post(self, *_a, **_k):
        return []

    async def patch(self, _client, _table, _filt, changes):
        self.patched.append(changes)
        return changes


def test_deleted_old_subscription_does_not_wipe_new_plan():
    sb = _FakeSB("sub_NEW")
    event = {
        "id": "evt_del_old",
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_OLD", "metadata": {"account_key": "ak_test"}}},
    }
    result = asyncio.run(handle_stripe_event(
        event,
        client=None,
        sb_get=sb.get,
        sb_post=sb.post,
        sb_patch=sb.patch,
        account_key_default="ak_test",
        tier_config={1: {"monthly_grant": 100}, 2: {"monthly_grant": 500}},
    ))
    assert result["action"] == "ignored_replaced_subscription_deleted"
    assert sb.patched == []


def test_deleted_current_subscription_goes_free():
    sb = _FakeSB("sub_CUR")
    event = {
        "id": "evt_del_cur",
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_CUR", "metadata": {"account_key": "ak_test"}}},
    }
    result = asyncio.run(handle_stripe_event(
        event,
        client=None,
        sb_get=sb.get,
        sb_post=sb.post,
        sb_patch=sb.patch,
        account_key_default="ak_test",
        tier_config={},
    ))
    assert result["action"] == "subscription_deleted_to_free"
    assert sb.patched and sb.patched[0]["tier_level"] == 0


def test_webhook_skips_without_tenant_metadata():
    sb = _FakeSB("sub_CUR")
    event = {
        "id": "evt_no_meta",
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_CUR", "metadata": {}}},
    }
    result = asyncio.run(handle_stripe_event(
        event,
        client=None,
        sb_get=sb.get,
        sb_post=sb.post,
        sb_patch=sb.patch,
        account_key_default="default",
        tier_config={},
    ))
    assert result["action"] == "skipped_missing_tenant"
    assert sb.patched == []


def test_checkout_completed_skips_without_tenant():
    sb = _FakeSB("sub_CUR")
    event = {
        "id": "evt_cs_no_meta",
        "type": "checkout.session.completed",
        "data": {"object": {"id": "cs_x", "mode": "payment", "metadata": {}}},
    }
    result = asyncio.run(handle_stripe_event(
        event,
        client=None,
        sb_get=sb.get,
        sb_post=sb.post,
        sb_patch=sb.patch,
        account_key_default="default",
        tier_config={},
    ))
    assert result["action"] == "skipped_missing_tenant"
    assert sb.patched == []
