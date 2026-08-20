"""Wspólna konfiguracja TLS dla httpx.

OPENAI_SSL_VERIFY=0 zostaje tylko na lokalnym Windows (zepsuty store certyfikatów).
Na produkcji (Railway) weryfikacja TLS jest zawsze włączona — inaczej MITM
mógłby podszyć się pod Supabase Auth.
"""
from __future__ import annotations

import os
import ssl


def is_production_runtime() -> bool:
    env = (
        os.environ.get("RAILWAY_ENVIRONMENT")
        or os.environ.get("ENVIRONMENT")
        or ""
    ).strip().lower()
    return env in ("production", "prod")


def httpx_verify():
    """SSL verify for httpx — Windows needs system cert store, not certifi bundle."""
    mode = os.environ.get("OPENAI_SSL_VERIFY", "auto").strip().lower()
    if mode in ("0", "false", "no"):
        if is_production_runtime():
            return ssl.create_default_context()
        return False
    if mode in ("certifi", "bundle"):
        import certifi

        return certifi.where()
    return ssl.create_default_context()
