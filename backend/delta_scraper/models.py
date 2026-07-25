from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Literal, Optional

ChangeType = Literal[
    "price_drop", "price_rise", "new_items", "status_change", "removed_item", "no_change"
]


@dataclass
class ScrapedProduct:
    name: str
    price_pln: float = 0.0
    unit: str = "szt"
    volume_label: str = ""
    status: str = "available"  # available | promo | out_of_stock | unknown
    raw_line: str = ""
    product_code: str = ""

    def key(self) -> str:
        from delta_scraper.parser import normalize_product_key
        if (self.product_code or "").strip():
            return f"code:{(self.product_code or '').strip().lower()}"
        return normalize_product_key(self.name)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> ScrapedProduct:
        return cls(
            name=str(d.get("name") or ""),
            price_pln=float(d.get("price_pln") or 0),
            unit=str(d.get("unit") or "szt"),
            volume_label=str(d.get("volume_label") or ""),
            status=str(d.get("status") or "unknown"),
            raw_line=str(d.get("raw_line") or ""),
            product_code=str(d.get("product_code") or ""),
        )


@dataclass
class ChangeEvent:
    change_type: ChangeType
    product_name: Optional[str] = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_alert_row(self, *, url: str, target_id: Optional[str], supplier_id: Optional[str]) -> dict:
        return {
            "target_id": target_id,
            "supplier_id": supplier_id,
            "url": url,
            "change_type": self.change_type,
            "product_name": self.product_name,
            "details": self.details,
        }


@dataclass
class CheckResult:
    target_id: str
    url: str
    changed: bool
    skipped_hash: bool = False
    product_count: int = 0
    new_product_count: int = 0
    changes: list[ChangeEvent] = field(default_factory=list)
    catalog_sync: Optional[dict[str, Any]] = None
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "target_id": self.target_id,
            "url": self.url,
            "changed": self.changed,
            "skipped_hash": self.skipped_hash,
            "product_count": self.product_count,
            "new_product_count": self.new_product_count,
            "changes": [
                {"change_type": c.change_type, "product_name": c.product_name, "details": c.details}
                for c in self.changes
            ],
            "catalog_sync": self.catalog_sync,
            "error": self.error,
        }
