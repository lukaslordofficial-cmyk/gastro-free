"""
Skan ręcznie spisanej listy sprzedaży → fuzzy match magazynu / nr POS dania → odjęcie gramatur.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from culinary_units import convert_culinary
from http_ssl import httpx_verify
from matching_utils import _resolve_by_fuzzy
from supabase_rest import sb_get, sb_patch, sb_post

logger = logging.getLogger("sales_scan")
router = APIRouter(tags=["sales-scan"])

_PURE_NUMERIC_RE = re.compile(r"^\s*\d+\s*$")


class SalesLineIn(BaseModel):
    product_name: str = ""
    quantity: float = 0.0
    unit: str = "g"
    matched_inventory_id: Optional[str] = None
    matched_name: Optional[str] = None
    match_score: Optional[float] = None
    matched_menu_item_id: Optional[str] = None
    match_kind: Optional[str] = None  # "inventory" | "dish"
    include: bool = True


class ConfirmSalesRequest(BaseModel):
    lines: list[SalesLineIn] = Field(default_factory=list)
    note: Optional[str] = None


_SALES_SYSTEM_PROMPT = """
Jesteś OCR dla restauracji. Na zdjęciu jest RĘCZNIE lub maszynowo spisana LISTA SPRZEDANYCH produktów
(notatka barmana/kucharza po zmianie — nazwy LUB numery dań POS + ilości).

Zasady:
- product_name: czytelna nazwa PL (np. "kurczak filet", "mozarella") ALBO sam numer dania z menu POS
  (np. "3", "12") gdy kasjer spisał tylko numerek.
- quantity: liczba porcji / sztuk > 0; jeśli brak, 0. Dla numeru dania quantity = liczba sprzedanych porcji.
- unit: dla dań po numerze użyj "szt"; dla składników "g"/"ml"/"szt" jak na kartce.
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


def _looks_like_pos_id(name: str) -> bool:
    return bool(_PURE_NUMERIC_RE.match(name or ""))


def _menu_by_pos_id(menu_rows: list[dict], pos_key: str) -> Optional[dict]:
    key = (pos_key or "").strip()
    if not key:
        return None
    for m in menu_rows:
        pid = str(m.get("pos_id") or "").strip()
        if pid == key:
            return m
    # "03" vs "3"
    try:
        n = str(int(key))
    except ValueError:
        return None
    for m in menu_rows:
        pid = str(m.get("pos_id") or "").strip()
        try:
            if str(int(pid)) == n:
                return m
        except ValueError:
            continue
    return None


async def _deduct_inventory_line(
    client: httpx.AsyncClient,
    *,
    ak: str,
    inv_id: str,
    quantity: float,
    unit: str,
    display_name: str,
    note: str,
) -> dict[str, Any] | None:
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
        return None

    stock_unit = str(inv.get("unit") or "g")
    try:
        delta = convert_culinary(float(quantity), unit or stock_unit, stock_unit)
    except Exception:  # noqa: BLE001
        delta = float(quantity)
    if delta is None or delta <= 0:
        return None

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
                "item_name": str(inv.get("name") or display_name),
                "quantity": float(delta),
                "unit": stock_unit,
                "reason": "sprzedaz",
                "note": note,
            },
        )
    except Exception as e:  # noqa: BLE001
        logger.info("sales waste_log skip: %s", e)

    return {
        "inventory_id": inv_id,
        "name": inv.get("name") or display_name,
        "deducted": float(delta),
        "unit": stock_unit,
        "before": before,
        "after": after,
    }


async def _deduct_dish_portions(
    client: httpx.AsyncClient,
    *,
    ak: str,
    menu_item_id: str,
    portions: float,
    dish_name: str,
    note: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Odejmij składniki receptury × liczba porcji. Zwraca (applied, skipped)."""
    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    ings = await sb_get(
        client,
        "recipe_ingredients",
        params={
            "select": "id,ingredient_name,quantity,unit,warehouse_product_id",
            "menu_item_id": f"eq.{menu_item_id}",
        },
    ) or []
    mapped = [r for r in ings if r.get("warehouse_product_id")]
    if not mapped:
        skipped.append(
            {
                "product_name": dish_name,
                "reason": "brak zmapowanych składników receptury",
            }
        )
        return applied, skipped

    qty = float(portions)
    for r in mapped:
        inv_id = str(r.get("warehouse_product_id") or "").strip()
        per = float(r.get("quantity") or 0) * qty
        unit = str(r.get("unit") or "g")
        if not inv_id or per <= 0:
            skipped.append(
                {
                    "product_name": r.get("ingredient_name") or dish_name,
                    "reason": "brak ilości składnika",
                }
            )
            continue
        hit = await _deduct_inventory_line(
            client,
            ak=ak,
            inv_id=inv_id,
            quantity=per,
            unit=unit,
            display_name=str(r.get("ingredient_name") or dish_name),
            note=f"{note} · danie {dish_name}",
        )
        if hit:
            hit["dish_name"] = dish_name
            hit["portions"] = qty
            applied.append(hit)
        else:
            skipped.append(
                {
                    "product_name": r.get("ingredient_name") or dish_name,
                    "reason": "brak w magazynie",
                }
            )
    return applied, skipped


@router.post("/api/documents/process-sales")
async def process_sales_list(
    file: UploadFile = File(...),
):
    """Vision OCR → lista sprzedanych produktów + podpowiedzi matchingu magazynu / nr POS."""
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
            "Odczytaj listę sprzedanych produktów lub numerów dań POS z notatki. "
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
        menu = await sb_get(
            httpx_c,
            "menu_items",
            params={
                "select": "id,name,pos_id",
                "is_active": "eq.true",
                "limit": "2000",
            },
        )
        menu_rows = menu if isinstance(menu, list) else []

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

        # 1) Czysty numer / pos_id → danie z menu → odjęcie przez recepturę
        if _looks_like_pos_id(name) and menu_rows:
            dish = _menu_by_pos_id(menu_rows, name)
            if dish:
                if qty <= 0:
                    qty = 1.0
                out_lines.append(
                    {
                        "product_name": name,
                        "quantity": qty,
                        "unit": "szt",
                        "matched_inventory_id": None,
                        "matched_name": str(dish.get("name") or ""),
                        "match_score": 100.0,
                        "matched_menu_item_id": str(dish.get("id")),
                        "match_kind": "dish",
                        "current_qty": None,
                        "stock_unit": "szt",
                        "include": qty > 0,
                    }
                )
                continue

        # 2) Fuzzy na magazyn (składniki)
        matched = None
        score = 0.0
        if inv_rows:
            hit, score = _resolve_by_fuzzy(
                name, inv_rows, key="name", threshold=65, strict_food=True,
            )
            if hit and score >= 65:
                matched = hit

        # 3) Fallback: nazwa dania z menu (niekoniecznie numer)
        if matched is None and menu_rows:
            dish_hit, dscore = _resolve_by_fuzzy(
                name, menu_rows, key="name", threshold=80, strict_food=False,
            )
            if dish_hit and dscore >= 80:
                if qty <= 0:
                    qty = 1.0
                out_lines.append(
                    {
                        "product_name": name,
                        "quantity": qty,
                        "unit": "szt",
                        "matched_inventory_id": None,
                        "matched_name": str(dish_hit.get("name") or ""),
                        "match_score": round(float(dscore or 0), 1),
                        "matched_menu_item_id": str(dish_hit.get("id")),
                        "match_kind": "dish",
                        "current_qty": None,
                        "stock_unit": "szt",
                        "include": qty > 0,
                    }
                )
                continue

        out_lines.append(
            {
                "product_name": name,
                "quantity": qty,
                "unit": unit,
                "matched_inventory_id": str(matched["id"]) if matched else None,
                "matched_name": str(matched.get("name") or "") if matched else None,
                "match_score": round(float(score or 0), 1) if matched else None,
                "matched_menu_item_id": None,
                "match_kind": "inventory" if matched else None,
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
            "menu_count": len(menu_rows),
            "pages_processed": pages_meta.get("pages_rendered"),
        },
        billing,
    )


@router.post("/api/documents/confirm-sales")
async def confirm_sales_list(req: ConfirmSalesRequest):
    """Odjęcie zatwierdzonych pozycji: składniki magazynu lub receptury dań (nr POS)."""
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
        # Cache menu by pos_id for numeric lines without matched_menu_item_id
        menu_rows: list[dict] = []
        need_menu = any(
            (line.include and (
                (line.matched_menu_item_id or "").strip()
                or _looks_like_pos_id(line.product_name or "")
            ))
            for line in req.lines
        )
        if need_menu:
            menu = await sb_get(
                client,
                "menu_items",
                params={
                    "select": "id,name,pos_id",
                    "is_active": "eq.true",
                    "limit": "2000",
                },
            )
            menu_rows = menu if isinstance(menu, list) else []

        for line in req.lines:
            if not line.include:
                skipped.append({"product_name": line.product_name, "reason": "pominięte"})
                continue

            name = (line.product_name or line.matched_name or "").strip()
            menu_id = (line.matched_menu_item_id or "").strip()
            kind = (line.match_kind or "").strip().lower()

            # Resolve dish by pos_id if needed
            if not menu_id and _looks_like_pos_id(line.product_name or ""):
                dish = _menu_by_pos_id(menu_rows, line.product_name)
                if dish:
                    menu_id = str(dish.get("id") or "")
                    name = str(dish.get("name") or name)
                    kind = "dish"

            if menu_id or kind == "dish":
                if not menu_id or line.quantity <= 0:
                    skipped.append(
                        {"product_name": name or "?", "reason": "brak dania lub ilości"}
                    )
                    continue
                dish_name = (line.matched_name or name or "?").strip()
                app, sk = await _deduct_dish_portions(
                    client,
                    ak=ak,
                    menu_item_id=menu_id,
                    portions=float(line.quantity),
                    dish_name=dish_name,
                    note=note,
                )
                applied.extend(app)
                skipped.extend(sk)
                continue

            inv_id = (line.matched_inventory_id or "").strip()
            if not inv_id or line.quantity <= 0:
                skipped.append(
                    {"product_name": name or "?", "reason": "brak dopasowania lub ilości"}
                )
                continue

            hit = await _deduct_inventory_line(
                client,
                ak=ak,
                inv_id=inv_id,
                quantity=float(line.quantity),
                unit=line.unit or "g",
                display_name=name,
                note=note,
            )
            if hit:
                applied.append(hit)
            else:
                skipped.append({"product_name": name, "reason": "brak w magazynie"})

    return {
        "ok": True,
        "applied_count": len(applied),
        "skipped_count": len(skipped),
        "applied": applied,
        "skipped": skipped,
    }
