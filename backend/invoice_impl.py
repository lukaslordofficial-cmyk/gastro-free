"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `invoice_impl`."""
from __future__ import annotations

from culinary_units import convert as _convert
from inventory_invoice_match import normalize_invoice_line_name as _normalize_invoice_line_name
from pl_fuzzy_norm import norm_pl as _norm_pl
from supabase_rest import sb_get
from supabase_rest import sb_patch
from supabase_rest import sb_post
from typing import Optional
from warehouse_category_guess import expiry_status as _expiry_status
import httpx
import re
from app_core import _current_year_month, get_account_key, logger
from catalog_offer_impl import _has_catalog_extra_cols
from inventory_match import _find_inventory_duplicate, _guess_category_free, _load_user_inventory_categories, _resolve_category_id_cached
from matching_utils import _inventory_names_same_product, _norm
from onboard_impl import _ensure_warehouse_categories
from pos_availability import _recompute_menu_availability



async def _upsert_supplier_catalog_from_invoice(
    client: httpx.AsyncClient,
    supplier_id: str,
    products: list[dict],
) -> int:
    """Dodaje/aktualizuje pozycje faktury w supplier_catalog danego dostawcy."""
    if not supplier_id or not products:
        return 0
    has_extra = await _has_catalog_extra_cols(client)
    existing = await sb_get(
        client,
        "supplier_catalog",
        params={"select": "id,name,sort_order", "supplier_id": f"eq.{supplier_id}"},
    ) or []
    by_name = {_norm(r["name"]): r for r in existing}
    max_sort = max((int(r.get("sort_order") or 0) for r in existing), default=0)
    saved = 0
    for p in products:
        name = (p.get("product_name") or "").strip()
        if not name:
            continue
        price = float(p.get("price_netto") or 0)
        unit = (p.get("unit") or "szt").strip() or "szt"
        variant = unit or name
        payload: dict = {
            "supplier_id": supplier_id,
            "name": name,
            "variant": variant,
            "volume_label": "",
            "price_pln": price,
            "unit_count": 1,
            "liters_total": 0,
        }
        if has_extra:
            payload["unit"] = unit
        match = by_name.get(_norm(name))
        try:
            if match:
                upd = {"price_pln": price, "variant": variant}
                if has_extra:
                    upd["unit"] = unit
                await sb_patch(client, "supplier_catalog", {"id": f"eq.{match['id']}"}, upd)
            else:
                max_sort += 1
                payload["sort_order"] = max_sort
                row = await sb_post(client, "supplier_catalog", payload)
                if row:
                    by_name[_norm(name)] = (row[0] if isinstance(row, list) else row)
            saved += 1
        except httpx.HTTPStatusError:
            continue
    return saved


async def _save_invoice(client: httpx.AsyncClient, supplier_id: str, supplier_name: str,
                        products: list[dict], total: float,
                        destination: str = "inventory") -> dict:
    """Zapis faktury: magazyn / koszt zmienny / koszt stały — zależnie od destination.
    Przy inventory: opcjonalne partie dat ważności → warehouse_inventory + invoices."""
    warnings: list[str] = []
    dest = (destination or "inventory").strip().lower()
    if dest not in ("inventory", "variable_cost", "fixed_cost"):
        dest = "inventory"

    updated: list[dict] = []
    created: list[dict] = []
    batches_saved = 0
    cost_id = None
    invoice_id: Optional[str] = None

    if dest == "inventory":
        # Nagłówek faktury (best-effort — tabela może nie istnieć przed migracją)
        try:
            inv_row = await sb_post(client, "invoices", {
                "supplier_id": supplier_id or None,
                "supplier_name": supplier_name or None,
                "total_cost": float(total or 0),
                "note": "Skan faktury AI",
            })
            invoice_id = (inv_row[0] if isinstance(inv_row, list) else inv_row).get("id")
        except Exception as e:
            warnings.append(f"Tabela invoices niedostępna (uruchom migrację ADD_INVOICE_EXPIRY_BATCHES): {e}")
            invoice_id = None

        cat_cache: dict = {}
        await _ensure_warehouse_categories(client)
        user_cats = await _load_user_inventory_categories(client)
        cat_cache["_rows"] = list(user_cats)
        for r in user_cats:
            cat_cache[_norm(r["name"])] = r["id"]
            cat_cache[_norm_pl(r["name"])] = r["id"]
        cat_cache["_max_sort"] = max((int(r.get("sort_order") or 0) for r in user_cats), default=0)
        cat_cache["_loaded"] = True

        cat_id_to_name = {str(c["id"]): c["name"] for c in user_cats if c.get("id")}
        # Tylko aktywne pozycje tenanta — soft-delete / obce konta nie połykają dostaw z faktury.
        try:
            inv_all = await sb_get(client, "inventory_items", params={
                "select": "id,name,quantity,unit,unit_cost,category_id,is_active",
                "is_active": "eq.true",
                "limit": "5000",
            }) or []
        except httpx.HTTPStatusError as e:
            txt = e.response.text or ""
            if "is_active" in txt:
                inv_all = await sb_get(client, "inventory_items", params={
                    "select": "id,name,quantity,unit,unit_cost,category_id",
                    "limit": "5000",
                }) or []
            else:
                raise
        inv_rows = [r for r in inv_all if r.get("is_active") is not False]

        ak = (get_account_key() or "").strip()
        for p in products:
            name = _normalize_invoice_line_name(p.get("product_name") or "")
            if not name:
                continue
            qty = float(p.get("quantity") or 0)
            unit = (p.get("unit") or "szt").strip() or "szt"
            price = float(p.get("price_netto") or 0)
            ai_cat = (p.get("category") or "").strip() or "Inne"
            alert_days = p.get("alert_days") or [7, 3, 1]
            if not isinstance(alert_days, list) or not alert_days:
                alert_days = [7, 3, 1]
            alert_days = [int(x) for x in alert_days if str(x).isdigit() or isinstance(x, (int, float))]
            if not alert_days:
                alert_days = [7, 3, 1]

            inv = _find_inventory_duplicate(name, inv_rows, threshold=88, for_invoice=True)
            # Pas bezpieczeństwa: nigdy nie zwiększaj „Ser” gdy faktura ma mozzarella/feta/…
            if inv and not _inventory_names_same_product(name, str(inv.get("name") or "")):
                warnings.append(
                    f"„{name}”: nie scalono z „{inv.get('name')}” — dodano jako nowy produkt."
                )
                inv = None
            item_id: Optional[str] = None
            if inv:
                item_id = str(inv["id"])
                conv = _convert(qty, unit, inv["unit"])
                delta = conv if conv is not None else qty
                if conv is None and _norm(unit) != _norm(inv["unit"]):
                    warnings.append(f"{name}: dodano {qty} {unit} bez konwersji do {inv['unit']} (połączono z „{inv['name']}”).")
                new_qty = float(inv["quantity"] or 0) + float(delta)
                patch_payload: dict = {"quantity": new_qty, "is_active": True}
                # odśwież unit_cost gdy znamy cenę z faktury
                if price > 0:
                    patch_payload["unit_cost"] = price
                # jeśli produkt był w „Inne” / bez kategorii — popraw kategorię
                neighbor_cat = cat_id_to_name.get(str(inv.get("category_id") or ""))
                guessed = _guess_category_free(
                    name, ai_category=ai_cat, user_categories=user_cats,
                    neighbor_category=neighbor_cat if neighbor_cat and _norm(neighbor_cat) != "inne" else None,
                )
                if guessed and _norm(guessed) != "inne":
                    if not neighbor_cat or _norm(neighbor_cat) == "inne":
                        new_cat_id = await _resolve_category_id_cached(client, guessed, cat_cache)
                        if new_cat_id:
                            patch_payload["category_id"] = new_cat_id
                            inv["category_id"] = new_cat_id
                try:
                    await sb_patch(
                        client, "inventory_items", {"id": f"eq.{item_id}"},
                        {**patch_payload, "default_alert_days": alert_days},
                    )
                except httpx.HTTPStatusError:
                    # bez default_alert_days / unit_cost jeśli kolumna nie istnieje
                    soft = {k: v for k, v in patch_payload.items() if k in ("quantity", "category_id", "unit_cost")}
                    try:
                        await sb_patch(client, "inventory_items", {"id": f"eq.{item_id}"}, soft)
                    except httpx.HTTPStatusError:
                        await sb_patch(client, "inventory_items", {"id": f"eq.{item_id}"}, {"quantity": new_qty})
                updated.append({
                    "name": inv["name"],
                    "added": float(delta),
                    "unit": inv["unit"],
                    "new_quantity": new_qty,
                    "merged_from": name if _norm(name) != _norm(inv["name"]) else None,
                })
                inv["quantity"] = new_qty
                if price > 0:
                    inv["unit_cost"] = price
            else:
                guessed = _guess_category_free(
                    name, ai_category=ai_cat, user_categories=user_cats,
                )
                category = guessed
                cat_id = await _resolve_category_id_cached(client, category, cat_cache)
                payload = {
                    "name": name, "quantity": qty, "unit": unit,
                    "min_quantity": 0, "unit_cost": price, "category_id": cat_id,
                    "is_combo_polprodukt": False, "safety_buffer_percent": 20,
                    "default_alert_days": alert_days,
                    "is_active": True,
                }
                if ak and ak != "default":
                    payload["account_key"] = ak
                try:
                    row = await sb_post(client, "inventory_items", payload)
                except httpx.HTTPStatusError as e:
                    body = e.response.text or ""
                    drop_keys = (
                        "default_alert_days", "safety_buffer_percent",
                        "is_combo_polprodukt", "min_quantity", "account_key",
                    )
                    dropped = False
                    for key in drop_keys:
                        if key in payload and key in body:
                            payload.pop(key, None)
                            dropped = True
                    if dropped:
                        try:
                            row = await sb_post(client, "inventory_items", payload)
                        except httpx.HTTPStatusError as e2:
                            try:
                                minimal = {
                                    "name": name, "quantity": qty, "unit": unit,
                                    "is_active": True,
                                }
                                if ak and ak != "default" and "account_key" not in (e2.response.text or ""):
                                    minimal["account_key"] = ak
                                row = await sb_post(client, "inventory_items", minimal)
                            except httpx.HTTPStatusError as e3:
                                warnings.append(f"{name}: nie dodano do magazynu ({e3.response.text[:80]}).")
                                continue
                    else:
                        try:
                            soft = {
                                "name": name, "quantity": qty, "unit": unit,
                                "unit_cost": price, "is_active": True,
                            }
                            if ak and ak != "default":
                                soft["account_key"] = ak
                            row = await sb_post(client, "inventory_items", soft)
                        except httpx.HTTPStatusError:
                            warnings.append(f"{name}: nie dodano do magazynu ({body[:80]}).")
                            continue
                item_id = str((row[0] if isinstance(row, list) else row).get("id"))
                created.append({"name": name, "quantity": qty, "unit": unit, "category": category})
                new_row = {"id": item_id, "name": name, "quantity": qty, "unit": unit, "category_id": cat_id, "unit_cost": price, "is_active": True}
                inv_rows.append(new_row)

            # Partie dat ważności
            raw_batches = p.get("batches") or []
            if isinstance(raw_batches, list):
                for b in raw_batches:
                    if not isinstance(b, dict):
                        continue
                    bqty = float(b.get("quantity") or 0)
                    edate = str(b.get("expiration_date") or "").strip()
                    if bqty <= 0 or not re.match(r"^\d{4}-\d{2}-\d{2}$", edate):
                        continue
                    status = _expiry_status(edate)
                    # Widen warning window to 7 days for invoice batches
                    try:
                        from datetime import date as _date
                        exp = _date.fromisoformat(edate)
                        if 0 <= (exp - _date.today()).days <= 7 and status == "fresh":
                            status = "warning"
                    except Exception:
                        pass
                    batch_payload = {
                        "restaurant_id": None,
                        "inventory_item_id": item_id,
                        "invoice_id": invoice_id,
                        "product_name": name,
                        "quantity": bqty,
                        "unit": unit,
                        "expiration_date": edate,
                        "status": status,
                        "alert_triggers": alert_days,
                        "confidence_score": None,
                        "source": "invoice_review",
                    }
                    try:
                        await sb_post(client, "warehouse_inventory", batch_payload)
                        batches_saved += 1
                    except httpx.HTTPStatusError as e:
                        # retry bez nowych kolumn
                        for drop in ("invoice_id", "alert_triggers"):
                            batch_payload.pop(drop, None)
                        try:
                            await sb_post(client, "warehouse_inventory", batch_payload)
                            batches_saved += 1
                        except Exception:
                            warnings.append(
                                f"{name}: nie zapisano partii {edate} "
                                f"(migracja ADD_WAREHOUSE_INVENTORY_EXPIRY / ADD_INVOICE_EXPIRY_BATCHES). "
                                f"{(e.response.text or '')[:60]}"
                            )

        if total > 0:
            cost_name = f"Faktura — {supplier_name}".strip(" —") or "Zakup towaru (faktura)"
            line_payload = {
                "v": 1,
                "kind": "invoice_lines",
                "supplier_id": supplier_id,
                "supplier_name": supplier_name,
                "total": float(total or 0),
                "lines": [
                    {
                        "name": (p.get("product_name") or "").strip(),
                        "qty": float(p.get("quantity") or 0),
                        "unit": (p.get("unit") or "szt").strip(),
                        "price_netto": float(p.get("price_netto") or 0),
                    }
                    for p in products
                    if (p.get("product_name") or "").strip()
                ],
            }
            try:
                import json as _json
                note_body = (
                    f"Skan faktury · supplier:{supplier_id}\n"
                    f"GM_INVOICE_LINES:{_json.dumps(line_payload, ensure_ascii=False)}"
                )
            except Exception:
                note_body = f"Skan faktury · supplier:{supplier_id}"
            try:
                cost_row = await sb_post(client, "variable_cost_entries", {
                    "year_month": _current_year_month(),
                    "type": "materials",
                    "name": cost_name,
                    "amount_pln": total,
                    "note": note_body,
                })
                cost_id = (cost_row[0] if isinstance(cost_row, list) else cost_row)["id"]
            except httpx.HTTPStatusError as e:
                try:
                    cost_row = await sb_post(client, "variable_cost_entries", {
                        "year_month": _current_year_month(),
                        "type": "other",
                        "name": cost_name,
                        "amount_pln": total,
                    })
                    cost_id = (cost_row[0] if isinstance(cost_row, list) else cost_row)["id"]
                except httpx.HTTPStatusError:
                    warnings.append(f"Nie udało się dopisać kosztu: {e.response.text[:80]}")

        # Katalog własny dostawcy — produkty z faktury (nowy lub istniejący dostawca)
        if supplier_id and (updated or created or products):
            try:
                catalog_saved = await _upsert_supplier_catalog_from_invoice(
                    client, supplier_id, products
                )
                if catalog_saved:
                    warnings.append(
                        f"Dodano/zaktualizowano {catalog_saved} poz. w katalogu dostawcy."
                    )
            except Exception as ce:  # noqa: BLE001
                warnings.append(f"Katalog dostawcy: nie udało się zsynchronizować ({ce}).")

        if updated or created:
            try:
                await _recompute_menu_availability(client)
            except Exception as e:
                logger.debug(f"_recompute_menu_availability skipped: {e}")

    elif dest == "variable_cost":
        if total <= 0:
            # suma z pozycji jeśli total pusty
            total = sum(float(p.get("quantity") or 0) * float(p.get("price_netto") or 0) for p in products)
        cost_name = f"Faktura (koszt zmienny) — {supplier_name}".strip(" —") or "Koszt zmienny (skan)"
        try:
            import json as _json
            line_payload = {
                "v": 1,
                "kind": "invoice_lines",
                "supplier_id": supplier_id,
                "supplier_name": supplier_name,
                "total": float(total or 0),
                "lines": [
                    {
                        "name": (p.get("product_name") or "").strip(),
                        "qty": float(p.get("quantity") or 0),
                        "unit": (p.get("unit") or "szt").strip(),
                        "price_netto": float(p.get("price_netto") or 0),
                    }
                    for p in products
                    if (p.get("product_name") or "").strip()
                ],
            }
            note_body = (
                f"Skan faktury → koszt zmienny · supplier:{supplier_id}\n"
                f"GM_INVOICE_LINES:{_json.dumps(line_payload, ensure_ascii=False)}"
            )
        except Exception:
            note_body = f"Skan faktury → koszt zmienny · supplier:{supplier_id} · {len(products)} poz."
        try:
            cost_row = await sb_post(client, "variable_cost_entries", {
                "year_month": _current_year_month(),
                "type": "materials",
                "name": cost_name,
                "amount_pln": float(total),
                "note": note_body,
            })
            cost_id = (cost_row[0] if isinstance(cost_row, list) else cost_row)["id"]
        except httpx.HTTPStatusError as e:
            warnings.append(f"Nie udało się dopisać kosztu zmiennego: {e.response.text[:80]}")

    elif dest == "fixed_cost":
        if total <= 0:
            total = sum(float(p.get("quantity") or 0) * float(p.get("price_netto") or 0) for p in products)
        cost_name = f"Faktura (koszt stały) — {supplier_name}".strip(" —") or "Koszt stały (skan)"
        try:
            cost_row = await sb_post(client, "fixed_costs", {
                "year_month": _current_year_month(),
                "type": "other",
                "name": cost_name,
                "amount_pln": float(total),
                "note": f"Skan faktury → koszt stały · supplier:{supplier_id} · {len(products)} poz.",
            })
            cost_id = (cost_row[0] if isinstance(cost_row, list) else cost_row)["id"]
        except httpx.HTTPStatusError as e:
            warnings.append(f"Nie udało się dopisać kosztu stałego: {e.response.text[:80]}")

    return {
        "supplier_id": supplier_id,
        "supplier_name": supplier_name,
        "destination": dest,
        "items_updated": len(updated),
        "items_created": len(created),
        "batches_saved": batches_saved if dest == "inventory" else 0,
        "invoice_id": invoice_id,
        "updated": updated,
        "created": created,
        "total_amount": total,
        "cost_id": cost_id,
        "warnings": warnings,
        "products_on_invoice": len(
            [p for p in products if (p.get("product_name") or "").strip()]
        ) if dest == "inventory" else 0,
    }

__all__ = ['_save_invoice', '_upsert_supplier_catalog_from_invoice']
