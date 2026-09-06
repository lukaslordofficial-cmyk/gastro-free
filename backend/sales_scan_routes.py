"""
Skan ręcznie spisanej listy sprzedaży → fuzzy match magazynu / nr POS dania → odjęcie gramatur.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
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
# Pojedyncze znaczniki sprzedaży obok pozycji na wydrukowanej liście POS.
_MARK_UNIT_RE = re.compile(
    r"[xX×✕✖✗✘╳☓✓✔☑✅\*★☆•·◦∙●○]|"
    r"(?<![A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9])[iIl|](?![A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9])"
)
# Nazwa/nr + znaczniki na końcu wiersza (np. "3 xxx", "Schabowy |||", "12 ✓✓").
_NAME_THEN_MARKS_RE = re.compile(
    r"^(.+?)\s+("
    r"(?:[xX×✕✖✗✘╳☓✓✔☑✅\*★☆•·◦∙●○iIl|\+\-/\s]){1,}"
    r")$"
)


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
    # Data sprzedaży z dokumentu (YYYY-MM-DD) — finanse trafiają w ten dzień.
    sale_date: Optional[str] = None


_SALES_SYSTEM_PROMPT = """
Jesteś OCR dla restauracji. Na zdjęciu jest lista sprzedaży — ręczna notatka ALBO WYDRUKOWANA
lista dań z numerami POS, na której kasjer zaznaczył sprzedaż obok pozycji.

Zasady ogólne:
- product_name: nazwa PL (np. "kurczak filet") ALBO sam numer dania POS (np. "3", "12").
- quantity: liczba sprzedanych porcji / sztuk > 0. unit: dla dań "szt"; dla składników "g"/"ml"/"szt".
- document_date: data zmiany / sprzedaży z nagłówka lub ręcznie wpisana na kartce (YYYY-MM-DD).
  Jeśli widzisz „6.09”, „06.09.2026”, „2026-09-06” — znormalizuj do ISO. Gdy brak daty: "".
- Nie wymyślaj pozycji spoza kartki. Pomiń nagłówki ("Sprzedaż", "Nr", "Danie"), podpisy.
- Jeśli lista pusta — lines: [].

WYDRUK Z NUMERKAMI POS + ZNACZNIKI (najczęstszy przypadek bez kasy):
Kasjer drukuje listę „Nr | Danie” i obok sprzedanych pozycji stawia znaczniki: x, X, ×, ptaszek ✓,
krzyżyk, kreska |, ukośnik /, plus +, kropka •, „i” / „I”, albo kilka kresek (||||).
- Każdy osobny znacznik = 1 sprzedana sztuka tej pozycji.
- Policz WSZYSTKIE znaczniki przy tej samej pozycji → quantity.
- product_name = numer z lewej kolumny (preferowane) albo nazwa dania — BEZ znaczników w nazwie.
- Pozycje BEZ znacznika = NIE sprzedane — POMIŃ.
- Cyfra ilości przy pozycji (np. "3 × 2") też jest OK jako quantity.

RĘCZNA NOTATKA:
- Nazwa/numer + ilość (np. "kurczak 800 g", "3 × 2") jak wcześniej.
"""

_SALES_JSON_SCHEMA: dict[str, Any] = {
    "name": "sales_list_scan",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "document_type": {"type": "string"},
            "document_date": {"type": "string"},
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
        "required": ["document_type", "document_date", "lines"],
    },
}


def _merge_sales_batches(parts: list[dict]) -> dict:
    lines: list[dict] = []
    doc_date = ""
    for p in parts:
        if not isinstance(p, dict):
            continue
        if not doc_date:
            doc_date = str(p.get("document_date") or "").strip()
        for row in p.get("lines") or []:
            if isinstance(row, dict):
                lines.append(row)
    return {
        "document_type": "LISTA_SPRZEDAZY",
        "document_date": doc_date,
        "lines": lines,
    }


_DATE_ISO_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_DATE_PL_RE = re.compile(
    r"(?<!\d)(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?!\d)"
)


def _normalize_sale_date(raw: Optional[str]) -> Optional[str]:
    """Zwraca YYYY-MM-DD albo None."""
    s = (raw or "").strip()
    if not s:
        return None
    m = _DATE_ISO_RE.match(s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = _DATE_PL_RE.search(s)
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
    year = datetime.now(timezone.utc).year
    if y:
        yi = int(y)
        year = yi if yi >= 100 else 2000 + yi
    try:
        return datetime(year, mo, d, tzinfo=timezone.utc).strftime("%Y-%m-%d")
    except ValueError:
        try:
            return datetime(year, d, mo, tzinfo=timezone.utc).strftime("%Y-%m-%d")
        except ValueError:
            return None


def _sale_day_bounds(sale_date: str) -> tuple[str, str]:
    """ISO created_at na południe UTC danego dnia + year_month."""
    y, m, d = [int(x) for x in sale_date.split("-")]
    noon = datetime(y, m, d, 12, 0, 0, tzinfo=timezone.utc)
    return noon.isoformat(), sale_date[:7]


def _looks_like_pos_id(name: str) -> bool:
    return bool(_PURE_NUMERIC_RE.match(name or ""))


def _count_sale_marks(fragment: str) -> int:
    """Policz ręczne znaczniki sprzedaży (x, ✓, kreski, …) w fragmencie tekstu."""
    if not fragment:
        return 0
    return len(_MARK_UNIT_RE.findall(fragment))


def _normalize_sales_ocr_row(name: str, qty: float, unit: str) -> tuple[str, float, str]:
    """
    Gdy OCR wrzuci znaczniki do product_name albo quantity=0 przy zaznaczonej pozycji,
    wyodrębnij nazwę/nr i ustaw quantity = liczba znaczników.
    """
    raw = (name or "").strip()
    u = (unit or "g").strip().lower() or "g"
    if not raw:
        return raw, float(qty or 0), u

    mark_qty = 0
    clean = raw
    m = _NAME_THEN_MARKS_RE.match(raw)
    if m:
        left, marks = m.group(1).strip(), m.group(2)
        # Lewa strona nie może być samym znacznikiem; prawa musi mieć ≥1 mark
        n_marks = _count_sale_marks(marks)
        if n_marks > 0 and _count_sale_marks(left) == 0:
            clean = left
            mark_qty = n_marks
    elif _count_sale_marks(raw) > 0 and not _looks_like_pos_id(raw):
        # Cały wiersz to np. same "xxx" — bez nazwy nie da się zmatchować
        only_marks = _count_sale_marks(raw)
        letters = re.sub(r"[\s\d]", "", _MARK_UNIT_RE.sub("", raw))
        if only_marks > 0 and not letters:
            return raw, float(qty or 0), u

    out_qty = float(qty or 0)
    if mark_qty > 0:
        if out_qty <= 0:
            out_qty = float(mark_qty)
        # Gdy OCR dał quantity=1, a znaczników jest więcej — ufaj znacznikom
        elif out_qty == 1 and mark_qty > 1:
            out_qty = float(mark_qty)
        if u in ("g", "ml", "kg", "l") and (_looks_like_pos_id(clean) or mark_qty > 0):
            u = "szt"
    return clean.strip(), out_qty, u


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
            "Odczytaj sprzedaż z notatki LUB z wydrukowanej listy POS ze znacznikami "
            "(x / ✓ / I / kreski = sztuki). Odczytaj też datę dokumentu jeśli jest. "
            "Pozycje bez znacznika pomiń. "
            f"Strony: {pages_meta.get('pages_rendered') or 1}."
        ),
        pages_meta=pages_meta,
        merge_fn=_merge_sales_batches,
    )
    image_uris = []

    if not isinstance(data, dict):
        data = {}
    lines_raw = data.get("lines") if isinstance(data.get("lines"), list) else []
    document_date = _normalize_sale_date(str(data.get("document_date") or ""))

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
                "select": "id,name,pos_id,price_pln",
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
        name, qty, unit = _normalize_sales_ocr_row(name, qty, unit)
        if not name:
            continue

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
            "document_date": document_date,
            "lines": out_lines,
            "inventory_count": len(inv_rows),
            "menu_count": len(menu_rows),
            "pages_processed": pages_meta.get("pages_rendered"),
        },
        billing,
    )


@router.post("/api/documents/confirm-sales")
async def confirm_sales_list(req: ConfirmSalesRequest):
    """Odjęcie magazynu + przychód z datą dokumentu (nawet gdy skan jest później)."""
    from server import require_tenant_account_key

    ak = require_tenant_account_key()
    if not ak or ak == "default":
        raise HTTPException(status_code=401, detail="Brak konta.")
    if not req.lines:
        raise HTTPException(status_code=400, detail="Brak pozycji sprzedaży.")

    sale_date = _normalize_sale_date(req.sale_date) or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    created_iso, year_month = _sale_day_bounds(sale_date)
    note = (req.note or f"Skan listy sprzedaży · {sale_date}").strip()[:200]
    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    revenue_total = 0.0
    dish_summaries: list[str] = []

    async with httpx.AsyncClient(timeout=90.0, verify=httpx_verify()) as client:
        menu_rows: list[dict] = []
        need_menu = any(
            (
                line.include
                and (
                    (line.matched_menu_item_id or "").strip()
                    or _looks_like_pos_id(line.product_name or "")
                    or (line.match_kind or "").strip().lower() == "dish"
                )
            )
            for line in req.lines
        )
        if need_menu:
            menu = await sb_get(
                client,
                "menu_items",
                params={
                    "select": "id,name,pos_id,price_pln",
                    "is_active": "eq.true",
                    "limit": "2000",
                },
            )
            menu_rows = menu if isinstance(menu, list) else []

        menu_by_id = {str(m.get("id")): m for m in menu_rows if m.get("id")}

        for line in req.lines:
            if not line.include:
                skipped.append({"product_name": line.product_name, "reason": "pominięte"})
                continue

            name = (line.product_name or line.matched_name or "").strip()
            menu_id = (line.matched_menu_item_id or "").strip()
            kind = (line.match_kind or "").strip().lower()

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
                menu_row = menu_by_id.get(menu_id) or {}
                unit_price = float(menu_row.get("price_pln") or 0)
                line_rev = round(unit_price * float(line.quantity), 2)
                revenue_total = round(revenue_total + line_rev, 2)
                dish_summaries.append(f"{dish_name} × {line.quantity:g}")

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

                try:
                    await sb_post(
                        client,
                        "sales_log",
                        {
                            "account_key": ak,
                            "menu_item_id": menu_id,
                            "quantity": float(line.quantity),
                            "revenue_pln": line_rev,
                            "sold_at": created_iso,
                        },
                    )
                except Exception:  # noqa: BLE001
                    pass
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

        revenue_id = None
        if revenue_total > 0:
            desc = f"Skan sprzedaży {sale_date}: " + ", ".join(dish_summaries[:12])
            if len(dish_summaries) > 12:
                desc += "…"
            try:
                rev_rows = await sb_post(
                    client,
                    "revenue_entries",
                    {
                        "account_key": ak,
                        "year_month": year_month,
                        "description": desc[:255],
                        "amount_pln": revenue_total,
                        "note": note,
                        "created_at": created_iso,
                    },
                )
                revenue_id = (
                    (rev_rows[0] if isinstance(rev_rows, list) else rev_rows) or {}
                ).get("id")
            except Exception as e:  # noqa: BLE001
                skipped.append({"product_name": "przychód", "reason": str(e)[:120]})

    return {
        "ok": True,
        "sale_date": sale_date,
        "revenue_added_pln": revenue_total,
        "revenue_entry_id": revenue_id,
        "applied_count": len(applied),
        "skipped_count": len(skipped),
        "applied": applied,
        "skipped": skipped,
    }
