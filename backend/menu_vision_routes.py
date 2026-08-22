"""
Skan menu / OCR receptury / suggest-recipe / inspiracje / confirm-scan.
Wymagają X-Account-Key tenanta. Logika w funkcjach server.py (bez @app).
"""
from __future__ import annotations

from fastapi import APIRouter, File, Request, UploadFile

router = APIRouter(tags=["menu-vision"])


@router.post("/api/menu/scan")
async def menu_scan(file: UploadFile = File(...)):
    from server import menu_scan as _impl
    return await _impl(file)


@router.post("/api/recipes/ocr-text")
async def recipe_ocr_text(file: UploadFile = File(...)):
    from server import recipe_ocr_text as _impl
    return await _impl(file)


@router.post("/api/menu/suggest-recipe")
async def menu_suggest_recipe(request: Request):
    from server import SuggestRecipeRequest, menu_suggest_recipe as _impl
    body = await request.json()
    return await _impl(SuggestRecipeRequest.model_validate(body))


@router.post("/api/inspirations/recipe")
async def inspiration_recipe(request: Request):
    from server import InspirationRecipeRequest, inspiration_recipe as _impl
    body = await request.json()
    return await _impl(InspirationRecipeRequest.model_validate(body))


@router.post("/api/menu/confirm-scan")
async def menu_confirm_scan(request: Request):
    from server import ConfirmMenuScanRequest, menu_confirm_scan as _impl
    body = await request.json()
    return await _impl(ConfirmMenuScanRequest.model_validate(body))
