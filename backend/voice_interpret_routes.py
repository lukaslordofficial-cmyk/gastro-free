"""
POST /api/voice/interpret (+ legacy interpret-waste).
Wymaga X-Account-Key. Implementacja w server.py.
"""
from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["voice-interpret"])


@router.post("/api/voice/interpret")
async def interpret(request: Request):
    from server import InterpretRequest, interpret as _impl, require_tenant_account_key
    require_tenant_account_key()
    body = await request.json()
    return await _impl(InterpretRequest.model_validate(body))


@router.post("/api/voice/interpret-waste")
async def interpret_waste_legacy(request: Request):
    from server import InterpretRequest, interpret_waste_legacy as _impl, require_tenant_account_key
    require_tenant_account_key()
    body = await request.json()
    return await _impl(InterpretRequest.model_validate(body))
