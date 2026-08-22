"""
POST /api/inventory/scan-expiration — Vision etykiety → partie warehouse_inventory.
Dopasowanie do magazynu jak przy fakturze (ser ≠ mozzarella).
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from openai import APIError, OpenAIError
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get, sb_patch, sb_post

router = APIRouter(tags=["inventory-expiry-scan"])


class ExpiryScanResponse(BaseModel):
    product_name: str
    expiration_date: str
    confidence_score: float = 0.0
    status: str = ""
    quantity: float = 0.0
    unit: str = "szt"
    inventory_item_id: Optional[str] = None
    inventory_matched_name: Optional[str] = None
    batch_id: Optional[str] = None
    message: str = ""
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


@router.post("/api/inventory/scan-expiration", response_model=ExpiryScanResponse)
async def scan_expiration(
    file: UploadFile = File(...),
    quantity: float = Form(...),
    restaurant_id: Optional[str] = Form(None),
    unit: str = Form("szt"),
):
    """Zdjęcie etykiety → GPT-4o Vision → partia + bump stanu (tylko ścisłe dopasowanie)."""
    from server import (
        VISION_MODEL,
        _EXPIRY_SCAN_JSON_SCHEMA,
        _EXPIRY_SCAN_SYSTEM_PROMPT,
        _bill_openai_response,
        _expiry_status,
        _find_inventory_duplicate,
        _guard_ai,
        _images_from_upload,
        _openai,
        require_tenant_account_key,
    )

    require_tenant_account_key()
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Ilość musi być > 0.")

    client = _openai()
    await _guard_ai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    image_uris, _pages_meta = _images_from_upload(
        contents, file.content_type or "", file.filename or "", max_pages=2,
    )
    contents = b""

    user_content: list[dict] = [
        {"type": "text", "text": "Extract product name and expiration date from this package photo."}
    ]
    for uri in image_uris:
        user_content.append({"type": "image_url", "image_url": {"url": uri}})

    try:
        resp = await client.chat.completions.create(
            model=VISION_MODEL,
            temperature=0.0,
            messages=[
                {"role": "system", "content": _EXPIRY_SCAN_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_schema", "json_schema": _EXPIRY_SCAN_JSON_SCHEMA},
        )
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"OpenAI Vision: {e.message}") from e
    except OpenAIError as e:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"OpenAI: {e}") from e
    finally:
        image_uris = []

    billing = {"credits_deducted": 0, "credits_remaining": None}
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as httpx_c:
        billing = await _bill_openai_response(
            httpx_c, resp, endpoint="/api/inventory/scan-expiration", model=VISION_MODEL,
        )

    raw = (resp.choices[0].message.content or "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Model zwrócił nie-JSON: {e}: {raw[:200]}") from e

    product_name = str(data.get("product_name") or "").strip()
    expiration_date = str(data.get("expiration_date") or "").strip()
    confidence = float(data.get("confidence_score") or 0)
    if not product_name or not re.match(r"^\d{4}-\d{2}-\d{2}$", expiration_date):
        raise HTTPException(status_code=422, detail="Nie udało się odczytać nazwy lub daty ważności.")

    status = _expiry_status(expiration_date)
    unit_clean = (unit or "szt").strip() or "szt"

    inventory_item_id: Optional[str] = None
    inventory_matched_name: Optional[str] = None
    batch_id: Optional[str] = None

    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as httpx_c:
        try:
            inv_all = await sb_get(
                httpx_c, "inventory_items",
                params={
                    "select": "id,name,quantity,unit,is_active",
                    "is_active": "eq.true",
                    "limit": "2000",
                },
            ) or []
        except httpx.HTTPStatusError:
            inv_all = await sb_get(
                httpx_c, "inventory_items",
                params={"select": "id,name,quantity,unit", "limit": "2000"},
            ) or []

        hit = _find_inventory_duplicate(product_name, inv_all, threshold=88, for_invoice=True)
        if hit and hit.get("id"):
            inventory_item_id = str(hit["id"])
            inventory_matched_name = str(hit.get("name") or "")
            try:
                best_qty = float(hit.get("quantity") or 0)
                await sb_patch(
                    httpx_c,
                    "inventory_items",
                    {"id": f"eq.{inventory_item_id}"},
                    {"quantity": best_qty + float(quantity), "is_active": True},
                )
            except Exception:
                logging.exception("expiry scan: failed to bump inventory quantity")

        payload = {
            "restaurant_id": restaurant_id or None,
            "inventory_item_id": inventory_item_id,
            "product_name": product_name,
            "quantity": float(quantity),
            "unit": unit_clean,
            "expiration_date": expiration_date,
            "status": status,
            "confidence_score": confidence,
            "source": "vision_scan",
        }
        try:
            inserted = await sb_post(httpx_c, "warehouse_inventory", payload)
            if isinstance(inserted, list) and inserted:
                batch_id = inserted[0].get("id")
            elif isinstance(inserted, dict):
                batch_id = inserted.get("id")
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Nie zapisano partii — uruchom migrację ADD_WAREHOUSE_INVENTORY_EXPIRY.sql. "
                    f"Szczegóły: {e}"
                ),
            ) from e

    msg = (
        f"Dodano {quantity:g} {unit_clean} · {product_name} "
        f"(ważne do {expiration_date}, status: {status})"
    )
    if inventory_matched_name:
        msg += f". Dopasowano do magazynu: {inventory_matched_name}."

    return ExpiryScanResponse(
        product_name=product_name,
        expiration_date=expiration_date,
        confidence_score=confidence,
        status=status,
        quantity=float(quantity),
        unit=unit_clean,
        inventory_item_id=inventory_item_id,
        inventory_matched_name=inventory_matched_name,
        batch_id=batch_id,
        message=msg,
        credits_deducted=int(billing.get("credits_deducted") or 0),
        credits_remaining=billing.get("credits_remaining"),
    )
