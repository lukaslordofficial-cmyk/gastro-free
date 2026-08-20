from tenant_auth import prefer_jwt_account_key


def test_jwt_wins_over_header():
    assert prefer_jwt_account_key("ak_spoof", "ak_real", "default") == "ak_real"


def test_header_used_without_jwt():
    assert prefer_jwt_account_key("ak_from_app", None, "default") == "ak_from_app"


def test_default_when_empty():
    assert prefer_jwt_account_key("", None, "default") == "default"
    assert prefer_jwt_account_key("default", None, "default") == "default"
