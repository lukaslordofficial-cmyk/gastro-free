"""
Skan menu / OCR receptury / suggest-recipe / inspiracje / confirm-scan.
Wymagają X-Account-Key tenanta (guard na routerze + w implementacji).
"""
from __future__ import annotations

from fastapi import APIRouter, File, Request, UploadFile

router = APIRouter(tags=["menu-vision"])


def _tenant():
    from server import require_tenant_account_key
    return require_tenant_account_key()


@router.post("/api/menu/scan")
async def menu_scan(file: UploadFile = File(...)):
    _tenant()
    from server import menu_scan as _impl
    return await _impl(file)


@router.post("/api/recipes/ocr-text")
async def recipe_ocr_text(file: UploadFile = File(...)):
    _tenant()
    from server import recipe_ocr_text as _impl
    return await _impl(file)


@router.post("/api/menu/suggest-recipe")
async def menu_suggest_recipe(request: Request):
    _tenant()
    from server import SuggestRecipeRequest, menu_suggest_recipe as _impl
    body = await request.json()
    return await _impl(SuggestRecipeRequest.model_validate(body))


@router.post("/api/inspirations/recipe")
async def inspiration_recipe(request: Request):
    _tenant()
    from inspiration_recipes import InspirationRecipeRequest, inspiration_recipe as _impl
    body = await request.json()
    return await _impl(InspirationRecipeRequest.model_validate(body))


@router.post("/api/menu/confirm-scan")
async def menu_confirm_scan(request: Request):
    _tenant()
    from server import ConfirmMenuScanRequest, menu_confirm_scan as _impl
    body = await request.json()
    return await _impl(ConfirmMenuScanRequest.model_validate(body))
