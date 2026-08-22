"""
POST /api/actions/apply + /api/waste/apply — wykonanie intencji głosowych / odpadków.
"""
from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["actions"])


@router.post("/api/actions/apply")
async def actions_apply(request: Request):
    from server import ApplyRequest, actions_apply as _impl
    body = await request.json()
    return await _impl(ApplyRequest.model_validate(body))


@router.post("/api/waste/apply")
async def apply_waste_legacy(request: Request):
    from server import ApplyWasteRequestLegacy, apply_waste_legacy as _impl
    body = await request.json()
    return await _impl(ApplyWasteRequestLegacy.model_validate(body))
