"""
Skan cennika dostawcy (Vision) + confirm do supplier_catalog.
Wymaga X-Account-Key tenanta.
"""
from __future__ import annotations

from typing import Optional

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get, sb_patch, sb_post

router = APIRouter(tags=["supplier-catalog-scan"])


class CatalogProduct(BaseModel):
    product_name: str
    price_netto: float = 0.0
    unit: str = "szt"
    volume_label: str = ""
    product_code: Optional[str] = None


class CatalogExtractionResponse(BaseModel):
    supplier_id: str
    supplier_name: Optional[str] = None
    product_count: int
    products: list[CatalogProduct]
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


class ConfirmCatalogRequest(BaseModel):
    products: list[CatalogProduct]


@router.post("/api/suppliers/{supplier_id}/upload-catalog", response_model=CatalogExtractionResponse)
async def upload_catalog(supplier_id: str, file: UploadFile = File(...)):
    """Skanuje cennik (obraz/PDF) — podgląd; zapis dopiero po confirm-catalog."""
    from server import (
        _CATALOG_JSON_SCHEMA,
        _CATALOG_SYSTEM_PROMPT,
        _guard_ai,
        _images_from_upload,
        _merge_catalog_vision_batches,
        _openai,
        _openai_vision_json_batches,
        require_tenant_account_key,
    )

    require_tenant_account_key()
    client = _openai()
    await _guard_ai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as httpx_c:
        rows = await sb_get(
            httpx_c,
            "suppliers",
            params={"select": "id,name", "id": f"eq.{supplier_id}", "limit": "1"},
        )
    if not rows:
        raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")
    supplier_name = rows[0]["name"]

    image_uris, pages_meta = _images_from_upload(
        contents, file.content_type or "", file.filename or "",
    )
    contents = b""

    data, billing = await _openai_vision_json_batches(
        client,
        image_uris=image_uris,
        system_prompt=_CATALOG_SYSTEM_PROMPT,
        json_schema=_CATALOG_JSON_SCHEMA,
        endpoint=f"/api/suppliers/{supplier_id}/upload-catalog",
        user_text=(
            "Oto cennik/oferta dostawcy. Wyodrębnij wszystkie produkty z tych stron. "
            f"(Dokument ma {pages_meta.get('pages_total')} stron; "
            f"analizuję {pages_meta.get('pages_rendered')}.)"
        ),
        pages_meta=pages_meta,
        merge_fn=_merge_catalog_vision_batches,
    )
    image_uris = []

    products = [CatalogProduct(**p) for p in (data.get("products") or [])]
    return CatalogExtractionResponse(
        supplier_id=supplier_id,
        supplier_name=data.get("supplier_name") or supplier_name,
        product_count=len(products),
        products=products,
        credits_deducted=int(billing.get("credits_deducted") or 0),
        credits_remaining=billing.get("credits_remaining"),
    )


@router.post("/api/suppliers/{supplier_id}/confirm-catalog")
async def confirm_catalog(supplier_id: str, req: ConfirmCatalogRequest):
    """Zapis zatwierdzonych produktów do supplier_catalog (upsert po nazwie)."""
    from server import _has_catalog_extra_cols, _norm, require_tenant_account_key

    require_tenant_account_key()
    if not req.products:
        raise HTTPException(status_code=400, detail="Brak produktów do zapisania.")

    inserted = 0
    updated = 0
    warnings: list[str] = []

    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as client:
        sup = await sb_get(
            client, "suppliers",
            params={"select": "id", "id": f"eq.{supplier_id}", "limit": "1"},
        )
        if not sup:
            raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")

        has_extra = await _has_catalog_extra_cols(client)
        existing = await sb_get(
            client,
            "supplier_catalog",
            params={"select": "id,name,sort_order", "supplier_id": f"eq.{supplier_id}"},
        )
        by_name = {_norm(r["name"]): r for r in (existing or [])}
        max_sort = max((int(r.get("sort_order") or 0) for r in (existing or [])), default=0)

        for prod in req.products:
            name = (prod.product_name or "").strip()
            if not name:
                continue
            price = float(prod.price_netto or 0)
            volume_label = (prod.volume_label or "").strip()
            unit = (prod.unit or "szt").strip()
            variant = volume_label or unit or name

            payload: dict = {
                "supplier_id": supplier_id,
                "name": name,
                "variant": variant,
                "volume_label": volume_label,
                "price_pln": price,
                "unit_count": 1,
                "liters_total": 0,
            }
            if has_extra:
                payload["unit"] = unit
                payload["product_code"] = (prod.product_code or None)

            match = by_name.get(_norm(name))
            try:
                if match:
                    update_payload = {
                        "price_pln": price,
                        "variant": variant,
                        "volume_label": volume_label,
                    }
                    if has_extra:
                        update_payload["unit"] = unit
                        update_payload["product_code"] = (prod.product_code or None)
                    await sb_patch(
                        client, "supplier_catalog", {"id": f"eq.{match['id']}"}, update_payload,
                    )
                    updated += 1
                else:
                    max_sort += 1
                    payload["sort_order"] = max_sort
                    row = await sb_post(client, "supplier_catalog", payload)
                    if row:
                        by_name[_norm(name)] = (row[0] if isinstance(row, list) else row)
                    inserted += 1
            except httpx.HTTPStatusError as e:
                warnings.append(f"{name}: {e.response.text[:120]}")

    return {
        "ok": True,
        "inserted": inserted,
        "updated": updated,
        "saved": inserted + updated,
        "warnings": warnings,
    }
