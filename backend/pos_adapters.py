"""
Adaptery payloadów popularnych systemów POS (PL) → kanoniczny format Gastro-Manager.

Kanoniczny format:
{
  "external_order_id": str | null,
  "items": [
    {"pos_external_id": str | null, "dish_name": str | null,
     "quantity_sold": float > 0, "unit_price_pln": float | null}
  ]
}
"""
from __future__ import annotations

from typing import Any, Optional


PROVIDERS: list[dict[str, Any]] = [
    {"id": "generic", "name": "Uniwersalny JSON"},
    {"id": "gopos", "name": "GoPOS"},
    {"id": "posbistro", "name": "POSbistro"},
    {"id": "dotykacka", "name": "Dotykačka"},
    {"id": "softpos", "name": "SoftPOS / Softtronic"},
    {"id": "ipos", "name": "iPOS"},
    {"id": "poster", "name": "Poster POS"},
    {"id": "restimo", "name": "Restimo"},
    {"id": "s4h", "name": "S4H / inne PL"},
]


def _f(v: Any, default: Optional[float] = None) -> Optional[float]:
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _s(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _item(
    pos_external_id: Any = None,
    dish_name: Any = None,
    quantity_sold: Any = 1,
    unit_price_pln: Any = None,
) -> Optional[dict[str, Any]]:
    qty = _f(quantity_sold, 0.0) or 0.0
    if qty <= 0:
        return None
    price = _f(unit_price_pln)
    # Poster czasem wysyła grosze
    return {
        "pos_external_id": _s(pos_external_id),
        "dish_name": _s(dish_name),
        "quantity_sold": qty,
        "unit_price_pln": price,
    }


def _pack(order_id: Any, items: list[dict[str, Any]]) -> dict[str, Any]:
    clean = [i for i in items if i]
    return {"external_order_id": _s(order_id), "items": clean}


def normalize_generic(body: dict[str, Any]) -> dict[str, Any]:
    if "items" in body and isinstance(body["items"], list):
        items = []
        for it in body["items"]:
            if not isinstance(it, dict):
                continue
            row = _item(
                it.get("pos_external_id") or it.get("sku") or it.get("code") or it.get("plu"),
                it.get("dish_name") or it.get("name"),
                it.get("quantity_sold") or it.get("quantity") or it.get("qty") or 1,
                it.get("unit_price_pln") or it.get("price") or it.get("unit_price"),
            )
            if row:
                items.append(row)
        return _pack(body.get("external_order_id") or body.get("order_id"), items)
    return _pack(None, [])


def normalize_gopos(body: dict[str, Any]) -> dict[str, Any]:
    products = body.get("products") or body.get("items") or body.get("lines") or []
    items = []
    for it in products if isinstance(products, list) else []:
        if not isinstance(it, dict):
            continue
        row = _item(
            it.get("sku") or it.get("productId") or it.get("id") or it.get("code"),
            it.get("name") or it.get("productName"),
            it.get("qty") or it.get("quantity") or it.get("amount") or 1,
            it.get("price") or it.get("unitPrice") or it.get("unit_price"),
        )
        if row:
            items.append(row)
    return _pack(body.get("orderId") or body.get("id") or body.get("external_order_id"), items)


def normalize_posbistro(body: dict[str, Any]) -> dict[str, Any]:
    lines = body.get("lines") or body.get("items") or body.get("positions") or []
    items = []
    for it in lines if isinstance(lines, list) else []:
        if not isinstance(it, dict):
            continue
        row = _item(
            it.get("plu") or it.get("sku") or it.get("product_code") or it.get("id"),
            it.get("name"),
            it.get("quantity") or it.get("qty") or 1,
            it.get("unit_price") or it.get("price"),
        )
        if row:
            items.append(row)
    return _pack(body.get("receipt_id") or body.get("order_id") or body.get("id"), items)


def normalize_dotykacka(body: dict[str, Any]) -> dict[str, Any]:
    order = body.get("order") if isinstance(body.get("order"), dict) else body
    items_raw = order.get("items") or order.get("products") or []
    items = []
    for it in items_raw if isinstance(items_raw, list) else []:
        if not isinstance(it, dict):
            continue
        row = _item(
            it.get("productId") or it.get("id") or it.get("sku"),
            it.get("name"),
            it.get("quantity") or it.get("qty") or 1,
            it.get("price") or it.get("unitPrice"),
        )
        if row:
            items.append(row)
    return _pack(order.get("id") or body.get("id"), items)


def normalize_softpos(body: dict[str, Any]) -> dict[str, Any]:
    items_raw = body.get("items") or body.get("lines") or []
    items = []
    for it in items_raw if isinstance(items_raw, list) else []:
        if not isinstance(it, dict):
            continue
        row = _item(
            it.get("code") or it.get("sku") or it.get("plu"),
            it.get("name"),
            it.get("amount") or it.get("quantity") or it.get("qty") or 1,
            it.get("price_netto") or it.get("price") or it.get("unit_price"),
        )
        if row:
            items.append(row)
    return _pack(body.get("sale_id") or body.get("id"), items)


def normalize_ipos(body: dict[str, Any]) -> dict[str, Any]:
    positions = body.get("positions") or body.get("items") or []
    items = []
    for it in positions if isinstance(positions, list) else []:
        if not isinstance(it, dict):
            continue
        row = _item(
            it.get("externalId") or it.get("sku") or it.get("id"),
            it.get("name"),
            it.get("qty") or it.get("quantity") or 1,
            it.get("price") or it.get("unitPrice"),
        )
        if row:
            items.append(row)
    return _pack(body.get("transactionId") or body.get("id"), items)


def normalize_poster(body: dict[str, Any]) -> dict[str, Any]:
    products = body.get("products") or body.get("items") or []
    items = []
    for it in products if isinstance(products, list) else []:
        if not isinstance(it, dict):
            continue
        price = it.get("price")
        # Poster często w groszach
        price_pln = None
        pf = _f(price)
        if pf is not None:
            price_pln = pf / 100.0 if pf > 200 else pf
        row = _item(
            it.get("product_id") or it.get("sku") or it.get("id"),
            it.get("product_name") or it.get("name"),
            it.get("count") or it.get("quantity") or 1,
            price_pln,
        )
        if row:
            items.append(row)
    return _pack(body.get("transaction_id") or body.get("id"), items)


def normalize_restimo(body: dict[str, Any]) -> dict[str, Any]:
    items_raw = body.get("items") or body.get("products") or []
    items = []
    for it in items_raw if isinstance(items_raw, list) else []:
        if not isinstance(it, dict):
            continue
        row = _item(
            it.get("sku") or it.get("externalId") or it.get("id"),
            it.get("name"),
            it.get("quantity") or it.get("qty") or 1,
            it.get("unitPrice") or it.get("price"),
        )
        if row:
            items.append(row)
    return _pack(body.get("orderId") or body.get("id"), items)


def normalize_s4h(body: dict[str, Any]) -> dict[str, Any]:
    pozycje = body.get("pozycje") or body.get("items") or body.get("lines") or []
    items = []
    for it in pozycje if isinstance(pozycje, list) else []:
        if not isinstance(it, dict):
            continue
        row = _item(
            it.get("plu") or it.get("kod") or it.get("sku") or it.get("code"),
            it.get("nazwa") or it.get("name"),
            it.get("ilosc") or it.get("quantity") or it.get("qty") or 1,
            it.get("cena") or it.get("price"),
        )
        if row:
            items.append(row)
    return _pack(body.get("dokument") or body.get("id") or body.get("external_order_id"), items)


_NORMALIZERS = {
    "generic": normalize_generic,
    "gopos": normalize_gopos,
    "posbistro": normalize_posbistro,
    "dotykacka": normalize_dotykacka,
    "softpos": normalize_softpos,
    "ipos": normalize_ipos,
    "poster": normalize_poster,
    "restimo": normalize_restimo,
    "s4h": normalize_s4h,
}


def normalize_pos_payload(provider: Optional[str], body: Any) -> dict[str, Any]:
    """Zwraca kanoniczny dict. Nieznany provider → generic + auto-detect."""
    if not isinstance(body, dict):
        return {"external_order_id": None, "items": []}

    pid = (provider or body.get("provider") or "generic").strip().lower()
    if pid in _NORMALIZERS:
        return _NORMALIZERS[pid](body)

    # Auto-heurystyka gdy brak provider
    if "pozycje" in body:
        return normalize_s4h(body)
    if "lines" in body and ("receipt_id" in body or any(
        isinstance(x, dict) and "plu" in x for x in (body.get("lines") or [])
    )):
        return normalize_posbistro(body)
    if "products" in body and ("orderId" in body or "transaction_id" in body):
        if "transaction_id" in body:
            return normalize_poster(body)
        return normalize_gopos(body)
    if isinstance(body.get("order"), dict):
        return normalize_dotykacka(body)
    if "positions" in body:
        return normalize_ipos(body)
    return normalize_generic(body)
