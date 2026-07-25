#!/usr/bin/env python3
"""
Symulacje koszyków Łowcy Okazji (bez UI) — reguły praktyczne + raport anomalii.

Użycie:
  python scripts/sim_deal_hunter_baskets.py
  python scripts/sim_deal_hunter_baskets.py --live   # dodatkowo hit na /api/orders/compare-offers

Wynik: stdout + plik backend/scripts/_sim_deal_hunter_report.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from smart_basket_optimizer import (  # noqa: E402
    MAX_GAP_NEW_BASKET_PLN,
    build_smart_optimize_response,
    compute_split_max,
)


def _item(name: str, qty: float, quotes: dict[str, float], unit: str = "kg") -> dict:
    bbs = {}
    for sid, price in quotes.items():
        bbs[sid] = {
            "supplier_id": sid,
            "supplier_name": f"Sup {sid}",
            "supplier_email": f"{sid}@t.pl",
            "matched_name": name,
            "unit_price_base": price,
            "base_dim": unit,
            "line_total": round(price * qty, 2),
            "matched_via": "sim",
            "order_base_qty": qty,
        }
    return {
        "product_name": name,
        "quantity": qty,
        "unit": unit,
        "base_dim": unit,
        "base_quantity": qty,
        "best_by_supplier": bbs,
    }


@dataclass
class Finding:
    severity: str  # critical | warn | info
    scenario: str
    message: str


@dataclass
class CaseResult:
    name: str
    findings: list[Finding] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)


def _analyze_scenario(case: str, sc: dict) -> list[Finding]:
    out: list[Finding] = []
    sid = sc.get("id") or "?"
    for g in sc.get("suppliers") or []:
        min_v = float(g.get("min_order_value") or 0)
        sub = float(g.get("subtotal_pln") or 0)
        gap = float(g.get("gap_to_minimum_pln") or 0)
        meets = bool(g.get("meets_minimum_order"))
        names = [it.get("product_name") for it in (g.get("items") or [])]
        # Duplikaty dokładne
        if len(names) != len(set(names)):
            out.append(Finding("critical", sid, f"Duplikat product_name w koszyku {g.get('supplier_name')}: {names}"))
        if min_v > 0 and gap > MAX_GAP_NEW_BASKET_PLN and meets is False:
            out.append(Finding(
                "critical", sid,
                f"Koszyk {g.get('supplier_name')} z luką {gap:.0f} zł > {MAX_GAP_NEW_BASKET_PLN:.0f} "
                f"(min {min_v:.0f}, sub {sub:.0f}) — nie powinien być w scenariuszu.",
            ))
        if min_v > 0 and not meets and gap <= MAX_GAP_NEW_BASKET_PLN:
            out.append(Finding(
                "warn", sid,
                f"Koszyk {g.get('supplier_name')} wymaga dopięcia (luka {gap:.0f} zł ≤ {MAX_GAP_NEW_BASKET_PLN:.0f}) — OK miękko.",
            ))
        if min_v > 0 and meets and sub < min_v - 0.01:
            out.append(Finding("critical", sid, f"meets_minimum=True ale sub {sub} < min {min_v}"))
    # Niska praktyczność: >3 dostawców przy <8 SKU
    n_sup = len(sc.get("suppliers") or [])
    n_items = sum(len(g.get("items") or []) for g in (sc.get("suppliers") or []))
    if n_sup >= 4 and n_items <= 10:
        out.append(Finding(
            "warn", sid,
            f"Niska praktyczność: {n_sup} dostawców na {n_items} pozycji.",
        ))
    if not (sc.get("suppliers") or []) and not (sc.get("missing") or []):
        out.append(Finding("warn", sid, "Pusty scenariusz bez missing — brak oferty?"))
    return out


def case_solo_under_min_hard() -> CaseResult:
    """1 produkt 40 zł, min 500 → nie wolno budować koszyka."""
    name = "solo_under_min_hard"
    items = [_item("Bazylia", 2, {"A": 20})]  # 40
    meta = {"A": {"name": "A", "min_order_value": 500, "shipping_cost": 0}}
    sc = compute_split_max(items, meta)
    cr = CaseResult(name=name, summary={"suppliers": len(sc.get("suppliers") or []), "missing": sc.get("missing")})
    cr.findings.extend(_analyze_scenario(name, sc))
    if sc.get("suppliers"):
        cr.findings.append(Finding("critical", "split_max", "Oczekiwano braku koszyka (luka >> 150)."))
    return cr


def case_fill_soft_gap_prefer_small_delta() -> CaseResult:
    """Kotwica A prawie przy min; B ma 1 tani SKU — przenieś najmniejszą dopłatę do A."""
    name = "fill_soft_gap_min_delta"
    items = [
        _item("Wolowina", 10, {"A": 45, "B": 44}),   # 450 / 440
        _item("Wieprzowina", 5, {"A": 30, "B": 28}),  # 150 / 140
        _item("Cebula", 10, {"A": 3.5, "B": 2.0}),    # 35 / 20 — duża dopłata do A
        _item("Marchew", 10, {"A": 2.2, "B": 2.0}),   # 22 / 20 — mała dopłata do A
    ]
    meta = {
        "A": {"name": "A", "min_order_value": 600, "shipping_cost": 0},
        "B": {"name": "B", "min_order_value": 500, "shipping_cost": 0},
    }
    sc = compute_split_max(items, meta)
    cr = CaseResult(name=name, summary={
        "suppliers": [
            {
                "id": g["supplier_id"],
                "sub": g["subtotal_pln"],
                "min": g["min_order_value"],
                "meets": g["meets_minimum_order"],
                "items": [i["product_name"] for i in g["items"]],
            }
            for g in (sc.get("suppliers") or [])
        ],
        "missing": sc.get("missing"),
    })
    cr.findings.extend(_analyze_scenario(name, sc))
    # Preferujemy 1–2 koszyki spełniające min
    under = [g for g in (sc.get("suppliers") or []) if not g.get("meets_minimum_order")]
    if under:
        cr.findings.append(Finding(
            "warn", "split_max",
            f"Nadal {len(under)} koszyk(ów) poniżej min po fill — sprawdź ręcznie.",
        ))
    return cr


def case_no_new_basket_when_anchor_far() -> CaseResult:
    """Duży koszyk A z luką >150 nie powinien sprowokować nowego B z 1 tanią pozycją."""
    name = "no_new_tiny_basket"
    items = [
        _item("Filet", 5, {"A": 40, "B": 39}),   # 200 / 195
        _item("Udo", 5, {"A": 35, "B": 34}),      # 175 / 170
        _item("Przyprawa", 1, {"A": 12, "B": 8}), # 12 / 8 — B solo luka ogromna
    ]
    meta = {
        "A": {"name": "A", "min_order_value": 800, "shipping_cost": 0},  # gap po 2 mięsach ~425
        "B": {"name": "B", "min_order_value": 500, "shipping_cost": 0},
    }
    sc = compute_split_max(items, meta)
    cr = CaseResult(name=name, summary={
        "suppliers": [
            {"id": g["supplier_id"], "sub": g["subtotal_pln"], "items": [i["product_name"] for i in g["items"]]}
            for g in (sc.get("suppliers") or [])
        ],
        "missing": sc.get("missing"),
    })
    cr.findings.extend(_analyze_scenario(name, sc))
    for g in sc.get("suppliers") or []:
        if g["supplier_id"] == "B" and len(g.get("items") or []) == 1:
            cr.findings.append(Finding(
                "critical", "split_max",
                "Powstał mini-koszyk B z 1 pozycją mimo twardego limitu 150 zł.",
            ))
    return cr


def case_many_skus_two_suppliers() -> CaseResult:
    """Typowy hurt: 12 SKU, 2 dostawców z min 300 — oczekuj ≤2 koszyków, bez luk >150."""
    name = "many_skus_two_suppliers"
    items = []
    for i, (n, q, pa, pb) in enumerate([
        ("Wolowina", 8, 42, 40),
        ("Kurczak", 10, 18, 19),
        ("Schab", 6, 28, 27),
        ("Mleko", 20, 3.2, 3.0),
        ("Smietana", 10, 6.5, 6.0),
        ("Maslo", 5, 8.0, 7.5),
        ("Cebula", 15, 2.5, 2.2),
        ("Ziemniak", 25, 1.8, 1.5),
        ("Makaron", 8, 5.0, 4.5),
        ("Ryz", 8, 4.0, 4.2),
        ("Olej", 6, 9.0, 8.5),
        ("Sol", 3, 2.0, 1.8),
    ]):
        items.append(_item(n, q, {"A": pa, "B": pb}))
    meta = {
        "A": {"name": "Makro", "min_order_value": 300, "shipping_cost": 25, "free_shipping_threshold": 600},
        "B": {"name": "Selgros", "min_order_value": 300, "shipping_cost": 29, "free_shipping_threshold": 700},
    }
    full = build_smart_optimize_response(items, meta)
    cr = CaseResult(name=name, summary={
        "recommended": full.get("recommended_scenario"),
        "scenarios": {
            s["id"]: {
                "viable": s.get("viable"),
                "n_sup": s.get("supplier_count"),
                "total": s.get("total_pln"),
                "meets": s.get("meets_all_minimums"),
                "missing": s.get("missing"),
            }
            for s in (full.get("scenarios") or [])
        },
    })
    for s in full.get("scenarios") or []:
        cr.findings.extend(_analyze_scenario(name, s))
    return cr


def case_duplicate_names_merged_upstream() -> CaseResult:
    """Symulacja: dwa warianty nazw tej samej pozycji już jako osobne linie — wykryj podwójne qty w wyniku."""
    name = "duplicate_name_variants"
    # Świadomie dwa rekordy — optimizer sam nie scala; scalanie jest w server._merge_duplicate_compare_items
    items = [
        _item("filet z kurczaka", 6, {"A": 22, "B": 21}),
        _item("kurczak filet", 6, {"A": 22, "B": 21}),
    ]
    meta = {
        "A": {"name": "A", "min_order_value": 200, "shipping_cost": 0},
        "B": {"name": "B", "min_order_value": 200, "shipping_cost": 0},
    }
    sc = compute_split_max(items, meta)
    cr = CaseResult(name=name, summary={"note": "bez merge w optimizerze — oczekiwane 2 linie; merge w API"})
    # Policzenie łącznego kg kurczaka w koszykach
    total_lines = sum(len(g.get("items") or []) for g in (sc.get("suppliers") or []))
    if total_lines >= 2:
        cr.findings.append(Finding(
            "info", "split_max",
            "Dwie linie kurczaka w optimizerze (OK) — API powinno je scalić przed build_smart_optimize_response.",
        ))
    return cr


CASES = [
    case_solo_under_min_hard,
    case_fill_soft_gap_prefer_small_delta,
    case_no_new_basket_when_anchor_far,
    case_many_skus_two_suppliers,
    case_duplicate_names_merged_upstream,
]


def run_live(base_url: str) -> CaseResult:
    name = "live_compare_offers"
    cr = CaseResult(name=name)
    payload = {
        "restaurant_name": "Sim Test",
        "items": [
            {"product_name_or_id": "filet z kurczaka", "quantity": 6, "unit": "kg"},
            {"product_name_or_id": "kurczak filet", "quantity": 6, "unit": "kg"},
            {"product_name_or_id": "cebula", "quantity": 10, "unit": "kg"},
            {"product_name_or_id": "mleko", "quantity": 20, "unit": "l"},
        ],
    }
    url = base_url.rstrip("/") + "/api/orders/compare-offers"
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:  # noqa: BLE001
        cr.findings.append(Finding("critical", "live", f"Request failed: {e}"))
        return cr

    req_items = data.get("items_requested") or []
    names = [i.get("product_name") for i in req_items]
    cr.summary = {
        "items_requested": names,
        "n_scenarios": len(data.get("scenarios") or []),
        "recommended": data.get("recommended_scenario"),
    }
    # Po merge nie powinno być obu wariantów osobno
    lower = [str(n).lower() for n in names]
    if "filet z kurczaka" in lower and "kurczak filet" in lower:
        cr.findings.append(Finding(
            "critical", "live",
            "API nie scaliło wariantów „filet z kurczaka” / „kurczak filet”.",
        ))
    elif any("kurczak" in str(n).lower() or "filet" in str(n).lower() for n in names):
        # Jedna linia — sprawdź qty ~12
        for it in req_items:
            if "kurczak" in str(it.get("product_name") or "").lower() or "filet" in str(it.get("product_name") or "").lower():
                qty = float(it.get("quantity") or 0)
                if qty < 10:
                    cr.findings.append(Finding(
                        "warn", "live",
                        f"Scalony kurczak ma qty={qty} (oczekiwano ~12 po sumie 6+6).",
                    ))
    for s in data.get("scenarios") or []:
        cr.findings.extend(_analyze_scenario(name, s))
    return cr


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="Dodaj test live compare-offers")
    ap.add_argument(
        "--base-url",
        default=os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "http://127.0.0.1:8001",
    )
    args = ap.parse_args()

    results: list[CaseResult] = [fn() for fn in CASES]
    if args.live:
        results.append(run_live(args.base_url))

    critical = sum(1 for r in results for f in r.findings if f.severity == "critical")
    warns = sum(1 for r in results for f in r.findings if f.severity == "warn")

    print("=== Symulacja Łowca Okazji ===")
    for r in results:
        print(f"\n## {r.name}")
        print(json.dumps(r.summary, ensure_ascii=False, indent=2)[:1200])
        for f in r.findings:
            print(f"  [{f.severity}] ({f.scenario}) {f.message}")
        if not r.findings:
            print("  (brak anomalii)")

    report = {
        "critical": critical,
        "warnings": warns,
        "cases": [
            {
                "name": r.name,
                "summary": r.summary,
                "findings": [f.__dict__ for f in r.findings],
            }
            for r in results
        ],
    }
    out = Path(__file__).resolve().parent / "_sim_deal_hunter_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nRaport: {out}")
    print(f"CRITICAL={critical} WARN={warns}")
    return 1 if critical else 0


if __name__ == "__main__":
    raise SystemExit(main())
