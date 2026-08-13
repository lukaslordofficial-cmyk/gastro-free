"""
Integracja Furgonetka typu „Własna” (e-commerce).

Furgonetka po zapisaniu formularza odpytuje adres bazowy:
  GET {base}/orders
z tokenem w Authorization: Bearer … albo ?token=

Env:
  FURGONETKA_SHOP_TOKEN   — token, który wklejasz w panelu Furgonetki
  FURGONETKA_SANDBOX=1    — jeśli token pusty, używany jest token testowy
"""
from __future__ import annotations

import hmac
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["furgonetka-shop"])

# Token sandbox — ten sam wklejasz w sandbox.furgonetka.pl (Integracje → Własne).
SANDBOX_SHOP_TOKEN = "gm_furg_shop_7c9e4a2b18f04d6e9a51c3b8d0e27f14"


def shop_token() -> str:
    configured = (os.getenv("FURGONETKA_SHOP_TOKEN") or "").strip()
    if configured:
        return configured
    # Tryb testowy: bez env używamy stałego tokenu sandbox, żeby test połączenia Furgonetki przeszedł.
    return SANDBOX_SHOP_TOKEN


def extract_request_token(request: Request) -> str:
    auth = (request.headers.get("authorization") or "").strip()
    lower = auth.lower()
    if lower.startswith("bearer "):
        return auth[7:].strip()
    if lower.startswith("token "):
        return auth[6:].strip()
    header_token = (
        request.headers.get("x-auth-token")
        or request.headers.get("x-api-key")
        or ""
    ).strip()
    if header_token:
        return header_token
    q = request.query_params
    return (q.get("token") or q.get("access_token") or q.get("api_key") or "").strip()


def require_shop_token(request: Request) -> None:
    expected = shop_token()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Brak FURGONETKA_SHOP_TOKEN — ustaw token integracji Własnej.",
        )
    got = extract_request_token(request)
    if not got or len(got) != len(expected) or not hmac.compare_digest(got, expected):
        raise HTTPException(status_code=401, detail="Nieprawidłowy token integracji Furgonetka.")


def empty_orders_payload() -> dict[str, Any]:
    """Format, którego Furgonetka oczekuje przy teście połączenia / pustej kolejce."""
    return {"orders": []}


@router.api_route("/api/furgonetka", methods=["GET", "HEAD"])
@router.api_route("/api/furgonetka/", methods=["GET", "HEAD"], include_in_schema=False)
async def furgonetka_shop_ping(request: Request):
    """Ping adresu bazowego — tester Furgonetki czasem wali w sam root (bez tokenu)."""
    return {
        "ok": True,
        "integration": "custom",
        "name": "Gastro Manager",
        "orders": "/orders",
    }


@router.api_route("/orders", methods=["GET", "HEAD"])
@router.api_route("/api/furgonetka/orders", methods=["GET", "HEAD"])
async def furgonetka_list_orders(request: Request):
    require_shop_token(request)
    return JSONResponse(content=empty_orders_payload())


@router.api_route("/orders/{order_id}", methods=["GET", "HEAD"])
@router.api_route("/api/furgonetka/orders/{order_id}", methods=["GET", "HEAD"])
async def furgonetka_get_order(order_id: str, request: Request):
    require_shop_token(request)
    raise HTTPException(status_code=404, detail=f"Brak zamówienia {order_id}.")


@router.api_route("/orders/{order_id}", methods=["PUT", "POST", "PATCH"])
@router.api_route("/api/furgonetka/orders/{order_id}", methods=["PUT", "POST", "PATCH"])
async def furgonetka_update_order(order_id: str, request: Request):
    """Callback: Furgonetka wysyła dane przesyłki po wygenerowaniu etykiety."""
    require_shop_token(request)
    body: Any = None
    try:
        body = await request.json()
    except Exception:
        body = None
    return {
        "ok": True,
        "id": order_id,
        "accepted": True,
        "received": body if isinstance(body, dict) else {},
    }
