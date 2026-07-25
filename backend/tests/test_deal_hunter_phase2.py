"""Phase 2+ Deal Hunter: kitchen priority, PACK_OVERSIZE, suggestions, MAX_GAP."""
from smart_basket_optimizer import (
    MAX_GAP_NEW_BASKET_PLN,
    apply_packaging_band_filter,
    attach_kitchen_priorities,
    build_deal_hunter_suggestions,
    build_smart_optimize_response,
    compute_priority_score,
    compute_split_max,
    sort_items_by_kitchen_priority,
)


def _item(name: str, qty: float, quotes: dict, **extra) -> dict:
    bbs = {}
    for sid, spec in quotes.items():
        if isinstance(spec, (int, float)):
            price = float(spec)
            pack = 1.0
            band_hi = qty * 1.1
        else:
            price = float(spec.get("price", 0))
            pack = float(spec.get("pack", 1))
            band_hi = float(spec.get("band_hi", qty * 1.1))
        bbs[sid] = {
            "supplier_id": sid,
            "supplier_name": f"Sup {sid}",
            "supplier_email": f"{sid}@t.pl",
            "matched_name": name,
            "unit_price_base": price,
            "base_dim": "kg",
            "line_total": round(price * qty, 2),
            "matched_via": "fuzzy",
            "order_base_qty": qty,
            "target_base_qty": qty,
            "pack_base_qty": pack,
            "band_hi_base": band_hi,
        }
    row = {
        "product_name": name,
        "quantity": qty,
        "unit": "kg",
        "base_dim": "kg",
        "base_quantity": qty,
        "quantity_min": round(qty * 0.9, 4),
        "quantity_max": round(qty * 1.1, 4),
        "best_by_supplier": bbs,
    }
    row.update(extra)
    return row


def test_max_gap_constant_still_150():
    assert MAX_GAP_NEW_BASKET_PLN == 150.0


def test_priority_ordering_hook_smoke():
    """Class A / high score items sort before low-priority ones."""
    items = [
        _item("Bazylia", 1, {"a": 10}),
        _item("Wolowina", 10, {"a": 40}),
        _item("Olej", 5, {"a": 9}),
    ]
    kp = {
        "wolowina": {"score": 0.9, "class_a": True, "reasons": ["high_sales"]},
        "bazylia": {"score": 0.1, "class_a": False, "reasons": []},
        "olej": {"score": 0.4, "class_a": False, "reasons": []},
    }
    stamped = attach_kitchen_priorities(items, kp)
    ordered = sort_items_by_kitchen_priority(stamped)
    assert ordered[0]["product_name"] == "Wolowina"
    assert ordered[0]["kitchen_class_a"] is True
    names = [x["product_name"] for x in ordered]
    assert names.index("Wolowina") < names.index("Bazylia")


def test_compute_priority_class_a_from_sales_or_stock():
    hi = compute_priority_score(sales_rank=0.8, usage_rank=0.2)
    assert hi["class_a"] is True
    low = compute_priority_score(sales_rank=0.1, usage_rank=0.1)
    assert low["class_a"] is False
    stock = compute_priority_score(low_stock=True)
    assert stock["class_a"] is True


def test_pack_oversize_prefers_band_fit():
    """Huge pack on perishable SKU is dropped (PACK_OVERSIZE) when smaller pack exists."""
    items = [
        _item(
            "Kurczak filet",
            2.0,
            {
                "bigbag": {"price": 8.0, "pack": 25.0, "band_hi": 2.2},
                "retail": {"price": 12.0, "pack": 1.0, "band_hi": 2.2},
            },
        ),
    ]
    log: list = []
    filtered = apply_packaging_band_filter(items, log)
    bbs = filtered[0]["best_by_supplier"]
    assert "bigbag" not in bbs
    assert "retail" in bbs
    assert any(e.get("reason_code") == "PACK_OVERSIZE" for e in log)


def test_pack_oversize_keeps_only_option():
    """If only oversize quote exists, keep it (don't leave product empty)."""
    items = [
        _item(
            "Kurczak filet",
            2.0,
            {"bigbag": {"price": 8.0, "pack": 25.0, "band_hi": 2.2}},
        ),
    ]
    log: list = []
    filtered = apply_packaging_band_filter(items, log)
    assert "bigbag" in filtered[0]["best_by_supplier"]


def test_pack_oversize_non_perishable_kept():
    """Dry goods may keep oversize pack."""
    items = [
        _item(
            "Mąka tortowa",
            2.0,
            {
                "bigbag": {"price": 2.0, "pack": 25.0, "band_hi": 2.2},
                "retail": {"price": 4.0, "pack": 1.0, "band_hi": 2.2},
            },
        ),
    ]
    log: list = []
    filtered = apply_packaging_band_filter(items, log)
    assert "bigbag" in filtered[0]["best_by_supplier"]


def test_waste_suggestion_emitted():
    items = [
        _item("Twarog", 12, {"a": 5}),
    ]
    items = attach_kitchen_priorities(items, {})
    meta = {"a": {"name": "A", "min_order_value": 0, "shipping_cost": 0}}
    suggestions = build_deal_hunter_suggestions(
        items,
        meta,
        waste_top=[{"name": "Twaróg", "qty": 40}],
    )
    types = {s["type"] for s in suggestions}
    assert "waste_qty_reduce" in types
    waste = next(s for s in suggestions if s["type"] == "waste_qty_reduce")
    assert "Twarog" in waste["product_name"] or "twarog" in waste["message"].lower()


def test_soft_gap_filler_suggestion():
    items = [
        _item("Olej", 10, {"pantry": 9}),  # 90 zł
    ]
    meta = {"pantry": {"name": "Pantry", "min_order_value": 200, "shipping_cost": 0}}
    # Build a soft-gap scenario stub (gap 110 ≤ 150)
    split_stub = {
        "suppliers": [
            {
                "supplier_id": "pantry",
                "supplier_name": "Pantry",
                "gap_to_minimum_pln": 110.0,
                "meets_minimum_order": False,
                "subtotal_pln": 90.0,
                "min_order_value": 200.0,
                "items": [],
            }
        ]
    }
    suggestions = build_deal_hunter_suggestions(
        items,
        meta,
        split_scenario=split_stub,
        fillers=[{"name": "Cukier"}, {"name": "Sól"}],
    )
    assert any(s["type"] == "soft_gap_filler" for s in suggestions)
    soft = next(s for s in suggestions if s["type"] == "soft_gap_filler")
    assert "Cukier" in soft["message"] or "Dopnij" in soft["message"]
    assert soft["evidence"].get("gap_to_minimum_pln") == 110.0


def test_lead_time_note_for_class_a():
    items = [
        _item("Wolowina", 5, {"slow": 20, "fast": 24}),
    ]
    items = attach_kitchen_priorities(
        items,
        {"wolowina": {"score": 0.95, "class_a": True, "reasons": ["high_sales"]}},
    )
    meta = {
        "slow": {"name": "Slow", "min_order_value": 0, "shipping_cost": 0, "lead_time_days": 5},
        "fast": {"name": "Fast", "min_order_value": 0, "shipping_cost": 0, "lead_time_days": 1},
    }
    suggestions = build_deal_hunter_suggestions(items, meta)
    notes = [s for s in suggestions if s["type"] == "lead_time_note"]
    assert notes, "expected lead_time_note for Class A + slow cheapest"
    assert notes[0]["evidence"]["lead_time_days"] == 5


def test_lead_time_skipped_when_missing():
    items = [
        _item("Wolowina", 5, {"a": 20, "b": 24}),
    ]
    items = attach_kitchen_priorities(
        items,
        {"wolowina": {"score": 0.95, "class_a": True, "reasons": ["high_sales"]}},
    )
    meta = {
        "a": {"name": "A", "min_order_value": 0, "shipping_cost": 0},
        "b": {"name": "B", "min_order_value": 0, "shipping_cost": 0},
    }
    suggestions = build_deal_hunter_suggestions(items, meta)
    assert not any(s["type"] == "lead_time_note" for s in suggestions)


def test_reliability_score_none_without_data():
    from smart_basket_optimizer import compute_reliability_score, reliability_tco_multiplier

    assert compute_reliability_score() is None
    assert reliability_tco_multiplier({}) == 1.0


def test_reliability_score_and_tco_uplift():
    from smart_basket_optimizer import (
        _basket_tco,
        compute_reliability_score,
        reliability_tco_multiplier,
    )

    score = compute_reliability_score(
        received_ok_count=6,
        received_bad_count=4,
        missing_total=2,
        review_count=10,
    )
    assert score is not None
    assert 0.0 <= score < 0.85
    meta = {
        "bad": {
            "name": "Bad",
            "min_order_value": 0,
            "shipping_cost": 0,
            "reliability_score": score,
        },
        "ok": {"name": "Ok", "min_order_value": 0, "shipping_cost": 0},
    }
    assert reliability_tco_multiplier(meta["bad"]) > 1.0
    assert reliability_tco_multiplier(meta["ok"]) == 1.0
    tco_bad = _basket_tco(100.0, "bad", meta)
    tco_ok = _basket_tco(100.0, "ok", meta)
    assert tco_bad > tco_ok


def test_build_response_includes_suggestions_and_priorities():
    items = [
        _item("A", 10, {"cheap": 5, "big": 9}),
        _item("B", 10, {"cheap": 5, "big": 9}),
        _item("C", 5, {"big": 20}),
    ]
    meta = {
        "cheap": {"name": "Cheap", "min_order_value": 0, "shipping_cost": 10},
        "big": {"name": "Big", "min_order_value": 0, "shipping_cost": 0},
    }
    kp = {
        "a": {"score": 0.95, "class_a": True, "reasons": ["high_sales"]},
    }
    res = build_smart_optimize_response(
        items,
        meta,
        kitchen_priorities=kp,
        waste_top=[{"name": "A", "qty": 99}],
        fillers=[{"name": "Mąka"}],
    )
    assert "suggestions" in res
    assert isinstance(res["suggestions"], list)
    assert "kitchen_priorities" in res
    assert res["kitchen_priorities"]["A"]["class_a"] is True


def test_max_gap_still_holds_with_priority_sort():
    """High-priority tiny SKU still cannot open basket with gap > 150."""
    items = [
        _item("Bazylia", 2, {"A": 20}),  # 40 zł, min 500 → gap 460
    ]
    items = attach_kitchen_priorities(
        items,
        {"bazylia": {"score": 1.0, "class_a": True, "reasons": ["critical_shortage"]}},
    )
    meta = {"A": {"name": "A", "min_order_value": 500, "shipping_cost": 0}}
    sc = compute_split_max(items, meta)
    assert sc["suppliers"] == []
    assert "Bazylia" in (sc.get("missing") or [])
