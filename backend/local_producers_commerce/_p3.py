from __future__ import annotations

from billing_stripe import _ssl_verify
from typing import Any
from typing import Optional
import httpx
import os
from ._p0 import _inpost_base, _split_street, inpost_configured, parse_lp_ship_from_notes



async def create_inpost_shipment(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order: dict[str, Any],
    producer: dict[str, Any],
    receiver: dict[str, Any],
) -> dict[str, Any]:
    """
    Tworzy przesyłkę InPost ShipX (kurier).
    sender = producent (pickup), receiver = restauracja (dostawa).
    Opłata kuriera jest już w Stripe (zatrzymana na platformie) — ShipX rozlicza InPost w org.
    """
    sender_street, sender_building = _split_street(producer.get("address"))
    recv_addr = receiver.get("address") or {}
    recv_street = (recv_addr.get("street") or "").strip() or "ul. Restauracyjna"
    recv_building = (recv_addr.get("building_number") or "").strip() or "1"
    recv_city = (recv_addr.get("city") or "").strip() or "Warszawa"
    recv_post = (recv_addr.get("post_code") or "").strip() or "00-001"

    comment = (
        f"Gastro LP {str(order.get('id'))[:8]} | "
        f"ODBIÓR: {producer.get('company_name') or 'Producent'}, "
        f"{sender_street} {sender_building}, {producer.get('city') or ''} {producer.get('postal_code') or ''} | "
        f"DOSTAWA: {receiver.get('name') or 'Restauracja'}, "
        f"{recv_street} {recv_building}, {recv_city} {recv_post}"
    )[:500]

    if not inpost_configured():
        try:
            await sb_patch(
                client,
                "producer_orders",
                {"id": f"eq.{order['id']}"},
                {
                    "shipment_status": "preparing",
                    "order_status": "processing",
                    "notes": (
                        (order.get("notes") or "")
                        + " | InPost: brak tokenu — etykieta później | "
                        + comment
                    ).strip(" |")[:2000],
                },
            )
        except Exception:
            pass
        return {
            "ok": True,
            "stub": True,
            "message": (
                "INPOST_API_TOKEN / INPOST_ORGANIZATION_ID nie ustawione — "
                "przesyłka oznaczona jako preparing (stub). "
                "Opłata kuriera jest na koncie platformy pod rozliczenie InPost."
            ),
            "pickup_hint": comment,
        }

    token = (os.getenv("INPOST_API_TOKEN") or "").strip()
    org_id = (os.getenv("INPOST_ORGANIZATION_ID") or "").strip()
    service = (os.getenv("INPOST_SERVICE") or "inpost_courier_standard").strip()

    body = {
        "receiver": {
            "name": receiver.get("name") or "Restauracja",
            "email": receiver.get("email") or "orders@gastromanager.app",
            "phone": receiver.get("phone") or "500600700",
            "address": {
                "street": recv_street[:60],
                "building_number": recv_building[:10],
                "city": recv_city[:40],
                "post_code": recv_post[:10],
                "country_code": "PL",
            },
        },
        "sender": {
            "name": producer.get("company_name") or "Producent",
            "email": producer.get("email") or "producer@example.com",
            "phone": producer.get("phone") or "500600700",
            "address": {
                "street": sender_street,
                "building_number": sender_building,
                "city": (producer.get("city") or "Warszawa")[:40],
                "post_code": (producer.get("postal_code") or "00-001")[:10],
                "country_code": "PL",
            },
        },
        "parcels": [
            {
                "dimensions": {
                    "length": "30",
                    "width": "20",
                    "height": "20",
                    "unit": "cm",
                },
                "weight": {"amount": "2", "unit": "kg"},
            }
        ],
        "service": service,
        "reference": str(order.get("id"))[:40],
        "comments": comment,
    }

    url = f"{_inpost_base()}/v1/organizations/{org_id}/shipments"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=45.0, verify=_ssl_verify()) as http:
        r = await http.post(url, json=body, headers=headers)
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            msg = data.get("message") or data.get("error") or r.text[:300]
            raise RuntimeError(f"InPost {r.status_code}: {msg}")

    tracking = None
    if isinstance(data, dict):
        tracking = data.get("tracking_number")
        parcels = data.get("parcels")
        if not tracking and isinstance(parcels, list) and parcels:
            tracking = parcels[0].get("tracking_number")
        if not tracking:
            tracking = data.get("id")

    patch = {
        "shipment_status": "shipped" if tracking else "preparing",
        "order_status": "processing",
    }
    if tracking:
        patch["delivery_tracking"] = str(tracking)
    try:
        await sb_patch(client, "producer_orders", {"id": f"eq.{order['id']}"}, patch)
    except Exception:
        await sb_patch(
            client,
            "producer_orders",
            {"id": f"eq.{order['id']}"},
            {"shipment_status": patch["shipment_status"]},
        )

    return {
        "ok": True,
        "stub": False,
        "shipment": data,
        "tracking_number": tracking,
        "label_hint": "Producent pobiera etykietę w panelu WWW / API InPost.",
        "pickup_hint": comment,
        "courier_settlement": (
            "Opłata kuriera z Checkout jest na koncie platformy; "
            "InPost rozlicza przesyłkę w organizacji ShipX."
        ),
    }


async def _resolve_receiver(
    *,
    client: httpx.AsyncClient,
    sb_get,
    order: dict[str, Any],
    account_key: Optional[str],
) -> dict[str, Any]:
    ship = parse_lp_ship_from_notes(order.get("notes"))
    receiver = {
        "name": "Restauracja",
        "email": "orders@gastromanager.app",
        "phone": "500600700",
        "address": {
            "street": "ul. Restauracyjna",
            "building_number": "1",
            "city": "Warszawa",
            "post_code": "00-001",
        },
    }
    if ship:
        receiver["name"] = ship.get("name") or receiver["name"]
        if ship.get("email"):
            receiver["email"] = ship["email"]
        if ship.get("phone"):
            receiver["phone"] = str(ship["phone"])
        receiver["address"] = {
            "street": ship.get("street") or receiver["address"]["street"],
            "building_number": ship.get("building_number") or "1",
            "city": ship.get("city") or receiver["address"]["city"],
            "post_code": ship.get("post_code") or receiver["address"]["post_code"],
        }
    if account_key:
        try:
            profiles = await sb_get(
                client,
                "profiles",
                params={
                    "select": "restaurant_name,email",
                    "account_key": f"eq.{account_key}",
                    "limit": "1",
                },
            )
            if profiles:
                if not ship or not ship.get("name"):
                    receiver["name"] = profiles[0].get("restaurant_name") or receiver["name"]
                if profiles[0].get("email") and (not ship or not ship.get("email")):
                    receiver["email"] = profiles[0]["email"]
        except Exception:
            pass
    return receiver

__all__ = ['_resolve_receiver', 'create_inpost_shipment']
