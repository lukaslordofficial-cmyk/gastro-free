"""
Skan ręcznie spisanej listy sprzedaży → fuzzy match magazynu → odjęcie gramatur.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from culinary_units import convert_culinary
from http_ssl import httpx_verify
from matching_utils import _resolve_by_fuzzy
from supabase_rest import sb_get, sb_patch, sb_post

logger = logging.getLogger("sales_scan")
router = APIRouter(tags=["sales-scan"])


class SalesLineIn(BaseModel):
    product_name: str = ""
    quantity: float = 0.0
    unit: str = "g"
    matched_inventory_id: Optional[str] = None
    matched_name: Optional[str] = None
    match_score: Optional[float] = None
    include: bool = True


class ConfirmSalesRequest(BaseModel):
    lines: list[SalesLineIn] = Field(default_factory=list)
    note: Optional[str] = None


_SALES_SYSTEM_PROMPT = """
Jesteś OCR dla restauracji. Na zdjęciu jest RĘCZNIE lub maszynowo spisana LISTA SPRZEDANYCH produktów
(notatka barmana/kucharza po zmianie — nazwy + ilości).

Zasady:
- product_name: czytelna nazwa PL (np. "kurczak filet", "mozarella", "bazylia").
- quantity: liczba > 0; jeśli brak, 0.
- unit: domyślnie "g" dla żywności; "szt" gdy sztukami; "ml"/"l" dla płynów.
- Nie wymyślaj pozycji spoza kartki. Pomiń nagłówki typu "Sprzedaż", daty, podpisy.
- Jeśli lista pusta — lines: [].
"""

_SALES_JSON_SCHEMA: dict[str, Any] = {
    "name": "sales_list_scan",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "document_type": {"type": "string"},
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "product_name": {"type": "string"},
                        "quantity": {"type": "number"},
                        "unit": {"type": "string"},
                    },
                    "required": ["product_name", "quantity", "unit"],
                },
            },
        },
        "required": ["document_type", "lines"],
    },
}


def _merge_sales_batches(parts: list[dict]) -> dict:
    lines: list[dict] = []
    for p in parts:
        if not isinstance(p, dict):
            continue
        for row in p.get("lines") or []:
            if isinstance(row, dict):
                lines.append(row)
    return {"document_type": "LISTA_SPRZEDAZY", "lines": lines}


@router.post("/api/documents/process-sales")
async def process_sales_list(
    file: UploadFile = File(...),
):
    """Vision OCR → lista sprzedanych produktów + podpowiedzi matchingu magazynu."""
    from server import (
        _images_from_upload,
        _openai,
        _openai_vision_json_batches,
        _with_billing,
        require_tenant_account_key,
    )

    require_tenant_account_key()
    client = _openai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    image_uris, pages_meta = _images_from_upload(
        contents, file.content_type or "", file.filename or "",
    )
    contents = b""

    data, billing = await _openai_vision_json_batches(
        client,
        image_uris=image_uris,
        system_prompt=_SALES_SYSTEM_PROMPT,
        json_schema=_SALES_JSON_SCHEMA,
        endpoint="/api/documents/process-sales",
        user_text=(
            "Odczytaj listę sprzedanych produktów z notatki zgodnie ze schematem. "
            f"Strony: {pages_meta.get('pages_rendered') or 1}."
        ),
        pages_meta=pages_meta,
        merge_fn=_merge_sales_batches,
    )
    image_uris = []

    if not isinstance(data, dict):
        data = {}
    lines_raw = data.get("lines") if isinstance(data.get("lines"), list) else []

    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as httpx_c:
        inv = await sb_get(
            httpx_c,
            "inventory_items",
            params={
                "select": "id,name,unit,quantity,critical_threshold",
                "limit": "2000",
            },
        )
        inv_rows = inv if isinstance(inv, list) else []

    out_lines: list[dict[str, Any]] = []
    for row in lines_raw:
        if not isinstance(row, dict):
            continue
        name = str(row.get("product_name") or row.get("name") or "").strip()
        if not name:
            continue
        try:
            qty = float(row.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        unit = str(row.get("unit") or "g").strip().lower() or "g"
        matched = None
        score = 0.0
        if inv_rows:
            hit, score = _resolve_by_fuzzy(
                name, inv_rows, key="name", threshold=65, strict_food=True,
            )
            if hit and score >= 65:
                matched = hit
        out_lines.append(
            {
                "product_name": name,
                "quantity": qty,
                "unit": unit,
                "matched_inventory_id": str(matched["id"]) if matched else None,
                "matched_name": str(matched.get("name") or "") if matched else None,
                "match_score": round(float(score or 0), 1) if matched else None,
                "current_qty": float(matched.get("quantity") or 0) if matched else None,
                "stock_unit": str(matched.get("unit") or unit) if matched else unit,
                "include": bool(matched) and qty > 0,
            }
        )

    return _with_billing(
        {
            "ok": True,
            "document_type": "LISTA_SPRZEDAZY",
            "lines": out_lines,
            "inventory_count": len(inv_rows),
            "pages_processed": pages_meta.get("pages_rendered"),
        },
        billing,
    )


@router.post("/api/documents/confirm-sales")
async def confirm_sales_list(req: ConfirmSalesRequest):
    """Odjęcie zatwierdzonych pozycji ze stanu magazynowego (sprzedaż ręczna)."""
    from server import require_tenant_account_key

    ak = require_tenant_account_key()
    if not ak or ak == "default":
        raise HTTPException(status_code=401, detail="Brak konta.")
    if not req.lines:
        raise HTTPException(status_code=400, detail="Brak pozycji sprzedaży.")

    note = (req.note or "Skan listy sprzedaży").strip()[:200]
    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=90.0, verify=httpx_verify()) as client:
        for line in req.lines:
            if not line.include:
                skipped.append({"product_name": line.product_name, "reason": "pominięte"})
                continue
            inv_id = (line.matched_inventory_id or "").strip()
            name = (line.product_name or line.matched_name or "").strip()
            if not inv_id or line.quantity <= 0:
                skipped.append({"product_name": name or "?", "reason": "brak dopasowania lub ilości"})
                continue

            rows = await sb_get(
                client,
                "inventory_items",
                params={
                    "select": "id,name,unit,quantity",
                    "id": f"eq.{inv_id}",
                    "limit": "1",
                },
            )
            inv = rows[0] if isinstance(rows, list) and rows else None
            if not inv:
                skipped.append({"product_name": name, "reason": "brak w magazynie"})
                continue

            stock_unit = str(inv.get("unit") or "g")
            try:
                delta = convert_culinary(float(line.quantity), line.unit or stock_unit, stock_unit)
            except Exception:  # noqa: BLE001
                delta = float(line.quantity)
            if delta is None or delta <= 0:
                skipped.append({"product_name": name, "reason": "ilość ≤ 0"})
                continue

            before = float(inv.get("quantity") or 0)
            after = max(0.0, before - float(delta))
            await sb_patch(
                client,
                "inventory_items",
                {"id": f"eq.{inv_id}"},
                {"quantity": after},
            )
            try:
                await sb_post(
                    client,
                    "waste_logs",
                    {
                        "account_key": ak,
                        "item_type": "ingredient",
                        "related_id": inv_id,
                        "item_name": str(inv.get("name") or name),
                        "quantity": float(delta),
                        "unit": stock_unit,
                        "reason": "sprzedaz",
                        "note": note,
                    },
                )
            except Exception as e:  # noqa: BLE001
                logger.info("sales waste_log skip: %s", e)

            applied.append(
                {
                    "inventory_id": inv_id,
                    "name": inv.get("name") or name,
                    "deducted": float(delta),
                    "unit": stock_unit,
                    "before": before,
                    "after": after,
                }
            )

    return {
        "ok": True,
        "applied_count": len(applied),
        "skipped_count": len(skipped),
        "applied": applied,
        "skipped": skipped,
    }
