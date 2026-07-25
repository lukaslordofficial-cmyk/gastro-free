#!/usr/bin/env python3
"""
Runner: symulacja strat produktowych 2025 + weryfikacja P&L.

Użycie (katalog backend):
  python scripts/sim_losses_2025.py
  python scripts/sim_losses_2025.py --strict
  python scripts/sim_losses_2025.py --seed-live   # opcjonalnie wstawia [SIM2025-LOSS] do Supabase

Offline (domyślnie): oracle z waste_cost_math + losses_sim_envs — bez DB.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(ROOT))

from losses_sim_envs import all_envs  # noqa: E402
from waste_cost_math import evaluate_env  # noqa: E402

OUT_DIR = SCRIPTS / "_sim_losses_report"
SIM_TAG = "[SIM2025-LOSS]"


def run_offline(strict: bool) -> int:
    envs = all_envs()
    results = []
    pass_n = fail_n = 0
    lines = ["# Symulacja strat produktowych 2025", "", f"Envs: {len(envs)}", ""]

    for env in envs:
        ev = evaluate_env(env)
        checks = ev["checks"]
        ok = all(checks.values())
        if ok:
            pass_n += 1
            verdict = "PASS"
        else:
            fail_n += 1
            verdict = "FAIL"
        waste = ev["waste"]
        pnl = ev["pnl"]
        results.append({"verdict": verdict, **{k: ev[k] for k in ("id", "title", "window", "checks")}, "pnl": pnl, "waste_total": waste["total_cost_pln"], "events": waste["events_count"]})

        lines.append(f"## {verdict}: {ev['id']}")
        lines.append(f"- {ev['title']}")
        lines.append(f"- Okno: {ev['window'][0]} → {ev['window'][1]}")
        lines.append(f"- Zdarzenia strat: {waste['events_count']}, suma PLN: **{waste['total_cost_pln']:.2f} zł**")
        lines.append(
            f"- P&L: przychód {pnl['revenue']:.0f} − stałe {pnl['fixed']:.0f} − straty {pnl['waste']:.2f} "
            f"− zmienne_netto {pnl['variable_net']:.2f} = **zysk {pnl['net_profit']:.2f} zł**"
        )
        lines.append(
            f"- Równoważnie (bez podwójnego liczenia): przychód − stałe − zmienne_brutto "
            f"= {pnl['net_equiv_gross']:.2f} zł"
        )
        lines.append(
            f"- Błędne podwójne odejmowanie (stara formuła): {pnl['wrong_double_count']:.2f} zł"
        )
        lines.append(f"- Checks: {checks}")
        lines.append("")
        lines.append("| Data | Typ | Nazwa | Ilość | Jedn. | Koszt PLN |")
        lines.append("|------|-----|-------|------:|-------|----------:|")
        for r in waste["events"]:
            lines.append(
                f"| {r['date']} | {r['item_type']} | {r['name']} | {r['qty']} | {r['unit']} | {r['cost_pln']:.2f} |"
            )
        lines.append("")

    lines.insert(3, f"**Wynik: {pass_n} PASS / {fail_n} FAIL**")
    lines.insert(4, "")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "report.md").write_text("\n".join(lines), encoding="utf-8")
    (OUT_DIR / "report.json").write_text(
        json.dumps({"pass": pass_n, "fail": fail_n, "results": results}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Offline: {pass_n} PASS / {fail_n} FAIL → {OUT_DIR / 'report.md'}")
    if strict and fail_n:
        return 1
    return 0 if fail_n == 0 else (1 if strict else 0)


async def seed_live(wipe: bool) -> None:
    """Wstawia straty z env March+July do waste_logs (tag [SIM2025-LOSS])."""
    import ssl
    import certifi
    import httpx
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_KEY")
        or ""
    ).strip()
    if not url or not key:
        raise SystemExit("Brak SUPABASE_URL / KEY w .env")

    mode = os.environ.get("OPENAI_SSL_VERIFY", "auto").strip().lower()
    if mode in ("0", "false", "no"):
        verify: object = False
    elif mode in ("certifi", "bundle"):
        verify = certifi.where()
    else:
        verify = ssl.create_default_context()

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    envs = [e for e in all_envs() if e["id"] in ("march_2025_mixed", "july_2025_peak")]
    rows = []
    for env in envs:
        for ev in env["losses"]:
            d = ev["date"]
            ts = datetime.fromisoformat(f"{d}T18:30:00+00:00")
            rows.append({
                "item_name": ev["name"],
                "quantity": ev["qty"],
                "unit": ev["unit"],
                "reason": f"{SIM_TAG} {ev.get('reason') or ''} {env['id']}".strip(),
                "item_type": ev["item_type"],
                "source": "sim",
                "created_at": ts.isoformat(),
            })

    async with httpx.AsyncClient(timeout=120.0, verify=verify) as client:
        if wipe:
            r = await client.delete(
                f"{url}/rest/v1/waste_logs",
                headers=headers,
                params={"reason": f"like.*{SIM_TAG}*"},
            )
            print(f"wipe waste_logs: {r.status_code}")

        # upewnij unit_cost na magazynie (best-effort po nazwie)
        inv = (await client.get(
            f"{url}/rest/v1/inventory_items",
            headers={**headers, "Prefer": "return=representation"},
            params={"select": "id,name,unit_cost,unit", "limit": "5000"},
        )).json()
        by_name = {(i.get("name") or "").lower(): i for i in (inv or [])}
        for env in envs:
            for item in env["inventory"]:
                hit = by_name.get(item["name"].lower())
                if not hit:
                    continue
                if float(hit.get("unit_cost") or 0) > 0:
                    continue
                await client.patch(
                    f"{url}/rest/v1/inventory_items",
                    headers=headers,
                    params={"id": f"eq.{hit['id']}"},
                    json={"unit_cost": item["unit_cost"]},
                )

        for i in range(0, len(rows), 40):
            chunk = rows[i : i + 40]
            r = await client.post(f"{url}/rest/v1/waste_logs", headers=headers, json=chunk)
            if r.status_code >= 400:
                # fallback bez opcjonalnych kolumn
                slim = [
                    {k: v for k, v in row.items() if k in ("item_name", "quantity", "unit", "reason", "created_at")}
                    for row in chunk
                ]
                r2 = await client.post(f"{url}/rest/v1/waste_logs", headers=headers, json=slim)
                print(f"post chunk {i}: {r.status_code} → fallback {r2.status_code}")
            else:
                print(f"post chunk {i}: {r.status_code} ({len(chunk)} rows)")

    print(f"Seed live: {len(rows)} waste events tagged {SIM_TAG}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--seed-live", action="store_true")
    ap.add_argument("--wipe-sim", action="store_true")
    args = ap.parse_args()

    code = run_offline(args.strict)
    if args.seed_live:
        import asyncio
        asyncio.run(seed_live(args.wipe_sim))
    sys.exit(code)


if __name__ == "__main__":
    main()
