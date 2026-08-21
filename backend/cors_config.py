"""CORS origins — jawna konfiguracja na produkcji (mobile APK często bez Origin)."""
from __future__ import annotations

import logging
import os

from http_ssl import is_production_runtime

logger = logging.getLogger("cors")


def cors_allow_origins() -> list[str]:
    raw = (os.environ.get("CORS_ALLOW_ORIGINS") or "").strip()
    if not raw:
        if is_production_runtime():
            logger.warning(
                "CORS_ALLOW_ORIGINS nieustawione na produkcji — używam '*'. "
                "Ustaw listę originów (lub *) świadomie w Variables."
            )
        return ["*"]
    if raw == "*":
        if is_production_runtime():
            logger.warning("CORS_ALLOW_ORIGINS=* na produkcji (świadomie).")
        return ["*"]
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins or ["*"]
