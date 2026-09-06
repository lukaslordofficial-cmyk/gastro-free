from __future__ import annotations

from bargain_hunter import _min_order_value
from bargain_hunter import _supplier_meta
from typing import Any
from typing import Optional
from ._p0 import ANCHOR_MIN_ITEMS, ANCHOR_PRICE_SLACK_PLN, ANCHOR_PRICE_SLACK_RATIO, MAX_GAP_NEW_BASKET_PLN, SOFT_GAP_PREFER_ANCHOR_PLN, _gap_to_min, _groups_tco



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


def _normalize_cart_objective(objective: Optional[str]) -> str:
    """lowest_price | min_deliveries | fast_delivery | ''."""
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
    if obj in ("lowest_price", "min_deliveries", "fast_delivery"):
        return obj
    return ""


def _pick_practical_supplier(
    pi: dict,
    groups: dict[str, dict],
    suppliers_meta: dict[str, dict],
    decision_log: Optional[list] = None,
    *,
    cart_objective: Optional[str] = None,
) -> Optional[tuple[str, dict]]:
    """
    Wybór dostawcy pod SKU — reguły zależne od preferencji użytkownika:

      • lowest_price / domyślnie: najtańsza cena jednostkowa, gdy koszyk
        miękko-wykonalny (już w koszyku LUB luka ≤ 150 zł LUB spełnia min).
      • min_deliveries: konsolidacja / TCO — nie otwieraj nowego koszyka tylko
        dlatego, że linia jest tańsza.
      • fast_delivery: najpierw lead_time, przy remisie cena.

    Pojedyncza pozycja nie blokuje nowego koszyka — luka > 150 oceniana po sumie (purge).
    """
    from ._p0 import resolve_lead_time_days

    bbs = pi.get("best_by_supplier") or {}
    if not bbs:
        return None

    obj = _normalize_cart_objective(cart_objective)
    prefer_consolidate = obj == "min_deliveries"
    prefer_speed = obj == "fast_delivery"
    # Domyślnie i przy lowest_price — cena jednostkowa
    prefer_price = not prefer_consolidate and not prefer_speed
    if obj == "lowest_price" or obj == "":
        prefer_price = True
        prefer_consolidate = False

    quotes = [(sid, q, float(q["line_total"])) for sid, q in bbs.items()]
    quotes.sort(key=lambda x: (
        float(x[1].get("unit_price_base") or 1e18),
        x[2],
    ))
    cheapest_lt = quotes[0][2]
    cheapest_sid = quotes[0][0]
    cheapest_unit = float(quotes[0][1].get("unit_price_base") or 0)

    scored: list[tuple[tuple, str, dict, float]] = []
    for sid, quote, lt in quotes:
        min_v = _min_order_value(suppliers_meta, sid)
        in_basket = sid in groups
        cur_sub = float(groups[sid]["subtotal_pln"]) if in_basket else 0.0
        projected = cur_sub + lt
        gap_after = _gap_to_min(projected, min_v)
        meets_after = gap_after <= 0
        soft_viable = in_basket or meets_after or gap_after <= MAX_GAP_NEW_BASKET_PLN
        anchor = in_basket and _is_anchor_group(groups[sid], suppliers_meta)
        unit_price = float(quote.get("unit_price_base") or 0)
        meta = suppliers_meta.get(sid) or {}
        lead = float(resolve_lead_time_days(meta))

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
        hard_gap_penalty = 1 if (min_v > 0 and gap_after > MAX_GAP_NEW_BASKET_PLN) else 0

        under_min_now = False
        if in_basket:
            cur_min = float(groups[sid].get("min_order_value") or min_v or 0)
            under_min_now = cur_min > 0 and _gap_to_min(cur_sub, cur_min) > 0
        prefer_existing = in_basket and (
            (under_min_now and _price_slack_ok(cheapest_lt, lt))
            or (anchor and _price_slack_ok(cheapest_lt, lt))
        )
        tier = 0 if prefer_existing else 1

        if prefer_consolidate:
            # Minimalna liczba dostaw — TCO / konsolidacja nad czystą ceną
            key = (
                hard_gap_penalty,
                tco_after,
                tier,
                0 if meets_after else 1,
                soft_penalty,
                lt,
                0 if in_basket else 1,
                unit_price,
                gap_after,
            )
        elif prefer_speed:
            key = (
                hard_gap_penalty,
                0 if soft_viable else 1,
                lead,
                unit_price,
                lt,
                tco_after,
                0 if in_basket else 1,
                gap_after,
            )
        else:
            # lowest_price / default: najtańsza cena gdy soft-viable
            key = (
                hard_gap_penalty,
                0 if soft_viable else 1,
                unit_price,
                lt,
                lead,
                0 if meets_after else 1,
                soft_penalty,
                tco_after,
                0 if in_basket else 1,
                gap_after,
            )
        scored.append((key, sid, quote, tco_after))

    if not scored:
        _log_decision(
            decision_log,
            product=pi.get("product_name") or "",
            chosen_supplier=None,
            reason_code="NO_LEGAL_BASKET",
            alt_cheaper_supplier=cheapest_sid,
            price_delta=0.0,
            gap_to_min=_gap_to_min(cheapest_lt, _min_order_value(suppliers_meta, cheapest_sid)),
            tco_note="Brak ofert do przydziału.",
        )
        return None

    scored.sort(key=lambda x: x[0])
    best_sid, best_quote, best_tco = scored[0][1], scored[0][2], scored[0][3]
    best_lt = float(best_quote["line_total"])
    best_unit = float(best_quote.get("unit_price_base") or 0)
    reason = "PRICE_BEST" if prefer_price else ("LEAD_BEST" if prefer_speed else "TCO_BEST")
    if best_sid != cheapest_sid:
        if prefer_consolidate and best_lt > cheapest_lt:
            reason = "TCO_CONSOLIDATE"
        elif prefer_speed:
            reason = "LEAD_THEN_PRICE"
        elif best_unit > cheapest_unit + 1e-9:
            reason = "SOFT_VIABLE_TRADEOFF"
        else:
            reason = "PRICE_BEST"
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
        tco_note=f"obj={obj or 'lowest_price'} TCO≈{best_tco:.2f}",
    )
    return best_sid, best_quote


def _cheapest_line_total(pi: dict) -> float:
    bbs = pi.get("best_by_supplier") or {}
    if not bbs:
        return 0.0
    return min(float(q["line_total"]) for q in bbs.values())

__all__ = ['_cheapest_line_total', '_cheapest_supplier_id', '_is_anchor_group', '_log_decision', '_normalize_cart_objective', '_pick_practical_supplier', '_price_slack_ok']
