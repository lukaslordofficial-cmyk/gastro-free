"""Regression: tenant-scoped AsyncStorage keys for recipes / media."""
from __future__ import annotations

# Lightweight mirror of frontend/lib/tenantStorage.ts logic for CI docs —
# real FE tests run in Jest; this guards backend inspiration cache key format.


def test_inspiration_cache_key_includes_account():
    from inspiration_recipes import inspiration_cache_key

    a = inspiration_cache_key("pizza", "Margherita", "ak_user1")
    b = inspiration_cache_key("pizza", "Margherita", "ak_user2")
    assert a != b
    assert a.startswith("ak_user1::")
    assert b.startswith("ak_user2::")


def test_inspiration_cache_key_normalizes_spaces():
    from inspiration_recipes import inspiration_cache_key

    k = inspiration_cache_key("", "Krem  z   dyni", "ak_x")
    assert k == "ak_x::krem_z_dyni"
