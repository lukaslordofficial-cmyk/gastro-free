"""Feature flags env — tanie wyłączenie ryzykownych ścieżek bez redeployu logiki."""
from __future__ import annotations

import os

FEATURE_DISABLED_DETAIL = "Funkcja chwilowo wyłączona. Spróbuj później."


def _flag(name: str, default: bool = True) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


def deal_hunter_enabled() -> bool:
    """Łowca okazji / compare-offers / optimizer. Domyślnie włączony."""
    return _flag("DEAL_HUNTER_ENABLED", True)


def lp_marketplace_enabled() -> bool:
    """Lokalni Przetwórcy (checkout, faktury, etykiety). Domyślnie włączony."""
    return _flag("LP_MARKETPLACE_ENABLED", True)
