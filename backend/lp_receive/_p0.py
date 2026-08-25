from __future__ import annotations

from datetime import datetime
from datetime import timezone
from typing import Any
from typing import Optional
import httpx
import logging

"""
Odbiór paczki LP w restauracji → magazyn + koszt zmienny (idempotentne).

Wywoływane gdy:
  - Furgonetka zgłosi tracking_state=delivered (sync_order_tracking),
  - restauracja kliknie „Odebrałem paczkę”.
"""

logger = logging.getLogger("lp.receive")

RECEIVED_TAG = "warehouse_received:1"
LP_ORDER_PREFIX = "LP_ORDER:"

_INV_OPTIONAL_KEYS = (
    "default_alert_days",
    "safety_buffer_percent",
    "is_combo_polprodukt",
    "min_quantity",
    "category_id",
    "unit_cost",
    "is_active",
)

_CAT_COLORS = {
    "Mięso i wędliny": "#DC2626",
    "Warzywa i owoce": "#16A34A",
    "Nabiał": "#F59E0B",
    "Pieczywo": "#78716C",
    "Napoje": "#0891B2",
    "Alkohole": "#7C3AED",
    "Przyprawy": "#D97706",
    "Inne": "#94A3B8",
}


def _already_received(order: dict[str, Any]) -> bool:
    if order.get("warehouse_received_at"):
        return True
    return RECEIVED_TAG in str(order.get("notes") or "")


def _norm_name(s: str) -> str:
    return " ".join((s or "").lower().split())


def producer_category_name(raw: Any) -> Optional[str]:
    """PostgREST embed: obiekt, lista obiektów albo zwykły string."""
    if isinstance(raw, dict):
        name = raw.get("name")
        return str(name).strip() if name else None
    if isinstance(raw, list) and raw:
        return producer_category_name(raw[0])
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


def _map_lp_category_hint(raw: Optional[str], title: str) -> str:
    """Hint kategorii magazynu — nazwy jak w Magazynie (WAREHOUSE_CATEGORIES)."""
    blob = f"{raw or ''} {title or ''}".lower()
    rules = [
        ("Warzywa i owoce", (
            "warzyw", "owoc", "sałat", "salat", "pomidor", "ogórek", "ogorek",
            "ziemniak", "cebula", "marchew", "kapust",
        )),
        ("Mięso i wędliny", (
            "mięs", "mies", "woł", "wol", "wieprz", "kurczak", "indyk", "wołow",
            "schab", "kiełbas", "kielbas", "drób", "drob",
        )),
        ("Nabiał", (
            "nabiał", "nabial", "ser ", "mleko", "śmiet", "smiet", "jogurt",
            "masło", "maslo", "jajka", "jajko",
        )),
        ("Pieczywo", ("pieczyw", "chleb", "bułk", "bulk", "bagiet")),
        ("Napoje", ("napoj", "sok", "woda", "lemoniad")),
        ("Alkohole", ("piwo", "wino", "alkohol")),
        ("Przyprawy", ("przypraw", "sól", "sol ", "pieprz", "zioła", "ziola", "oliwa", "ocet")),
        ("Inne", ("przetwór", "przetwor", "konserw", "dżem", "dzem", "miód", "miod", "pasztet", "smalec")),
    ]
    for cat, keys in rules:
        if any(k in blob for k in keys):
            return cat
    return "Inne"


def order_paid_total_pln(order: dict[str, Any], materials_total: float = 0.0) -> float:
    """Cała kwota zapłacona przez restaurację (produkty + kurier + opłata platformy)."""
    try:
        total_paid = float(order.get("total_price") or 0)
    except (TypeError, ValueError):
        total_paid = 0.0
    try:
        delivery_cost = float(order.get("delivery_cost") or order.get("shipping_cost") or 0)
    except (TypeError, ValueError):
        delivery_cost = 0.0
    try:
        platform_fee = float(order.get("platform_fee") or 0)
    except (TypeError, ValueError):
        platform_fee = 0.0
    try:
        producer_amount = float(order.get("producer_amount") or 0)
    except (TypeError, ValueError):
        producer_amount = 0.0

    total = round(total_paid, 2)
    if total <= 0 and producer_amount > 0:
        total = round(producer_amount + delivery_cost + platform_fee, 2)
    if total <= 0:
        total = round(materials_total + delivery_cost + platform_fee, 2)
    if total <= 0:
        total = round(materials_total, 2)
    return total


def lp_order_note_tag(order_id: str) -> str:
    return f"{LP_ORDER_PREFIX}{(order_id or '').strip()}"


def _row_id(row: Any) -> Optional[str]:
    if not row:
        return None
    obj = row[0] if isinstance(row, list) else row
    if isinstance(obj, dict) and obj.get("id"):
        return str(obj["id"])
    return None


def _http_body(exc: BaseException) -> str:
    resp = getattr(exc, "response", None)
    return str(getattr(resp, "text", None) or exc)


async def _post_dropping_optional(sb_post, client, table: str, payload: dict[str, Any], optional_keys: tuple[str, ...]):
    """Insert z retry: zrzuca kolumny wymienione w błędzie PostgREST, potem minimalny zestaw."""
    try:
        return await sb_post(client, table, payload)
    except httpx.HTTPStatusError as e:
        body = _http_body(e)
        nxt = dict(payload)
        dropped = False
        for key in optional_keys:
            if key in nxt and key in body:
                nxt.pop(key, None)
                dropped = True
        if dropped:
            try:
                return await sb_post(client, table, nxt)
            except httpx.HTTPStatusError as e2:
                body = _http_body(e2)
        core_keep = {"name", "quantity", "unit", "year_month", "type", "amount_pln", "note", "is_active"}
        minimal = {k: v for k, v in payload.items() if k in core_keep or k not in optional_keys}
        if "is_active" in payload:
            minimal["is_active"] = payload["is_active"]
        try:
            return await sb_post(client, table, minimal)
        except httpx.HTTPStatusError:
            logger.warning("LP post %s failed: %s", table, body[:240])
            raise


async def _resolve_category_id(client, sb_get, sb_post, cat_name: str, cache: dict[str, Any]) -> Optional[str]:
    name = (cat_name or "Inne").strip() or "Inne"
    key = _norm_name(name)
    if key in cache:
        return cache[key]
    rows = cache.get("_rows")
    if rows is None:
        try:
            rows = await sb_get(client, "inventory_categories", params={
                "select": "id,name,sort_order",
                "limit": "200",
            }) or []
        except Exception:
            rows = []
        cache["_rows"] = rows
        for r in rows:
            cache[_norm_name(str(r.get("name") or ""))] = r.get("id")
    if key in cache and cache[key]:
        return cache[key]
    max_sort = max((int(r.get("sort_order") or 0) for r in (cache.get("_rows") or [])), default=0) + 1
    try:
        created = await sb_post(client, "inventory_categories", {
            "name": name,
            "color": _CAT_COLORS.get(name, "#94A3B8"),
            "sort_order": max_sort,
        })
        cid = _row_id(created)
        if cid:
            cache[key] = cid
            cache.setdefault("_rows", []).append({"id": cid, "name": name, "sort_order": max_sort})
            return cid
    except Exception:
        logger.debug("LP category create skipped for %s", name, exc_info=True)
    return cache.get(_norm_name("Inne"))


async def _find_existing_lp_cost(
    client,
    sb_get,
    *,
    order_id: str,
    company: str,
    total: float,
) -> Optional[dict[str, Any]]:
    tag = lp_order_note_tag(order_id)
    try:
        tagged = await sb_get(client, "variable_cost_entries", params={
            "select": "id,note,name,amount_pln",
            "note": f"ilike.*{tag}*",
            "limit": "5",
        }) or []
        if tagged:
            return tagged[0]
    except Exception:
        logger.debug("LP cost lookup by tag skipped", exc_info=True)
    cost_name = f"Zakup LP — {company}"[:120]
    try:
        named = await sb_get(client, "variable_cost_entries", params={
            "select": "id,note,name,amount_pln",
            "name": f"eq.{cost_name}",
            "year_month": f"eq.{datetime.now(timezone.utc).strftime('%Y-%m')}",
            "limit": "10",
        }) or []
        for row in named:
            try:
                amt = round(float(row.get("amount_pln") or 0), 2)
            except (TypeError, ValueError):
                amt = 0.0
            if abs(amt - round(float(total), 2)) <= 0.05:
                return row
            note = str(row.get("note") or "")
            if tag in note:
                return row
    except Exception:
        logger.debug("LP cost lookup by name skipped", exc_info=True)
    return None

__all__ = ['LP_ORDER_PREFIX', 'RECEIVED_TAG', '_CAT_COLORS', '_INV_OPTIONAL_KEYS', '_already_received', '_find_existing_lp_cost', '_http_body', '_map_lp_category_hint', '_norm_name', '_post_dropping_optional', '_resolve_category_id', '_row_id', 'logger', 'lp_order_note_tag', 'order_paid_total_pln', 'producer_category_name']
