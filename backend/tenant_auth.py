"""Tenant account_key selection: JWT profile wins over spoofable header."""


def prefer_jwt_account_key(header_key: str, jwt_key: str | None, default: str) -> str:
    """If the user is logged in, ignore a mismatched X-Account-Key."""
    if jwt_key:
        return jwt_key.strip()
    raw = (header_key or "").strip()
    if raw and raw != "default":
        return raw
    return (default or "default").strip() or "default"
