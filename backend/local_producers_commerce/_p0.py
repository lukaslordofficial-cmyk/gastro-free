from __future__ import annotations

from typing import Any
from typing import Optional
import json
import logging
import os
import re

"""
Marketplace Lokalni Przetwórcy — Stripe Checkout (BLIK + karta) + InPost ShipX.

Jedna ścieżka: Zamów i zapłać = produkty + kurier + opłata serwisu 5%.
Po płatności:
  - dystrybutor: producer_amount (Connect destination charge lub Transfer),
  - platforma: 5% (application_fee / saldo platformy),
  - InPost: opłata kuriera zatrzymana na platformie + utworzenie przesyłki ShipX
    (pickup u producenta → dostawa do restauracji).
"""

logger = logging.getLogger("local_producers.commerce")

INPOST_SANDBOX = "https://sandbox-api-shipx-pl.easypack24.net"
INPOST_PROD = "https://api-shipx-pl.easypack24.net"
LP_SHIP_PREFIX = "lp_ship:"
LP_COURIER_PREFIX = "lp_courier:"


def inpost_configured() -> bool:
    return bool(
        (os.getenv("INPOST_API_TOKEN") or "").strip()
        and (os.getenv("INPOST_ORGANIZATION_ID") or "").strip()
    )


def _inpost_base() -> str:
    custom = (os.getenv("INPOST_API_URL") or "").strip().rstrip("/")
    if custom:
        return custom
    if (os.getenv("INPOST_SANDBOX") or "").strip().lower() in ("1", "true", "yes"):
        return INPOST_SANDBOX
    return INPOST_PROD


def _pln_to_grosze(value: Any) -> int:
    try:
        return int(round(float(value or 0) * 100))
    except (TypeError, ValueError):
        return 0


def parse_lp_ship_from_notes(notes: Optional[str]) -> Optional[dict[str, Any]]:
    """Wyciąga adres dostawy zapisany w notes jako lp_ship:{json}."""
    if not notes:
        return None
    idx = notes.find(LP_SHIP_PREFIX)
    if idx < 0:
        return None
    raw = notes[idx + len(LP_SHIP_PREFIX) :].strip()
    # JSON kończy się przed ' | ' albo na końcu
    if " |" in raw:
        raw = raw.split(" |", 1)[0].strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def encode_lp_ship_note(delivery: dict[str, Any], extra: str = "") -> str:
    payload = json.dumps(delivery, ensure_ascii=False, separators=(",", ":"))
    base = f"{LP_SHIP_PREFIX}{payload}"
    extra = (extra or "").strip()
    return f"{extra} | {base}".strip(" |") if extra else base


def parse_lp_courier_from_notes(notes: Optional[str]) -> Optional[dict[str, Any]]:
    if not notes:
        return None
    idx = notes.find(LP_COURIER_PREFIX)
    if idx < 0:
        return None
    raw = notes[idx + len(LP_COURIER_PREFIX) :].strip()
    if " |" in raw:
        raw = raw.split(" |", 1)[0].strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def courier_line_item_name(order: dict[str, Any]) -> str:
    """Nazwa kuriera na podsumowaniu Stripe — ta sama, którą restauracja wybrała."""
    raw = str(order.get("courier_name") or "").strip()
    if not raw:
        sel = parse_lp_courier_from_notes(order.get("notes")) or {}
        raw = str(sel.get("name") or sel.get("service") or "").strip()
    if not raw:
        return "Kurier"
    low = raw.lower()
    if low in ("inpost", "inpost kurier"):
        return "Kurier InPost"
    if low.startswith("kurier"):
        return raw[:80]
    return f"Kurier — {raw}"[:80]


def _split_street(address: Optional[str]) -> tuple[str, str]:
    """Prosta próba wydzielenia numeru budynku z linii adresu."""
    text = (address or "").strip() or "ul. Producenta"
    m = re.search(r"^(.*?)[\s,]+(\d+[A-Za-z]?(?:/\d+[A-Za-z]?)?)\s*$", text)
    if m:
        return m.group(1).strip()[:60] or "ul. Producenta", m.group(2)[:10]
    return text[:60], "1"

__all__ = ['INPOST_PROD', 'INPOST_SANDBOX', 'LP_COURIER_PREFIX', 'LP_SHIP_PREFIX', '_inpost_base', '_pln_to_grosze', '_split_street', 'courier_line_item_name', 'encode_lp_ship_note', 'inpost_configured', 'logger', 'parse_lp_courier_from_notes', 'parse_lp_ship_from_notes']
