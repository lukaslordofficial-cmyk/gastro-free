from cors_config import cors_allow_origins


def test_cors_default_star_outside_prod(monkeypatch):
    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    assert cors_allow_origins() == ["*"]


def test_cors_explicit_list(monkeypatch):
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://a.example, https://b.example")
    assert cors_allow_origins() == ["https://a.example", "https://b.example"]


def test_cors_star_in_production(monkeypatch):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "*")
    assert cors_allow_origins() == ["*"]
