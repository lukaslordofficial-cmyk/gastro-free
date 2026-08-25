"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `expiration_apply`."""
from __future__ import annotations

from fastapi import HTTPException
from pl_fuzzy_norm import FUZZY_MATCH_THRESHOLD
from pl_fuzzy_norm import norm_pl as _norm_pl
from rapidfuzz import fuzz
from supabase_rest import sb_get
from supabase_rest import sb_post
from warehouse_category_guess import expiry_status as _expiry_status
import httpx
import re
from matching_utils import _food_names_compatible



async def _apply_expiration_batch(client, p, transcript, source):
    """Zapis partii z datą ważności (głos) → warehouse_inventory.

    TYLKO istniejące produkty w magazynie — nie tworzy nowych pozycji
    i nie zwiększa stanu (produkty dodaje się w Magazynie / fakturą / „dodaj produkt”).
    """
    warnings: list[str] = []
    name = (p.get("item_name") or p.get("product_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Brak nazwy produktu.")

    raw_batches = p.get("batches")
    if not isinstance(raw_batches, list) or not raw_batches:
        raw_batches = [{
            "quantity": p.get("quantity"),
            "expiration_date": p.get("expiration_date"),
        }]

    def _norm_date(edate: str) -> str:
        edate = str(edate or "").strip()
        m = re.match(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$", edate)
        if m:
            edate = f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", edate):
            raise HTTPException(
                status_code=400,
                detail=f"Podaj datę ważności z kalendarza (RRRR-MM-DD). Otrzymano: {edate or 'puste'}.",
            )
        return edate

    batches: list[dict] = []
    for b in raw_batches:
        qty = float(b.get("quantity") or 0)
        if qty <= 0:
            continue
        batches.append({
            "quantity": qty,
            "expiration_date": _norm_date(b.get("expiration_date")),
        })
    if not batches:
        raise HTTPException(status_code=400, detail="Dodaj co najmniej jedną partię (ilość > 0 + data).")

    unit = (p.get("unit") or "szt").strip() or "szt"
    alert_days = p.get("alert_days") or [7, 3, 1]
    if not isinstance(alert_days, list) or not alert_days:
        alert_days = [7, 3, 1]
    alert_days = [int(x) for x in alert_days]
    total_qty = sum(b["quantity"] for b in batches)

    inv_id = p.get("inventory_id") or p.get("related_id")
    inv_name = name
    if inv_id:
        # Nie ufaj ślepo related_id z LLM — musi pasować do nazwy produktu.
        try:
            rows = await sb_get(
                client, "inventory_items",
                params={"select": "id,name,quantity,unit", "id": f"eq.{inv_id}", "limit": "1"},
            ) or []
            if not rows:
                inv_id = None
            else:
                claimed_name = str(rows[0].get("name") or "")
                if name and not _food_names_compatible(name, claimed_name):
                    warnings.append(
                        f"Odrzucono niespójne ID magazynu ({claimed_name}) dla „{name}”."
                    )
                    inv_id = None
                else:
                    inv_name = claimed_name or name
                    unit = rows[0].get("unit") or unit
        except HTTPException:
            raise
        except Exception:
            warnings.append("Nie udało się zweryfikować ID produktu — szukam po nazwie.")
            inv_id = None

    if not inv_id:
        inv_all = await sb_get(client, "inventory_items", params={"select": "id,name,quantity,unit", "limit": "2000"}) or []
        best = None
        best_score = 0.0
        qn = _norm_pl(name)
        for row in inv_all:
            cand = _norm_pl(str(row.get("name") or ""))
            if not cand:
                continue
            if not _food_names_compatible(name, str(row.get("name") or "")):
                continue
            score = max(float(fuzz.token_set_ratio(qn, cand)), float(fuzz.partial_ratio(qn, cand)))
            if score > best_score:
                best_score = score
                best = row
        if not best or best_score < FUZZY_MATCH_THRESHOLD:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Nie znaleziono „{name}” w magazynie. "
                    "Najpierw dodaj produkt w Magazynie, komendą „dodaj produkt” albo przez skan faktury."
                ),
            )
        inv_id = best["id"]
        inv_name = best.get("name") or name
        unit = (best.get("unit") or unit or "szt")

    saved_ids = []
    for b in batches:
        edate = b["expiration_date"]
        qty = b["quantity"]
        status = _expiry_status(edate)
        try:
            from datetime import date as _date
            exp = _date.fromisoformat(edate)
            if 0 <= (exp - _date.today()).days <= 7 and status == "fresh":
                status = "warning"
        except Exception:
            pass

        payload = {
            "inventory_item_id": inv_id,
            "product_name": inv_name,
            "quantity": qty,
            "unit": unit,
            "expiration_date": edate,
            "status": status,
            "alert_triggers": alert_days,
            "source": "voice",
        }
        try:
            row = await sb_post(client, "warehouse_inventory", payload)
        except httpx.HTTPStatusError as e:
            payload.pop("alert_triggers", None)
            try:
                row = await sb_post(client, "warehouse_inventory", payload)
                if "alert_triggers" not in "".join(warnings):
                    warnings.append("Kolumna alert_triggers niedostępna — uruchom migrację ADD_INVOICE_EXPIRY_BATCHES.")
            except httpx.HTTPStatusError as e2:
                raise HTTPException(
                    status_code=500,
                    detail=f"Nie zapisano partii (migracja warehouse_inventory?): {e2.response.text[:120]}",
                ) from e2
        batch_id = (row[0] if isinstance(row, list) else row).get("id")
        saved_ids.append(batch_id)

    return (saved_ids[0] if saved_ids else None), {
        "product_name": inv_name,
        "quantity": total_qty,
        "unit": unit,
        "batches": batches,
        "alert_days": alert_days,
        "increase_stock": False,
        "created_new": False,
        "batches_count": len(batches),
    }, warnings

__all__ = ['_apply_expiration_batch']
