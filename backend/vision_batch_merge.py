"""
Scalanie wyników Vision OCR z kolejnych partii stron PDF/obrazów.
Wydzielone z server.py (dekalog §I).
"""
from __future__ import annotations

import re
from typing import Any


def page_surcharge_credits(pages_rendered: int) -> int:
    """Deprecated: billing jest wyłącznie z OpenAI usage (tokeny). Zawsze 0."""
    return 0


def norm_product_key(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def merge_supplier_meta_dicts(*parts: Any) -> dict:
    out: dict = {}
    for p in parts:
        if not isinstance(p, dict):
            continue
        for k, v in p.items():
            if v is None or v == "" or v == []:
                continue
            if out.get(k) in (None, "", []):
                out[k] = v
    return out


def merge_document_vision_batches(parts: list[dict]) -> dict:
    """Scala wyniki Vision z kolejnych partii stron PDF."""
    if not parts:
        return {
            "document_type": "OFERTA_HANDLOWA",
            "supplier_name": None,
            "total_amount": 0,
            "supplier": {},
            "products": [],
        }
    types = [str(p.get("document_type") or "") for p in parts]
    if "FAKTURA_ZAKUPOWA" in types:
        doc_type = "FAKTURA_ZAKUPOWA"
    elif "MENU_RESTAURACYJNE" in types:
        doc_type = "MENU_RESTAURACYJNE"
    else:
        doc_type = types[0] or "OFERTA_HANDLOWA"

    supplier_name = None
    for p in parts:
        sn = (p.get("supplier_name") or "").strip() if isinstance(p.get("supplier_name"), str) else None
        if sn:
            supplier_name = sn
            break

    total_amount = 0.0
    for p in parts:
        try:
            total_amount = max(total_amount, float(p.get("total_amount") or 0))
        except (TypeError, ValueError):
            pass

    supplier = merge_supplier_meta_dicts(*[p.get("supplier") for p in parts])

    products: list[dict] = []
    seen: set[str] = set()
    for p in parts:
        for row in p.get("products") or []:
            if not isinstance(row, dict):
                continue
            key = norm_product_key(str(row.get("product_name") or ""))
            if not key or key in seen:
                continue
            seen.add(key)
            products.append(row)

    return {
        "document_type": doc_type,
        "supplier_name": supplier_name,
        "total_amount": total_amount,
        "supplier": supplier,
        "products": products,
    }


def merge_catalog_vision_batches(parts: list[dict]) -> dict:
    products: list[dict] = []
    seen: set[str] = set()
    supplier_name = None
    for p in parts:
        if not supplier_name:
            sn = p.get("supplier_name")
            if isinstance(sn, str) and sn.strip():
                supplier_name = sn.strip()
        for row in p.get("products") or []:
            if not isinstance(row, dict):
                continue
            key = norm_product_key(str(row.get("product_name") or ""))
            if not key or key in seen:
                continue
            seen.add(key)
            products.append(row)
    return {"supplier_name": supplier_name, "products": products}


def merge_menu_vision_batches(parts: list[dict]) -> dict:
    dishes: list[dict] = []
    seen: set[str] = set()
    for p in parts:
        for row in p.get("dishes") or []:
            if not isinstance(row, dict):
                continue
            key = norm_product_key(str(row.get("name") or row.get("product_name") or ""))
            if not key or key in seen:
                continue
            seen.add(key)
            dishes.append(row)
    return {"dishes": dishes}


def merge_recipe_ocr_batches(parts: list[dict]) -> dict:
    chunks = []
    for p in parts:
        t = (p.get("text") or "").strip()
        if t:
            chunks.append(t)
    return {"text": "\n\n".join(chunks)}
