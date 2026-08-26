"""
POST /api/pos/webhook — sprzedaż POS → magazyn → przychód.

Wydzielone z server.py. Tenant z HMAC URL (public mutate), nie z JWT.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from http_ssl import httpx_verify
from pos_adapters import normalize_pos_payload
from pos_webhook_auth import require_pos_webhook_tenant
from pos_webhook_consume import consume_pos_recipes, process_via_menu_item
from pos_sync import claim_event, extract_event_id, finalize_event, payload_hash
from supabase_rest import sb_get, sb_post

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pos-webhook"])


class PosSaleItem(BaseModel):
    pos_external_id: Optional[str] = None
    dish_name: Optional[str] = None
    quantity_sold: float = Field(gt=0)
    unit_price_pln: Optional[float] = None


class PosWebhookRequest(BaseModel):
    external_order_id: Optional[str] = None
    items: list[PosSaleItem]


def _fmt_qty(q: float) -> str:
    return str(int(q)) if float(q).is_integer() else f"{q:g}"


@router.post("/api/pos/webhook")
async def pos_webhook(request: Request, provider: Optional[str] = None):
    """Odbiera uderzenie POS (JSON kanoniczny lub format providera).

    Query: ?provider=… — normalizacja w pos_adapters.
    Wymaga tokenu HMAC w URL (account + token z Ustawień).
    """
    from server import _account_key_ctx, _recompute_menu_availability

    pos_account = require_pos_webhook_tenant(request)
    ctx_token = _account_key_ctx.set(pos_account)
    try:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Oczekiwano JSON body.")

        canonical = normalize_pos_payload(provider, body if isinstance(body, dict) else {})
        try:
            req = PosWebhookRequest(**canonical)
        except ValidationError as e:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Niepoprawny payload POS po normalizacji "
                    f"({provider or 'generic'}): {e.errors()[:3]}"
                ),
            )

        if not req.items:
            raise HTTPException(status_code=400, detail="Brak pozycji w zamówieniu.")

        # ── Idempotencja: event_id (opcjonalny — brak = zachowanie wsteczne). ──
        event_id = extract_event_id(body if isinstance(body, dict) else {}, canonical)
        p_hash = payload_hash(canonical)
        sync_row_id: Optional[str] = None

        year_month = datetime.now(timezone.utc).strftime("%Y-%m")
        processed: list[dict] = []
        inventory_updates: list[dict] = []
        warnings: list[str] = []
        revenue_total = 0.0
        sale_log_ids: list[str] = []

        async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as client:
            # Rezerwacja zdarzenia — duplikat (retry POS) zwraca ACK bez ponownego księgowania.
            if event_id:
                claim_status, existing = await claim_event(
                    client,
                    event_id=event_id,
                    provider=provider,
                    external_order_id=req.external_order_id,
                    p_hash=p_hash,
                )
                if claim_status == "duplicate":
                    prev_status = (existing or {}).get("status")
                    if prev_status == "processed":
                        prev = (existing or {}).get("result") or {}
                        return {
                            "ok": True,
                            "status": "duplicate",
                            "event_id": event_id,
                            "message": "Zdarzenie już przetworzone — pominięto (idempotencja).",
                            "external_order_id": req.external_order_id,
                            **({"previous_result": prev} if prev else {}),
                        }
                    # Wcześniejsza próba nie zakończyła się sukcesem (processing/error)
                    # → przetwórz ponownie na istniejącym wierszu dziennika.
                sync_row_id = (existing or {}).get("id")

            for it in req.items:
                product: Optional[dict] = None

                if it.pos_external_id:
                    rows = await sb_get(client, "pos_products", params={
                        "select": "id,name,pos_external_id,price_pln",
                        "pos_external_id": f"eq.{it.pos_external_id}",
                        "limit": "1",
                    })
                    if rows:
                        product = rows[0]
                if product is None and it.dish_name:
                    rows = await sb_get(client, "pos_products", params={
                        "select": "id,name,pos_external_id,price_pln",
                        "name": f"ilike.{it.dish_name}",
                        "limit": "1",
                    })
                    if rows:
                        product = rows[0]

                if product is None:
                    revenue_total = round(
                        revenue_total
                        + await process_via_menu_item(
                            client,
                            pos_external_id=it.pos_external_id,
                            dish_name=it.dish_name,
                            quantity_sold=it.quantity_sold,
                            unit_price_pln=it.unit_price_pln,
                            processed=processed,
                            inventory_updates=inventory_updates,
                            warnings=warnings,
                        ),
                        2,
                    )
                    continue

                qty = float(it.quantity_sold)
                unit_price = (
                    float(it.unit_price_pln)
                    if it.unit_price_pln is not None
                    else float(product.get("price_pln") or 0)
                )
                line_total = round(unit_price * qty, 2)
                item_consumed = await consume_pos_recipes(
                    client, product, qty, inventory_updates, warnings,
                )

                try:
                    log_rows = await sb_post(client, "pos_sales_log", {
                        "pos_external_id": product["pos_external_id"],
                        "pos_product_id": product["id"],
                        "quantity_sold": qty,
                    })
                    log_id = (log_rows[0] if isinstance(log_rows, list) else log_rows).get("id")
                    if log_id:
                        sale_log_ids.append(log_id)
                except httpx.HTTPStatusError as e:
                    warnings.append(
                        f"'{product['name']}': pos_sales_log — {e.response.text[:100]}"
                    )

                processed.append({
                    "pos_external_id": product["pos_external_id"],
                    "name": product["name"],
                    "quantity": qty,
                    "unit_price_pln": unit_price,
                    "line_total_pln": line_total,
                    "inventory_consumed": item_consumed,
                })
                revenue_total = round(revenue_total + line_total, 2)

            revenue_id: Optional[str] = None
            if revenue_total > 0:
                summary_items = ", ".join(
                    f"{p['name']} × {_fmt_qty(p['quantity'])}" for p in processed
                )
                desc = f"POS: {summary_items}"
                if req.external_order_id:
                    desc = f"[{req.external_order_id}] {desc}"
                try:
                    rev_rows = await sb_post(client, "revenue_entries", {
                        "year_month": year_month,
                        "description": desc[:255],
                        "amount_pln": revenue_total,
                    })
                    revenue_id = (
                        (rev_rows[0] if isinstance(rev_rows, list) else rev_rows).get("id")
                    )
                except httpx.HTTPStatusError as e:
                    warnings.append(f"revenue_entries: {e.response.text[:120]}")

            if inventory_updates:
                try:
                    await _recompute_menu_availability(
                        client,
                        changed_inventory_ids={u["inventory_id"] for u in inventory_updates},
                    )
                except Exception as e:
                    logger.debug("_recompute_menu_availability skipped: %s", e)

            response = {
                "ok": True,
                "status": "processed",
                "event_id": event_id,
                "external_order_id": req.external_order_id,
                "processed_items": processed,
                "inventory_updates": inventory_updates,
                "revenue_added_pln": revenue_total,
                "revenue_entry_id": revenue_id,
                "sale_log_ids": sale_log_ids,
                "warnings": warnings,
            }
            # ACK: potwierdź poprawne przetworzenie (idempotencja + reconciliation).
            if sync_row_id:
                await finalize_event(
                    client, row_id=sync_row_id, status="processed",
                    result={
                        "revenue_added_pln": revenue_total,
                        "revenue_entry_id": revenue_id,
                        "processed_items": processed,
                        "warnings": warnings,
                    },
                )
        return response
    finally:
        _account_key_ctx.reset(ctx_token)
