"""
Helpers dla akcji waste — resolve celu (składnik/danie) przed odjęciem stanu.

Wydzielone z server.py, żeby apply nie ufał ślepo related_id z LLM.
"""
from __future__ import annotations

from typing import Any, Callable, Optional


def resolve_ingredient_target(
    item_name: str,
    related_id: Optional[str],
    inv_rows: list[dict[str, Any]],
    *,
    resolve_by_fuzzy: Callable[..., tuple[Optional[dict], float]],
    food_names_compatible: Callable[[str, str], bool],
) -> tuple[Optional[str], str, list[str]]:
    """Zwraca (related_id | None, canonical_name, warnings).

    Odrzuca UUID wskazujący na inny towar niż `item_name`.
    """
    warnings: list[str] = []
    name = (item_name or "").strip()
    claimed = next((r for r in inv_rows if str(r.get("id")) == str(related_id)), None) if related_id else None
    if claimed and name and not food_names_compatible(name, str(claimed.get("name") or "")):
        warnings.append(
            f"Odrzucono niespójne ID magazynu ({claimed.get('name')}) dla „{name}”."
        )
        claimed = None
        related_id = None
    if claimed:
        return str(claimed["id"]), str(claimed.get("name") or name), warnings
    if name and inv_rows:
        row, _score = resolve_by_fuzzy(name, inv_rows, strict_food=True)
        if row:
            return str(row["id"]), str(row.get("name") or name), warnings
    return None, name, warnings
