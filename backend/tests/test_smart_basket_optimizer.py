"""Testy Smart Basket Optimizer v2."""
from smart_basket_optimizer import (
    build_smart_optimize_response,
    cache_clear,
    cache_get,
    cache_set,
    compute_monolith_scenario,
    compute_smart_hybrid,
    compute_split_max,
    make_cache_key,
    shipping_cost_for,
)


def _item(name: str, qty: float, quotes: dict) -> dict:
    """quotes: sid -> unit_price (line = price * qty for simplicity)."""
    bbs = {}
    for sid, price in quotes.items():
        bbs[sid] = {
            "supplier_id": sid,
            "supplier_name": f"Sup {sid}",
            "supplier_email": f"{sid}@t.pl",
            "matched_name": name,
            "unit_price_base": price,
            "base_dim": "kg",
            "line_total": round(price * qty, 2),
            "matched_via": "fuzzy",
        }
    return {
        "product_name": name,
        "quantity": qty,
        "unit": "kg",
        "base_dim": "kg",
        "base_quantity": qty,
        "best_by_supplier": bbs,
    }


def test_shipping_free_threshold():
    assert shipping_cost_for(100, {"shipping_cost": 20, "free_shipping_threshold": 300}) == 20
    assert shipping_cost_for(300, {"shipping_cost": 20, "free_shipping_threshold": 300}) == 0
    assert shipping_cost_for(50, {"shipping_cost": 0}) == 0


def test_split_max_respects_min_order():
    """Mała pozycja u drogiego Selgros poniżej min → przeniesiona do Makro."""
    items = [
        _item("Wolowina", 10, {"makro": 40, "selgros": 38}),  # 400 vs 380
        _item("Bazylia", 1, {"makro": 15, "selgros": 12}),     # 15 vs 12
    ]
    meta = {
        "makro": {"name": "Makro", "min_order_value": 200, "shipping_cost": 0},
        "selgros": {"name": "Selgros", "min_order_value": 500, "shipping_cost": 20},
    }
    sc = compute_split_max(items, meta)
    assert sc["id"] == "split_max"
    # Żaden koszyk poniżej min nie może trafić do wyniku
    for g in sc["suppliers"]:
        assert g["meets_minimum_order"] is True
        mv = float(g.get("min_order_value") or 0)
        if mv > 0:
            assert g["subtotal_pln"] >= mv


def test_split_max_drops_solo_under_min():
    """Jajka 8 zł u Euro (min 800) bez legalnego koszyka → brak oferty Euro, pozycja w missing lub u innego."""
    items = [
        _item("Jajka", 10, {"euro": 0.8, "pantry": 1.0}),  # 8 vs 10
    ]
    meta = {
        "euro": {"name": "EuroCash", "min_order_value": 800, "shipping_cost": 49, "free_shipping_threshold": 1200},
        "pantry": {"name": "Pantry", "min_order_value": 200, "shipping_cost": 19},
    }
    sc = compute_split_max(items, meta)
    for g in sc["suppliers"]:
        assert g["meets_minimum_order"] is True
        assert g["supplier_id"] != "euro" or g["subtotal_pln"] >= 800
    # Żaden nie spełnia min solo → brak dostawców, jajka w missing
    assert sc["suppliers"] == [] or all(
        float(g.get("min_order_value") or 0) <= 0
        or g["subtotal_pln"] >= float(g.get("min_order_value") or 0)
        for g in sc["suppliers"]
    )
    if not sc["suppliers"]:
        assert "Jajka" in sc["missing"]


def test_split_max_moves_eggs_into_legal_basket():
    items = [
        _item("Jajka", 10, {"euro": 0.8, "pantry": 1.0}),   # 8 / 10
        _item("Olej", 40, {"pantry": 9.0, "euro": 10.0}),    # 360 / 400 — pantry >= 200
    ]
    meta = {
        "euro": {"name": "EuroCash", "min_order_value": 800, "shipping_cost": 49},
        "pantry": {"name": "Pantry", "min_order_value": 200, "shipping_cost": 19},
    }
    sc = compute_split_max(items, meta)
    assert sc["viable"] is True
    euro = [g for g in sc["suppliers"] if g["supplier_id"] == "euro"]
    assert euro == []  # nie wolno zostawić samego Euro poniżej 800
    pantry = [g for g in sc["suppliers"] if g["supplier_id"] == "pantry"]
    assert len(pantry) == 1
    assert pantry[0]["subtotal_pln"] >= 200
    names = {it["product_name"] for it in pantry[0]["items"]}
    assert "Jajka" in names and "Olej" in names

def test_three_scenarios_and_shield():
    # A,B najtańsze u "cheap"; C tylko u "big" → split 2 dostawców vs monolit droższy
    items = [
        _item("A", 10, {"cheap": 5, "big": 9}),
        _item("B", 10, {"cheap": 5, "big": 9}),
        _item("C", 5, {"big": 20}),
    ]
    meta = {
        "cheap": {"name": "Cheap", "min_order_value": 0, "shipping_cost": 10},
        "big": {"name": "Big", "min_order_value": 0, "shipping_cost": 0},
    }
    # Split: A+B@cheap=100+ship10, C@big=100 → 210
    # Monolith big: 90+90+100=280
    res = build_smart_optimize_response(items, meta)
    assert "scenario_split_max" in res
    assert "scenario_monolith" in res
    assert "scenario_smart_hybrid" in res
    split_t = res["scenario_split_max"]["total_pln"]
    mono_t = res["scenario_monolith"]["total_pln"]
    assert split_t < mono_t
    assert res["is_multivariable"] is True
    assert res["savings_amount"] > 0


def test_ux_shield_single_sku():
    items = [_item("Maslo", 2, {"s1": 8, "s2": 9})]
    meta = {
        "s1": {"name": "S1", "min_order_value": 0},
        "s2": {"name": "S2", "min_order_value": 0},
    }
    res = build_smart_optimize_response(items, meta)
    assert res["is_multivariable"] is False
    assert res["best_option"] is not None


def test_hybrid_merges_small_baskets():
    items = [
        _item("Mieso", 20, {"rzeznia": 30, "makro": 35}),       # 600 vs 700
        _item("Bazylia", 1, {"selgros": 12, "makro": 15}),       # mały koszyk
    ]
    meta = {
        "rzeznia": {"name": "Rzeznia", "min_order_value": 0, "shipping_cost": 15},
        "makro": {"name": "Makro", "min_order_value": 200, "shipping_cost": 0},
        "selgros": {"name": "Selgros", "min_order_value": 300, "shipping_cost": 20},
    }
    split = compute_split_max(items, meta)
    mono = compute_monolith_scenario(items, meta)
    hyb = compute_smart_hybrid(items, meta, split, mono)
    assert hyb["id"] == "smart_hybrid"
    # Hybrid powinien istnieć
    assert hyb["supplier_count"] >= 1


def test_cache_roundtrip():
    cache_clear()
    key = make_cache_key("a", "b")
    cache_set(key, {"ok": True, "x": 1})
    got = cache_get(key)
    assert got and got["ok"] is True and got.get("from_cache") is True
    cache_clear()
    assert cache_get(key) is None


def test_hard_gap_over_150_no_solo_basket():
    """Produkt 40 zł przy min 500 → brak koszyka (luka > 150)."""
    items = [_item("Bazylia", 2, {"A": 20})]
    meta = {"A": {"name": "A", "min_order_value": 500, "shipping_cost": 0}}
    sc = compute_split_max(items, meta)
    assert sc["suppliers"] == []
    assert "Bazylia" in (sc.get("missing") or [])


def test_no_tiny_new_basket_when_gap_huge():
    """Nie twórz mini-koszyka B z 1 SKU gdy luka >> 150."""
    items = [
        _item("Filet", 5, {"A": 40, "B": 39}),
        _item("Udo", 5, {"A": 35, "B": 34}),
        _item("Przyprawa", 1, {"A": 12, "B": 8}),
    ]
    meta = {
        "A": {"name": "A", "min_order_value": 800, "shipping_cost": 0},
        "B": {"name": "B", "min_order_value": 500, "shipping_cost": 0},
    }
    sc = compute_split_max(items, meta)
    for g in sc["suppliers"]:
        gap = float(g.get("gap_to_minimum_pln") or 0)
        min_v = float(g.get("min_order_value") or 0)
        if min_v > 0 and not g.get("meets_minimum_order"):
            assert gap <= 150.0
        if g["supplier_id"] == "B":
            assert len(g.get("items") or []) != 1 or g.get("meets_minimum_order")


def test_exclusive_below_50_no_illegal_basket():
    """Herbata tylko u Euro; reszta najtańsza u Makro (<50%) → Herbata missing, bez Euro."""
    items = [
        _item("Herbata", 1, {"euro": 35}),
        _item("Maka", 20, {"makro": 3, "euro": 4}),   # 60 / 80 — cheapest makro
        _item("Olej", 10, {"makro": 9, "euro": 11}),  # 90 / 110
        _item("Sol", 5, {"makro": 2, "euro": 3}),     # 10 / 15
    ]
    meta = {
        "euro": {"name": "Euro", "min_order_value": 800, "shipping_cost": 0},
        "makro": {"name": "Makro", "min_order_value": 0, "shipping_cost": 0},
    }
    sc = compute_split_max(items, meta)
    assert "euro" not in [g["supplier_id"] for g in sc["suppliers"]]
    assert "Herbata" in (sc.get("missing") or [])
    log = sc.get("decision_log") or []
    assert any(e.get("reason_code") == "EXCLUSIVE_BELOW_50PCT" for e in log)


def test_exclusive_over_50_anchors_when_tco_ok():
    """Exclusive u Pantry + ≥50% najtańszych tam + TCO OK → koszyk Pantry z fillerami."""
    items = [
        _item("Specjal", 1, {"pantry": 40}),                 # exclusive
        _item("A", 10, {"pantry": 12, "makro": 15}),         # 120 / 150 — pantry cheapest
        _item("B", 10, {"pantry": 10, "makro": 14}),         # 100 / 140
        _item("C", 5, {"pantry": 8, "makro": 9}),            # 40 / 45
    ]
    # pantry subtotal ≈ 40+120+100+40 = 300 ≥ min 250
    meta = {
        "pantry": {"name": "Pantry", "min_order_value": 250, "shipping_cost": 0},
        "makro": {"name": "Makro", "min_order_value": 0, "shipping_cost": 0},
    }
    sc = compute_split_max(items, meta)
    pantry = [g for g in sc["suppliers"] if g["supplier_id"] == "pantry"]
    assert len(pantry) == 1
    names = {it["product_name"] for it in pantry[0]["items"]}
    assert "Specjal" in names
    assert pantry[0]["meets_minimum_order"] is True
    log = sc.get("decision_log") or []
    assert any(e.get("reason_code") in ("EXCLUSIVE_TCO_OK", "EXCLUSIVE_SIBLING_OK") for e in log)


def test_tco_prefers_consolidate_over_soft_gap():
    """Kara min u Selgros przewyższa dopłatę u Makro → konsolidacja do Makro."""
    items = [
        _item("Wolowina", 10, {"makro": 40, "selgros": 38}),  # 400 vs 380
        _item("Bazylia", 1, {"makro": 15, "selgros": 12}),     # 15 vs 12
    ]
    meta = {
        "makro": {"name": "Makro", "min_order_value": 200, "shipping_cost": 0},
        "selgros": {"name": "Selgros", "min_order_value": 500, "shipping_cost": 20},
    }
    sc = compute_split_max(items, meta)
    sids = [g["supplier_id"] for g in sc["suppliers"]]
    assert "makro" in sids
    assert "selgros" not in sids or all(
        g.get("meets_minimum_order") for g in sc["suppliers"] if g["supplier_id"] == "selgros"
    )
    for g in sc["suppliers"]:
        assert g["meets_minimum_order"] is True


def test_gap_over_150_never_kept():
    items = [
        _item("X", 1, {"A": 50}),
        _item("Y", 1, {"A": 40}),
    ]
    meta = {"A": {"name": "A", "min_order_value": 400, "shipping_cost": 0}}
    sc = compute_split_max(items, meta)
    for g in sc["suppliers"]:
        gap = float(g.get("gap_to_minimum_pln") or 0)
        if not g.get("meets_minimum_order"):
            assert gap <= 150.0
    # 90 zł przy min 400 → gap 310 > 150 → brak koszyka
    assert sc["suppliers"] == []


def test_merge_duplicate_compare_items_sums_qty():
    from server import _merge_duplicate_compare_items

    a = _item("filet z kurczaka", 6, {"A": 22})
    b = _item("kurczak filet", 6, {"A": 21})
    a["inventory_id"] = "inv-1"
    b["inventory_id"] = "inv-1"
    a["food_key"] = "filet kurczak"
    b["food_key"] = "filet kurczak"
    merged = _merge_duplicate_compare_items([a, b])
    assert len(merged) == 1
    assert float(merged[0]["quantity"]) == 12.0
    assert float(merged[0]["best_by_supplier"]["A"]["unit_price_base"]) == 21.0


def test_merge_rukola_and_salata_rukola():
    from server import _merge_duplicate_compare_items, _food_match_key

    a = _item("rukola", 2, {"A": 10, "B": 12})
    b = _item("sałata rukola", 2, {"A": 11, "B": 9})
    a["food_key"] = _food_match_key("rukola")
    b["food_key"] = _food_match_key("sałata rukola")
    merged = _merge_duplicate_compare_items([a, b])
    assert len(merged) == 1


def test_dedupe_products_across_supplier_groups():
    from server import _dedupe_products_across_supplier_groups

    groups = [
        {
            "supplier_id": "a",
            "supplier_name": "A",
            "min_order_value": 0,
            "items": [
                {"product_name": "rukola", "line_total": 20.0},
                {"product_name": "mleko", "line_total": 10.0},
            ],
        },
        {
            "supplier_id": "b",
            "supplier_name": "B",
            "min_order_value": 0,
            "items": [
                {"product_name": "rukola", "line_total": 15.0},
            ],
        },
    ]
    out = _dedupe_products_across_supplier_groups(groups)
    names = [(g["supplier_id"], [i["product_name"] for i in g["items"]]) for g in out]
    # tańsza rukola u B; mleko zostaje u A
    assert ("b", ["rukola"]) in names
    assert ("a", ["mleko"]) in names
