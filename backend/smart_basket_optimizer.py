"""
Smart Basket Optimizer (Łowca Okazji v2) — 3 scenariusze z ograniczeniami.

Scenariusze:
  1. split_max   — najtańszy dostawca per SKU + walidacja minimów + shipping
  2. monolith    — 1 (lub max 2) dostawcy, max coverage, min total
  3. smart_hybrid — przenosi pozycje z koszyków poniżej min. do dużych koszyków

Pure functions — bez I/O. Wejście: ta sama struktura `per_item` co bargain_hunter.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Optional

from bargain_hunter import (
    PRICE_TOLERANCE,
    _item_line_entry,
    _min_order_value,
    _supplier_meta,
    compute_monolith,
    compute_split,
    find_tied_suppliers,
    fmt_pln,
    to_pricing_matrix,
)

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


def shipping_cost_for(subtotal: float, meta: dict) -> float:
    """Koszt dostawy po uwzględnieniu free_shipping_threshold."""
    try:
        cost = float(meta.get("shipping_cost") or 0)
    except (TypeError, ValueError):
        cost = 0.0
    if cost <= 0:
        return 0.0
    try:
        free_at = float(meta.get("free_shipping_threshold") or 0)
    except (TypeError, ValueError):
        free_at = 0.0
    if free_at > 0 and subtotal >= free_at:
        return 0.0
    return round(cost, 2)


def _enrich_group(g: dict, suppliers_meta: dict[str, dict]) -> dict:
    """Dokłada shipping + total_with_shipping do grupy dostawcy."""
    sid = g["supplier_id"]
    meta = _supplier_meta(suppliers_meta, sid)
    sub = round(float(g.get("subtotal_pln") or 0), 2)
    ship = shipping_cost_for(sub, meta)
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
    return out


def _gap_to_min(subtotal: float, min_val: float) -> float:
    if min_val <= 0:
        return 0.0
    return round(max(0.0, min_val - subtotal), 2)


def _virtual_min_penalty(subtotal: float, min_val: float) -> float:
    """Wirtualna kara za koszyk poniżej minimum (= luka do min)."""
    return _gap_to_min(subtotal, min_val)


def _basket_tco(subtotal: float, sid: str, suppliers_meta: dict[str, dict]) -> float:
    """TCO koszyka: produkty + shipping (po free threshold) + kara za min (+ reliability)."""
    meta = _supplier_meta(suppliers_meta, sid)
    min_v = _min_order_value(suppliers_meta, sid)
    ship = shipping_cost_for(subtotal, meta)
    base = float(subtotal) + ship + _virtual_min_penalty(float(subtotal), min_v)
    return round(base * reliability_tco_multiplier(meta), 2)


def _groups_tco(groups: dict[str, dict], suppliers_meta: dict[str, dict]) -> float:
    return round(
        sum(_basket_tco(float(g.get("subtotal_pln") or 0), sid, suppliers_meta) for sid, g in groups.items()),
        2,
    )


def _cheapest_supplier_id(pi: dict) -> Optional[str]:
    bbs = pi.get("best_by_supplier") or {}
    if not bbs:
        return None
    return min(bbs.items(), key=lambda kv: float(kv[1]["line_total"]))[0]


def _log_decision(
    decision_log: Optional[list],
    *,
    product: str,
    chosen_supplier: Optional[str],
    reason_code: str,
    alt_cheaper_supplier: Optional[str] = None,
    price_delta: Optional[float] = None,
    gap_to_min: Optional[float] = None,
    tco_note: Optional[str] = None,
) -> None:
    if decision_log is None:
        return
    entry: dict[str, Any] = {
        "product": product,
        "chosen_supplier": chosen_supplier,
        "reason_code": reason_code,
    }
    if alt_cheaper_supplier is not None:
        entry["alt_cheaper_supplier"] = alt_cheaper_supplier
    if price_delta is not None:
        entry["price_delta"] = round(float(price_delta), 2)
    if gap_to_min is not None:
        entry["gap_to_min"] = round(float(gap_to_min), 2)
    if tco_note:
        entry["tco_note"] = tco_note
    decision_log.append(entry)


def _is_anchor_group(g: dict, suppliers_meta: dict[str, dict]) -> bool:
    """Duży / praktyczny koszyk — warto dokładać tu nawet odrobinę drożej."""
    items = g.get("items") or []
    sub = float(g.get("subtotal_pln") or 0)
    min_v = float(g.get("min_order_value") or _min_order_value(suppliers_meta, g.get("supplier_id") or ""))
    meta = _supplier_meta(suppliers_meta, g.get("supplier_id") or "")
    free_at = float(meta.get("free_shipping_threshold") or 0)
    if len(items) >= ANCHOR_MIN_ITEMS:
        return True
    if min_v > 0 and sub >= min_v:
        return True
    if free_at > 0 and sub >= free_at:
        return True
    return False


def _price_slack_ok(cheapest_lt: float, candidate_lt: float) -> bool:
    """Czy droższy wariant jest 'tylko odrobinę' droższy."""
    delta = candidate_lt - cheapest_lt
    if delta <= 0:
        return True
    if delta <= ANCHOR_PRICE_SLACK_PLN:
        return True
    if cheapest_lt > 0 and delta / cheapest_lt <= ANCHOR_PRICE_SLACK_RATIO:
        return True
    return False


def _pick_practical_supplier(
    pi: dict,
    groups: dict[str, dict],
    suppliers_meta: dict[str, dict],
    decision_log: Optional[list] = None,
) -> Optional[tuple[str, dict]]:
    """
    Wybór dostawcy pod SKU z regułami praktycznymi + TCO:
      1) Nie twórz nowego koszyka, jeśli po dodaniu luka do min > 150 zł.
      2) Score = TCO wszystkich koszyków po dodaniu (produkty + ship + kara min).
      3) Preferuj konsolidację gdy obniża TCO (nawet gdy linia droższa).
      4) Brak legalnej opcji → None (pozycja idzie do missing, nie wymuszamy koszyka).
    """
    bbs = pi.get("best_by_supplier") or {}
    if not bbs:
        return None

    quotes = [(sid, q, float(q["line_total"])) for sid, q in bbs.items()]
    quotes.sort(key=lambda x: x[2])
    cheapest_lt = quotes[0][2]
    cheapest_sid = quotes[0][0]

    scored: list[tuple[tuple, str, dict, float]] = []
    for sid, quote, lt in quotes:
        min_v = _min_order_value(suppliers_meta, sid)
        in_basket = sid in groups
        cur_sub = float(groups[sid]["subtotal_pln"]) if in_basket else 0.0
        projected = cur_sub + lt
        gap_after = _gap_to_min(projected, min_v)
        meets_after = gap_after <= 0
        is_new = not in_basket
        anchor = in_basket and _is_anchor_group(groups[sid], suppliers_meta)

        # TWARDY: nowy koszyk z luką > 150 zł — odrzuć (także exclusive —
        # lepiej missing niż zamówienie 30 zł przy min. 800 zł).
        if is_new and min_v > 0 and gap_after > MAX_GAP_NEW_BASKET_PLN:
            continue
        # TWARDY: istniejący koszyk, który po dodaniu wciąż ma lukę > 150 i nie jest kotwicą
        if in_basket and not meets_after and gap_after > MAX_GAP_NEW_BASKET_PLN and not anchor:
            continue

        # Symuluj TCO po dodaniu linii
        sim: dict[str, dict] = {
            k: {
                "supplier_id": v["supplier_id"],
                "subtotal_pln": float(v.get("subtotal_pln") or 0),
            }
            for k, v in groups.items()
        }
        if sid not in sim:
            sim[sid] = {"supplier_id": sid, "subtotal_pln": 0.0}
        sim[sid]["subtotal_pln"] = projected
        tco_after = _groups_tco(sim, suppliers_meta)

        soft_penalty = 0
        if gap_after > SOFT_GAP_PREFER_ANCHOR_PLN and not meets_after:
            soft_penalty = 1

        under_min_now = False
        if in_basket:
            cur_min = float(groups[sid].get("min_order_value") or min_v or 0)
            under_min_now = cur_min > 0 and _gap_to_min(cur_sub, cur_min) > 0
        prefer_existing = in_basket and (
            (under_min_now and _price_slack_ok(cheapest_lt, lt))
            or (anchor and _price_slack_ok(cheapest_lt, lt))
        )

        # Główny ranking: TCO (niższe = lepsze), potem cena linii / minima
        tier = 0 if prefer_existing else 1
        key = (
            tco_after,
            tier,
            0 if meets_after else 1,
            soft_penalty,
            lt,
            0 if in_basket else 1,
            gap_after,
        )
        scored.append((key, sid, quote, tco_after))

    if not scored:
        # Brak legalnej opcji — NIGDY nie wrzucaj do koszyka z luką > 150.
        _log_decision(
            decision_log,
            product=pi.get("product_name") or "",
            chosen_supplier=None,
            reason_code="NO_LEGAL_BASKET",
            alt_cheaper_supplier=cheapest_sid,
            price_delta=0.0,
            gap_to_min=_gap_to_min(cheapest_lt, _min_order_value(suppliers_meta, cheapest_sid)),
            tco_note="Wszystkie oferty tworzą lukę > MAX_GAP lub są niedostępne.",
        )
        return None

    scored.sort(key=lambda x: x[0])
    best_sid, best_quote, best_tco = scored[0][1], scored[0][2], scored[0][3]
    best_lt = float(best_quote["line_total"])
    reason = "TCO_BEST"
    if best_sid != cheapest_sid:
        reason = "TCO_CONSOLIDATE" if best_lt > cheapest_lt else "TCO_BEST"
    _log_decision(
        decision_log,
        product=pi.get("product_name") or "",
        chosen_supplier=best_sid,
        reason_code=reason,
        alt_cheaper_supplier=cheapest_sid if best_sid != cheapest_sid else None,
        price_delta=round(best_lt - cheapest_lt, 2) if best_sid != cheapest_sid else 0.0,
        gap_to_min=_gap_to_min(
            (float(groups[best_sid]["subtotal_pln"]) if best_sid in groups else 0.0) + best_lt,
            _min_order_value(suppliers_meta, best_sid),
        ),
        tco_note=f"TCO po dodaniu ≈ {best_tco:.2f} zł",
    )
    return best_sid, best_quote


def _cheapest_line_total(pi: dict) -> float:
    bbs = pi.get("best_by_supplier") or {}
    if not bbs:
        return 0.0
    return min(float(q["line_total"]) for q in bbs.values())


def _fill_soft_gaps_min_delta(
    groups: dict[str, dict],
    items: list[dict],
    suppliers_meta: dict[str, dict],
) -> dict[str, dict]:
    """Dopełnij koszyki z luką ≤ 150 zł, przenosząc pozycje o najmniejszej dopłacie.

    Reguła: wolimy droższy SKU u tego samego dostawcy (kotwicy), jeśli dopłata vs
    najtańsza oferta na rynku jest najmniejsza — aż do domknięcia minimum.
    Nie tworzy nowych koszyków; nie rusza pozycji, gdy źródło wpadłoby w lukę > 150 zł.
    """
    item_by_name = {pi["product_name"]: pi for pi in items}

    for _ in range(12):
        # Dopełniaj koszyki poniżej min (soft-luki ≤150; hard-fail i tak usunie purge)
        under = [
            sid for sid, g in groups.items()
            if float(g.get("min_order_value") or 0) > 0
            and _gap_to_min(float(g.get("subtotal_pln") or 0), float(g.get("min_order_value") or 0)) > 0
        ]
        if not under:
            break
        # Najpierw największy koszyk / najbliżej minimum
        under.sort(
            key=lambda s: (
                -len(groups[s].get("items") or []),
                _gap_to_min(float(groups[s].get("subtotal_pln") or 0), float(groups[s].get("min_order_value") or 0)),
            )
        )
        target_sid = under[0]
        target = groups[target_sid]
        gap = _gap_to_min(float(target.get("subtotal_pln") or 0), float(target.get("min_order_value") or 0))
        if gap <= 0:
            break

        candidates: list[tuple[float, str, str, dict]] = []
        for src_sid, src in groups.items():
            if src_sid == target_sid:
                continue
            for line in list(src.get("items") or []):
                pname = line.get("product_name") or ""
                pi = item_by_name.get(pname)
                if not pi:
                    continue
                quote = (pi.get("best_by_supplier") or {}).get(target_sid)
                if not quote:
                    continue
                lt_target = float(quote["line_total"])
                cheapest = _cheapest_line_total(pi)
                delta = max(0.0, lt_target - cheapest)
                # Nie zabieraj ze źródła, jeśli po zabraniu wpadnie w hard-fail
                src_min = float(src.get("min_order_value") or 0)
                src_sub_after = float(src.get("subtotal_pln") or 0) - float(line.get("line_total") or 0)
                if src_min > 0 and _gap_to_min(src_sub_after, src_min) > MAX_GAP_NEW_BASKET_PLN:
                    # OK tylko gdy źródło i tak było soft/hard — wtedy lepiej domknąć kotwicę
                    src_gap_now = _gap_to_min(float(src.get("subtotal_pln") or 0), src_min)
                    if src_gap_now <= MAX_GAP_NEW_BASKET_PLN and float(src.get("subtotal_pln") or 0) >= src_min:
                        continue
                candidates.append((delta, src_sid, pname, quote))

        if not candidates:
            break
        # Preferuj przeniesienie, które najbardziej obniża TCO (kara min + ship)
        def _move_tco_key(cand: tuple) -> tuple:
            delta, src_sid, pname, quote = cand
            lt = float(quote["line_total"])
            src = groups[src_sid]
            tg = groups[target_sid]
            sim = {
                s: {"supplier_id": s, "subtotal_pln": float(g.get("subtotal_pln") or 0)}
                for s, g in groups.items()
            }
            line_lt = next(
                (float(x.get("line_total") or 0) for x in (src.get("items") or []) if x.get("product_name") == pname),
                0.0,
            )
            sim[src_sid]["subtotal_pln"] = float(src.get("subtotal_pln") or 0) - line_lt
            sim[target_sid]["subtotal_pln"] = float(tg.get("subtotal_pln") or 0) + lt
            if sim[src_sid]["subtotal_pln"] <= 0.001:
                del sim[src_sid]
            return (_groups_tco(sim, suppliers_meta), delta, lt)

        candidates.sort(key=_move_tco_key)
        moved = False
        for delta, src_sid, pname, quote in candidates:
            if target_sid not in groups or src_sid not in groups:
                continue
            src = groups[src_sid]
            if not any(x.get("product_name") == pname for x in (src.get("items") or [])):
                continue
            pi = item_by_name.get(pname)
            if not pi:
                continue
            # Usuń ze źródła
            src["items"] = [x for x in src["items"] if x.get("product_name") != pname]
            src["subtotal_pln"] = round(sum(x["line_total"] for x in src["items"]), 2)
            if not src["items"]:
                del groups[src_sid]
            # Dodaj do celu
            tg = groups[target_sid]
            tg["items"] = [x for x in tg["items"] if x.get("product_name") != pname]
            tg["items"].append(_item_line_entry(pi, quote))
            tg["subtotal_pln"] = round(sum(x["line_total"] for x in tg["items"]), 2)
            moved = True
            # Po jednym przeniesieniu — przelicz soft listę
            break
        if not moved:
            break
    return groups


def _new_group(sid: str, quote: dict, suppliers_meta: dict[str, dict]) -> dict:
    return {
        "supplier_id": sid,
        "supplier_name": quote["supplier_name"],
        "supplier_email": quote.get("supplier_email"),
        "items": [],
        "subtotal_pln": 0.0,
        "min_order_value": _min_order_value(suppliers_meta, sid),
    }


def _add_line_to_groups(
    groups: dict[str, dict],
    pi: dict,
    sid: str,
    quote: dict,
    suppliers_meta: dict[str, dict],
) -> None:
    if sid not in groups:
        groups[sid] = _new_group(sid, quote, suppliers_meta)
    g = groups[sid]
    g["items"] = [x for x in g["items"] if x.get("product_name") != pi["product_name"]]
    g["items"].append(_item_line_entry(pi, quote))
    g["subtotal_pln"] = round(sum(x["line_total"] for x in g["items"]), 2)


def _exclusive_share(exclusive_sid: str, exclusive_pi: dict, items: list[dict]) -> tuple[float, int, int]:
    """Udział pozostałych produktów (z ofertami), dla których exclusive_sid jest najtańszy."""
    others = [
        pi for pi in items
        if pi.get("product_name") != exclusive_pi.get("product_name")
        and (pi.get("best_by_supplier") or {})
    ]
    if not others:
        return 1.0, 0, 0
    n_cheap = sum(1 for pi in others if _cheapest_supplier_id(pi) == exclusive_sid)
    return n_cheap / len(others), n_cheap, len(others)


def _simulate_assign_excluding(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    *,
    skip_names: Optional[set[str]] = None,
    force_sid_for: Optional[dict[str, str]] = None,
) -> tuple[dict[str, dict], list[str], float]:
    """Lekka symulacja przydziału (TCO pick). Exclusive spoza force_map są pomijane."""
    skip_names = skip_names or set()
    force_sid_for = force_sid_for or {}
    groups: dict[str, dict] = {}
    missing: list[str] = []
    ordered = sorted(
        [pi for pi in items if pi.get("product_name") not in skip_names],
        key=lambda pi: -max(
            (float(q["line_total"]) for q in (pi.get("best_by_supplier") or {}).values()),
            default=0.0,
        ),
    )
    for pi in ordered:
        bbs = pi.get("best_by_supplier") or {}
        pname = pi["product_name"]
        if not bbs:
            missing.append(pname)
            continue
        # Inne exclusive — nie otwieraj tu (osobny gate); tylko force_map
        if len(bbs) == 1 and pname not in force_sid_for:
            continue
        force = force_sid_for.get(pname)
        if force and force in bbs:
            quote = bbs[force]
            min_v = _min_order_value(suppliers_meta, force)
            cur = float(groups[force]["subtotal_pln"]) if force in groups else 0.0
            gap = _gap_to_min(cur + float(quote["line_total"]), min_v)
            if min_v > 0 and gap > MAX_GAP_NEW_BASKET_PLN and force not in groups:
                missing.append(pname)
                continue
            if force in groups and min_v > 0 and gap > MAX_GAP_NEW_BASKET_PLN:
                missing.append(pname)
                continue
            _add_line_to_groups(groups, pi, force, quote, suppliers_meta)
            continue
        picked = _pick_practical_supplier(pi, groups, suppliers_meta, decision_log=None)
        if not picked:
            missing.append(pname)
            continue
        sid, quote = picked
        _add_line_to_groups(groups, pi, sid, quote, suppliers_meta)
    item_by_name = {pi["product_name"]: pi for pi in items}
    groups, missing = _purge_under_min_groups(groups, item_by_name, suppliers_meta, missing)
    return groups, missing, _groups_tco(groups, suppliers_meta)


def _evaluate_exclusive_anchor(
    exclusive_pi: dict,
    exclusive_sid: str,
    items: list[dict],
    suppliers_meta: dict[str, dict],
    decision_log: Optional[list],
    skip_names: Optional[set[str]] = None,
) -> tuple[bool, Optional[dict[str, dict]], list[str], float]:
    """
    Exclusive SKU (oferta tylko u 1 dostawcy):
      • Jeśli sibling-exclusive u tego dostawcy już dają koszyk z luką ≤ MAX_GAP
        → kotwica bez filtra 50% (TCO vs „wszystko missing”).
      • W przeciwnym razie (trzeba ściągać fillery): filtr ≥50% najtańszych u S
        + bramka TCO (konsolidacja vs exclusive jako missing).
    """
    skip_names = set(skip_names or [])
    pname = exclusive_pi["product_name"]
    quote = (exclusive_pi.get("best_by_supplier") or {}).get(exclusive_sid)
    if not quote:
        return False, None, [pname], 0.0

    # Sibling exclusives u tego samego dostawcy (jeszcze nie odrzucone)
    siblings = [
        pi for pi in items
        if pi.get("product_name") not in skip_names
        and len(pi.get("best_by_supplier") or {}) == 1
        and exclusive_sid in (pi.get("best_by_supplier") or {})
    ]
    sibling_names = {pi["product_name"] for pi in siblings}
    sibling_sub = 0.0
    force_siblings: dict[str, str] = {}
    for pi in siblings:
        q = (pi.get("best_by_supplier") or {})[exclusive_sid]
        sibling_sub += float(q["line_total"])
        force_siblings[pi["product_name"]] = exclusive_sid

    min_v = _min_order_value(suppliers_meta, exclusive_sid)
    sibling_gap = _gap_to_min(sibling_sub, min_v)
    needs_fillers = min_v > 0 and sibling_gap > MAX_GAP_NEW_BASKET_PLN

    share, n_cheap, n_other = _exclusive_share(exclusive_sid, exclusive_pi, [
        pi for pi in items if pi.get("product_name") not in skip_names
    ])

    if needs_fillers and n_other > 0 and share < EXCLUSIVE_CHEAPEST_SHARE:
        _log_decision(
            decision_log,
            product=pname,
            chosen_supplier=None,
            reason_code="EXCLUSIVE_BELOW_50PCT",
            gap_to_min=sibling_gap,
            tco_note=(
                f"Exclusive u {exclusive_sid}: luka siblingów {sibling_gap:.0f} zł wymaga fillerów, "
                f"ale tylko {n_cheap}/{n_other} ({share:.0%}) pozostałych ma tu najtańszą ofertę (<50%)."
            ),
        )
        return False, None, list(sibling_names), 0.0

    # Fillers gdy potrzeba / gdy 50% OK: produkty z najtańszą ofertą u exclusive_sid
    force_map: dict[str, str] = dict(force_siblings)
    if needs_fillers or share >= EXCLUSIVE_CHEAPEST_SHARE:
        for pi in items:
            n = pi.get("product_name") or ""
            if n in skip_names or n in force_map:
                continue
            bbs = pi.get("best_by_supplier") or {}
            if exclusive_sid in bbs and _cheapest_supplier_id(pi) == exclusive_sid:
                force_map[n] = exclusive_sid

    # Plan A: konsolidacja exclusive (+siblings + fillers)
    groups_a, miss_a, tco_a = _simulate_assign_excluding(
        items, suppliers_meta, skip_names=skip_names, force_sid_for=force_map,
    )
    has_excl = any(
        any(it.get("product_name") == pname for it in (g.get("items") or []))
        for g in groups_a.values()
    )
    if not has_excl or exclusive_sid not in groups_a:
        _log_decision(
            decision_log,
            product=pname,
            chosen_supplier=None,
            reason_code="EXCLUSIVE_HARD_GAP",
            gap_to_min=sibling_gap,
            tco_note="Konsolidacja exclusive nadal przekracza MAX_GAP — brak koszyka.",
        )
        return False, None, list(sibling_names), 0.0

    excl_g = groups_a[exclusive_sid]
    excl_gap = _gap_to_min(
        float(excl_g.get("subtotal_pln") or 0),
        float(excl_g.get("min_order_value") or 0),
    )
    if excl_gap > MAX_GAP_NEW_BASKET_PLN:
        _log_decision(
            decision_log,
            product=pname,
            chosen_supplier=None,
            reason_code="EXCLUSIVE_HARD_GAP",
            gap_to_min=excl_gap,
            tco_note=f"Koszyk exclusive luka {excl_gap:.0f} zł > {MAX_GAP_NEW_BASKET_PLN:.0f}.",
        )
        return False, None, list(sibling_names), 0.0

    # Plan B: exclusive siblings jako missing
    groups_b, miss_b, tco_b = _simulate_assign_excluding(
        items, suppliers_meta, skip_names=skip_names | sibling_names,
    )

    # Gdy siblingi same spełniają soft/hard OK — TCO_A zwykle wygrywa vs brak towaru.
    # Gdy fillery: wymagaj TCO_A <= TCO_B.
    tco_ok = (not needs_fillers) or (tco_a <= tco_b) or (not groups_b)
    if tco_ok:
        reason = "EXCLUSIVE_SIBLING_OK" if not needs_fillers else "EXCLUSIVE_TCO_OK"
        _log_decision(
            decision_log,
            product=pname,
            chosen_supplier=exclusive_sid,
            reason_code=reason,
            gap_to_min=excl_gap,
            tco_note=(
                f"share={share:.0%} needs_fillers={needs_fillers}. "
                f"TCO A={tco_a:.2f} vs B(bez excl)={tco_b:.2f}."
            ),
        )
        # Zwróć TYLKO koszyk exclusive_sid (nie całe plan A — inne exclusive oceniamy osobno)
        only = {
            exclusive_sid: {
                "supplier_id": excl_g["supplier_id"],
                "supplier_name": excl_g["supplier_name"],
                "supplier_email": excl_g.get("supplier_email"),
                "items": [dict(x) for x in (excl_g.get("items") or [])],
                "subtotal_pln": float(excl_g.get("subtotal_pln") or 0),
                "min_order_value": float(excl_g.get("min_order_value") or 0),
            }
        }
        return True, only, [], tco_a

    _log_decision(
        decision_log,
        product=pname,
        chosen_supplier=None,
        reason_code="EXCLUSIVE_TCO_WORSE",
        gap_to_min=excl_gap,
        tco_note=(
            f"50% OK ({share:.0%}), ale TCO konsolidacji {tco_a:.2f} > "
            f"bez exclusive {tco_b:.2f} — SKU jako missing."
        ),
    )
    return False, None, list(sibling_names), 0.0


def _product_norm_key(name: str) -> str:
    s = (name or "").lower().strip()
    trans = str.maketrans({
        "ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n",
        "ó": "o", "ś": "s", "ź": "z", "ż": "z",
    })
    s = s.translate(trans)
    return " ".join(s.split())


def _is_non_perishable_like(product_name: str) -> bool:
    key = _product_norm_key(product_name)
    return any(k in key for k in _NON_PERISHABLE_KEYWORDS)


def compute_priority_score(
    *,
    sales_rank: float = 0.0,
    usage_rank: float = 0.0,
    waste_rank: float = 0.0,
    low_stock: bool = False,
    critical_shortage: bool = False,
) -> dict[str, Any]:
    """
    Priority 0–1 per SKU for compare-offers ordering.
    Class A / critical when high sales OR high usage OR low stock vs buffer
    OR frequent in critical shortages (flag).
    """
    score = (
        0.35 * max(0.0, min(1.0, float(sales_rank)))
        + 0.30 * max(0.0, min(1.0, float(usage_rank)))
        + 0.15 * max(0.0, min(1.0, float(waste_rank)))
        + (0.15 if low_stock else 0.0)
        + (0.25 if critical_shortage else 0.0)
    )
    score = round(min(1.0, score), 4)
    reasons: list[str] = []
    if sales_rank >= 0.6:
        reasons.append("high_sales")
    if usage_rank >= 0.6:
        reasons.append("high_usage")
    if low_stock:
        reasons.append("low_stock")
    if critical_shortage:
        reasons.append("critical_shortage")
    if waste_rank >= 0.7:
        reasons.append("top_waste")
    class_a = (
        score >= CLASS_A_SCORE_THRESHOLD
        or critical_shortage
        or sales_rank >= 0.75
        or usage_rank >= 0.75
        or low_stock
    )
    return {
        "score": score,
        "class_a": bool(class_a),
        "reasons": reasons,
    }


def resolve_kitchen_priority(
    pi: dict,
    kitchen_priorities: Optional[dict[str, dict]] = None,
) -> dict[str, Any]:
    """Lookup priority by inventory_id / food_key / product_name."""
    kp = kitchen_priorities or {}
    keys: list[str] = []
    if pi.get("inventory_id"):
        keys.append(str(pi["inventory_id"]))
    if pi.get("food_key"):
        keys.append(str(pi["food_key"]))
    pname = pi.get("product_name") or ""
    keys.append(_product_norm_key(pname))
    keys.append(pname.lower().strip())
    for k in keys:
        if k and k in kp:
            row = dict(kp[k])
            row.setdefault("score", float(row.get("score") or 0))
            row.setdefault("class_a", bool(row.get("class_a")))
            return row
    # optional nested map by name
    by_name = kp.get("_by_name") if isinstance(kp.get("_by_name"), dict) else None
    if by_name:
        hit = by_name.get(_product_norm_key(pname))
        if hit:
            return dict(hit)
    return {"score": 0.0, "class_a": False, "reasons": []}


def attach_kitchen_priorities(
    items: list[dict],
    kitchen_priorities: Optional[dict[str, dict]] = None,
) -> list[dict]:
    """Stamp kitchen_priority / kitchen_class_a onto each per_item row."""
    out = []
    for pi in items:
        row = dict(pi)
        pri = resolve_kitchen_priority(row, kitchen_priorities)
        row["kitchen_priority"] = float(pri.get("score") or 0)
        row["kitchen_class_a"] = bool(pri.get("class_a"))
        row["kitchen_priority_reasons"] = list(pri.get("reasons") or [])
        out.append(row)
    return out


def sort_items_by_kitchen_priority(items: list[dict]) -> list[dict]:
    """Class A / high score first, then by line value (stable for assignment)."""
    def _key(pi: dict) -> tuple:
        pri = float(pi.get("kitchen_priority") or 0)
        class_a = 1 if pi.get("kitchen_class_a") else 0
        line = max(
            (float(q.get("line_total") or 0) for q in (pi.get("best_by_supplier") or {}).values()),
            default=0.0,
        )
        return (-class_a, -pri, -line)

    return sorted(items, key=_key)


def apply_packaging_band_filter(
    items: list[dict],
    decision_log: Optional[list] = None,
) -> list[dict]:
    """
    Prefer packs that fit demand band [quantity_min..quantity_max] / base band.
    Reject huge oversize bags when demand is small (unless non-perishable-like
    OR oversize is the only remaining quote). Logs PACK_OVERSIZE.
    """
    out: list[dict] = []
    for pi in items:
        row = dict(pi)
        bbs = dict(row.get("best_by_supplier") or {})
        if not bbs:
            out.append(row)
            continue
        target = float(
            row.get("base_quantity")
            or row.get("quantity")
            or 0
        )
        # band hi in base units: prefer explicit from quotes, else ±10%
        band_hi = target * 1.1
        for q in bbs.values():
            try:
                th = float(q.get("band_hi_base") or 0)
                if th > 0:
                    band_hi = max(band_hi, th)
            except (TypeError, ValueError):
                pass
        try:
            qmax = float(row.get("quantity_max") or 0)
            # quantity_max may be display units — if close to quantity, treat as display
            qty = float(row.get("quantity") or target)
            if qmax > 0 and qty > 0:
                # scale max into base proportionally
                band_hi = max(band_hi, target * (qmax / qty) if qty else qmax)
        except (TypeError, ValueError):
            pass

        perishable = not _is_non_perishable_like(str(row.get("product_name") or ""))
        kept: dict[str, dict] = {}
        rejected: list[tuple[str, float]] = []
        for sid, q in bbs.items():
            try:
                pack = float(q.get("pack_base_qty") or 0)
            except (TypeError, ValueError):
                pack = 0.0
            oversize = (
                pack > 1.001
                and band_hi > 0
                and pack > band_hi * PACK_OVERSIZE_RATIO + 1e-9
            )
            if oversize and perishable:
                rejected.append((sid, pack))
                continue
            kept[sid] = q

        if not kept and rejected:
            # keep cheapest oversize — can't leave product without quotes
            cheapest_sid = min(
                rejected,
                key=lambda sp: float((bbs[sp[0]].get("line_total") or 1e18)),
            )[0]
            kept[cheapest_sid] = bbs[cheapest_sid]
            rejected = [r for r in rejected if r[0] != cheapest_sid]

        for sid, pack in rejected:
            _log_decision(
                decision_log,
                product=str(row.get("product_name") or ""),
                chosen_supplier=None,
                reason_code="PACK_OVERSIZE",
                alt_cheaper_supplier=sid,
                tco_note=(
                    f"Odrzucono opakowanie {pack:g} (band_hi≈{band_hi:.2f}) — "
                    "zbyt duże względem zapotrzebowania."
                ),
            )
        row["best_by_supplier"] = kept
        out.append(row)
    return out


def build_deal_hunter_suggestions(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    *,
    split_scenario: Optional[dict] = None,
    decision_log: Optional[list] = None,
    waste_top: Optional[list[dict]] = None,
    fillers: Optional[list[dict]] = None,
) -> list[dict]:
    """
    Math-first suggestions from DB / basket signals.
    Types: soft_gap_filler | waste_qty_reduce | lead_time_note | decision_note
    """
    suggestions: list[dict] = []
    waste_keys = {
        _product_norm_key(str(w.get("name") or w.get("item_name") or w.get("ingredient_name") or ""))
        for w in (waste_top or [])
        if (w.get("name") or w.get("item_name") or w.get("ingredient_name"))
    }
    waste_keys.discard("")

    # Soft gap ≤ MAX_GAP → filler suggestions from long-shelf / high-rotation catalog
    for g in (split_scenario or {}).get("suppliers") or []:
        gap = float(g.get("gap_to_minimum_pln") or 0)
        meets = g.get("meets_minimum_order")
        if gap <= 0 or meets is True:
            continue
        if gap > MAX_GAP_NEW_BASKET_PLN:
            continue
        sid = g.get("supplier_id")
        sname = g.get("supplier_name") or sid
        filler_names = [f.get("name") for f in (fillers or []) if f.get("name")][:5]
        sub = float(g.get("subtotal_pln") or 0)
        min_v = float(g.get("min_order_value") or 0)
        if filler_names:
            msg = (
                f"U {sname} brakuje {gap:.0f} zł do minimum "
                f"({sub:.0f}/{min_v:.0f} zł, luka ≤{MAX_GAP_NEW_BASKET_PLN:.0f}). "
                f"Dopnij koszyk: {', '.join(str(n) for n in filler_names[:4])}."
            )
        else:
            msg = (
                f"U {sname} brakuje {gap:.0f} zł do minimum zamówienia "
                f"(obecnie {sub:.0f} zł, próg {min_v:.0f} zł). "
                "Dodaj pozycje o długim terminie / wysokiej rotacji u tego dostawcy, "
                "zamiast otwierać drugi koszyk."
            )
        suggestions.append({
            "type": "soft_gap_filler",
            "supplier_id": sid,
            "message": msg,
            "evidence": {
                "gap_to_minimum_pln": gap,
                "max_gap_pln": MAX_GAP_NEW_BASKET_PLN,
                "subtotal_pln": sub,
                "min_order_value": min_v,
                "filler_candidates": filler_names,
            },
            "action": "add_filler",
        })

    # TOP waste + large order qty → reduce suggestion
    for pi in items:
        pname = str(pi.get("product_name") or "")
        key = _product_norm_key(pname)
        if key not in waste_keys:
            continue
        qty = float(pi.get("quantity") or pi.get("target_quantity") or 0)
        # "large" heuristic: quantity clearly above small retail pack
        if qty < 2:
            continue
        # bump if class A waste reason or simply in top list
        suggestions.append({
            "type": "waste_qty_reduce",
            "product_name": pname,
            "message": (
                f"„{pname}” jest w TOP strat (30 dni), a zamawiasz {qty:g} "
                f"{pi.get('unit') or ''}. Rozważ mniejszą ilość / krótszy cykl."
            ).strip(),
            "evidence": {
                "in_waste_top_30d": True,
                "order_qty": qty,
                "unit": pi.get("unit"),
            },
            "action": "reduce_qty",
        })

    # Class A + cheaper supplier has long lead_time (NULL → DEFAULT_LEAD_TIME_DAYS)
    for pi in items:
        if not pi.get("kitchen_class_a"):
            continue
        bbs = pi.get("best_by_supplier") or {}
        if len(bbs) < 2:
            continue
        quotes = sorted(bbs.items(), key=lambda kv: float(kv[1].get("line_total") or 1e18))
        cheap_sid, cheap_q = quotes[0]
        cheap_meta = _supplier_meta(suppliers_meta, cheap_sid)
        lead_d = resolve_lead_time_days(cheap_meta)
        lead_assumed = cheap_meta.get("lead_time_days") is None
        if lead_d < LEAD_TIME_SLOW_DAYS:
            continue
        alt_sid, alt_q = quotes[1] if len(quotes) > 1 else (None, None)
        alt_meta = _supplier_meta(suppliers_meta, alt_sid) if alt_sid else {}
        alt_lead = resolve_lead_time_days(alt_meta) if alt_sid else None
        alt_name = (alt_q or {}).get("supplier_name") if alt_q else None
        cheap_name = cheap_q.get("supplier_name") or cheap_sid
        assumed = " (domyślnie — uzupełnij czas dostawy)" if lead_assumed else ""
        msg = (
            f"Krytyczny SKU „{pi.get('product_name')}”: najtańszy ({cheap_name}) "
            f"ma czas dostawy ~{lead_d:.0f} dni{assumed}."
        )
        if alt_name and alt_lead is not None:
            msg += f" Alternatywa: {alt_name} (~{float(alt_lead):.0f} dni)."
        elif alt_name:
            msg += f" Rozważ szybszego dostawcę: {alt_name}."
        suggestions.append({
            "type": "lead_time_note",
            "product_name": pi.get("product_name"),
            "supplier_id": cheap_sid,
            "message": msg,
            "evidence": {
                "lead_time_days": lead_d,
                "lead_time_is_default": lead_assumed,
                "cheaper_supplier_id": cheap_sid,
                "alt_supplier_id": alt_sid,
                "alt_lead_time_days": alt_lead,
            },
            "action": "review_lead_time",
        })

    # Reliability note when score is known and below threshold
    for sid, meta in (suppliers_meta or {}).items():
        score = meta.get("reliability_score")
        if score is None:
            continue
        try:
            s = float(score)
        except (TypeError, ValueError):
            continue
        if s >= RELIABILITY_TCO_THRESHOLD:
            continue
        suggestions.append({
            "type": "reliability_note",
            "supplier_id": sid,
            "message": (
                f"Dostawca {meta.get('name') or sid}: Reliability Score {s:.0%} "
                f"(< {RELIABILITY_TCO_THRESHOLD:.0%}) — TCO lekko podniesione."
            ),
            "evidence": {"reliability_score": s, "threshold": RELIABILITY_TCO_THRESHOLD},
            "action": "review_reliability",
        })

    # Expose key decision_log entries as suggestion notes
    for entry in (decision_log or [])[:12]:
        code = entry.get("reason_code") or ""
        if code not in (
            "EXCLUSIVE_TCO_OK",
            "EXCLUSIVE_BELOW_50PCT",
            "EXCLUSIVE_SIBLING_OK",
            "PACK_OVERSIZE",
            "HARD_GAP",
            "TCO_CONSOLIDATE",
        ):
            continue
        suggestions.append({
            "type": "decision_note",
            "product_name": entry.get("product"),
            "supplier_id": entry.get("chosen_supplier"),
            "message": entry.get("tco_note") or f"Decyzja: {code}",
            "evidence": {
                "reason_code": code,
                "price_delta": entry.get("price_delta"),
                "gap_to_min": entry.get("gap_to_min"),
            },
        })

    return suggestions


def _assign_all_practical(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    decision_log: Optional[list] = None,
) -> tuple[dict[str, dict], list[str]]:
    """Przydziel wszystkie SKU: exclusive gate → TCO pick dla pozostałych.

    Kolejność: kitchen Class A / priority score, potem wartość linii.
    """
    groups: dict[str, dict] = {}
    missing: list[str] = []
    assigned: set[str] = set()

    exclusives = [
        pi for pi in items
        if len(pi.get("best_by_supplier") or {}) == 1
    ]
    exclusives = sort_items_by_kitchen_priority(exclusives)

    seen_excl_sids: set[str] = set()
    for epi in exclusives:
        if epi["product_name"] in assigned:
            continue
        esid = next(iter(epi["best_by_supplier"]))
        if esid in seen_excl_sids:
            continue
        seen_excl_sids.add(esid)
        ok, plan_groups, miss_extra, _tco = _evaluate_exclusive_anchor(
            epi, esid, items, suppliers_meta, decision_log,
            skip_names=assigned,
        )
        if not ok:
            for m in miss_extra:
                if m not in missing:
                    missing.append(m)
                assigned.add(m)
            continue
        assert plan_groups is not None
        for sid, g in plan_groups.items():
            if sid not in groups:
                groups[sid] = {
                    "supplier_id": g["supplier_id"],
                    "supplier_name": g["supplier_name"],
                    "supplier_email": g.get("supplier_email"),
                    "items": [],
                    "subtotal_pln": 0.0,
                    "min_order_value": float(g.get("min_order_value") or 0),
                }
            for it in list(g.get("items") or []):
                n = it.get("product_name") or ""
                if n in assigned:
                    continue
                src_pi = next((x for x in items if x["product_name"] == n), None)
                q = (src_pi.get("best_by_supplier") or {}).get(sid) if src_pi else None
                if src_pi and q:
                    _add_line_to_groups(groups, src_pi, sid, q, suppliers_meta)
                    assigned.add(n)
        for m in miss_extra:
            if m not in missing:
                missing.append(m)
            assigned.add(m)

    ordered = sort_items_by_kitchen_priority(items)
    for pi in ordered:
        pname = pi["product_name"]
        if pname in assigned:
            continue
        if not (pi.get("best_by_supplier") or {}):
            missing.append(pname)
            assigned.add(pname)
            continue
        if len(pi.get("best_by_supplier") or {}) == 1:
            if pname not in missing:
                missing.append(pname)
            _log_decision(
                decision_log,
                product=pname,
                chosen_supplier=None,
                reason_code="EXCLUSIVE_UNHANDLED",
                tco_note="Exclusive pominięte w gate — oznaczono jako missing.",
            )
            assigned.add(pname)
            continue

        picked = _pick_practical_supplier(pi, groups, suppliers_meta, decision_log)
        if not picked:
            if pname not in missing:
                missing.append(pname)
            assigned.add(pname)
            continue
        sid, quote = picked
        _add_line_to_groups(groups, pi, sid, quote, suppliers_meta)
        assigned.add(pname)
    return groups, missing


def _scenario_from_groups(
    scenario_id: str,
    label: str,
    description: str,
    groups: list[dict],
    missing: list[str],
    suppliers_meta: dict[str, dict],
    decision_log: Optional[list] = None,
) -> dict:
    enriched_all = [_enrich_group(g, suppliers_meta) for g in groups]
    # TWARDY FILTR: koszyk z luką > 150 zł do min → produkty do missing (notka), nie do zamówienia
    miss = list(missing or [])
    enriched: list[dict] = []
    for g in enriched_all:
        gap = float(g.get("gap_to_minimum_pln") or 0)
        min_v = float(g.get("min_order_value") or 0)
        if g.get("meets_minimum_order"):
            enriched.append(g)
            continue
        if min_v > 0 and gap > MAX_GAP_NEW_BASKET_PLN:
            for it in g.get("items") or []:
                n = (it.get("product_name") or "").strip()
                if n and n not in miss:
                    miss.append(n)
                    _log_decision(
                        decision_log,
                        product=n,
                        chosen_supplier=None,
                        reason_code="PURGED_HARD_GAP",
                        gap_to_min=gap,
                        tco_note=(
                            f"Usunięto koszyk {g.get('supplier_name')} — "
                            f"luka {gap:.0f} zł > {MAX_GAP_NEW_BASKET_PLN:.0f}."
                        ),
                    )
            continue
        # Luka ≤ 150 zł — zostaw w UI jako „wymaga dopięcia”
        enriched.append(g)
    products = round(sum(g["subtotal_pln"] for g in enriched), 2)
    shipping = round(sum(g["shipping_pln"] for g in enriched), 2)
    total = round(products + shipping, 2)
    all_meet = all(g["meets_minimum_order"] for g in enriched) if enriched else False
    tco_total = round(
        sum(
            _basket_tco(float(g["subtotal_pln"]), g["supplier_id"], suppliers_meta)
            for g in enriched
        ),
        2,
    )
    out = {
        "id": scenario_id,
        "label": label,
        "description": description,
        "suppliers": enriched,
        "products_pln": products,
        "shipping_pln": shipping,
        "total_pln": total,
        "tco_pln": tco_total,
        "supplier_count": len(enriched),
        "meets_all_minimums": all_meet,
        "missing": miss,
        # viable = da się wysłać bez dopinania; missing to tylko notka (nie blokuje kafla)
        "viable": bool(enriched) and all_meet,
    }
    if decision_log is not None:
        out["decision_log"] = list(decision_log)
    return out


def _purge_under_min_groups(
    groups: dict[str, dict],
    item_by_name: dict[str, dict],
    suppliers_meta: dict[str, dict],
    missing: list[str],
) -> tuple[dict[str, dict], list[str]]:
    """Usuwa koszyki z luką > 150 zł do min; próbuje przenieść linie do kotwic."""
    miss = list(missing)

    def _gap(g: dict) -> float:
        return _gap_to_min(float(g.get("subtotal_pln") or 0), float(g.get("min_order_value") or 0))

    def _is_hard_fail(g: dict) -> bool:
        mv = float(g.get("min_order_value") or 0)
        if mv <= 0:
            return False
        return _gap(g) > MAX_GAP_NEW_BASKET_PLN

    for _ in range(len(groups) + 2):
        failing = [sid for sid, g in groups.items() if _is_hard_fail(g)]
        if not failing:
            break
        broken_sid = min(failing, key=lambda s: groups[s]["subtotal_pln"])
        broken = groups[broken_sid]
        for line in list(broken.get("items") or []):
            pname = line.get("product_name")
            pi = item_by_name.get(pname or "")
            if not pi:
                if pname and pname not in miss:
                    miss.append(pname)
                continue
            # Preferuj kotwice / istniejące koszyki z luką ≤ 150
            bbs = pi.get("best_by_supplier") or {}
            # tymczasowo bez broken
            tmp = {k: v for k, v in groups.items() if k != broken_sid}
            picked = _pick_practical_supplier(pi, tmp, suppliers_meta)
            if picked is None:
                if pname and pname not in miss:
                    miss.append(pname)
                continue
            target_sid, quote = picked
            if target_sid == broken_sid:
                if pname and pname not in miss:
                    miss.append(pname)
                continue
            lt = float(quote["line_total"])
            min_v = _min_order_value(suppliers_meta, target_sid)
            if target_sid not in groups:
                if min_v > 0 and _gap_to_min(lt, min_v) > MAX_GAP_NEW_BASKET_PLN:
                    if pname and pname not in miss:
                        miss.append(pname)
                    continue
                groups[target_sid] = {
                    "supplier_id": target_sid,
                    "supplier_name": quote["supplier_name"],
                    "supplier_email": quote.get("supplier_email"),
                    "items": [],
                    "subtotal_pln": 0.0,
                    "min_order_value": min_v,
                }
            else:
                projected = float(groups[target_sid]["subtotal_pln"]) + lt
                if min_v > 0 and _gap_to_min(projected, min_v) > MAX_GAP_NEW_BASKET_PLN:
                    if pname and pname not in miss:
                        miss.append(pname)
                    continue
            tg = groups[target_sid]
            tg["items"] = [x for x in tg["items"] if x.get("product_name") != pname]
            tg["items"].append(_item_line_entry(pi, quote))
            tg["subtotal_pln"] = round(sum(x["line_total"] for x in tg["items"]), 2)
        del groups[broken_sid]

    # Soft-fail (luka ≤ 150) zostaje — FE pokazuje badge i blokuje wysyłkę.
    # Hard-fail bez reassignment → missing
    for sid in list(groups.keys()):
        if _is_hard_fail(groups[sid]):
            for line in groups[sid].get("items") or []:
                n = line.get("product_name")
                if n and n not in miss:
                    miss.append(n)
            del groups[sid]
    return groups, miss


def compute_split_max(
    items: list[dict],
    suppliers_meta: dict[str, dict],
) -> dict:
    """
    Split praktyczny: przydział SKU z regułami kotwic / minimów / TCO,
    potem naprawa koszyków poniżej min i purge luk > 150 zł.
    """
    decision_log: list = []
    # Packaging band first — drop oversize quotes before assignment
    items = apply_packaging_band_filter(items, decision_log)
    groups, missing = _assign_all_practical(items, suppliers_meta, decision_log)
    item_by_name = {pi["product_name"]: pi for pi in items}

    def _failing() -> list[str]:
        return [
            sid for sid, g in groups.items()
            if not (g.get("min_order_value", 0) <= 0
                    or g["subtotal_pln"] >= g.get("min_order_value", 0))
        ]

    for _ in range(8):
        failing = _failing()
        if not failing:
            break
        failing.sort(key=lambda sid: groups[sid]["subtotal_pln"])
        broken_sid = failing[0]
        broken = groups[broken_sid]
        moved_any = False
        for line in list(broken["items"]):
            pname = line["product_name"]
            pi = item_by_name.get(pname)
            if not pi:
                continue
            broken["items"] = [x for x in broken["items"] if x["product_name"] != pname]
            broken["subtotal_pln"] = round(sum(x["line_total"] for x in broken["items"]), 2)
            picked = _pick_practical_supplier(pi, groups, suppliers_meta, decision_log)
            if not picked or picked[0] == broken_sid:
                broken["items"].append(line)
                broken["subtotal_pln"] = round(sum(x["line_total"] for x in broken["items"]), 2)
                continue
            target_sid, quote = picked
            if target_sid not in groups:
                min_v = _min_order_value(suppliers_meta, target_sid)
                lt = float(quote["line_total"])
                if min_v > 0 and _gap_to_min(lt, min_v) > MAX_GAP_NEW_BASKET_PLN:
                    broken["items"].append(line)
                    broken["subtotal_pln"] = round(sum(x["line_total"] for x in broken["items"]), 2)
                    continue
                groups[target_sid] = {
                    "supplier_id": target_sid,
                    "supplier_name": quote["supplier_name"],
                    "supplier_email": quote.get("supplier_email"),
                    "items": [],
                    "subtotal_pln": 0.0,
                    "min_order_value": min_v,
                }
            tg = groups[target_sid]
            tg["items"] = [x for x in tg["items"] if x["product_name"] != pname]
            tg["items"].append(_item_line_entry(pi, quote))
            tg["subtotal_pln"] = round(sum(x["line_total"] for x in tg["items"]), 2)
            moved_any = True

        if not broken["items"]:
            del groups[broken_sid]
        if not moved_any:
            break

    # Najpierw dopełnij soft/exclusive luki (zanim purge wyrzuci exclusive SKU)
    groups = _fill_soft_gaps_min_delta(groups, items, suppliers_meta)
    groups, missing = _purge_under_min_groups(groups, item_by_name, suppliers_meta, missing)
    groups = _fill_soft_gaps_min_delta(groups, items, suppliers_meta)
    groups, missing = _purge_under_min_groups(groups, item_by_name, suppliers_meta, missing)

    group_list = list(groups.values())
    for g in group_list:
        g["meets_minimum_order"] = (
            g.get("min_order_value", 0) <= 0
            or g["subtotal_pln"] >= g.get("min_order_value", 0)
        )

    return _scenario_from_groups(
        "split_max",
        "Najniższa cena (rozbite zamówienie)",
        "Kupujemy tam, gdzie najtaniej — z uwzględnieniem minimów, TCO i dużych koszyków.",
        group_list,
        missing,
        suppliers_meta,
        decision_log=decision_log,
    )


def compute_monolith_scenario(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    max_suppliers: int = 2,
) -> dict:
    """
    Monolit / konsolidacja: NAJPIERW 1 dostawca z pełnym pokryciem (wygoda),
    dopiero gdy żaden nie pokrywa 100% — para (max 2).
    Wybór 1 dostawcy: min total z shippingiem (nie tylko suma produktów).
    """
    # --- 1 dostawca: pełne pokrycie, najniższy total z dostawą ---
    best_one: Optional[dict] = None
    all_sids: set[str] = set()
    for pi in items:
        all_sids.update((pi.get("best_by_supplier") or {}).keys())
    for sid in all_sids:
        quotes = []
        ok = True
        for pi in items:
            q = (pi.get("best_by_supplier") or {}).get(sid)
            if not q:
                ok = False
                break
            quotes.append((pi, q))
        if not ok or not quotes:
            continue
        g = {
            "supplier_id": sid,
            "supplier_name": quotes[0][1]["supplier_name"],
            "supplier_email": quotes[0][1].get("supplier_email"),
            "items": [_item_line_entry(pi, q) for pi, q in quotes],
            "subtotal_pln": round(sum(float(q["line_total"]) for _, q in quotes), 2),
            "min_order_value": _min_order_value(suppliers_meta, sid),
        }
        enriched = _enrich_group(g, suppliers_meta)
        if not enriched.get("meets_minimum_order"):
            continue
        if best_one is None or float(enriched["total_pln"]) < float(best_one["total_pln"]):
            best_one = enriched

    if best_one:
        return _scenario_from_groups(
            "monolith",
            "Wygoda (mało dostaw)",
            "Skupiamy zamówienie u 1–2 dostawców — mniej paczek, prostsza logistyka.",
            [{
                "supplier_id": best_one["supplier_id"],
                "supplier_name": best_one["supplier_name"],
                "supplier_email": best_one.get("supplier_email"),
                "items": best_one["items"],
                "subtotal_pln": best_one["subtotal_pln"],
                "min_order_value": best_one.get("min_order_value", 0),
            }],
            [],
            suppliers_meta,
        )

    mono = compute_monolith(items, suppliers_meta)

    if max_suppliers < 2 or not items:
        if mono:
            g = {
                "supplier_id": mono["supplier_id"],
                "supplier_name": mono["supplier_name"],
                "supplier_email": mono.get("supplier_email"),
                "items": mono["items"],
                "subtotal_pln": mono["subtotal_pln"],
                "min_order_value": mono.get("min_order_value", 0),
            }
            return _scenario_from_groups(
                "monolith",
                "Wygoda (mało dostaw)",
                "Najlepszy pojedynczy dostawca (częściowe pokrycie).",
                [g],
                list(mono.get("missing") or []),
                suppliers_meta,
            )
        return _empty_monolith()

    # --- Pary tylko gdy 1 dostawca nie pokrywa asortymentu ---
    all_sids: set[str] = set()
    for pi in items:
        all_sids.update((pi.get("best_by_supplier") or {}).keys())
    coverage = []
    for sid in all_sids:
        cov = sum(1 for pi in items if sid in (pi.get("best_by_supplier") or {}))
        coverage.append((cov, sid))
    coverage.sort(reverse=True)
    top = [sid for _, sid in coverage[:12]]

    best: Optional[dict] = None
    for i, a in enumerate(top):
        for b in top[i + 1:]:
            groups_map: dict[str, dict] = {}
            miss: list[str] = []
            ok = True
            for pi in items:
                bbs = pi.get("best_by_supplier") or {}
                qa, qb = bbs.get(a), bbs.get(b)
                if qa is None and qb is None:
                    miss.append(pi["product_name"])
                    ok = False
                    break
                if qa is None:
                    sid, quote = b, qb
                elif qb is None:
                    sid, quote = a, qa
                else:
                    sid, quote = (a, qa) if qa["line_total"] <= qb["line_total"] else (b, qb)
                g = groups_map.setdefault(
                    sid,
                    {
                        "supplier_id": sid,
                        "supplier_name": quote["supplier_name"],
                        "supplier_email": quote.get("supplier_email"),
                        "items": [],
                        "subtotal_pln": 0.0,
                        "min_order_value": _min_order_value(suppliers_meta, sid),
                    },
                )
                g["items"].append(_item_line_entry(pi, quote))
                g["subtotal_pln"] = round(g["subtotal_pln"] + quote["line_total"], 2)
            if not ok or miss:
                continue
            viable_groups = []
            fail = False
            for g in groups_map.values():
                if g["min_order_value"] > 0 and g["subtotal_pln"] < g["min_order_value"]:
                    fail = True
                    break
                viable_groups.append(g)
            if fail:
                continue
            sc = _scenario_from_groups(
                "monolith",
                "Wygoda (mało dostaw)",
                "Zamówienie u maksymalnie 2 dostawców (żaden nie ma pełnego asortymentu solo).",
                viable_groups,
                [],
                suppliers_meta,
            )
            if best is None or (sc["viable"] and sc["total_pln"] < best["total_pln"]):
                best = sc

    if best:
        return best
    if mono:
        g = {
            "supplier_id": mono["supplier_id"],
            "supplier_name": mono["supplier_name"],
            "supplier_email": mono.get("supplier_email"),
            "items": mono["items"],
            "subtotal_pln": mono["subtotal_pln"],
            "min_order_value": mono.get("min_order_value", 0),
        }
        return _scenario_from_groups(
            "monolith",
            "Wygoda (mało dostaw)",
            "Najlepszy pojedynczy dostawca (częściowe pokrycie).",
            [g],
            list(mono.get("missing") or []),
            suppliers_meta,
        )
    return _empty_monolith()


def _empty_monolith() -> dict:
    return {
        "id": "monolith",
        "label": "Wygoda (mało dostaw)",
        "description": "Brak dostawcy pokrywającego asortyment.",
        "suppliers": [],
        "products_pln": 0.0,
        "shipping_pln": 0.0,
        "total_pln": 0.0,
        "supplier_count": 0,
        "meets_all_minimums": False,
        "missing": [],
        "viable": False,
    }


def compute_smart_hybrid(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    split_scenario: dict,
    monolith_scenario: dict,
) -> dict:
    """
    Hybrid: start od split_max; pozycje z małych / niespełniających minimów
    koszyków dorzuć do największego koszyka (nawet drożej).
    """
    # Punkt startowy: grupy ze split (nawet jeśli nieviable — naprawiamy)
    groups = {
        g["supplier_id"]: {
            "supplier_id": g["supplier_id"],
            "supplier_name": g["supplier_name"],
            "supplier_email": g.get("supplier_email"),
            "items": [dict(x) for x in (g.get("items") or [])],
            "subtotal_pln": float(g.get("subtotal_pln") or 0),
            "min_order_value": float(g.get("min_order_value") or 0),
        }
        for g in (split_scenario.get("suppliers") or [])
    }
    missing = list(split_scenario.get("missing") or [])
    item_by_name = {pi["product_name"]: pi for pi in items}

    if not groups:
        # Nie ma split — skopiuj monolith
        return {
            **monolith_scenario,
            "id": "smart_hybrid",
            "label": "Optymalizacja progów (Smart)",
            "description": "Manipulacja koszykami i progami (minima / darmowa dostawa), by uniknąć ukrytych kosztów.",
        }

    def largest_sid(exclude: Optional[str] = None) -> Optional[str]:
        cands = [(g["subtotal_pln"], sid) for sid, g in groups.items() if sid != exclude]
        if not cands:
            return None
        cands.sort(reverse=True)
        return cands[0][1]

    for _ in range(12):
        small = [
            sid for sid, g in groups.items()
            if g["min_order_value"] > 0 and g["subtotal_pln"] < g["min_order_value"]
        ]
        if not small:
            break
        small.sort(key=lambda s: groups[s]["subtotal_pln"])
        src = small[0]
        dest = largest_sid(exclude=src)
        if dest is None:
            # Brak dużego koszyka — spróbuj wchłonąć wszystko do monolit-owego dostawcy
            mono_sid = None
            if monolith_scenario.get("suppliers"):
                mono_sid = monolith_scenario["suppliers"][0]["supplier_id"]
            if not mono_sid or mono_sid == src:
                break
            dest = mono_sid
            if dest not in groups:
                meta = _supplier_meta(suppliers_meta, dest)
                groups[dest] = {
                    "supplier_id": dest,
                    "supplier_name": meta.get("name") or "Dostawca",
                    "supplier_email": meta.get("email"),
                    "items": [],
                    "subtotal_pln": 0.0,
                    "min_order_value": _min_order_value(suppliers_meta, dest),
                }

        src_g = groups[src]
        for line in list(src_g["items"]):
            pi = item_by_name.get(line["product_name"])
            if not pi:
                continue
            quote = (pi.get("best_by_supplier") or {}).get(dest)
            if quote is None:
                # Zostaw u src — nie da się przenieść
                continue
            src_g["items"] = [x for x in src_g["items"] if x["product_name"] != line["product_name"]]
            src_g["subtotal_pln"] = round(sum(x["line_total"] for x in src_g["items"]), 2)
            dg = groups[dest]
            dg["items"] = [x for x in dg["items"] if x["product_name"] != line["product_name"]]
            dg["items"].append(_item_line_entry(pi, quote))
            dg["subtotal_pln"] = round(sum(x["line_total"] for x in dg["items"]), 2)
        if not src_g["items"]:
            del groups[src]

    return _scenario_from_groups(
        "smart_hybrid",
        "Optymalizacja progów (Smart)",
        "Drobne koszyki poniżej minimum dołączamy do dużych — plus wskazówki do progów darmowej dostawy.",
        list(groups.values()),
        missing,
        suppliers_meta,
    )


def attach_logistics_hints(scenario: dict) -> dict:
    """Dokłada do scenariusza luki do minimum / darmowej dostawy (dla AI tipów)."""
    hints: list[dict] = []
    for g in scenario.get("suppliers") or []:
        sub = float(g.get("subtotal_pln") or 0)
        min_val = float(g.get("min_order_value") or 0)
        free_at = float(g.get("free_shipping_threshold") or 0)
        ship_list = float(g.get("shipping_cost_list") or 0)
        gap_min = round(max(0.0, min_val - sub), 2) if min_val > 0 else 0.0
        gap_free = round(max(0.0, free_at - sub), 2) if free_at > 0 and ship_list > 0 else 0.0
        blocked = min_val > 0 and sub < min_val
        tco = round(sub + float(g.get("shipping_pln") or 0) + gap_min, 2)
        hints.append({
            "supplier_id": g.get("supplier_id"),
            "supplier_name": g.get("supplier_name"),
            "subtotal_pln": sub,
            "min_order_value": min_val,
            "gap_to_minimum_pln": gap_min,
            "blocked_by_minimum": blocked,
            "free_shipping_threshold": free_at,
            "gap_to_free_shipping_pln": gap_free,
            "shipping_pln": float(g.get("shipping_pln") or 0),
            "shipping_list_pln": ship_list,
            "tco_pln": tco,
        })
    out = dict(scenario)
    out["logistics_hints"] = hints
    tip_parts: list[str] = []
    for h in hints:
        name = h["supplier_name"] or "Dostawca"
        if h["blocked_by_minimum"] and h["gap_to_minimum_pln"] > 0:
            tip_parts.append(
                f"U {name} brakuje {h['gap_to_minimum_pln']:.0f} zł do minimum "
                f"({h['min_order_value']:.0f} zł) — TCO z karą ≈ {h['tco_pln']:.0f} zł."
            )
        elif h["gap_to_free_shipping_pln"] > 0 and h["gap_to_free_shipping_pln"] <= 80:
            tip_parts.append(
                f"U {name} brakuje {h['gap_to_free_shipping_pln']:.0f} zł do darmowej dostawy "
                f"(próg {h['free_shipping_threshold']:.0f} zł, shipping {h['shipping_list_pln']:.0f} zł)."
            )
    # Dołącz konkretne powody z decision_log (exclusive / hard gap)
    for entry in (scenario.get("decision_log") or [])[:6]:
        code = entry.get("reason_code") or ""
        prod = entry.get("product") or "?"
        if code in ("EXCLUSIVE_BELOW_50PCT", "EXCLUSIVE_HARD_GAP", "EXCLUSIVE_TCO_WORSE", "NO_LEGAL_BASKET"):
            note = entry.get("tco_note") or code
            tip_parts.append(f"{prod}: {note}")
        elif code == "TCO_CONSOLIDATE" and entry.get("price_delta"):
            tip_parts.append(
                f"{prod}: konsolidacja (+{entry['price_delta']:.0f} zł vs najtańszy) "
                f"obniża TCO ({entry.get('tco_note') or ''})."
            )
    out["smart_tip"] = " ".join(tip_parts) if tip_parts else (
        "Koszyk spełnia minima. Sprawdź, czy nie da się ograniczyć liczby dostaw bez dużej dopłaty."
    )
    return out


def _analysis_summary_from_log(result: dict) -> str:
    """Krótkie podsumowanie z decision_log + liczb."""
    parts: list[str] = []
    rec = result.get("recommended_scenario_id")
    sav = float(result.get("savings_amount") or 0)
    parts.append(f"Porównano do 3 strategii koszyka. Rekomendacja: {rec or 'brak'}")
    if sav > 0:
        parts.append(f"Potencjalna oszczędność vs konsolidacja: {sav:.0f} zł.")
    split = result.get("scenario_split_max") or {}
    log = split.get("decision_log") or []
    excl_miss = [e for e in log if (e.get("reason_code") or "").startswith("EXCLUSIVE_") and not e.get("chosen_supplier")]
    consolidations = [e for e in log if e.get("reason_code") == "TCO_CONSOLIDATE"]
    if excl_miss:
        names = ", ".join(e.get("product") or "?" for e in excl_miss[:3])
        parts.append(f"Exclusive bez koszyka: {names}.")
    if consolidations:
        parts.append(f"Konsolidacja TCO: {len(consolidations)} pozycji przeniesionych mimo droższej linii.")
    gap_soft = [
        g for g in (split.get("suppliers") or [])
        if not g.get("meets_minimum_order") and float(g.get("gap_to_minimum_pln") or 0) > 0
    ]
    if gap_soft:
        g0 = gap_soft[0]
        parts.append(
            f"Soft-luka u {g0.get('supplier_name')}: {float(g0.get('gap_to_minimum_pln') or 0):.0f} zł "
            f"(≤{MAX_GAP_NEW_BASKET_PLN:.0f} zł)."
        )
    return " ".join(parts)


def build_math_tip_fallback(result: dict) -> dict:
    """Wzbogaca scenariusze o logistics_hints + smart_tip bez LLM."""
    for key in ("scenario_split_max", "scenario_monolith", "scenario_smart_hybrid"):
        sc = result.get(key)
        if isinstance(sc, dict) and sc.get("suppliers") is not None:
            result[key] = attach_logistics_hints(sc)
    scenarios = []
    for sc in (result.get("scenarios") or []):
        if isinstance(sc, dict):
            scenarios.append(attach_logistics_hints(sc))
    if scenarios:
        result["scenarios"] = scenarios
    # Preferuj full 3 kafle gdy mamy ≥2 scenariusze z produktami
    all_three = [
        result.get("scenario_split_max"),
        result.get("scenario_monolith"),
        result.get("scenario_smart_hybrid"),
    ]
    with_items = [s for s in all_three if s and (s.get("suppliers") or s.get("missing") is not None)]
    if len(with_items) >= 2 and len(result.get("items_requested") or []) > 1:
        result["scenarios"] = [attach_logistics_hints(s) if "smart_tip" not in s else s for s in with_items]
        result["is_multivariable"] = True
        result["is_optimized"] = True
    result["analysis_summary"] = _analysis_summary_from_log(result)
    # decision_log na top-level (z split — główny silnik przydziału)
    split = result.get("scenario_split_max") or {}
    if isinstance(split, dict) and split.get("decision_log") is not None:
        result["decision_log"] = split["decision_log"]
    return result


def build_smart_optimize_response(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    *,
    kitchen_priorities: Optional[dict[str, dict]] = None,
    waste_top: Optional[list[dict]] = None,
    fillers: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """Pełna odpowiedź v2: do 3 scenariuszy + flaga is_multivariable.

    kitchen_priorities: mapa id/nazwa → {score, class_a, reasons} (POS/usage/waste/stock).
    waste_top / fillers: sygnały do suggestions (math-first).
    """
    items = attach_kitchen_priorities(items, kitchen_priorities)
    items = sort_items_by_kitchen_priority(items)

    split_sc = compute_split_max(items, suppliers_meta)
    mono_sc = compute_monolith_scenario(items, suppliers_meta)
    hybrid_sc = compute_smart_hybrid(items, suppliers_meta, split_sc, mono_sc)

    scenarios = [split_sc, mono_sc, hybrid_sc]
    viable = [s for s in scenarios if s.get("viable")]
    unique_count = len(items)

    # Najlepszy: among viable prefer (1) mniej missing / większe pokrycie (2) niższy total
    best = None
    if viable:
        def _rank(s: dict) -> tuple:
            miss = len(s.get("missing") or [])
            cov = sum(len(g.get("items") or []) for g in (s.get("suppliers") or []))
            return (miss, -cov, float(s.get("total_pln") or 1e18))
        best = min(viable, key=_rank)
    elif scenarios:
        # Fallback: najmniejszy total niezależnie od viable
        ranked = sorted(
            [s for s in scenarios if s.get("suppliers")],
            key=lambda s: (not s.get("meets_all_minimums"), s.get("total_pln") or 1e18),
        )
        best = ranked[0] if ranked else None

    # Savings vs najdroższy viable / vs monolith
    savings_amount = 0.0
    ref_total = mono_sc["total_pln"] if mono_sc.get("viable") else None
    if best and ref_total and ref_total > best["total_pln"]:
        savings_amount = round(ref_total - best["total_pln"], 2)

    # UX Shield — różnica ≥5% ALBO ≥2 scenariusze z dostawcami (zawsze pokaż kafle)
    is_multivariable = False
    suppliers_present = sum(1 for s in scenarios if s.get("suppliers"))
    if unique_count > 1 and suppliers_present >= 2:
        is_multivariable = True
    elif unique_count > 1 and len(viable) >= 2:
        totals = sorted(s["total_pln"] for s in viable)
        spread = totals[-1] - totals[0]
        base = totals[-1] if totals[-1] > 0 else 1.0
        if spread / base >= MULTIVAR_SAVINGS_RATIO:
            is_multivariable = True

    pricing_matrix = to_pricing_matrix(items, suppliers_meta)
    items_requested = []
    for pi in items:
        bbs = pi.get("best_by_supplier") or {}
        offers_sorted = sorted(
            bbs.values(),
            key=lambda q: float(q.get("line_total") or 1e18),
        )
        best_q = offers_sorted[0] if offers_sorted else None
        meta_best = _supplier_meta(suppliers_meta, best_q["supplier_id"]) if best_q else {}
        best_name = (
            ((best_q or {}).get("supplier_name") or meta_best.get("name") or "").strip()
            or None
        )
        items_requested.append({
            "product_name": pi["product_name"],
            "quantity": pi["quantity"],
            "unit": pi["unit"],
            "found": bool(bbs),
            "supplier_id": (best_q or {}).get("supplier_id"),
            "supplier_name": best_name,
            "matched_name": (best_q or {}).get("matched_name"),
            "offers": [
                {
                    "supplier_id": q.get("supplier_id"),
                    "supplier_name": (
                        (q.get("supplier_name")
                         or (_supplier_meta(suppliers_meta, q.get("supplier_id") or {}).get("name"))
                         or "").strip()
                        or "Dostawca"
                    ),
                    "line_total": q.get("line_total"),
                    "matched_name": q.get("matched_name"),
                }
                for q in offers_sorted[:6]
            ],
        })

    # Kompatybilność z DealHunterModal v1
    variant_monolith = None
    if mono_sc.get("suppliers") and len(mono_sc["suppliers"]) == 1:
        g = mono_sc["suppliers"][0]
        variant_monolith = {
            "type": "all_one_supplier",
            "supplier_id": g["supplier_id"],
            "supplier_name": g["supplier_name"],
            "supplier_email": g.get("supplier_email"),
            "items": g["items"],
            "subtotal_pln": g["subtotal_pln"],
            "total_pln": g["total_pln"],
            "shipping_pln": g.get("shipping_pln", 0),
            "min_order_value": g.get("min_order_value", 0),
            "meets_minimum_order": g.get("meets_minimum_order", True),
            "missing": mono_sc.get("missing") or [],
        }
    elif mono_sc.get("suppliers"):
        # multi → potraktuj jak option_optimized-style w monolicie
        variant_monolith = {
            "type": "all_one_supplier",
            "supplier_id": mono_sc["suppliers"][0]["supplier_id"],
            "supplier_name": mono_sc["suppliers"][0]["supplier_name"]
            + (f" +{len(mono_sc['suppliers']) - 1}" if len(mono_sc["suppliers"]) > 1 else ""),
            "supplier_email": mono_sc["suppliers"][0].get("supplier_email"),
            "items": [i for g in mono_sc["suppliers"] for i in g["items"]],
            "subtotal_pln": mono_sc["products_pln"],
            "total_pln": mono_sc["total_pln"],
            "shipping_pln": mono_sc["shipping_pln"],
            "min_order_value": 0,
            "meets_minimum_order": mono_sc.get("meets_all_minimums", False),
            "missing": mono_sc.get("missing") or [],
        }

    variant_split = {
        "type": "optimized",
        "suppliers": split_sc.get("suppliers") or [],
        "total_pln": split_sc.get("total_pln") or 0,
        "missing": split_sc.get("missing") or [],
    }

    best_option = None
    tied: list[dict] = []
    if not is_multivariable and best and best.get("suppliers"):
        if len(best["suppliers"]) == 1:
            g = best["suppliers"][0]
            best_option = {
                "type": "single",
                "supplier_id": g["supplier_id"],
                "supplier_name": g["supplier_name"],
                "supplier_email": g.get("supplier_email"),
                "items": g["items"],
                "subtotal_pln": g["subtotal_pln"],
                "total_pln": g["total_pln"],
                "shipping_pln": g.get("shipping_pln", 0),
                "min_order_value": g.get("min_order_value", 0),
                "meets_minimum_order": g.get("meets_minimum_order", True),
                "missing": best.get("missing") or [],
            }
            if unique_count == 1 and items:
                tied = find_tied_suppliers(items[0], g["subtotal_pln"], suppliers_meta)
        else:
            best_option = {
                "type": "split_single_view",
                "suppliers": best["suppliers"],
                "subtotal_pln": best["products_pln"],
                "total_pln": best["total_pln"],
                "shipping_pln": best.get("shipping_pln", 0),
                "missing": best.get("missing") or [],
            }

    # Zawsze trzy kafle strategii gdy ≥2 scenariusze mają dostawców
    out_scenarios = scenarios if (is_multivariable or suppliers_present >= 2) else ([best] if best else [])

    result: dict[str, Any] = {
        "currency": "PLN",
        "optimizer_version": 2,
        # Jeden SKU → zawsze widok „single”, nawet gdy 3 scenariusze mają tego samego dostawcę
        "is_multivariable": (is_multivariable or suppliers_present >= 2) and unique_count > 1,
        "is_optimized": (is_multivariable or suppliers_present >= 2) and unique_count > 1,
        "items_requested": items_requested,
        "scenarios": out_scenarios,
        "scenario_split_max": split_sc,
        "scenario_monolith": mono_sc,
        "scenario_smart_hybrid": hybrid_sc,
        "recommended_scenario_id": best["id"] if best else None,
        "savings_amount": savings_amount,
        "savings_pln": savings_amount,
        "best_option": best_option,
        "tied_suppliers": tied,
        "variant_monolith": variant_monolith,
        "variant_split": variant_split,
        "option_all_one": variant_monolith,
        "option_optimized": variant_split,
        "cheaper_variant": (
            "split" if best and best["id"] == "split_max"
            else ("monolith" if best and best["id"] == "monolith" else "hybrid")
        ) if best else None,
        "pricing_matrix": pricing_matrix,
    }
    result["assistant_speech"] = build_smart_speech(result)
    result = build_math_tip_fallback(result)

    # Sugestie Łowcy (math) — decision_log + soft gap + waste + lead-time (gdy dostępne)
    dlog = result.get("decision_log") or (split_sc.get("decision_log") if isinstance(split_sc, dict) else None)
    suggestions = build_deal_hunter_suggestions(
        items,
        suppliers_meta,
        split_scenario=split_sc,
        decision_log=dlog if isinstance(dlog, list) else None,
        waste_top=waste_top,
        fillers=fillers,
    )
    result["suggestions"] = suggestions
    if suggestions and not result.get("smart_tip"):
        # kompaktowy tip z pierwszej sugestii (FE / speech)
        top = suggestions[0]
        result["smart_tip"] = top.get("message")
        if result.get("analysis_summary") and top.get("message"):
            # dołącz krótką wzmiankę jeśli summary już jest
            pass
        elif top.get("message"):
            result["analysis_summary"] = top["message"]
    # Kitchen priorities echo (debug / FE badges)
    result["kitchen_priorities"] = {
        pi["product_name"]: {
            "score": pi.get("kitchen_priority"),
            "class_a": pi.get("kitchen_class_a"),
            "reasons": pi.get("kitchen_priority_reasons") or [],
        }
        for pi in items
        if pi.get("product_name")
    }
    return result


def apply_cart_objective(
    result: dict[str, Any],
    objective: Optional[str],
    suppliers_meta: Optional[dict[str, dict]] = None,
) -> dict[str, Any]:
    """Ustaw recommended_scenario_id wg preferencji użytkownika.

    - lowest_price → split_max (najniższa suma produktów)
    - min_deliveries → monolith (minimalna liczba dostaw)
    - fast_delivery → scenariusz z najkrótszym max(lead_time) wśród dostawców
    """
    if not result or not isinstance(result, dict):
        return result
    obj = (objective or "").strip().lower()
    aliases = {
        "najniższa cena": "lowest_price",
        "najnizsza cena": "lowest_price",
        "price": "lowest_price",
        "lowest": "lowest_price",
        "minimalna liczba dostaw": "min_deliveries",
        "min dostaw": "min_deliveries",
        "monolith": "min_deliveries",
        "szybki czas dostawy": "fast_delivery",
        "szybka dostawa": "fast_delivery",
        "fast": "fast_delivery",
        "lead_time": "fast_delivery",
    }
    obj = aliases.get(obj, obj)
    if obj not in ("lowest_price", "min_deliveries", "fast_delivery"):
        result["cart_objective"] = objective
        return result

    scenarios = {
        "split_max": result.get("scenario_split_max") or {},
        "monolith": result.get("scenario_monolith") or {},
        "smart_hybrid": result.get("scenario_smart_hybrid") or {},
    }
    meta = suppliers_meta or {}

    def _max_lead(sc: dict) -> float:
        leads = []
        for g in sc.get("suppliers") or []:
            sid = g.get("supplier_id")
            m = meta.get(sid) or {}
            leads.append(resolve_lead_time_days(m))
        return max(leads) if leads else 1e9

    def _supplier_count(sc: dict) -> int:
        return len(sc.get("suppliers") or [])

    pick_id = None
    if obj == "lowest_price":
        pick_id = "split_max"
        # jeśli split niewykonalny — najtańszy viable
        if not (scenarios["split_max"] or {}).get("suppliers"):
            ranked = sorted(
                [(sid, sc) for sid, sc in scenarios.items() if sc.get("suppliers")],
                key=lambda x: float(x[1].get("total_pln") or 1e18),
            )
            pick_id = ranked[0][0] if ranked else None
    elif obj == "min_deliveries":
        pick_id = "monolith"
        if not (scenarios["monolith"] or {}).get("suppliers"):
            ranked = sorted(
                [(sid, sc) for sid, sc in scenarios.items() if sc.get("suppliers")],
                key=lambda x: (_supplier_count(x[1]), float(x[1].get("total_pln") or 1e18)),
            )
            pick_id = ranked[0][0] if ranked else None
    else:  # fast_delivery
        ranked = sorted(
            [(sid, sc) for sid, sc in scenarios.items() if sc.get("suppliers")],
            key=lambda x: (_max_lead(x[1]), float(x[1].get("total_pln") or 1e18)),
        )
        pick_id = ranked[0][0] if ranked else None

    if pick_id:
        result["recommended_scenario_id"] = pick_id
        result["cheaper_variant"] = (
            "split" if pick_id == "split_max"
            else ("monolith" if pick_id == "monolith" else "hybrid")
        )
    result["cart_objective"] = obj
    return result


def build_smart_speech(result: dict) -> str:
    if not result.get("items_requested") or not any(
        i.get("found") for i in result["items_requested"]
    ):
        return (
            "Niestety nie znalazłem produktów w katalogu dostawców. "
            "Dodaj oferty dostawców albo uruchom Delta-Scrapera."
        )
    if not result.get("is_multivariable"):
        best = result.get("best_option")
        if best and best.get("supplier_name"):
            return (
                f"Najlepsza oferta: {best['supplier_name']} za "
                f"{fmt_pln(best.get('total_pln') or 0)}. Możesz od razu zamówić."
            )
        if best and best.get("suppliers"):
            names = ", ".join(g["supplier_name"] for g in best["suppliers"])
            return f"Optymalny koszyk: {names} łącznie {fmt_pln(best.get('total_pln') or 0)}."
        return "Znalazłem oferty — wybierz poniżej."

    parts = []
    for sc in result.get("scenarios") or []:
        if not sc.get("viable"):
            continue
        parts.append(
            f"{sc['label']}: {sc['supplier_count']} dost. · {fmt_pln(sc['total_pln'])}"
        )
    speech = " | ".join(parts) if parts else "Porównaj scenariusze poniżej."
    sav = float(result.get("savings_amount") or 0)
    if sav > PRICE_TOLERANCE:
        speech += f" Możesz zaoszczędzić do {fmt_pln(sav)} vs konsolidacja."
    speech += " Który wariant wybierasz?"
    return speech


# ── Cache ────────────────────────────────────────────────────────────────────

def make_cache_key(critical_fingerprint: str, price_fingerprint: str) -> str:
    raw = f"{critical_fingerprint}|{price_fingerprint}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def fingerprint_critical(critical: list[dict]) -> str:
    rows = sorted(
        (str(c.get("id") or c.get("name")), round(float(c.get("deficit") or c.get("quantity") or 0), 4))
        for c in critical
    )
    return hashlib.md5(json.dumps(rows).encode()).hexdigest()


def fingerprint_prices(per_item: list[dict], suppliers_meta: dict) -> str:
    blob = []
    for pi in per_item:
        quotes = []
        for sid, b in sorted((pi.get("best_by_supplier") or {}).items()):
            quotes.append((sid, round(float(b.get("line_total") or 0), 2)))
        blob.append((pi["product_name"], quotes))
    meta = {
        sid: (
            round(float(m.get("min_order_value") or 0), 2),
            round(float(m.get("shipping_cost") or 0), 2),
            round(float(m.get("free_shipping_threshold") or 0), 2),
        )
        for sid, m in sorted(suppliers_meta.items())
    }
    return hashlib.md5(json.dumps({"i": blob, "m": meta}, sort_keys=True).encode()).hexdigest()


def cache_get(key: str) -> Optional[dict]:
    entry = _RESULT_CACHE.get(key)
    if not entry:
        return None
    exp, payload = entry
    if time.time() > exp:
        _RESULT_CACHE.pop(key, None)
        return None
    out = dict(payload)
    out["from_cache"] = True
    return out


def cache_set(key: str, payload: dict, ttl: int = CACHE_TTL_SEC) -> None:
    clean = {k: v for k, v in payload.items() if k != "from_cache"}
    _RESULT_CACHE[key] = (time.time() + ttl, clean)


def cache_clear() -> None:
    _RESULT_CACHE.clear()
