"""CORS origins — jawna konfiguracja na produkcji (mobile APK często bez Origin)."""
from __future__ import annotations

import logging
import os

from http_ssl import is_production_runtime

logger = logging.getLogger("cors")


def _allow_star_escape() -> bool:
    return os.environ.get("CORS_ALLOW_STAR", "").strip().lower() in ("1", "true", "yes")


def cors_allow_origins() -> list[str]:
    raw = (os.environ.get("CORS_ALLOW_ORIGINS") or "").strip()
    if not raw or raw == "*":
        if is_production_runtime() and not _allow_star_escape():
            raise RuntimeError(
                "Na produkcji ustaw CORS_ALLOW_ORIGINS na listę originów "
                "(np. https://app.example.com) albo CORS_ALLOW_STAR=1 dla '*' "
                "(mobile APK / brak Origin)."
            )
        if is_production_runtime():
            logger.warning("CORS_ALLOW_ORIGINS=* via CORS_ALLOW_STAR (świadomie).")
        return ["*"]
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins or ["*"]
