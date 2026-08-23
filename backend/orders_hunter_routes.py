"""
Łowca okazji / krytyczne zamówienia — compare-offers i pokrewne.
Wymagają X-Account-Key tenanta.
"""
from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["orders-hunter"])


@router.post("/api/orders/compare-offers")
async def compare_offers(request: Request):
    from server import CompareOffersRequest, compare_offers as _impl, require_tenant_account_key
    require_tenant_account_key()
    body = await request.json()
    return await _impl(CompareOffersRequest.model_validate(body))


@router.post("/api/bargain-hunter/optimize")
async def bargain_hunter_optimize(request: Request):
    from server import CompareOffersRequest, bargain_hunter_optimize as _impl, require_tenant_account_key
    require_tenant_account_key()
    body = await request.json()
    return await _impl(CompareOffersRequest.model_validate(body))


@router.post("/api/optimizer/critical-order")
async def optimizer_critical_order(request: Request):
    from server import CriticalOrderRequest, optimizer_critical_order as _impl, require_tenant_account_key
    require_tenant_account_key()
    body = await request.json()
    return await _impl(CriticalOrderRequest.model_validate(body))


@router.post("/api/orders/critical-by-category")
async def orders_critical_by_category(request: Request):
    from server import CriticalByCategoryRequest, orders_critical_by_category as _impl, require_tenant_account_key
    require_tenant_account_key()
    body = await request.json()
    return await _impl(CriticalByCategoryRequest.model_validate(body))


@router.post("/api/orders/interpret-command")
async def interpret_order_command(request: Request):
    from server import InterpretOrderRequest, interpret_order_command as _impl, require_tenant_account_key
    require_tenant_account_key()
    body = await request.json()
    return await _impl(InterpretOrderRequest.model_validate(body))


@router.post("/api/voice/dispatch")
async def voice_dispatch(request: Request):
    from server import VoiceDispatchRequest, voice_dispatch as _impl, require_tenant_account_key
    require_tenant_account_key()
    body = await request.json()
    return await _impl(VoiceDispatchRequest.model_validate(body))
