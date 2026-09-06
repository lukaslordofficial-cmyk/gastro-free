from __future__ import annotations

from bargain_hunter import _item_line_entry
from bargain_hunter import _min_order_value
from bargain_hunter import _supplier_meta
from typing import Any
from typing import Optional
from ._p0 import CLASS_A_SCORE_THRESHOLD, EXCLUSIVE_CHEAPEST_SHARE, MAX_GAP_NEW_BASKET_PLN, PACK_OVERSIZE_RATIO, _NON_PERISHABLE_KEYWORDS, _basket_tco, _enrich_group, _gap_to_min, _groups_tco
from ._p1 import _cheapest_line_total, _cheapest_supplier_id, _log_decision, _pick_practical_supplier



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
    meta = _supplier_meta(suppliers_meta, sid)
    g = {
        "supplier_id": sid,
        "supplier_name": quote["supplier_name"],
        "supplier_email": quote.get("supplier_email"),
        "items": [],
        "subtotal_pln": 0.0,
        "min_order_value": _min_order_value(suppliers_meta, sid),
    }
    if quote.get("is_local_producer") or meta.get("is_local_producer"):
        g["is_local_producer"] = True
    return g


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
            # Zawsze dodaj — ostateczna luka > 150 zł liczona po sumie koszyka (purge).
            _add_line_to_groups(groups, pi, force, quote, suppliers_meta)
            continue
        picked = _pick_practical_supplier(
            pi, groups, suppliers_meta, decision_log=None, cart_objective=None,
        )
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


def _assign_all_practical(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    decision_log: Optional[list] = None,
    *,
    cart_objective: Optional[str] = None,
) -> tuple[dict[str, dict], list[str]]:
    """Przydziel wszystkie SKU: exclusive gate → pick wg preferencji (cena/TCO/lead).

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

        picked = _pick_practical_supplier(
            pi, groups, suppliers_meta, decision_log, cart_objective=cart_objective,
        )
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
            _basket_tco(
                float(g["subtotal_pln"]),
                g["supplier_id"],
                suppliers_meta,
                items=g.get("items") or [],
            )
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
    *,
    cart_objective: Optional[str] = None,
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
            picked = _pick_practical_supplier(
                pi, tmp, suppliers_meta, cart_objective=cart_objective,
            )
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
                groups[target_sid] = {
                    "supplier_id": target_sid,
                    "supplier_name": quote["supplier_name"],
                    "supplier_email": quote.get("supplier_email"),
                    "items": [],
                    "subtotal_pln": 0.0,
                    "min_order_value": min_v,
                }
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
    *,
    cart_objective: Optional[str] = None,
) -> dict:
    """
    Split praktyczny: przydział SKU z regułami kotwic / minimów / TCO/ceny,
    potem naprawa koszyków poniżej min i purge luk > 150 zł.
    """
    decision_log: list = []
    # Packaging band first — drop oversize quotes before assignment
    items = apply_packaging_band_filter(items, decision_log)
    groups, missing = _assign_all_practical(
        items, suppliers_meta, decision_log, cart_objective=cart_objective,
    )
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
            picked = _pick_practical_supplier(
                pi, groups, suppliers_meta, decision_log, cart_objective=cart_objective,
            )
            if not picked or picked[0] == broken_sid:
                broken["items"].append(line)
                broken["subtotal_pln"] = round(sum(x["line_total"] for x in broken["items"]), 2)
                continue
            target_sid, quote = picked
            if target_sid not in groups:
                min_v = _min_order_value(suppliers_meta, target_sid)
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
    groups, missing = _purge_under_min_groups(
        groups, item_by_name, suppliers_meta, missing, cart_objective=cart_objective,
    )
    groups = _fill_soft_gaps_min_delta(groups, items, suppliers_meta)
    groups, missing = _purge_under_min_groups(
        groups, item_by_name, suppliers_meta, missing, cart_objective=cart_objective,
    )

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

__all__ = ['_add_line_to_groups', '_assign_all_practical', '_evaluate_exclusive_anchor', '_exclusive_share', '_fill_soft_gaps_min_delta', '_is_non_perishable_like', '_new_group', '_product_norm_key', '_purge_under_min_groups', '_scenario_from_groups', '_simulate_assign_excluding', 'apply_packaging_band_filter', 'attach_kitchen_priorities', 'compute_priority_score', 'compute_split_max', 'resolve_kitchen_priority', 'sort_items_by_kitchen_priority']
