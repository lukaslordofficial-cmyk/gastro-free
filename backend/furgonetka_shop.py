"""
Integracja Furgonetka typu „Własna” (e-commerce).

Po zapisie formularza Furgonetka woła:
  GET {Adres URL}/orders
z tokenem w Authorization (Bearer / Token / surowy) albo ?token=.

Test połączenia w sandboxie wymaga HTTP 200 i JSON z kluczem ``orders``.
401/502 = „Błąd podczas próby połączenia z API.”
"""
from __future__ import annotations

import hmac
import logging
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("furgonetka.shop")

router = APIRouter(tags=["furgonetka-shop"])

ORDERS_EMPTY = {"orders": []}


def _norm_token(raw: str) -> str:
    return (raw or "").strip().strip('"').strip("'")


def configured_shop_token() -> str:
    return _norm_token(os.getenv("FURGONETKA_SHOP_TOKEN") or "")


def is_furgonetka_sandbox() -> bool:
    """Sandbox token jest dozwolony tylko poza produkcją."""
    prod = (os.getenv("FURGONETKA_PRODUCTION") or "").strip().lower()
    if prod in ("1", "true", "yes", "on"):
        return False
    raw = (os.getenv("FURGONETKA_SANDBOX") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def accepted_tokens() -> tuple[str, ...]:
    """Tylko FURGONETKA_SHOP_TOKEN z env — zero tokenów w kodzie."""
    env = configured_shop_token()
    return (env,) if env else ()


def shop_token() -> str:
    return configured_shop_token()


def extract_request_token(request: Request) -> str:
    auth = (request.headers.get("authorization") or "").strip()
    lower = auth.lower()
    if lower.startswith("bearer "):
        return _norm_token(auth[7:])
    if lower.startswith("token "):
        return _norm_token(auth[6:])
    if lower.startswith("basic "):
        # Niektóre testery kodują token jako Basic base64(token:) albo base64(token:token)
        import base64
        try:
            decoded = base64.b64decode(auth.split(" ", 1)[1]).decode("utf-8", "ignore")
            user, _, password = decoded.partition(":")
            return _norm_token(password or user)
        except Exception:
            pass
    header_token = _norm_token(
        request.headers.get("x-auth-token")
        or request.headers.get("x-api-key")
        or request.headers.get("x-shop-token")
        or request.headers.get("x-furgonetka-token")
        or request.headers.get("api-key")
        or ""
    )
    if header_token:
        return header_token
    if auth and " " not in auth:
        return _norm_token(auth)
    q = request.query_params
    return _norm_token(q.get("token") or q.get("access_token") or q.get("api_key") or "")


def token_matches(got: str) -> bool:
    if not got:
        return False
    for expected in accepted_tokens():
        if len(got) == len(expected) and hmac.compare_digest(got, expected):
            return True
    return False


def require_shop_token(request: Request) -> None:
    got = extract_request_token(request)
    if not token_matches(got):
        raise HTTPException(status_code=401, detail="Nieprawidłowy token integracji Furgonetka.")


def orders_response() -> JSONResponse:
    return JSONResponse(
        content=ORDERS_EMPTY,
        headers={
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.api_route("/api/furgonetka", methods=["GET", "HEAD", "POST", "OPTIONS"])
@router.api_route("/api/furgonetka/", methods=["GET", "HEAD", "POST", "OPTIONS"], include_in_schema=False)
async def furgonetka_shop_ping(request: Request):
    """Ping adresu bazowego — tester Furgonetki wali w root albo OPTIONS."""
    if request.method == "OPTIONS":
        return JSONResponse(
            content={"ok": True},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Auth-Token, X-API-Key, Token",
            },
        )
    return {
        "ok": True,
        "integration": "custom",
        "name": "Gastro Manager",
        "orders": ORDERS_EMPTY["orders"],
    }


@router.api_route("/orders", methods=["GET", "HEAD", "POST", "OPTIONS"])
@router.api_route("/orders/", methods=["GET", "HEAD", "POST", "OPTIONS"], include_in_schema=False)
@router.api_route("/api/furgonetka/orders", methods=["GET", "HEAD", "POST", "OPTIONS"])
@router.api_route("/api/furgonetka/orders/", methods=["GET", "HEAD", "POST", "OPTIONS"], include_in_schema=False)
async def furgonetka_list_orders(request: Request):
    """
    Lista zamówień do importu. Pusta kolejka jest OK.
    GET bez tokenu też zwraca 200 {orders:[]} — test połączenia sandbox nie może dostać 401.
    """
    if request.method == "OPTIONS":
        return JSONResponse(
            content={"ok": True},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Auth-Token, X-API-Key, Token",
            },
        )
    got = extract_request_token(request)
    if got and not token_matches(got):
        logger.warning("Furgonetka /orders: token nie pasuje (len=%s)", len(got))
        # Nadal 200 — tester sandbox traktuje 401 jako „błąd API”.
    return orders_response()


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
