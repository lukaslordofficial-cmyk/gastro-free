"""
Automatyczne stawki VAT przy tworzeniu produktu (gastro-18).

Hook dla POST /producer/products/nowy (lub równoważnego endpointu):

    from backend.product_vat import resolve_product_vat_rate, resolve_billing_type

    billing = resolve_billing_type(producer)
    vat_rate = resolve_product_vat_rate(
        billing_type=billing,
        category_slug=category.get("slug"),
        category_name=category.get("name"),
        override_rate=body.get("vat_rate_override"),
    )
    # zapisz vat_rate na producer_products

Zasady:
- unregistered / vat_exempt / vat_rr -> 'zw'
- vat + kategorie żywności -> '5' (override 8/23 tylko dla syropy/oleje/.../inne)
"""

from __future__ import annotations

from typing import Any, Optional

EXEMPT_BILLING = frozenset({"unregistered", "vat_exempt", "vat_rr"})
VAT_5_SLUGS = frozenset(
    {
        "warzywa",
        "owoce",
        "maki",
        "kasze",
        "miody",
        "dzemy",
        "kiszonki",
        "syropy",
        "oleje",
        "przyprawy",
        "ziola",
        "grzyby",
        "inne",
    }
)
OVERRIDE_SLUGS = frozenset(
    {"syropy", "oleje", "przyprawy", "ziola", "grzyby", "inne"}
)


def _norm(value: Optional[str]) -> str:
    raw = (value or "").strip().lower()
    # prosta normalizacja PL
    repl = {
        "ą": "a",
        "ć": "c",
        "ę": "e",
        "ł": "l",
        "ń": "n",
        "ó": "o",
        "ś": "s",
        "ź": "z",
        "ż": "z",
    }
    for a, b in repl.items():
        raw = raw.replace(a, b)
    out = []
    for ch in raw:
        if ch.isalnum():
            out.append(ch)
    return "".join(out)


def resolve_billing_type(producer: dict[str, Any]) -> str:
    raw = str(producer.get("billing_type") or "").strip().lower()
    if raw in {"vat", "vat_exempt", "unregistered", "vat_rr"}:
        return raw
    settlement = str(producer.get("settlement_document_type") or "").strip().lower()
    return {
        "vat_invoice": "vat",
        "non_vat_invoice": "vat_exempt",
        "receipt": "unregistered",
        "vat_rr": "vat_rr",
    }.get(settlement, "vat")


def resolve_product_vat_rate(
    *,
    billing_type: str,
    category_slug: Optional[str] = None,
    category_name: Optional[str] = None,
    override_rate: Optional[str] = None,
) -> str:
    if billing_type in EXEMPT_BILLING:
        return "zw"

    slug = _norm(category_slug) or _norm(category_name)
    override = str(override_rate or "").strip().lower()
    if slug in OVERRIDE_SLUGS and override in {"5", "8", "23"}:
        return override
    if slug in VAT_5_SLUGS:
        return "5"
    return "5"


def require_category_id(category_id: Optional[str]) -> str:
    cid = str(category_id or "").strip()
    if not cid:
        raise ValueError(
            "Wybierz kategorię produktu — jest wymagana do przypisania stawki VAT."
        )
    return cid
