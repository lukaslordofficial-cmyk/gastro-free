"""Unit tests: koszty strat + formuła P&L bez podwójnego liczenia."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from losses_sim_envs import (  # noqa: E402
    build_env_march_mixed,
    build_env_units_edge,
    all_envs,
)
from waste_cost_math import (  # noqa: E402
    convert_culinary,
    compute_pnl,
    dish_portions,
    evaluate_env,
    event_cost,
    inv_index,
    dish_index,
    sum_losses,
)


def test_convert_g_to_kg():
    assert convert_culinary(1000, "g", "kg") == pytest.approx(1.0)
    assert convert_culinary(0.5, "kg", "g") == pytest.approx(500.0)


def test_convert_ml_to_l():
    assert convert_culinary(1000, "ml", "l") == pytest.approx(1.0)
    assert convert_culinary(0.25, "l", "ml") == pytest.approx(250.0)


def test_dish_portions_soup_liter():
    # portion 350 g ≈ 350 ml → 1.5 l = ~4.286 porcji
    p = dish_portions(1.5, "l", 350.0)
    assert p == pytest.approx(1500 / 350, rel=1e-6)


def test_units_edge_costs():
    env = build_env_units_edge()
    by_inv = inv_index(env["inventory"])
    by_dish = dish_index(env["dishes"])
    # 1000 g pomidorów = 1 kg * 6.5
    assert event_cost(env["losses"][0], by_inv, by_dish) == pytest.approx(6.5)
    # 1000 ml śmietany = 1 l * 12.5
    assert event_cost(env["losses"][1], by_inv, by_dish) == pytest.approx(12.5)
    # 350 ml zupy = 1 porcja ≈ koszt receptury 1 porcji
    one_portion = event_cost(env["losses"][3], by_inv, by_dish)
    ml_portion = event_cost(env["losses"][2], by_inv, by_dish)
    assert one_portion == pytest.approx(ml_portion, rel=1e-3)
    # oczekiwany koszt 1 porcji: 0.2kg*6.5 + 0.04l*12.5 = 1.3 + 0.5 = 1.8
    assert one_portion == pytest.approx(1.8, abs=0.02)
    # 500 g mąki * 0.0035 = 1.75
    assert event_cost(env["losses"][4], by_inv, by_dish) == pytest.approx(1.75)


def test_pnl_no_double_count():
    pnl = compute_pnl({"revenue": 10000, "fixed": 3000, "variable_gross": 4000}, waste_pln=500)
    assert pnl["variable_net"] == 3500
    assert pnl["net_profit"] == 10000 - 3000 - 500 - 3500  # = 3000
    assert pnl["net_profit"] == pnl["net_equiv_gross"]
    assert pnl["wrong_double_count"] == 10000 - 3000 - 4000 - 500  # = 2500
    assert pnl["net_profit"] != pnl["wrong_double_count"]


def test_march_env_all_events_costed():
    ev = evaluate_env(build_env_march_mixed())
    assert ev["checks"]["waste_events_costed"]
    assert ev["checks"]["net_equals_rev_minus_fixed_minus_var_gross"]
    assert ev["checks"]["not_double_counting_waste"]
    assert ev["waste"]["total_cost_pln"] > 0


def test_all_envs_pass():
    for env in all_envs():
        ev = evaluate_env(env)
        assert all(ev["checks"].values()), (env["id"], ev["checks"], ev["pnl"])


def test_sum_losses_qty_aggregation():
    env = build_env_march_mixed()
    s = sum_losses(env)
    assert s["events_count"] == len(env["losses"])
    assert s["total_cost_pln"] == round(sum(r["cost_pln"] for r in s["events"]), 2)
