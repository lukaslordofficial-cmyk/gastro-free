"""
POST /api/documents/process + confirm-invoice — skan dokumentów.
Wydzielone z server.py (helpers Vision / _save_invoice zostają w server).
"""
from __future__ import annotations

from typing import Optional

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator

from http_ssl import httpx_verify
from supabase_rest import sb_get

router = APIRouter(tags=["documents"])


class InvoiceBatchIn(BaseModel):
    quantity: float = 0.0
    expiration_date: Optional[str] = None


class InvoiceProductIn(BaseModel):
    product_name: str
    quantity: float = 0.0
    price_netto: float = 0.0
    unit: str = "szt"
    category: str = "Inne"
    batches: list[InvoiceBatchIn] = Field(default_factory=list)
    alert_days: list[int] = Field(default_factory=lambda: [7, 3, 1])

    @field_validator("product_name")
    @classmethod
    def _normalize_name(cls, v: str) -> str:
        from inventory_invoice_match import normalize_invoice_line_name
        return normalize_invoice_line_name(v)


class ConfirmInvoiceRequest(BaseModel):
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    total_amount: float = 0.0
    products: list[InvoiceProductIn]
    destination: str = "inventory"
    supplier: Optional[dict] = None
    supplier_nip: Optional[str] = None
    supplier_phone: Optional[str] = None
    supplier_email: Optional[str] = None
    supplier_contact_person: Optional[str] = None
    supplier_address: Optional[str] = None
    supplier_bank_account: Optional[str] = None
    supplier_payment_terms: Optional[str] = None
    supplier_shipping_cost: Optional[float] = None
    supplier_min_order_value: Optional[float] = None
    supplier_free_shipping_threshold: Optional[float] = None
    supplier_lead_time_days: Optional[int] = None


@router.post("/api/documents/confirm-invoice")
async def confirm_invoice(req: ConfirmInvoiceRequest):
    """Zatwierdzenie faktury: magazyn + koszt zmienny + meta dostawcy."""
    from server import (
        _apply_supplier_scan_meta,
        _find_or_create_supplier,
        _save_invoice,
        require_tenant_account_key,
    )
    from supplier_scan_meta import normalize_supplier_scan_meta, supplier_meta_preview

    require_tenant_account_key()
    if not req.products:
        raise HTTPException(status_code=400, detail="Brak pozycji do zaksięgowania.")

    flat_meta = {
        "nip": req.supplier_nip,
        "phone": req.supplier_phone,
        "email": req.supplier_email,
        "contact_person": req.supplier_contact_person,
        "address": req.supplier_address,
        "bank_account": req.supplier_bank_account,
        "payment_terms": req.supplier_payment_terms,
        "shipping_cost": req.supplier_shipping_cost,
        "min_order_value": req.supplier_min_order_value,
        "free_shipping_threshold": req.supplier_free_shipping_threshold,
        "lead_time_days": req.supplier_lead_time_days,
    }
    if isinstance(req.supplier, dict):
        merged_src = {**flat_meta, **{k: v for k, v in req.supplier.items() if v is not None}}
    else:
        merged_src = flat_meta
    supplier_meta = normalize_supplier_scan_meta(merged_src)

    async with httpx.AsyncClient(timeout=90.0, verify=httpx_verify()) as client:
        if req.supplier_id:
            sup = await sb_get(
                client,
                "suppliers",
                params={"select": "id,name", "id": f"eq.{req.supplier_id}", "limit": "1"},
            )
            if not sup:
                raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")
            supplier_id, supplier_name = sup[0]["id"], sup[0]["name"]
        else:
            supplier_id, supplier_name = await _find_or_create_supplier(
                client, req.supplier_name, nip=supplier_meta.get("nip"),
            )

        meta_result = await _apply_supplier_scan_meta(client, supplier_id, supplier_meta)
        products = [p.model_dump() for p in req.products]
        result = await _save_invoice(
            client,
            supplier_id,
            supplier_name,
            products,
            float(req.total_amount or 0),
            destination="inventory",
        )
    return {
        "document_type": "FAKTURA_ZAKUPOWA",
        "supplier": meta_result.get("supplier_meta") or supplier_meta_preview(supplier_meta),
        "supplier_fields_updated": meta_result.get("updated_fields") or [],
        **result,
    }


@router.post("/api/documents/process")
async def process_document(
    supplier_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    """FAKTURA → podgląd; OFERTA → katalog; MENU → sygnał do skanera menu."""
    from server import (
        _DOCUMENT_JSON_SCHEMA,
        _DOCUMENT_SYSTEM_PROMPT,
        _apply_supplier_scan_meta,
        _ensure_warehouse_categories,
        _find_inventory_duplicate,
        _find_or_create_supplier,
        _guess_category_free,
        _images_from_upload,
        _inventory_names_same_product,
        _load_user_inventory_categories,
        _merge_document_vision_batches,
        _normalize_invoice_line_name,
        _openai,
        _openai_vision_json_batches,
        _process_offer,
        _with_billing,
        require_tenant_account_key,
    )
    from supplier_scan_meta import normalize_supplier_scan_meta, supplier_meta_preview

    require_tenant_account_key()
    client = _openai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    if supplier_id:
        async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as httpx_c:
            sup = await sb_get(
                httpx_c,
                "suppliers",
                params={"select": "id,name", "id": f"eq.{supplier_id}", "limit": "1"},
            )
            if not sup:
                raise HTTPException(status_code=404, detail="Nie znaleziono dostawcy.")

    image_uris, pages_meta = _images_from_upload(
        contents, file.content_type or "", file.filename or "",
    )
    contents = b""

    data, billing = await _openai_vision_json_batches(
        client,
        image_uris=image_uris,
        system_prompt=_DOCUMENT_SYSTEM_PROMPT,
        json_schema=_DOCUMENT_JSON_SCHEMA,
        endpoint="/api/documents/process",
        user_text=(
            "Rozpoznaj typ tego dokumentu i wyodrębnij dane zgodnie ze schematem. "
            f"Dokument PDF/zdjęcie: {pages_meta.get('pages_rendered')} stron"
            f"{' (z ' + str(pages_meta.get('pages_total')) + ')' if pages_meta.get('truncated') else ''}."
        ),
        pages_meta=pages_meta,
        merge_fn=_merge_document_vision_batches,
    )
    image_uris = []

    doc_type = data.get("document_type") or "OFERTA_HANDLOWA"
    supplier_name = data.get("supplier_name")
    supplier_meta = normalize_supplier_scan_meta(data.get("supplier"))
    pages_info = {
        "pages_total": pages_meta.get("pages_total"),
        "pages_processed": pages_meta.get("pages_rendered"),
        "pages_truncated": bool(pages_meta.get("truncated")),
    }

    if doc_type == "MENU_RESTAURACYJNE":
        dishes_preview = []
        for p in (data.get("products") or [])[:80]:
            nm = (p.get("product_name") or "").strip()
            if not nm:
                continue
            dishes_preview.append({
                "name": nm,
                "price_pln": float(p.get("price_netto") or 0),
                "category": p.get("category") or "Inne",
            })
        return _with_billing({
            "document_type": "MENU_RESTAURACYJNE",
            "open_menu_scan": True,
            "dishes_preview": dishes_preview,
            **pages_info,
            "message": (
                "Rozpoznano kartę dań (menu restauracji). "
                "Otwórz „Skanuj menu”, aby wgrać potrawy — nie dodano dostawcy ani katalogu."
            ),
        }, billing)

    if doc_type == "FAKTURA_ZAKUPOWA":
        raw_products = data.get("products") or []
        enriched: list[dict] = []
        user_cat_names: list[str] = []
        async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client_db:
            await _ensure_warehouse_categories(client_db)
            user_cats = await _load_user_inventory_categories(client_db)
            user_cat_names = [c.get("name") for c in user_cats if c.get("name")]
            try:
                inv_all = await sb_get(client_db, "inventory_items", params={
                    "select": "id,name,category_id,is_active",
                    "is_active": "eq.true",
                    "limit": "5000",
                }) or []
            except httpx.HTTPStatusError:
                inv_all = await sb_get(client_db, "inventory_items", params={
                    "select": "id,name,category_id",
                    "limit": "5000",
                }) or []
            cat_id_to_name = {str(c["id"]): c["name"] for c in user_cats if c.get("id")}
            for p in raw_products:
                if not isinstance(p, dict):
                    continue
                pname = _normalize_invoice_line_name(p.get("product_name") or "")
                if not pname:
                    continue
                neighbor = _find_inventory_duplicate(pname, inv_all, threshold=88, for_invoice=True)
                neighbor_cat = None
                if neighbor and neighbor.get("category_id"):
                    neighbor_cat = cat_id_to_name.get(str(neighbor["category_id"]))
                guessed = _guess_category_free(
                    pname,
                    ai_category=p.get("category"),
                    user_categories=user_cats,
                    neighbor_category=neighbor_cat,
                )
                out = dict(p)
                out["product_name"] = pname
                out["category"] = guessed
                if neighbor and _inventory_names_same_product(pname, str(neighbor.get("name") or "")):
                    out["matched_inventory_name"] = neighbor.get("name")
                    out["will_update_existing"] = True
                else:
                    out["matched_inventory_name"] = None
                    out["will_update_existing"] = False
                enriched.append(out)
        return _with_billing({
            "document_type": doc_type,
            "supplier_id": supplier_id,
            "supplier_name": supplier_name,
            "supplier": supplier_meta_preview(supplier_meta),
            "total_amount": float(data.get("total_amount") or 0),
            "products": enriched or raw_products,
            "user_categories": user_cat_names,
            **pages_info,
        }, billing)

    async with httpx.AsyncClient(timeout=90.0, verify=httpx_verify()) as client_db:
        if supplier_id:
            resolved_id, resolved_name = supplier_id, (data.get("supplier_name") or "")
        else:
            resolved_id, resolved_name = await _find_or_create_supplier(
                client_db, supplier_name, nip=supplier_meta.get("nip"),
            )
        meta_result = await _apply_supplier_scan_meta(client_db, resolved_id, supplier_meta)
        result = await _process_offer(client_db, resolved_id, data)
        return _with_billing({
            "document_type": doc_type,
            "supplier_id": resolved_id,
            "supplier_name": resolved_name or supplier_name,
            "supplier": meta_result.get("supplier_meta") or supplier_meta_preview(supplier_meta),
            "supplier_fields_updated": meta_result.get("updated_fields") or [],
            **pages_info,
            **result,
        }, billing)
