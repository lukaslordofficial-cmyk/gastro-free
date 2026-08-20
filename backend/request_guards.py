"""HTTP guards: public webhooks vs tenant writes vs costly AI routes."""
from __future__ import annotations

_PUBLIC_MUTATE = (
    "/api/billing/webhook",
    "/api/pos/webhook",
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
    "/api/reports/",
    "/api/recipes/ocr-text",
    "/api/inventory/scan-expiration",
    "/api/orders/generate-messages",
    "/api/orders/interpret-command",
    "/api/suppliers/",
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
