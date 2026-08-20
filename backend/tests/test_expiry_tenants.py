from tenant_auth import collect_tenant_account_keys


def test_collect_tenant_keys_skips_default_and_dupes():
    rows = [
        {"account_key": "ak_aaa"},
        {"account_key": "default"},
        {"account_key": "ak_aaa"},
        {"account_key": ""},
        {"account_key": "ak_bbb"},
        {},
    ]
    assert collect_tenant_account_keys(rows) == ["ak_aaa", "ak_bbb"]
