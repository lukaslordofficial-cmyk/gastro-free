from __future__ import annotations

from typing import Any
import json
from ._p0 import lp_order_note_tag



def _cost_note(
    *,
    source: str,
    company: str,
    total: float,
    producer_amount: float,
    materials_total: float,
    delivery_cost: float,
    platform_fee: float,
    invoice_products: list[dict[str, Any]],
    order_id: str,
) -> str:
    prefix = (
        f"Dostawa LP ({source}) · {company} · zapłacono łącznie {total:.2f} zł "
        f"(produkty {round(producer_amount or materials_total, 2):.2f} zł"
        + (f" + kurier {delivery_cost:.2f} zł" if delivery_cost > 0 else "")
        + (f" + opłata platformy {platform_fee:.2f} zł" if platform_fee > 0 else "")
        + f") · {lp_order_note_tag(order_id)}"
    )
    lines = [
        {
            "name": p["product_name"],
            "qty": p["quantity"],
            "unit": p["unit"],
            "price_netto": p["price_netto"],
        }
        for p in invoice_products
    ]
    if delivery_cost > 0:
        lines.append({
            "name": "Kurier / dostawa",
            "qty": 1,
            "unit": "szt",
            "price_netto": round(delivery_cost, 2),
        })
    if platform_fee > 0:
        lines.append({
            "name": "Opłata serwisu platformy (5%)",
            "qty": 1,
            "unit": "szt",
            "price_netto": round(platform_fee, 2),
        })
    payload = {
        "v": 1,
        "kind": "invoice_lines",
        "supplier_id": "",
        "supplier_name": str(company),
        "total": float(total),
        "order_id": order_id,
        "lines": lines,
    }
    return f"{prefix}\nGM_INVOICE_LINES:{json.dumps(payload, ensure_ascii=False)}"

__all__ = ['_cost_note']
