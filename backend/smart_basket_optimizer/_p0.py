from __future__ import annotations

from bargain_hunter import _min_order_value
from bargain_hunter import _supplier_meta
from typing import Optional

"""
Smart Basket Optimizer (Łowca Okazji v2) — 3 scenariusze z ograniczeniami.

Scenariusze:
  1. split_max   — najtańszy dostawca per SKU + walidacja minimów + shipping
  2. monolith    — 1 (lub max 2) dostawcy, max coverage, min total
  3. smart_hybrid — przenosi pozycje z koszyków poniżej min. do dużych koszyków

Pure functions — bez I/O. Wejście: ta sama struktura `per_item` co bargain_hunter.
"""

# Różnica < 5% → nie pokazuj wielu wariantów (UX Shield)
MULTIVAR_SAVINGS_RATIO = 0.05
CACHE_TTL_SEC = 2 * 3600

# Reguły praktycznego koszyka (nie tylko „najtańszy SKU”)
# Nie zakładaj nowego koszyka, jeśli po dodaniu produktu brakuje > 150 zł do minimum.
MAX_GAP_NEW_BASKET_PLN = 150.0
# Jeśli tańszy wariant zostawia lukę > 50 zł do min — wolimy droższy u „kotwicy”.
SOFT_GAP_PREFER_ANCHOR_PLN = 50.0
# Kotwica: ≥N pozycji LUB już spełnia min / próg darmowej dostawy
ANCHOR_MIN_ITEMS = 5
# Dopuszczalna dopłata za praktyczność (zł lub % linii)
ANCHOR_PRICE_SLACK_PLN = 25.0
ANCHOR_PRICE_SLACK_RATIO = 0.12
# Exclusive SKU: buduj koszyk-kotwicę tylko gdy ≥50% pozostałych produktów
# (z ofertami) ma najtańszą ofertę u tego samego dostawcy.
EXCLUSIVE_CHEAPEST_SHARE = 0.5
# Po przydziale: dopełniaj soft-luki (≤150 zł) pozycjami o najmniejszej dopłacie vs rynek.

# Opakowania: 1 paczka > band_hi × ratio → PACK_OVERSIZE (odrzucane dla produktów świeżych)
PACK_OVERSIZE_RATIO = 1.0
# Klasa A / critical — próg priority_score (0–1)
CLASS_A_SCORE_THRESHOLD = 0.55
# Duża ilość vs typowa strata: qty ≥ X × mediana → waste qty-reduce hint
WASTE_QTY_LARGE_FACTOR = 1.5
# Reliability Score: poniżej progu → łagodny uplift TCO (tylko gdy dane istnieją)
RELIABILITY_TCO_THRESHOLD = 0.85
RELIABILITY_TCO_UPLIFT_RATIO = 0.04  # +4% TCO gdy score < threshold
LEAD_TIME_SLOW_DAYS = 3.0
# Gdy suppliers.lead_time_days jest NULL — bezpieczny domyślny horyzont (nie zapisujemy do DB)
DEFAULT_LEAD_TIME_DAYS = 2.0


def resolve_lead_time_days(meta: Optional[dict]) -> float:
    """Zwraca lead_time_days z meta albo DEFAULT_LEAD_TIME_DAYS gdy brak/niepoprawne."""
    if not meta:
        return float(DEFAULT_LEAD_TIME_DAYS)
    raw = meta.get("lead_time_days")
    if raw is None:
        return float(DEFAULT_LEAD_TIME_DAYS)
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return float(DEFAULT_LEAD_TIME_DAYS)
    if v < 0:
        return float(DEFAULT_LEAD_TIME_DAYS)
    return v

# Keywords produktów o długim terminie (nie karaj oversize tak ostro)
_NON_PERISHABLE_KEYWORDS = (
    "mąka", "maka", "cukier", "sól", "sol", "olej", "ocet", "ryż", "ryz",
    "makaron", "kasza", "pelati", "puszka", "konserwa", "bulion", "przypraw",
    "chemia", "folia", "serwet", "kubek", "talerz", "worki",
)

# In-memory cache: key → (expires_at, payload)
_RESULT_CACHE: dict[str, tuple[float, dict]] = {}


def compute_reliability_score(
    *,
    received_ok_count: int = 0,
    received_bad_count: int = 0,
    missing_total: int = 0,
    review_count: int = 0,
) -> Optional[float]:
    """
    Prosty Reliability Score 0–1 z danych odbioru.
    Zwraca None gdy brak jakichkolwiek ocen (nie wpływaj na TCO).

    TODO(Phase 4 FE): delivery rating form zapisze received_ok / missing_count
    na supplier_orders lub supplier_delivery_reviews — wtedy score zacznie działać.
    """
    total = int(received_ok_count) + int(received_bad_count)
    if total <= 0 and int(review_count) <= 0:
        return None
    n = max(total, int(review_count), 1)
    ok_ratio = float(received_ok_count) / float(n) if n else 0.0
    # Kara za braki: każdy missing lekko obniża score
    miss_pen = min(0.35, 0.03 * float(max(0, missing_total)))
    score = max(0.0, min(1.0, ok_ratio - miss_pen))
    return round(score, 4)


def reliability_tco_multiplier(meta: dict) -> float:
    """Mnożnik TCO z reliability_score w meta (1.0 = brak kary)."""
    score = meta.get("reliability_score")
    if score is None:
        return 1.0
    try:
        s = float(score)
    except (TypeError, ValueError):
        return 1.0
    if s >= RELIABILITY_TCO_THRESHOLD:
        return 1.0
    # Im niższy score, tym wyższy uplift (do ~2× RELIABILITY_TCO_UPLIFT_RATIO)
    deficit = RELIABILITY_TCO_THRESHOLD - s
    uplift = RELIABILITY_TCO_UPLIFT_RATIO * (1.0 + min(1.0, deficit / RELIABILITY_TCO_THRESHOLD))
    return round(1.0 + uplift, 4)


def shipping_cost_for(subtotal: float, meta: dict, items: Optional[list] = None) -> float:
    """Koszt dostawy po uwzględnieniu free_shipping_threshold.

    Lokalni przetwórcy: kurier wg wagi koszyka (InPost bands), nie flat 0 zł.
    """
    is_lp = bool(meta.get("is_local_producer"))
    try:
        free_at = float(meta.get("free_shipping_threshold") or 0)
    except (TypeError, ValueError):
        free_at = 0.0
    if free_at > 0 and float(subtotal or 0) >= free_at:
        return 0.0

    if is_lp:
        quote_items = []
        for it in (items or []):
            if not isinstance(it, dict):
                continue
            quote_items.append({
                "quantity": it.get("quantity") if it.get("quantity") is not None else it.get("order_base_qty"),
                "unit": it.get("unit") or it.get("base_dim") or "szt",
                "weight_g": it.get("weight_g"),
                "product_id": it.get("catalog_product_id") or it.get("product_id"),
            })
        if quote_items:
            try:
                from lp_courier_price import quote_courier_for_items
                q = quote_courier_for_items(quote_items)
                return round(float(q.get("price_pln") or 0), 2)
            except Exception:
                pass
        # Szacunek flat gdy brak pozycji (TCO przed zbudowaniem koszyka)
        try:
            est = float(meta.get("shipping_cost") or 0)
        except (TypeError, ValueError):
            est = 0.0
        if est > 0:
            return round(est, 2)
        try:
            from lp_courier_price import courier_price_for_weight_kg
            return round(float(courier_price_for_weight_kg(1.0)), 2)
        except Exception:
            return 15.99

    try:
        cost = float(meta.get("shipping_cost") or 0)
    except (TypeError, ValueError):
        cost = 0.0
    if cost <= 0:
        return 0.0
    return round(cost, 2)


def _enrich_group(g: dict, suppliers_meta: dict[str, dict]) -> dict:
    """Dokłada shipping + total_with_shipping do grupy dostawcy."""
    sid = g["supplier_id"]
    meta = _supplier_meta(suppliers_meta, sid)
    sub = round(float(g.get("subtotal_pln") or 0), 2)
    ship = shipping_cost_for(sub, meta, items=g.get("items") or [])
    min_val = float(g.get("min_order_value") if g.get("min_order_value") is not None
                    else _min_order_value(suppliers_meta, sid))
    meets = min_val <= 0 or sub >= min_val
    out = dict(g)
    # Nazwa z meta zawsze wygrywa nad pustą / None / „Dostawca”
    meta_name = (meta.get("name") or "").strip()
    cur_name = (out.get("supplier_name") or "").strip()
    if meta_name and (not cur_name or cur_name == "Dostawca"):
        out["supplier_name"] = meta_name
    elif not cur_name:
        out["supplier_name"] = meta_name or "Dostawca"
    if meta.get("email") and not out.get("supplier_email"):
        out["supplier_email"] = meta.get("email")
    out["min_order_value"] = min_val
    out["meets_minimum_order"] = meets
    out["shipping_pln"] = ship
    out["total_pln"] = round(sub + ship, 2)
    out["shipping_cost_list"] = float(meta.get("shipping_cost") or 0)
    out["free_shipping_threshold"] = float(meta.get("free_shipping_threshold") or 0)
    out["gap_to_minimum_pln"] = round(max(0.0, min_val - sub), 2) if min_val > 0 else 0.0
    # Echo reliability when present (FE Phase 4 badges)
    if meta.get("reliability_score") is not None:
        out["reliability_score"] = meta.get("reliability_score")
    # Echo lead time: realna wartość z DB albo bezpieczny default (nie fałszujemy wiersza dostawcy)
    out["lead_time_days"] = resolve_lead_time_days(meta)
    out["lead_time_is_default"] = meta.get("lead_time_days") is None
    if meta.get("is_local_producer"):
        out["is_local_producer"] = True
        if meta.get("city"):
            out["local_producer_city"] = meta.get("city")
        if meta.get("voivodeship"):
            out["local_producer_voivodeship"] = meta.get("voivodeship")
    return out


def _gap_to_min(subtotal: float, min_val: float) -> float:
    if min_val <= 0:
        return 0.0
    return round(max(0.0, min_val - subtotal), 2)


def _virtual_min_penalty(subtotal: float, min_val: float) -> float:
    """Wirtualna kara za koszyk poniżej minimum (= luka do min)."""
    return _gap_to_min(subtotal, min_val)


def _basket_tco(
    subtotal: float,
    sid: str,
    suppliers_meta: dict[str, dict],
    items: Optional[list] = None,
) -> float:
    """TCO koszyka: produkty + shipping (po free threshold) + kara za min (+ reliability)."""
    meta = _supplier_meta(suppliers_meta, sid)
    min_v = _min_order_value(suppliers_meta, sid)
    ship = shipping_cost_for(subtotal, meta, items=items)
    base = float(subtotal) + ship + _virtual_min_penalty(float(subtotal), min_v)
    return round(base * reliability_tco_multiplier(meta), 2)


def _groups_tco(groups: dict[str, dict], suppliers_meta: dict[str, dict]) -> float:
    return round(
        sum(
            _basket_tco(
                float(g.get("subtotal_pln") or 0),
                sid,
                suppliers_meta,
                items=g.get("items") or [],
            )
            for sid, g in groups.items()
        ),
        2,
    )

__all__ = ['ANCHOR_MIN_ITEMS', 'ANCHOR_PRICE_SLACK_PLN', 'ANCHOR_PRICE_SLACK_RATIO', 'CACHE_TTL_SEC', 'CLASS_A_SCORE_THRESHOLD', 'DEFAULT_LEAD_TIME_DAYS', 'EXCLUSIVE_CHEAPEST_SHARE', 'LEAD_TIME_SLOW_DAYS', 'MAX_GAP_NEW_BASKET_PLN', 'MULTIVAR_SAVINGS_RATIO', 'PACK_OVERSIZE_RATIO', 'RELIABILITY_TCO_THRESHOLD', 'RELIABILITY_TCO_UPLIFT_RATIO', 'SOFT_GAP_PREFER_ANCHOR_PLN', 'WASTE_QTY_LARGE_FACTOR', '_NON_PERISHABLE_KEYWORDS', '_RESULT_CACHE', '_basket_tco', '_enrich_group', '_gap_to_min', '_groups_tco', '_virtual_min_penalty', 'compute_reliability_score', 'reliability_tco_multiplier', 'resolve_lead_time_days', 'shipping_cost_for']
