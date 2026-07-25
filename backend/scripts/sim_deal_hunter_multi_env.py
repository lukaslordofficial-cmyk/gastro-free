#!/usr/bin/env python3
"""
Multi-środowiskowa ocena Łowcy Okazji (stress suite).

15 syntetycznych środowisk × wiele zadań (~60).
Dla każdego: zadanie → macierz opcji → wybór Łowcy → oracle → werdykt.

Użycie:
  python scripts/sim_deal_hunter_multi_env.py
  python scripts/sim_deal_hunter_multi_env.py --strict --summary-only
  python scripts/sim_deal_hunter_multi_env.py --out scripts/_sim_multi_env_report

Wynik: report.md + report.json
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from smart_basket_optimizer import (  # noqa: E402
    MAX_GAP_NEW_BASKET_PLN,
    build_smart_optimize_response,
    shipping_cost_for,
)


def make_item(name: str, qty: float, price_by_sid: dict[str, float], unit: str = "kg") -> dict:
    bbs: dict[str, dict] = {}
    for sid, price in price_by_sid.items():
        bbs[sid] = {
            "supplier_id": sid,
            "supplier_name": sid,
            "supplier_email": f"{sid}@sim.test",
            "matched_name": name,
            "unit_price_base": float(price),
            "base_dim": unit,
            "line_total": round(float(price) * qty, 2),
            "matched_via": "sim",
            "order_base_qty": qty,
        }
    return {
        "product_name": name,
        "quantity": qty,
        "unit": unit,
        "base_dim": unit,
        "base_quantity": qty,
        "target_quantity": qty,
        "best_by_supplier": bbs,
    }


def resolve_task_items(env: dict, task: dict) -> list[dict]:
    catalog: dict[str, dict[str, float]] = env["catalog"]
    out: list[dict] = []
    for row in task["items"]:
        name = row["name"]
        qty = float(row["qty"])
        unit = row.get("unit") or "kg"
        prices = catalog.get(name) or {}
        clean = {sid: float(p) for sid, p in prices.items() if p is not None}
        out.append(make_item(name, qty, clean, unit=unit))
    return out


# Środowiska i zadania — osobny moduł (15 env / 60+ zadań)
from deal_hunter_sim_envs import ALL_ENV_BUILDERS  # noqa: E402

ENVIRONMENTS = ALL_ENV_BUILDERS


@dataclass
class OracleResult:
    total_pln: Optional[float]
    products_pln: Optional[float]
    shipping_pln: Optional[float]
    assignment: dict[str, str]
    feasible: bool
    note: str = ""


def _group_totals(
    assignment: dict[str, str],
    items: list[dict],
    suppliers_meta: dict[str, dict],
) -> tuple[Optional[float], Optional[float], Optional[float], bool, str]:
    by_sup: dict[str, float] = {}
    for pi in items:
        name = pi["product_name"]
        sid = assignment.get(name)
        if not sid:
            return None, None, None, False, f"brak przypisania: {name}"
        q = (pi.get("best_by_supplier") or {}).get(sid)
        if not q:
            return None, None, None, False, f"brak oferty {name}@{sid}"
        by_sup[sid] = by_sup.get(sid, 0.0) + float(q["line_total"])

    products = 0.0
    shipping = 0.0
    for sid, sub in by_sup.items():
        meta = suppliers_meta.get(sid) or {}
        min_v = float(meta.get("min_order_value") or 0)
        gap = max(0.0, min_v - sub) if min_v > 0 else 0.0
        if min_v > 0 and gap > MAX_GAP_NEW_BASKET_PLN:
            return None, None, None, False, f"hard-fail {sid}: gap {gap:.0f}"
        if min_v > 0 and gap > 0:
            return None, None, None, False, f"soft-fail {sid}: gap {gap:.0f} (nie meets min)"
        ship = shipping_cost_for(sub, meta)
        products += sub
        shipping += ship
    return round(products + shipping, 2), round(products, 2), round(shipping, 2), True, "ok"


def naive_lower_bound(items: list[dict]) -> tuple[float, dict[str, str]]:
    total = 0.0
    asg: dict[str, str] = {}
    for pi in items:
        bbs = pi.get("best_by_supplier") or {}
        if not bbs:
            continue
        sid, q = min(bbs.items(), key=lambda kv: float(kv[1]["line_total"]))
        total += float(q["line_total"])
        asg[pi["product_name"]] = sid
    return round(total, 2), asg


def oracle_best_feasible(
    items: list[dict],
    suppliers_meta: dict[str, dict],
    max_combos: int = 250_000,
) -> OracleResult:
    """
    Najtańsze wykonalne zamówienie (meets min u każdego dostawcy).

    Jeśli pełne pokrycie jest niewykonalne, szuka podzbioru SKU o:
      1) maksymalnym pokryciu
      2) minimalnym total
    (Łowca też może wrzucić pozycje do missing — porównanie ma być fair.)
    """
    found_items = [pi for pi in items if pi.get("best_by_supplier")]
    if not found_items:
        return OracleResult(None, None, None, {}, False, "brak ofert")

    best: Optional[OracleResult] = None

    def consider(subset: list[dict], asg: dict[str, str], note_suffix: str = "") -> None:
        nonlocal best
        total, prod, ship, ok, note = _group_totals(asg, subset, suppliers_meta)
        if not ok or total is None:
            return
        cov = len(subset)
        cand = OracleResult(total, prod, ship, dict(asg), True, note + note_suffix)
        if best is None:
            best = cand
            best.note = f"cov={cov}; " + best.note
            return
        best_cov = len(best.assignment)
        # max coverage, then min total
        if cov > best_cov or (cov == best_cov and total < (best.total_pln or 1e18)):
            best = cand
            best.note = f"cov={cov}; " + best.note

    def search_subset(subset: list[dict], note_suffix: str = "") -> None:
        if not subset:
            return
        choices: list[list[str]] = []
        names: list[str] = []
        for pi in subset:
            names.append(pi["product_name"])
            choices.append(list((pi.get("best_by_supplier") or {}).keys()))
        n_combos = 1
        for c in choices:
            n_combos *= max(1, len(c))
            if n_combos > max_combos:
                break
        if n_combos <= max_combos:
            for combo in itertools.product(*choices):
                asg = {names[i]: combo[i] for i in range(len(names))}
                consider(subset, asg, note_suffix)
            return
        # beam fallback
        beam: list[dict[str, str]] = [{}]
        BEAM = 300
        order = sorted(
            range(len(subset)),
            key=lambda i: -(
                max(float(q["line_total"]) for q in subset[i]["best_by_supplier"].values())
                - min(float(q["line_total"]) for q in subset[i]["best_by_supplier"].values())
            ),
        )
        for idx in order:
            pi = subset[idx]
            name = pi["product_name"]
            nxt: list[tuple[float, dict[str, str]]] = []
            for partial in beam:
                for sid in (pi.get("best_by_supplier") or {}):
                    asg = dict(partial)
                    asg[name] = sid
                    cost = 0.0
                    for n2, s2 in asg.items():
                        p2 = next(x for x in subset if x["product_name"] == n2)
                        cost += float(p2["best_by_supplier"][s2]["line_total"])
                    nxt.append((cost, asg))
            nxt.sort(key=lambda x: x[0])
            beam = [a for _, a in nxt[:BEAM]]
        for asg in beam:
            consider(subset, asg, note_suffix + " (beam)")

    # 1) pełne pokrycie
    search_subset(found_items, "")
    if best and len(best.assignment) == len(found_items):
        return best

    # 2) podzbiory — od największych (2^n; n<=12)
    n = len(found_items)
    if n <= 12:
        for k in range(n - 1, 0, -1):
            for combo in itertools.combinations(range(n), k):
                subset = [found_items[i] for i in combo]
                search_subset(subset, f" (subset k={k})")
            if best and len(best.assignment) >= k:
                # znaleziono najlepsze przy max cov = k (iterujemy malejąco)
                break
    else:
        # zachłannie: wyrzucaj SKU z największą luką solo
        subset = list(found_items)
        while len(subset) > 1 and (best is None or len(best.assignment) < len(subset)):
            search_subset(subset, " (greedy drop)")
            if best and len(best.assignment) == len(subset):
                break
            # drop item present only on suppliers that fail alone most often
            drop_i = max(
                range(len(subset)),
                key=lambda i: min(
                    float(q["line_total"]) for q in subset[i]["best_by_supplier"].values()
                ),
            )
            subset.pop(drop_i)

    if best:
        return best
    return OracleResult(None, None, None, {}, False, "brak feasible (także po redukcji SKU)")



@dataclass
class TaskEval:
    env_id: str
    task_id: str
    task_label: str
    requested: list[dict]
    options_matrix: dict[str, dict[str, Optional[float]]]
    hunter_choice: dict[str, Any]
    hunter_scenarios: list[dict]
    metrics: dict[str, Any]
    verdict: str
    notes: list[str] = field(default_factory=list)


def scenario_compact(sc: dict) -> dict:
    return {
        "id": sc.get("id"),
        "label": sc.get("label"),
        "viable": sc.get("viable"),
        "meets_all_minimums": sc.get("meets_all_minimums"),
        "total_pln": sc.get("total_pln"),
        "products_pln": sc.get("products_pln"),
        "shipping_pln": sc.get("shipping_pln"),
        "supplier_count": sc.get("supplier_count"),
        "missing": sc.get("missing") or [],
        "baskets": [
            {
                "supplier_id": g.get("supplier_id"),
                "supplier_name": g.get("supplier_name"),
                "subtotal_pln": g.get("subtotal_pln"),
                "min_order_value": g.get("min_order_value"),
                "meets_minimum_order": g.get("meets_minimum_order"),
                "gap_to_minimum_pln": g.get("gap_to_minimum_pln"),
                "shipping_pln": g.get("shipping_pln"),
                "items": [
                    {
                        "product_name": it.get("product_name"),
                        "quantity": it.get("quantity"),
                        "unit_price_base": it.get("unit_price_base"),
                        "line_total": it.get("line_total"),
                    }
                    for it in (g.get("items") or [])
                ],
            }
            for g in (sc.get("suppliers") or [])
        ],
    }


def evaluate_task(env: dict, task: dict) -> TaskEval:
    items = resolve_task_items(env, task)
    meta = env["suppliers"]

    options_matrix: dict[str, dict[str, Optional[float]]] = {}
    for pi in items:
        row: dict[str, Optional[float]] = {sid: None for sid in meta}
        for sid, q in (pi.get("best_by_supplier") or {}).items():
            row[sid] = float(q["unit_price_base"])
        options_matrix[pi["product_name"]] = row

    result = build_smart_optimize_response(items, meta)
    scenarios = [scenario_compact(s) for s in (result.get("scenarios") or [])]
    for key in ("scenario_split_max", "scenario_monolith", "scenario_smart_hybrid"):
        sc = result.get(key)
        if sc and sc.get("id") not in {s["id"] for s in scenarios}:
            scenarios.append(scenario_compact(sc))

    rec_id = result.get("recommended_scenario_id")
    chosen = next((s for s in scenarios if s["id"] == rec_id), None)
    if chosen is None and scenarios:
        viable = [s for s in scenarios if s.get("viable")]
        chosen = min(viable, key=lambda s: s.get("total_pln") or 1e18) if viable else scenarios[0]

    naive_prod, naive_asg = naive_lower_bound(items)
    oracle = oracle_best_feasible(items, meta)

    notes: list[str] = []
    critical = 0
    if chosen:
        for b in chosen.get("baskets") or []:
            gap = float(b.get("gap_to_minimum_pln") or 0)
            min_v = float(b.get("min_order_value") or 0)
            meets = bool(b.get("meets_minimum_order"))
            if min_v > 0 and gap > MAX_GAP_NEW_BASKET_PLN:
                notes.append(
                    f"CRITICAL: koszyk {b.get('supplier_id')} gap={gap} > 100"
                )
                critical += 1
            if min_v > 0 and meets and float(b.get("subtotal_pln") or 0) < min_v - 0.01:
                notes.append(f"CRITICAL: meets=true ale sub < min ({b.get('supplier_id')})")
                critical += 1

    hunter_total = float(chosen["total_pln"]) if chosen and chosen.get("total_pln") is not None else None
    hunter_viable = bool(chosen and chosen.get("viable"))

    opt_gap = None
    if hunter_total is not None and oracle.feasible and oracle.total_pln is not None:
        opt_gap = round(hunter_total - oracle.total_pln, 2)

    coverage_req = len(items)
    coverage_found = sum(1 for pi in items if pi.get("best_by_supplier"))
    coverage_in_choice = 0
    if chosen:
        coverage_in_choice = sum(len(b.get("items") or []) for b in (chosen.get("baskets") or []))

    if critical:
        verdict = "FAIL_RULES"
    elif not oracle.feasible:
        if hunter_viable:
            notes.append("WARN: Łowca oznaczył viable, a oracle nie widzi feasible meets-min")
            verdict = "REVIEW"
        else:
            notes.append("OK: brak feasible — Łowca nie forsuje niewykonalnego koszyka")
            verdict = "PASS_NO_FEASIBLE"
    elif hunter_total is None:
        verdict = "FAIL_NO_CHOICE"
    elif opt_gap is not None and opt_gap <= 1.0:
        verdict = "PASS_OPTIMAL"
    elif opt_gap is not None and opt_gap <= max(25.0, 0.05 * (oracle.total_pln or 1)):
        notes.append(f"Akceptowalna strata vs oracle: +{opt_gap:.2f} zł")
        verdict = "PASS_NEAR_OPTIMAL"
    elif opt_gap is not None:
        notes.append(f"Strata vs oracle: +{opt_gap:.2f} zł — przeanalizować ręcznie")
        verdict = "REVIEW_COST"
    else:
        verdict = "REVIEW"

    if "salata_iceberg" in options_matrix:
        missing = (chosen or {}).get("missing") or []
        if "salata_iceberg" in missing:
            notes.append("OK: brakujący SKU w missing")
        elif coverage_found < coverage_req:
            notes.append("WARN: salata_iceberg bez oferty, sprawdź missing")

    n_sup = int(chosen.get("supplier_count") or 0) if chosen else 0
    if n_sup >= 4 and coverage_in_choice <= 10:
        notes.append(f"WARN praktyczność: {n_sup} dostawców / {coverage_in_choice} pozycji")

    metrics = {
        "coverage_requested": coverage_req,
        "coverage_with_offers": coverage_found,
        "coverage_in_chosen_baskets": coverage_in_choice,
        "naive_lower_bound_products_pln": naive_prod,
        "naive_assignment": naive_asg,
        "oracle_feasible": oracle.feasible,
        "oracle_total_pln": oracle.total_pln,
        "oracle_products_pln": oracle.products_pln,
        "oracle_shipping_pln": oracle.shipping_pln,
        "oracle_assignment": oracle.assignment,
        "oracle_note": oracle.note,
        "hunter_viable": hunter_viable,
        "hunter_total_pln": hunter_total,
        "hunter_supplier_count": n_sup,
        "optimality_gap_pln": opt_gap,
        "max_gap_rule_pln": MAX_GAP_NEW_BASKET_PLN,
        "critical_rule_breaches": critical,
    }

    return TaskEval(
        env_id=env["id"],
        task_id=task["id"],
        task_label=task["label"],
        requested=[{"name": r["name"], "qty": r["qty"], "unit": r.get("unit") or "kg"} for r in task["items"]],
        options_matrix=options_matrix,
        hunter_choice={
            "recommended_scenario_id": rec_id,
            "chosen": chosen,
            "analysis_summary": result.get("analysis_summary"),
        },
        hunter_scenarios=scenarios,
        metrics=metrics,
        verdict=verdict,
        notes=notes,
    )


def render_markdown(evals: list[TaskEval], envs: list[dict], summary_only: bool = False) -> str:
    lines: list[str] = []
    lines.append("# Raport multi-env Łowca Okazji")
    lines.append("")
    lines.append(f"Wygenerowano: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append("")
    lines.append("## Wskaźniki oceny")
    lines.append("")
    lines.append("| Metryka | Znaczenie |")
    lines.append("|---|---|")
    lines.append("| `naive_lower_bound` | Suma najtańszych ofert per SKU (ignoruje min) — dolna granica |")
    lines.append("| `oracle_total` | Najtańsze przypisanie **spełniające minima** (enumeracja/beam) |")
    lines.append("| `hunter_total` | Koszt rekomendowanego scenariusza Łowcy (produkty+dostawa) |")
    lines.append("| `optimality_gap` | hunter − oracle (≈0 = optymalny przy meets-min) |")
    lines.append("| `PASS_OPTIMAL` | gap ≤ 1 zł |")
    lines.append("| `PASS_NEAR_OPTIMAL` | gap ≤ max(25 zł, 5% oracle) |")
    lines.append("| `PASS_NO_FEASIBLE` | brak wykonalnego koszyka — Łowca nie forsuje |")
    lines.append("| `REVIEW_*` / `FAIL_*` | wymaga analizy / złamanie reguł |")
    lines.append("")
    lines.append("## Podsumowanie")
    lines.append("")
    lines.append("| Środowisko | Zadanie | Werdykt | Hunter | Oracle | Gap | Dostawcy |")
    lines.append("|---|---|---|---:|---:|---:|---:|")
    for e in evals:
        m = e.metrics
        lines.append(
            f"| {e.env_id} | {e.task_id} | **{e.verdict}** | "
            f"{m.get('hunter_total_pln')} | {m.get('oracle_total_pln')} | "
            f"{m.get('optimality_gap_pln')} | {m.get('hunter_supplier_count')} |"
        )
    lines.append("")
    if summary_only:
        return "\n".join(lines)

    env_by_id = {e["id"]: e for e in envs}
    for e in evals:
        env = env_by_id[e.env_id]
        lines.append(f"## {env['title']} → `{e.task_id}`")
        lines.append("")
        lines.append(f"**Zadanie:** {e.task_label}")
        lines.append("")
        lines.append(f"*{env['description']}*")
        lines.append("")
        lines.append("### Co zamówić")
        for r in e.requested:
            lines.append(f"- {r['name']}: {r['qty']} {r['unit']}")
        lines.append("")
        lines.append("### Dostępne opcje (cena jednostkowa)")
        lines.append("")
        sids = list(env["suppliers"].keys())
        lines.append("| Produkt | " + " | ".join(sids) + " |")
        lines.append("|---|" + "|".join(["---:"] * len(sids)) + "|")
        for pname, row in e.options_matrix.items():
            cells = []
            for sid in sids:
                v = row.get(sid)
                cells.append("—" if v is None else f"{v:.2f}")
            lines.append(f"| {pname} | " + " | ".join(cells) + " |")
        lines.append("")
        lines.append("### Wybór Łowcy")
        ch = e.hunter_choice.get("chosen") or {}
        lines.append(
            f"- Rekomendacja: `{e.hunter_choice.get('recommended_scenario_id')}` / `{ch.get('id')}`"
        )
        lines.append(
            f"- Viable: {ch.get('viable')} · total: {ch.get('total_pln')} zł · dostawców: {ch.get('supplier_count')}"
        )
        lines.append(f"- Missing: {ch.get('missing') or []}")
        for b in ch.get("baskets") or []:
            lines.append(
                f"  - **{b.get('supplier_name')}** sub={b.get('subtotal_pln')} "
                f"min={b.get('min_order_value')} meets={b.get('meets_minimum_order')} "
                f"gap={b.get('gap_to_minimum_pln')} ship={b.get('shipping_pln')}"
            )
            for it in b.get("items") or []:
                lines.append(
                    f"    - {it.get('product_name')}: {it.get('quantity')} × {it.get('unit_price_base')} "
                    f"= {it.get('line_total')}"
                )
        lines.append("")
        lines.append("### Ocena")
        lines.append(f"- Werdykt: **{e.verdict}**")
        lines.append(f"- Naive LB (produkty): {e.metrics.get('naive_lower_bound_products_pln')}")
        lines.append(
            f"- Oracle feasible: {e.metrics.get('oracle_feasible')} "
            f"total={e.metrics.get('oracle_total_pln')} ({e.metrics.get('oracle_note')})"
        )
        if e.metrics.get("oracle_assignment"):
            lines.append(f"- Oracle assignment: `{json.dumps(e.metrics.get('oracle_assignment'), ensure_ascii=False)}`")
        lines.append(f"- Gap: {e.metrics.get('optimality_gap_pln')}")
        for n in e.notes:
            lines.append(f"- {n}")
        lines.append("")
        lines.append("<details><summary>Wszystkie scenariusze Łowcy</summary>")
        lines.append("")
        lines.append("```json")
        lines.append(json.dumps(e.hunter_scenarios, ensure_ascii=False, indent=2)[:8000])
        lines.append("```")
        lines.append("</details>")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent / "_sim_multi_env_report"),
        help="Katalog na report.md + report.json",
    )
    ap.add_argument("--strict", action="store_true", help="Exit 1 także przy REVIEW_*")
    ap.add_argument("--summary-only", action="store_true", help="Markdown tylko z tabelą podsumowania")
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    builders = ENVIRONMENTS
    envs = [fn() for fn in builders]
    evals: list[TaskEval] = []
    for env in envs:
        for task in env["tasks"]:
            ev = evaluate_task(env, task)
            evals.append(ev)
            print(
                f"[{ev.verdict}] {env['id']}/{task['id']} "
                f"hunter={ev.metrics.get('hunter_total_pln')} "
                f"oracle={ev.metrics.get('oracle_total_pln')} "
                f"gap={ev.metrics.get('optimality_gap_pln')}"
            )

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "environments": [
            {
                "id": e["id"],
                "title": e["title"],
                "description": e["description"],
                "suppliers": e["suppliers"],
            }
            for e in envs
        ],
        "evaluations": [
            {
                "env_id": ev.env_id,
                "task_id": ev.task_id,
                "task_label": ev.task_label,
                "requested": ev.requested,
                "options_matrix": ev.options_matrix,
                "hunter_choice": ev.hunter_choice,
                "hunter_scenarios": ev.hunter_scenarios,
                "metrics": ev.metrics,
                "verdict": ev.verdict,
                "notes": ev.notes,
            }
            for ev in evals
        ],
        "counts": {
            "tasks": len(evals),
            "pass": sum(1 for e in evals if e.verdict.startswith("PASS")),
            "review": sum(1 for e in evals if e.verdict.startswith("REVIEW")),
            "fail": sum(1 for e in evals if e.verdict.startswith("FAIL")),
        },
    }
    (out_dir / "report.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md = render_markdown(evals, envs, summary_only=args.summary_only)
    (out_dir / "report.md").write_text(md, encoding="utf-8")
    print(f"\nZapisano: {out_dir / 'report.md'}")
    print(f"Counts: {payload['counts']}")
    bad = payload["counts"]["fail"]
    if args.strict:
        bad += payload["counts"]["review"]
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
