"""Wspólne dopasowanie nazw produktów magazynowych (marchew ≈ marchewka)."""
from __future__ import annotations

from typing import Any, Optional


def find_inventory_match(
    name: str,
    inv_rows: list[dict[str, Any]],
    *,
    threshold: int = 82,
    for_invoice: bool = False,
) -> Optional[dict[str, Any]]:
    """Szuka istniejącej pozycji magazynu — nie tylko po identycznej nazwie."""
    if not (name or "").strip() or not inv_rows:
        return None
    from server import _find_inventory_duplicate

    return _find_inventory_duplicate(
        name, inv_rows, threshold=threshold, for_invoice=for_invoice,
    )
