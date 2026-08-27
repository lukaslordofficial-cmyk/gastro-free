"""
Voice CRUD v2 — bulk/delete/availability/scale + voice_dispatch_v2.
Wydzielone z server.py. Mutacje wymagają require_tenant_account_key().
"""
from __future__ import annotations

import httpx

from http_ssl import httpx_verify
from supabase_rest import sb_delete, sb_get, sb_patch

_ALL_ROWS = {"id": "not.is.null"}


def _tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


def _fuzzy(query, rows, *, key: str = "name", threshold: int = 55):
    from server import _resolve_by_fuzzy

    return _resolve_by_fuzzy(query, rows, key=key, threshold=threshold)


async def _recompute(client, **kwargs):
    from server import _recompute_menu_availability

    return await _recompute_menu_availability(client, **kwargs)


def _avail_count(result) -> int:
    from server import _availability_changed_count

    return _availability_changed_count(result)


def _cat_matches(row_cat: str, wanted: str, threshold: int = 72) -> bool:
    from server import _cat_matches as _cm

    return _cm(row_cat, wanted, threshold)


async def _menu_id_from_payload(client, p):
    """Zwraca (dish_id, dish_name) z payloadu; fallback ilike po nazwie."""
    dish_id = p.get("dish_id")
    name = p.get("dish_name_resolved") or p.get("dish_name")
    if not dish_id and name:
        rows = await sb_get(client, "menu_items",
                            params={"select": "id,name", "name": f"ilike.%{name}%", "limit": "1"})
        if rows:
            dish_id, name = rows[0]["id"], rows[0]["name"]
    return dish_id, name


async def _exec_bulk_delete_menu(client):
    """Trwałe usunięcie całego menu (bez soft-restore / „przywróć ukryte”)."""
    rows = await sb_get(client, "menu_items", params={"select": "id", "limit": "10000"}) or []
    n = len(rows)
    if n:
        ids = [r["id"] for r in rows if r.get("id")]
        # Najpierw receptury (FK), potem dania.
        for mid in ids:
            try:
                await sb_delete(client, "recipe_ingredients", {"menu_item_id": f"eq.{mid}"})
            except httpx.HTTPStatusError:
                pass
        await sb_delete(client, "menu_items", _ALL_ROWS)
    return {"ok": True, "action": "bulk_delete_menu", "affected": n, "restorable": False,
            "message": f"Usunięto trwale {n} pozycji z menu. Przywrócenie nie jest możliwe."}


async def _exec_restore_menu(client):
    return {
        "ok": False,
        "action": "restore_last_deleted_menu",
        "affected": 0,
        "message": (
            "Przywracanie usuniętego menu zostało wyłączone. "
            "Usunięte dania nie wracają ze skanu ani komendy głosowej — dodaj je ponownie."
        ),
    }


async def _exec_bulk_delete_suppliers(client):
    rows = await sb_get(client, "suppliers", params={"select": "id"}) or []
    n = len(rows)
    ids = [str(r["id"]) for r in rows if r.get("id")]
    if ids:
        # Katalog nie jest w _TENANT_TABLES — NIGDY nie kasuj _ALL_ROWS.
        id_csv = ",".join(ids)
        try:
            await sb_delete(client, "supplier_catalog", {"supplier_id": f"in.({id_csv})"})
        except httpx.HTTPStatusError:
            for sid in ids:
                try:
                    await sb_delete(client, "supplier_catalog", {"supplier_id": f"eq.{sid}"})
                except httpx.HTTPStatusError:
                    pass
        await sb_delete(client, "suppliers", _ALL_ROWS)
    return {"ok": True, "action": "bulk_delete_suppliers", "affected": n,
            "message": f"Usunięto {n} dostawców."}


async def _exec_bulk_delete_inventory(client):
    """Soft-delete: is_active=false (przywracalne). Fallback: twarde usunięcie gdy brak kolumny."""
    try:
        rows = await sb_get(client, "inventory_items", params={
            "select": "id", "is_active": "eq.true", "limit": "10000",
        }) or []
    except httpx.HTTPStatusError:
        rows = await sb_get(client, "inventory_items", params={"select": "id", "limit": "10000"}) or []
        n = len(rows)
        if n:
            await sb_delete(client, "inventory_items", _ALL_ROWS)
        blocked = _avail_count(await _recompute(client))
        return {
            "ok": True, "action": "bulk_delete_inventory", "affected": n,
            "blocked_dishes": blocked, "restorable": False,
            "message": (
                f"Usunięto {n} produktów z magazynu (trwale — baza bez soft-delete). "
                "Przywrócenie niemożliwe."
            ),
        }
    n = len(rows)
    if n:
        await sb_patch(client, "inventory_items", {"is_active": "eq.true"}, {"is_active": False})
    blocked = _avail_count(await _recompute(client))
    return {
        "ok": True, "action": "bulk_delete_inventory", "affected": n,
        "blocked_dishes": blocked, "restorable": True,
        "message": (
            f"Usunięto {n} produktów z magazynu (ukryte). "
            "Powiedz „przywróć magazyn”, aby cofnąć."
        ),
    }


async def _exec_restore_inventory(client):
    try:
        rows = await sb_get(client, "inventory_items", params={
            "select": "id", "is_active": "eq.false", "limit": "10000",
        }) or []
    except httpx.HTTPStatusError:
        return {
            "ok": False, "action": "restore_deleted_inventory", "affected": 0,
            "message": (
                "Nie da się przywrócić magazynu — produkty zostały usunięte trwale "
                "(brak soft-delete). Dodaj je ręcznie lub zeskanuj fakturę."
            ),
        }
    n = len(rows)
    if n:
        await sb_patch(client, "inventory_items", {"is_active": "eq.false"}, {"is_active": True})
    return {
        "ok": True, "action": "restore_deleted_inventory", "affected": n,
        "message": (
            f"Przywrócono {n} produktów magazynu."
            if n else "Brak ukrytych produktów magazynu do przywrócenia."
        ),
    }


async def _exec_bulk_reset_inventory(client):
    rows = await sb_get(client, "inventory_items", params={"select": "id", "limit": "10000"}) or []
    n = len(rows)
    if n:
        await sb_patch(client, "inventory_items", _ALL_ROWS, {"quantity": 0})
    blocked = _avail_count(await _recompute(client))
    return {"ok": True, "action": "bulk_reset_inventory", "affected": n, "blocked_dishes": blocked,
            "message": f"Wyzerowano stany {n} produktów. Zablokowano {blocked} dań (brak składników)."}


async def _exec_delete_menu_item(client, p):
    dish_id, name = await _menu_id_from_payload(client, p)
    if not dish_id:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dania „{name or '?'}” w menu.")
    try:
        await sb_delete(client, "recipe_ingredients", {"menu_item_id": f"eq.{dish_id}"})
    except httpx.HTTPStatusError:
        pass
    await sb_delete(client, "menu_items", {"id": f"eq.{dish_id}"})
    return {"ok": True, "action": "delete_menu_item", "dish_id": dish_id, "restorable": False,
            "message": f"Usunięto trwale danie: {name}."}


async def _exec_delete_supplier(client, p):
    sid = p.get("supplier_name_id") or p.get("supplier_id")
    name = p.get("supplier_name_resolved") or p.get("supplier_name")
    if not sid and name:
        rows = await sb_get(client, "suppliers",
                            params={"select": "id,name", "name": f"ilike.%{name}%", "limit": "1"})
        if rows:
            sid, name = rows[0]["id"], rows[0]["name"]
    if not sid:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dostawcy „{name or '?'}”.")
    try:
        await sb_delete(client, "supplier_catalog", {"supplier_id": f"eq.{sid}"})
    except httpx.HTTPStatusError:
        pass
    await sb_delete(client, "suppliers", {"id": f"eq.{sid}"})
    return {"ok": True, "action": "delete_supplier", "message": f"Usunięto dostawcę: {name}."}


async def _exec_delete_inventory_item(client, p):
    iid = p.get("inventory_id") or p.get("item_name_id")
    name = p.get("item_name_resolved") or p.get("item_name")
    if not iid and name:
        rows = await sb_get(client, "inventory_items",
                            params={"select": "id,name", "name": f"ilike.%{name}%", "limit": "1"})
        if rows:
            iid, name = rows[0]["id"], rows[0]["name"]
    if not iid:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono produktu „{name or '?'}” w magazynie.")
    # Soft-delete jak bulk_delete_inventory — umożliwia „przywróć magazyn”
    try:
        await sb_patch(client, "inventory_items", {"id": f"eq.{iid}"}, {"is_active": False})
        return {
            "ok": True, "action": "delete_inventory_item", "restorable": True,
            "message": f"Usunięto produkt: {name} (ukryty — powiedz „przywróć magazyn”, aby cofnąć).",
        }
    except httpx.HTTPStatusError:
        await sb_delete(client, "inventory_items", {"id": f"eq.{iid}"})
        return {
            "ok": True, "action": "delete_inventory_item", "restorable": False,
            "message": f"Usunięto produkt: {name}.",
        }


async def _exec_toggle_availability(client, p):
    dish_id, name = await _menu_id_from_payload(client, p)
    if not dish_id:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dania „{name or '?'}”.")
    available = bool(p.get("available")) if p.get("available") is not None else False
    await sb_patch(client, "menu_items", {"id": f"eq.{dish_id}"}, {"is_available": available})
    verb = "Włączono" if available else "Wyłączono (zablokowano)"
    return {"ok": True, "action": "toggle_menu_item_availability", "available": available,
            "message": f"{verb} danie: {name}."}


async def _exec_bulk_menu_prices(client, p, mode: str):
    """mode: 'pct' | 'fixed'."""
    category = (p.get("category") or "").strip()
    action = (p.get("action") or "increase").lower()
    sign = -1 if action == "decrease" else 1
    rows = await sb_get(client, "menu_items",
                        params={"select": "id,name,price_pln,category", "is_active": "eq.true"}) or []
    rows = [r for r in rows if _cat_matches(r.get("category", ""), category)]
    if mode == "pct":
        factor = 1 + sign * float(p.get("percentage") or 0) / 100.0
    else:
        delta = sign * float(p.get("amount") or 0)
    changed = []
    for r in rows:
        old = float(r.get("price_pln") or 0)
        new = old * factor if mode == "pct" else old + delta
        new = round(max(0.0, new), 2)
        if new == old:
            continue
        await sb_patch(client, "menu_items", {"id": f"eq.{r['id']}"}, {"price_pln": new})
        changed.append({"name": r["name"], "old": old, "new": new})
    detail = (f"{p.get('percentage')}%" if mode == "pct" else f"{p.get('amount')} zł")
    verb = "Obniżono" if sign < 0 else "Podniesiono"
    scope = f" w kategorii „{category}”" if category else ""
    return {"ok": True, "action": f"bulk_edit_menu_prices_{mode}", "affected": len(changed),
            "changes": changed[:20],
            "message": f"{verb} ceny {len(changed)} dań{scope} o {detail}."}


async def _exec_bulk_inventory_buffers(client, p):
    category = (p.get("category") or "").strip()
    action = (p.get("action") or "increase").lower()
    sign = -1 if action == "decrease" else 1
    pts = sign * float(p.get("percentage") or 0)
    cat_id = None
    if category:
        cats = await sb_get(client, "inventory_categories", params={"select": "id,name"}) or []
        hit, _ = _fuzzy(category, cats, threshold=65)
        cat_id = hit["id"] if hit else None
        if category and not cat_id:
            return {"ok": False, "action": "bulk_edit_inventory_buffers", "affected": 0,
                    "message": f"Nie rozpoznano kategorii magazynu „{category}”."}
    params = {"select": "id,name,safety_buffer_percent,category_id"}
    if cat_id:
        params["category_id"] = f"eq.{cat_id}"
    rows = await sb_get(client, "inventory_items", params=params) or []
    changed = []
    for r in rows:
        old = float(r.get("safety_buffer_percent") or 20)
        new = round(max(10.0, old + pts), 1)
        if new == old:
            continue
        try:
            await sb_patch(client, "inventory_items", {"id": f"eq.{r['id']}"},
                           {"safety_buffer_percent": new})
            changed.append({"name": r["name"], "old": old, "new": new})
        except httpx.HTTPStatusError:
            pass
    verb = "Zmniejszono" if sign < 0 else "Zwiększono"
    scope = f" (kategoria „{category}”)" if category else ""
    return {"ok": True, "action": "bulk_edit_inventory_buffers", "affected": len(changed),
            "changes": changed[:20],
            "message": f"{verb} bufory bezpieczeństwa {len(changed)} produktów{scope} o {abs(pts)} p.p."}


async def _exec_edit_menu_category(client, p):
    dish_id, name = await _menu_id_from_payload(client, p)
    new_cat = (p.get("new_category") or p.get("category") or "").strip()
    if not dish_id:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dania „{name or '?'}”.")
    if not new_cat:
        raise HTTPException(status_code=400, detail="Brak nowej kategorii.")
    await sb_patch(client, "menu_items", {"id": f"eq.{dish_id}"}, {"category": new_cat})
    return {"ok": True, "action": "edit_menu_item_category", "dish_id": dish_id,
            "message": f"Zmieniono kategorię „{name}” → „{new_cat}”."}


async def _exec_rename_menu_item(client, p):
    dish_id, name = await _menu_id_from_payload(client, p)
    new_name = (p.get("new_name") or "").strip()
    if not dish_id:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dania „{name or '?'}”.")
    if not new_name:
        raise HTTPException(status_code=400, detail="Brak nowej nazwy dania.")
    await sb_patch(client, "menu_items", {"id": f"eq.{dish_id}"}, {"name": new_name})
    return {"ok": True, "action": "rename_menu_item", "dish_id": dish_id,
            "message": f"Zmieniono nazwę „{name}” → „{new_name}”."}


async def _exec_scale_recipe(client, p):
    dish_id, name = await _menu_id_from_payload(client, p)
    portions = float(p.get("portions") or 0)
    if not dish_id:
        raise HTTPException(status_code=404, detail=f"Nie znaleziono dania „{name or '?'}”.")
    if portions <= 0:
        raise HTTPException(status_code=400, detail="Podaj liczbę porcji > 0.")
    ings = await sb_get(client, "recipe_ingredients", params={
        "select": "ingredient_name,quantity,unit", "menu_item_id": f"eq.{dish_id}"}) or []
    inv = await sb_get(client, "inventory_items", params={"select": "name,quantity,unit"}) or []
    scaled = []
    for ing in ings:
        need = round(float(ing.get("quantity") or 0) * portions, 2)
        hit, _ = _fuzzy(ing.get("ingredient_name"), inv, threshold=70)
        have = float(hit.get("quantity")) if hit else None
        scaled.append({
            "ingredient_name": ing.get("ingredient_name"),
            "unit": ing.get("unit"),
            "per_portion": float(ing.get("quantity") or 0),
            "total_needed": need,
            "in_stock": have,
            "enough": (have is not None and have >= need),
        })
    missing = [s["ingredient_name"] for s in scaled if not s["enough"]]
    return {"ok": True, "action": "scale_recipe", "dish_id": dish_id, "dish_name": name,
            "portions": portions, "ingredients": scaled, "missing": missing,
            "message": f"Przeliczono „{name}” na {int(portions)} porcji "
                       f"({len(scaled)} składników).{' Braki: ' + ', '.join(missing) if missing else ''}"}


async def voice_dispatch_v2(intent: str, p: dict):
    """Router nowych intencji v2. Zwraca dict wyniku lub None jeśli intencja nieobsługiwana tutaj."""
    _tenant()
    # Intencje UI — wykonywane na froncie, backend zwraca tylko potwierdzenie.
    if intent == "navigate_screen":
        return {"ok": True, "action": "navigate_screen", "screen": p.get("screen"),
                "message": f"Nawigacja: {p.get('screen')}"}
    if intent == "filter_ui_inventory":
        return {"ok": True, "action": "filter_ui_inventory",
                "category": p.get("category"), "supplier_id": p.get("supplier_id"),
                "message": f"Filtr magazynu: {p.get('category')}"}
    if intent == "filter_ui_menu_blocked":
        return {"ok": True, "action": "filter_ui_menu_blocked", "message": "Filtr menu: zablokowane"}

    async with httpx.AsyncClient(timeout=45.0, verify=httpx_verify()) as client:
        if intent == "bulk_delete_menu":
            return await _exec_bulk_delete_menu(client)
        if intent == "bulk_delete_suppliers":
            return await _exec_bulk_delete_suppliers(client)
        if intent == "bulk_reset_inventory":
            return await _exec_bulk_reset_inventory(client)
        if intent == "bulk_delete_inventory":
            return await _exec_bulk_delete_inventory(client)
        if intent == "restore_last_deleted_menu":
            return await _exec_restore_menu(client)
        if intent == "restore_deleted_inventory":
            return await _exec_restore_inventory(client)
        if intent == "delete_menu_item":
            return await _exec_delete_menu_item(client, p)
        if intent == "delete_supplier":
            return await _exec_delete_supplier(client, p)
        if intent == "delete_inventory_item":
            return await _exec_delete_inventory_item(client, p)
        if intent == "toggle_menu_item_availability":
            return await _exec_toggle_availability(client, p)
        if intent == "bulk_edit_menu_prices_percentage":
            return await _exec_bulk_menu_prices(client, p, "pct")
        if intent == "bulk_edit_menu_prices_fixed":
            return await _exec_bulk_menu_prices(client, p, "fixed")
        if intent == "bulk_edit_inventory_buffers":
            return await _exec_bulk_inventory_buffers(client, p)
        if intent == "edit_menu_item_category":
            return await _exec_edit_menu_category(client, p)
        if intent == "rename_menu_item":
            return await _exec_rename_menu_item(client, p)
        if intent == "scale_recipe":
            return await _exec_scale_recipe(client, p)
    return None
