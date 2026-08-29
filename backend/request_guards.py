"""HTTP guards: public webhooks vs tenant writes vs costly AI routes."""
from __future__ import annotations

import os

_PUBLIC_MUTATE = (
    "/api/billing/webhook",
    "/api/pos/webhook",
    "/w/",
    "/api/furgonetka",
    "/api/auth/auto-confirm",
    "/api/local-producers/confirm-payment",
    "/api/stripe/connect/callback",
)

_AI_PREFIXES = (
    "/api/voice/",
    "/api/documents/",
    "/api/menu/scan",
    "/api/menu/suggest-recipe",
    "/api/inspirations/",
    "/api/orders/compare-offers",
    "/api/bargain-hunter/",
    "/api/optimizer/",
    # Tylko raporty z GPT — NIE /api/reports/comprehensive ani /daily
    # (te są czystym SQL; wcześniej wpadały w AI rate-limit + circuit breaker).
    "/api/reports/analyze-period",
    "/api/reports/compare-periods",
    "/api/recipes/ocr-text",
    "/api/inventory/scan-expiration",
    "/api/orders/generate-messages",
    "/api/orders/interpret-command",
    "/api/suppliers/",
)

_UPLOAD_PREFIXES = (
    "/api/voice/transcribe",
    "/api/documents/",
    "/api/menu/scan",
    "/api/recipes/ocr-text",
    "/api/inventory/scan-expiration",
    "/api/suppliers/",
)

_DEAL_HUNTER_PREFIXES = (
    "/api/orders/compare-offers",
    "/api/bargain-hunter/",
    "/api/optimizer/",
    "/api/orders/critical-by-category",
)

_LP_PREFIXES = (
    "/api/local-producers/",
    "/api/producer/",
    "/producer/",
    "/api/producer-orders/",
)


def _norm(path: str) -> str:
    p = (path or "").split("?", 1)[0]
    if len(p) > 1:
        p = p.rstrip("/")
    return p or "/"


def is_public_mutate(path: str) -> bool:
    p = _norm(path)
    if p == "/orders" or p.startswith("/orders/"):
        return True
    return any(p == x or p.startswith(x.rstrip("/") + "/") or p.startswith(x) for x in _PUBLIC_MUTATE)


def is_ai_path(path: str) -> bool:
    p = _norm(path)
    return any(p.startswith(x.rstrip("/")) for x in _AI_PREFIXES)


def is_mutate_method(method: str) -> bool:
    return (method or "").upper() in ("POST", "PUT", "PATCH", "DELETE")


def _prefix_match(path: str, prefixes: tuple[str, ...]) -> bool:
    p = _norm(path)
    return any(p.startswith(x.rstrip("/")) for x in prefixes)


def is_upload_path(path: str) -> bool:
    return _prefix_match(path, _UPLOAD_PREFIXES)


def is_deal_hunter_path(path: str) -> bool:
    return _prefix_match(path, _DEAL_HUNTER_PREFIXES)


def is_lp_marketplace_path(path: str) -> bool:
    return _prefix_match(path, _LP_PREFIXES)


def max_upload_bytes() -> int:
    """Limit ciała requestu (PDF/obraz). Domyślnie 12 MiB, max 32 MiB."""
    try:
        n = int(os.environ.get("MAX_UPLOAD_BYTES", str(12 * 1024 * 1024)) or 0)
    except ValueError:
        n = 12 * 1024 * 1024
    return max(256 * 1024, min(32 * 1024 * 1024, n))


def content_length_too_large(content_length: str | None) -> bool:
    if not content_length:
        return False
    try:
        size = int(str(content_length).strip())
    except ValueError:
        return False
    return size > max_upload_bytes()
