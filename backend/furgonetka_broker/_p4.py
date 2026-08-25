from __future__ import annotations

from typing import Any
import httpx
from ._p3 import create_furgonetka_shipment



async def create_furgonetka_shipment_for_order(
    *,
    client: httpx.AsyncClient,
    sb_get,
    sb_patch,
    order: dict[str, Any],
    producer: dict[str, Any] = None,
    receiver: dict[str, Any] = None,
) -> dict[str, Any]:
    return await create_furgonetka_shipment(
        str(order.get("id")),
        client=client,
        sb_get=sb_get,
        sb_patch=sb_patch,
    )

__all__ = ['create_furgonetka_shipment_for_order']
