from __future__ import annotations

import hashlib
import re


def normalize_text(text: str) -> str:
    """Normalizacja widocznego tekstu (jak monitor.py innerText)."""
    lines = [line.strip() for line in (text or "").splitlines()]
    lines = [ln for ln in lines if ln]
    return "\n".join(lines)


def md5_hex(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def content_hash(text: str) -> str:
    return md5_hex(normalize_text(text))
