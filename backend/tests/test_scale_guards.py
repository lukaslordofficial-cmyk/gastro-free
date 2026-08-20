from rate_limit import SlidingWindow, allow_ai, allow_write
from request_guards import is_ai_path, is_mutate_method, is_public_mutate
from tenant_auth import jwt_cache_get, jwt_cache_put, prefer_jwt_account_key


def test_jwt_cache_roundtrip():
    tok = "header.payload.sig-example"
    assert jwt_cache_get(tok) is None
    jwt_cache_put(tok, "ak_user1aaaa")
    assert jwt_cache_get(tok) == "ak_user1aaaa"


def test_public_mutate_webhooks():
    assert is_public_mutate("/api/billing/webhook")
    assert is_public_mutate("/api/pos/webhook")
    assert is_public_mutate("/orders")
    assert not is_public_mutate("/api/actions/apply")
    assert not is_public_mutate("/api/voice/transcribe")


def test_ai_paths():
    assert is_ai_path("/api/voice/transcribe")
    assert is_ai_path("/api/menu/scan")
    assert not is_ai_path("/api/actions/apply")
    assert is_mutate_method("POST")
    assert not is_mutate_method("GET")


def test_sliding_window_blocks():
    w = SlidingWindow(limit=2, window_s=60)
    now = 1000.0
    assert w.allow("k", now)
    assert w.allow("k", now + 1)
    assert not w.allow("k", now + 2)
    assert allow_write("ak_x")
    assert allow_ai("ak_x")
