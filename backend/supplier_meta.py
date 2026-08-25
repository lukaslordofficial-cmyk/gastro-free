"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `supplier_meta`."""
from __future__ import annotations

from pl_fuzzy_norm import norm_pl as _norm_pl
from supabase_rest import sb_get
from supabase_rest import sb_patch
from supabase_rest import sb_post
from supplier_scan_meta import build_supplier_patch_from_scan
from supplier_scan_meta import nip_digits as _nip_digits
from supplier_scan_meta import normalize_supplier_scan_meta as _normalize_supplier_scan_meta
from supplier_scan_meta import supplier_meta_preview
from typing import Optional
import httpx
import re
from app_core import logger
from matching_utils import _norm



_inv_synonyms_col: Optional[bool] = None


async def _has_inventory_synonyms(client: httpx.AsyncClient) -> bool:
    """True jeśli inventory_items ma kolumnę `synonyms` (JSONB/lista tekstów)."""
    global _inv_synonyms_col
    if _inv_synonyms_col is not None:
        return _inv_synonyms_col
    try:
        await sb_get(client, "inventory_items", params={"select": "synonyms", "limit": "1"})
        _inv_synonyms_col = True
    except Exception:
        _inv_synonyms_col = False
    return _inv_synonyms_col


async def _load_matchable_terms(client: httpx.AsyncClient) -> dict:
    """Ładuje wszystkie normalized-terms z magazynu + składników aktywnych receptur.

    Zwraca:
        {
          "inv_terms": {norm_key: original_name, ...},
          "recipe_terms": {norm_key: original_name, ...},
        }
    Uwaga: recipe_terms zawiera tylko składniki potraw, które są `is_active=true`
    w `menu_items` (jeśli tabela ma tę kolumnę; w przeciwnym razie — wszystkie).
    """
    inv_terms: dict[str, str] = {}
    recipe_terms: dict[str, str] = {}

    # 1) Magazyn (name + opcjonalnie synonyms)
    has_syn = await _has_inventory_synonyms(client)
    select = "id,name,synonyms" if has_syn else "id,name"
    try:
        inv_rows = await sb_get(client, "inventory_items",
                                params={"select": select, "limit": "5000"}) or []
    except Exception as e:
        logger.warning(f"_load_matchable_terms: inventory_items load failed: {e}")
        inv_rows = []
    for r in inv_rows:
        name = (r.get("name") or "").strip()
        if name:
            k = _norm_pl(name)
            if k:
                inv_terms.setdefault(k, name)
        if has_syn:
            syns = r.get("synonyms") or []
            if isinstance(syns, str):
                # Czasami zapisane jako CSV
                syns = [s for s in re.split(r"[,;|]", syns) if s.strip()]
            for s in syns or []:
                s = (str(s) or "").strip()
                if not s:
                    continue
                k = _norm_pl(s)
                if k:
                    inv_terms.setdefault(k, name)

    # 2) Składniki aktywnych receptur
    # Najpierw pobierz aktywne dania (jeśli kolumna is_active istnieje).
    active_ids: Optional[set[str]] = None
    try:
        menu_rows = await sb_get(client, "menu_items",
                                 params={"select": "id", "is_active": "eq.true", "limit": "5000"})
        active_ids = {r["id"] for r in (menu_rows or [])}
    except Exception:
        # Kolumna is_active może nie istnieć — bierzemy wtedy wszystkie potrawy
        active_ids = None

    try:
        # Uwaga: recipe_ingredients ma pole ingredient_name (patrz kod _process_dish/_deduct)
        ri = await sb_get(client, "recipe_ingredients",
                          params={"select": "ingredient_name,menu_item_id", "limit": "20000"}) or []
    except Exception as e:
        logger.warning(f"_load_matchable_terms: recipe_ingredients load failed: {e}")
        ri = []

    for r in ri:
        if active_ids is not None and r.get("menu_item_id") not in active_ids:
            continue
        name = (r.get("ingredient_name") or "").strip()
        if not name:
            continue
        k = _norm_pl(name)
        if k:
            recipe_terms.setdefault(k, name)

    return {"inv_terms": inv_terms, "recipe_terms": recipe_terms}


async def _find_or_create_supplier(
    client: httpx.AsyncClient,
    name: Optional[str],
    *,
    nip: Optional[str] = None,
) -> tuple[str, str]:
    """Zwraca (supplier_id, supplier_name). Tworzy dostawcę jeśli nie istnieje.

    Dopasowanie: najpierw NIP (cyfry), potem nazwa (znormalizowana).
    """
    clean = (name or "").strip() or "Nieznany dostawca"
    nip_d = _nip_digits(nip)
    existing = await sb_get(
        client, "suppliers",
        params={"select": "id,name,nip", "limit": "1000"},
    )
    if nip_d and len(nip_d) >= 8:
        for r in (existing or []):
            if _nip_digits(r.get("nip")) == nip_d:
                return r["id"], r["name"]
    for r in (existing or []):
        if _norm(r["name"]) == _norm(clean):
            return r["id"], r["name"]
    colors = ["#2563EB", "#DC2626", "#16A34A", "#D97706", "#7C3AED", "#0891B2"]
    color = colors[len(existing or []) % len(colors)]
    payload: dict = {
        "name": clean, "category": "Dodany ze skanu", "icon_color": color,
    }
    if nip and str(nip).strip():
        payload["nip"] = str(nip).strip()
    row = await sb_post(client, "suppliers", payload)
    created = row[0] if isinstance(row, list) else row
    return created["id"], created["name"]


async def _apply_supplier_scan_meta(
    client: httpx.AsyncClient,
    supplier_id: str,
    meta: Optional[dict],
) -> dict:
    """Inteligentny upsert pól panelu Dostawcy po skanie. Nie nadpisuje pustym."""
    normalized = _normalize_supplier_scan_meta(meta)
    if not any(v is not None for v in normalized.values()):
        return {"updated_fields": [], "supplier_meta": {}}

    select_cols = (
        "id,name,nip,phone,email,contact_person,notes,address,bank_account,"
        "min_order_value,shipping_cost,free_shipping_threshold,lead_time_days"
    )
    rows = None
    try:
        rows = await sb_get(
            client, "suppliers",
            params={"select": select_cols, "id": f"eq.{supplier_id}", "limit": "1"},
        )
    except Exception:
        # Graceful: migracje shipping/lead_time/bank mogą nie być uruchomione
        for cols in (
            "id,name,nip,phone,email,contact_person,notes,"
            "min_order_value,shipping_cost,free_shipping_threshold,lead_time_days",
            "id,name,nip,phone,email,contact_person,notes,min_order_value,shipping_cost,free_shipping_threshold",
            "id,name,nip,phone,email,contact_person,notes,min_order_value",
            "id,name,nip,phone,email,contact_person,notes",
        ):
            try:
                rows = await sb_get(
                    client, "suppliers",
                    params={"select": cols, "id": f"eq.{supplier_id}", "limit": "1"},
                )
                break
            except Exception:
                continue
    if not rows:
        return {"updated_fields": [], "supplier_meta": supplier_meta_preview(normalized)}

    existing = rows[0]
    patch = build_supplier_patch_from_scan(existing, normalized)
    if not patch:
        return {"updated_fields": [], "supplier_meta": supplier_meta_preview(normalized)}

    # Próby zapisu z fallbackiem na brakujące kolumny
    attempts = [dict(patch)]
    if "lead_time_days" in patch:
        p2 = dict(patch)
        del p2["lead_time_days"]
        attempts.append(p2)
    if any(k in patch for k in ("shipping_cost", "free_shipping_threshold")):
        p3 = {k: v for k, v in patch.items()
              if k not in ("shipping_cost", "free_shipping_threshold", "lead_time_days")}
        if p3:
            attempts.append(p3)
    # Tylko podstawowe pola kontaktowe
    p4 = {k: v for k, v in patch.items()
          if k in ("nip", "phone", "email", "contact_person", "notes")}
    if p4 and p4 not in attempts:
        attempts.append(p4)

    saved_keys: list[str] = []
    last_err: Optional[Exception] = None
    for attempt in attempts:
        if not attempt:
            continue
        try:
            await sb_patch(client, "suppliers", {"id": f"eq.{supplier_id}"}, attempt)
            saved_keys = list(attempt.keys())
            last_err = None
            break
        except Exception as e:
            last_err = e
            continue
    if last_err and not saved_keys:
        logger.warning(f"_apply_supplier_scan_meta failed: {last_err}")

    return {
        "updated_fields": saved_keys,
        "supplier_meta": supplier_meta_preview(normalized),
    }

__all__ = ['_apply_supplier_scan_meta', '_find_or_create_supplier', '_has_inventory_synonyms', '_inv_synonyms_col', '_load_matchable_terms']
