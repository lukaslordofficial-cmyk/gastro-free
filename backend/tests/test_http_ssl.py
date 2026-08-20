from http_ssl import httpx_verify, is_production_runtime


def test_insecure_tls_blocked_in_production(monkeypatch):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    monkeypatch.setenv("OPENAI_SSL_VERIFY", "0")
    assert is_production_runtime() is True
    assert httpx_verify() is not False


def test_insecure_tls_allowed_outside_production(monkeypatch):
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("OPENAI_SSL_VERIFY", "0")
    assert is_production_runtime() is False
    assert httpx_verify() is False
