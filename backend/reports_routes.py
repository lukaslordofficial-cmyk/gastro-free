"""
Raporty okresowe / zbiorcze — wydzielone z server.py.
Wymagają X-Account-Key tenanta (nie „default”).
"""
from __future__ import annotations

import re
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from http_ssl import httpx_verify

router = APIRouter(tags=["reports"])


def _require_tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


class AnalyzePeriodRequest(BaseModel):
    period_type: Literal["week", "month", "year", "custom"] = "week"
    limit_days: Optional[int] = None
    selected_periods: Optional[list] = None
    period_hint: Optional[str] = None


class ComparePeriodsRequest(BaseModel):
    period_1: str
    period_2: str


class ComprehensiveReportRequest(BaseModel):
    """Raport zbiorczy za dokładny zakres dat (YYYY-MM-DD)."""

    from_date: str
    to_date: str
    top_n: Optional[int] = 10


def _parse_ymd_or_400(raw: str, field: str) -> str:
    s = (raw or "").strip()[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        raise HTTPException(
            status_code=400,
            detail=f"Nieprawidłowa data {field} (oczekiwano YYYY-MM-DD).",
        )
    try:
        from datetime import date as _date

        _date.fromisoformat(s)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Nieprawidłowa data {field}.") from e
    return s


@router.post("/api/reports/analyze-period")
async def reports_analyze_period(req: AnalyzePeriodRequest):
    """Analiza P&L dla okresu / zaznaczonych okien."""
    _require_tenant()
    from server import _run_period_analysis

    return await _run_period_analysis(
        req.period_type,
        req.limit_days,
        period_hint=req.period_hint,
        selected_periods=req.selected_periods,
    )


@router.post("/api/reports/compare-periods")
async def reports_compare_periods(req: ComparePeriodsRequest):
    """Porównanie dwóch okresów finansowych."""
    _require_tenant()
    from server import _run_compare_periods

    return await _run_compare_periods(req.period_1, req.period_2)


@router.post("/api/reports/comprehensive")
async def reports_comprehensive(req: ComprehensiveReportRequest):
    """Raport zbiorczy: P&L, rankingi dań, zużycie magazynu, straty, dni zysku/straty."""
    _require_tenant()
    from server import (
        _aggregate_menu_sales,
        _compute_true_pnl,
        _daily_profit_series,
        _inventory_usage_for_window,
        _waste_ranking_for_window,
    )

    from_d = _parse_ymd_or_400(req.from_date, "from_date")
    to_d = _parse_ymd_or_400(req.to_date, "to_date")
    if from_d > to_d:
        raise HTTPException(
            status_code=400,
            detail="from_date nie może być późniejsza niż to_date.",
        )
    try:
        top_n = max(1, min(int(req.top_n or 10), 30))
    except (TypeError, ValueError):
        top_n = 10

    since_iso = f"{from_d}T00:00:00Z"
    until_iso = f"{to_d}T23:59:59Z"
    from datetime import date as _date

    days = max(1, (_date.fromisoformat(to_d) - _date.fromisoformat(from_d)).days + 1)

    async with httpx.AsyncClient(timeout=120.0, verify=httpx_verify()) as client:
        pnl = await _compute_true_pnl(client, from_d, to_d)
        menu = await _aggregate_menu_sales(
            client,
            days,
            since_iso=since_iso,
            until_iso=until_iso,
        )
        menu_sorted_best = sorted(
            menu,
            key=lambda r: (float(r.get("qty_sold") or 0), float(r.get("revenue_pln") or 0)),
            reverse=True,
        )
        menu_with_sales = [r for r in menu if float(r.get("qty_sold") or 0) > 0]
        menu_sorted_worst = sorted(
            menu_with_sales,
            key=lambda r: (float(r.get("qty_sold") or 0), float(r.get("revenue_pln") or 0)),
        )
        inventory_top = await _inventory_usage_for_window(
            client,
            since_iso,
            until_iso,
            top_n=top_n,
        )
        waste = await _waste_ranking_for_window(
            client,
            since_iso,
            until_iso,
            top_n=top_n,
        )
        daily = await _daily_profit_series(client, from_d, to_d)

    best_days = sorted(daily, key=lambda r: float(r.get("net_pln") or 0), reverse=True)[:top_n]
    worst_days = sorted(daily, key=lambda r: float(r.get("net_pln") or 0))[:top_n]

    return {
        "ok": True,
        "from_date": from_d,
        "to_date": to_d,
        "period_label": f"{from_d} – {to_d}",
        "top_n": top_n,
        "pnl": pnl,
        "top_dishes": menu_sorted_best[:top_n],
        "worst_dishes": menu_sorted_worst[:top_n],
        "inventory_usage_top": inventory_top,
        "waste": waste,
        "daily_profits": daily,
        "best_days": best_days,
        "worst_days": worst_days,
    }
