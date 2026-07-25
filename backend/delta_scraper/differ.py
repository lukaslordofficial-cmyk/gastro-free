from __future__ import annotations

import difflib
from typing import Optional

from delta_scraper.models import ChangeEvent, ScrapedProduct


def _fmt_price(v: float) -> str:
    return f"{v:.2f} zł"


def diff_products(
    old: list[ScrapedProduct],
    new: list[ScrapedProduct],
    *,
    price_epsilon: float = 0.009,
) -> list[ChangeEvent]:
    """Porównuje listy produktów — ceny, nowości, statusy."""
    old_map = {p.key(): p for p in old if p.name}
    new_map = {p.key(): p for p in new if p.name}
    events: list[ChangeEvent] = []

    for key, np in new_map.items():
        op = old_map.get(key)
        if op is None:
            events.append(ChangeEvent(
                change_type="new_items",
                product_name=np.name,
                details={
                    "before": None,
                    "after": _fmt_price(np.price_pln) if np.price_pln else np.name,
                    "price_pln": np.price_pln,
                    "status": np.status,
                },
            ))
            continue

        if np.price_pln and op.price_pln and abs(np.price_pln - op.price_pln) > price_epsilon:
            diff_val = round(np.price_pln - op.price_pln, 2)
            events.append(ChangeEvent(
                change_type="price_drop" if diff_val < 0 else "price_rise",
                product_name=np.name,
                details={
                    "before": _fmt_price(op.price_pln),
                    "after": _fmt_price(np.price_pln),
                    "difference": f"{diff_val:+.2f} zł",
                    "price_before": op.price_pln,
                    "price_after": np.price_pln,
                },
            ))

        if np.status != op.status and np.status in ("promo", "out_of_stock", "available"):
            events.append(ChangeEvent(
                change_type="status_change",
                product_name=np.name,
                details={
                    "before": op.status,
                    "after": np.status,
                },
            ))

    for key, op in old_map.items():
        if key not in new_map:
            events.append(ChangeEvent(
                change_type="removed_item",
                product_name=op.name,
                details={"before": _fmt_price(op.price_pln) if op.price_pln else op.name, "after": None},
            ))

    # Agregat: wiele nowych produktów → jeden wpis summary (opcjonalnie dodatkowy)
    new_only = [e for e in events if e.change_type == "new_items"]
    if len(new_only) > 3:
        events.insert(0, ChangeEvent(
            change_type="new_items",
            product_name=None,
            details={
                "summary": f"Wykryto {len(new_only)} nowych pozycji w katalogu",
                "count": len(new_only),
            },
        ))

    return events


def text_unified_diff(old_text: str, new_text: str, *, max_lines: int = 80) -> str:
    """Unified diff tekstu — do logów diagnostycznych."""
    diff = list(difflib.unified_diff(
        (old_text or "").splitlines(),
        (new_text or "").splitlines(),
        fromfile="poprzednio",
        tofile="teraz",
        lineterm="",
        n=2,
    ))
    if len(diff) > max_lines:
        diff = diff[:max_lines] + ["... (diff obcięty)"]
    return "\n".join(diff)
