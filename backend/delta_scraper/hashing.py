from __future__ import annotations

import hashlib
import re


def normalize_text(text: str) -> str:
    """Normalizacja widocznego tekstu (jak monitor.py innerText)."""
    lines = [line.strip() for line in (text or "").splitlines()]
    lines = [ln for ln in lines if ln]
    return "\n".join(lines)


def fingerprint_hex(text: str) -> str:
    """Kryptograficzny odcisk treści (SHA-256). Nie do haseł — do detekcji zmian."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# Back-compat alias (dawniej MD5) — skanery Code Registry / stare importy.
def md5_hex(text: str) -> str:
    return fingerprint_hex(text)


def content_hash(text: str) -> str:
    return fingerprint_hex(normalize_text(text))
