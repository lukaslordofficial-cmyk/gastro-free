#!/usr/bin/env python3
"""Weryfikacja: POS + PnL marca/lipca 2025 po seedzie."""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENAI_SSL_VERIFY", "0")

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import httpx
from server import _compute_true_pnl, _aggregate_menu_sales, _httpx_verify, _resolve_period_window


async def main():
    s, u, label = _resolve_period_window("year", None, "najlepiej sprzedajace sie 2025 roku")
    print("resolve year:", label, s[:10], u[:10])
    s2, u2, l2 = _resolve_period_window("month", None, "marzec 2025")
    print("resolve march:", l2, s2[:10], u2[:10])

    async with httpx.AsyncClient(timeout=90, verify=_httpx_verify()) as c:
        pnl = await _compute_true_pnl(c, "2025-03-01", "2025-03-31")
        print("PnL marzec 2025:", {k: pnl[k] for k in (
            "total_revenue", "fixed_costs_allocated", "variable_costs_allocated",
            "operating_profit", "net_profit", "days_count",
        )})
        rows = await _aggregate_menu_sales(
            c, 365, since_iso="2025-01-01T00:00:00", until_iso="2025-12-31T23:59:59",
        )
        rows.sort(key=lambda r: r["qty_sold"], reverse=True)
        print("Top POS 2025:", [(r["name"], r["qty_sold"], r["revenue_pln"]) for r in rows[:5]])


asyncio.run(main())
