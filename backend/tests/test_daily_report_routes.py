"""Smoke: daily_report_routes exports + tenant on close-day."""
from __future__ import annotations

import daily_report_routes


def test_daily_report_module_exports():
    assert callable(daily_report_routes.pos_close_day)
    assert callable(daily_report_routes.reports_daily)
    assert callable(daily_report_routes.persist_daily_report)
    assert callable(daily_report_routes.auto_close_stale_daily_reports)


def test_daily_router_has_routes():
    paths = {getattr(r, "path", None) for r in daily_report_routes.router.routes}
    assert "/api/pos/close-day" in paths
    assert "/api/reports/daily" in paths
