"""
Merge / normalizacja pól dostawcy ze skanu faktury/oferty — pure helpers.
Wydzielone z server.py (dekalog §I). Używane przez documents_routes + skan.
"""
from __future__ import annotations

from typing import Optional


def nip_digits(value: Optional[str]) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def normalize_supplier_scan_meta(raw: Optional[dict]) -> dict:
    """Normalizuje blok `supplier` z Vision JSON do pól panelu Dostawcy."""
    src = raw if isinstance(raw, dict) else {}

    def _str(key: str) -> Optional[str]:
        v = src.get(key)
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    def _num(key: str) -> Optional[float]:
        v = src.get(key)
        if v is None or v == "":
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    def _int(key: str) -> Optional[int]:
        n = _num(key)
        if n is None:
            return None
        try:
            return int(round(n))
        except (TypeError, ValueError):
            return None

    return {
        "nip": _str("nip"),
        "phone": _str("phone"),
        "email": _str("email"),
        "contact_person": _str("contact_person"),
        "address": _str("address"),
        "bank_account": _str("bank_account"),
        "payment_terms": _str("payment_terms"),
        "shipping_cost": _num("shipping_cost"),
        "min_order_value": _num("min_order_value"),
        "free_shipping_threshold": _num("free_shipping_threshold"),
        "lead_time_days": _int("lead_time_days"),
    }


def compose_supplier_notes_from_scan(meta: dict) -> Optional[str]:
    parts: list[str] = []
    addr = (meta.get("address") or "").strip()
    pay = (meta.get("payment_terms") or "").strip()
    if addr:
        parts.append(f"Adres: {addr}")
    if pay:
        parts.append(f"Termin płatności: {pay}")
    return "\n".join(parts) if parts else None


def merge_supplier_notes(existing: Optional[str], incoming: Optional[str]) -> Optional[str]:
    """Dokłada linie z dokumentu bez kasowania istniejących notatek."""
    ex = (existing or "").strip()
    inc = (incoming or "").strip()
    if not inc:
        return None
    if not ex:
        return inc
    to_add = []
    for line in inc.split("\n"):
        line = line.strip()
        if line and line not in ex:
            to_add.append(line)
    if not to_add:
        return None
    return f"{ex}\n" + "\n".join(to_add)


def prefer_supplier_str(
    existing: Optional[str], new: Optional[str], *, kind: str = "text",
) -> Optional[str]:
    """Zwraca nową wartość do zapisu albo None (= nie zmieniaj)."""
    n = (new or "").strip()
    e = (existing or "").strip()
    if not n:
        return None
    if not e:
        return n
    if kind == "nip":
        nd, ed = nip_digits(n), nip_digits(e)
        if not nd:
            return None
        if len(nd) > len(ed) or (len(nd) == 10 and len(ed) != 10):
            return n
        if nd == ed:
            return None
        return n
    if kind == "phone":
        nd = sum(ch.isdigit() for ch in n)
        ed = sum(ch.isdigit() for ch in e)
        if nd > ed:
            return n
        if nd == ed and n != e:
            return n
        return None
    if kind == "email":
        if "@" in n and "@" not in e:
            return n
        if n.lower() != e.lower():
            return n
        return None
    if len(n) > len(e) + 2 or n.lower() != e.lower():
        return n
    return None


def prefer_supplier_num(
    existing,
    new: Optional[float],
    *,
    allow_zero: bool = False,
) -> Optional[float]:
    """Zwraca liczbę do zapisu albo None (= nie zmieniaj)."""
    if new is None:
        return None
    try:
        v = float(new)
    except (TypeError, ValueError):
        return None
    if allow_zero:
        if v < 0:
            return None
    elif v <= 0:
        return None
    try:
        ex = float(existing) if existing is not None and existing != "" else 0.0
    except (TypeError, ValueError):
        ex = 0.0
    if allow_zero:
        if ex == v:
            return None
        return v
    if ex <= 0 or abs(ex - v) > 0.009:
        return v
    return None


def build_supplier_patch_from_scan(existing: dict, meta: dict) -> dict:
    """Czysta logika merge — używana przy zapisie i w testach jednostkowych."""
    patch: dict = {}
    for key, kind in (
        ("nip", "nip"),
        ("phone", "phone"),
        ("email", "email"),
        ("contact_person", "text"),
        ("address", "text"),
        ("bank_account", "text"),
    ):
        chosen = prefer_supplier_str(existing.get(key), meta.get(key), kind=kind)
        if chosen is not None:
            patch[key] = chosen

    notes_in = compose_supplier_notes_from_scan(meta)
    notes_merged = merge_supplier_notes(existing.get("notes"), notes_in)
    if notes_merged is not None:
        patch["notes"] = notes_merged

    ship = prefer_supplier_num(
        existing.get("shipping_cost"), meta.get("shipping_cost"), allow_zero=True,
    )
    if ship is not None:
        patch["shipping_cost"] = ship

    min_o = prefer_supplier_num(
        existing.get("min_order_value"), meta.get("min_order_value"), allow_zero=False,
    )
    if min_o is not None:
        patch["min_order_value"] = min_o

    free_th = prefer_supplier_num(
        existing.get("free_shipping_threshold"),
        meta.get("free_shipping_threshold"),
        allow_zero=False,
    )
    if free_th is not None:
        patch["free_shipping_threshold"] = free_th

    lead = meta.get("lead_time_days")
    if lead is not None:
        try:
            lead_i = int(lead)
        except (TypeError, ValueError):
            lead_i = None
        if lead_i is not None and lead_i > 0:
            ex_lead = existing.get("lead_time_days")
            try:
                ex_i = int(ex_lead) if ex_lead is not None and ex_lead != "" else None
            except (TypeError, ValueError):
                ex_i = None
            if ex_i is None or ex_i <= 0 or ex_i != lead_i:
                patch["lead_time_days"] = lead_i

    return patch


def supplier_meta_preview(meta: dict) -> dict:
    """Kompaktowy podgląd pól dostawcy dla FE (pomija puste)."""
    out: dict = {}
    for k in (
        "nip", "phone", "email", "contact_person", "address", "bank_account", "payment_terms",
        "shipping_cost", "min_order_value", "free_shipping_threshold", "lead_time_days",
    ):
        v = meta.get(k)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        out[k] = v
    return out


# Aliasy zgodne z dawnymi nazwami w server.py
_nip_digits = nip_digits
_normalize_supplier_scan_meta = normalize_supplier_scan_meta
_compose_supplier_notes_from_scan = compose_supplier_notes_from_scan
_merge_supplier_notes = merge_supplier_notes
_prefer_supplier_str = prefer_supplier_str
_prefer_supplier_num = prefer_supplier_num
