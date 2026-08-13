"""Mapowanie statusów trackingu Furgonetki → shipment_status Gastro."""
from __future__ import annotations

from typing import Any, Optional

# Furgonetka GET /packages/{id}/tracking → pole ``state``
FURGONETKA_STATE_TO_SHIPMENT = {
    "waiting": "preparing",
    "ordered": "preparing",
    "collected": "shipped",
    "transit": "shipped",
    "delivery": "shipped",
    "delivered": "delivered",
    "delivery-problem": "shipped",
    "canceled": "cancelled",
    "cancelled": "cancelled",
    "returned": "cancelled",
}

FURGONETKA_STATE_TO_ORDER = {
    "waiting": "preparing",
    "ordered": "awaiting_courier",
    "collected": "shipped",
    "transit": "shipped",
    "delivery": "shipped",
    "delivered": "delivered",
    "delivery-problem": "shipped",
    "canceled": "cancelled",
    "cancelled": "cancelled",
    "returned": "cancelled",
}

# Krok timeline w aplikacji (0–5)
TIMELINE_STEPS = (
    "preparing",
    "courier_ordered",
    "collected",
    "in_transit",
    "out_for_delivery",
    "delivered",
)


def normalize_furgonetka_state(raw: Optional[str]) -> str:
    s = (raw or "").strip().lower().replace("_", "-")
    return s


def shipment_status_for_state(state: Optional[str], *, fallback: str = "preparing") -> str:
    mapped = FURGONETKA_STATE_TO_SHIPMENT.get(normalize_furgonetka_state(state))
    return mapped or fallback


def order_status_for_state(state: Optional[str], *, fallback: str = "preparing") -> str:
    mapped = FURGONETKA_STATE_TO_ORDER.get(normalize_furgonetka_state(state))
    return mapped or fallback


def timeline_index(state: Optional[str], *, has_pickup: bool = False) -> int:
    s = normalize_furgonetka_state(state)
    if s in ("delivered",):
        return 5
    if s in ("delivery",):
        return 4
    if s in ("transit",):
        return 3
    if s in ("collected",):
        return 2
    if s in ("ordered",) or has_pickup:
        return 1
    return 0


def latest_tracking_state(payload: Any) -> Optional[str]:
    """Ostatni ``state`` z odpowiedzi GET /packages/{id}/tracking."""
    if not isinstance(payload, dict):
        return None
    events = payload.get("tracking") or payload.get("events") or []
    if not isinstance(events, list) or not events:
        return normalize_furgonetka_state(payload.get("state") or payload.get("status")) or None
    last = events[-1] if isinstance(events[-1], dict) else {}
    return normalize_furgonetka_state(last.get("state") or last.get("status")) or None


def tracking_events_public(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    events = payload.get("tracking") or payload.get("events") or []
    out: list[dict[str, Any]] = []
    if not isinstance(events, list):
        return out
    for ev in events:
        if not isinstance(ev, dict):
            continue
        state = normalize_furgonetka_state(ev.get("state"))
        out.append({
            "state": state,
            "status": ev.get("status") or ev.get("description") or "",
            "datetime": ev.get("datetime") or ev.get("date") or None,
            "location": ev.get("branch") or ev.get("location") or None,
            "shipment_status": shipment_status_for_state(state),
        })
    return out
