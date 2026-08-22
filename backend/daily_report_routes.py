"""
Raporty dobowe (close-day + lista + auto-close) — wydzielone z server.py.
Wymaga require_tenant_account_key() na mutacjach i odczycie archiwum.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get, sb_patch, sb_post

router = APIRouter(tags=["daily-reports"])
logger = logging.getLogger("server")

DAILY_REPORT_AUTO_CLOSE_HOURS = 25


class CloseDayRequest(BaseModel):
    date: Optional[str] = None  # YYYY-MM-DD; domyślnie dziś (UTC)
    total_revenue: Optional[float] = None
    total_waste_cost: Optional[float] = None
    total_invoice_cost: Optional[float] = None


def _week_of_month(d) -> int:
    return min(5, (int(d.day) - 1) // 7 + 1)


async def _sum_amount_for_day(client, table: str, day: str, extra: dict | None = None) -> float:
    """Best-effort suma amount_pln z tabeli dla danego dnia (po created_at)."""
    from datetime import date as _d, timedelta as _td
    try:
        next_day = (_d.fromisoformat(day) + _td(days=1)).isoformat()
        params = [
            ("select", "amount_pln"),
            ("created_at", f"gte.{day}T00:00:00"),
            ("created_at", f"lt.{next_day}T00:00:00"),
        ]
        if extra:
            for k, v in extra.items():
                params.append((k, v))
        rows = await sb_get(client, table, params=params) or []
        return round(sum(float(r.get("amount_pln") or 0) for r in rows), 2)
    except Exception:
        return 0.0


async def _generate_day_summary(
    httpx_c: httpx.AsyncClient,
    revenue: float,
    waste: float,
    invoice: float,
    day: str,
) -> tuple[str, dict]:
    from server import CHAT_MODEL, _bill_openai_response, _openai

    profit = round(revenue - waste - invoice, 2)
    try:
        client = _openai()
        prompt = (
            f"Przeanalizuj dzień pracy restauracji ({day}). "
            f"Utarg: {revenue} zł, Straty (waste): {waste} zł, Koszty faktur: {invoice} zł, "
            f"Zysk netto: {profit} zł. "
            "Wygeneruj profesjonalne, dokładnie 3-zdaniowe podsumowanie managerskie po polsku: "
            "co poszło dobrze, gdzie uciekły pieniądze i jedna konkretna rekomendacja na jutro."
        )
        resp = await client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.5,
            messages=[{"role": "user", "content": prompt}],
        )
        billing = await _bill_openai_response(
            httpx_c,
            resp,
            endpoint="/api/pos/close-day",
            model=CHAT_MODEL,
            extras={"date": day},
        )
        return (resp.choices[0].message.content or "").strip(), billing
    except Exception as e:  # noqa: BLE001
        logger.warning("_generate_day_summary failed: %s", e)
        return (
            f"Utarg {revenue} zł, straty {waste} zł, koszty faktur {invoice} zł, "
            f"zysk netto {profit} zł.",
            {"credits_deducted": 0},
        )


def _parse_iso_dt(value):
    from datetime import datetime as _dt, timezone as _tz

    if not value:
        return None
    try:
        s = str(value).strip().replace("Z", "+00:00")
        dt = _dt.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_tz.utc)
        return dt
    except Exception:
        return None


async def persist_daily_report(
    client,
    day: str,
    *,
    revenue: float | None = None,
    waste: float | None = None,
    invoice: float | None = None,
    use_ai: bool = True,
    auto_closed: bool = False,
    allow_overwrite: bool = True,
) -> tuple[dict | None, dict, str | None]:
    """Agregacja + zapis daily_reports (ręczne i auto zamknięcie)."""
    from datetime import date as _date

    d_obj = _date.fromisoformat(day)
    if revenue is None:
        revenue = await _sum_amount_for_day(client, "revenue_entries", day)
    if invoice is None:
        invoice = await _sum_amount_for_day(
            client, "variable_cost_entries", day, {"type": "eq.materials"}
        )
    if waste is None:
        waste = await _sum_amount_for_day(
            client, "variable_cost_entries", day, {"type": "eq.waste"}
        )

    existing = await sb_get(
        client,
        "daily_reports",
        params={"select": "id", "date": f"eq.{day}", "limit": "1"},
    )
    if existing and not allow_overwrite:
        return None, {"credits_deducted": 0}, "exists"

    if use_ai:
        summary, billing = await _generate_day_summary(client, revenue, waste, invoice, day)
    else:
        profit = round(float(revenue) - float(waste) - float(invoice), 2)
        summary = (
            f"[Auto] Zamknięto automatycznie po {DAILY_REPORT_AUTO_CLOSE_HOURS}h od poprzedniego raportu. "
            f"Utarg {revenue} zł, straty {waste} zł, koszty faktur {invoice} zł, zysk netto {profit} zł."
        )
        billing = {"credits_deducted": 0}
        if auto_closed:
            pass

    record = {
        "date": day,
        "total_revenue": revenue,
        "total_waste_cost": waste,
        "total_invoice_cost": invoice,
        "ai_summary": summary,
        "year": d_obj.year,
        "month": d_obj.month,
        "week_of_month": _week_of_month(d_obj),
    }
    if existing:
        await sb_patch(client, "daily_reports", {"date": f"eq.{day}"}, record)
        record["id"] = existing[0]["id"]
    else:
        row = await sb_post(client, "daily_reports", record)
        record["id"] = (row[0] if isinstance(row, list) else row).get("id")
    return record, billing, None


async def auto_close_stale_daily_reports(client) -> list[str]:
    """Domyka brakujące raporty dobowe, gdy od last close minęło ≥25h."""
    from datetime import datetime as _dt, timezone as _tz, date as _date, timedelta as _td

    try:
        rows = await sb_get(
            client,
            "daily_reports",
            params={"select": "date,created_at", "order": "date.desc", "limit": "1"},
        ) or []
    except httpx.HTTPStatusError:
        return []

    if not rows:
        return []

    last = rows[0]
    last_date_s = str(last.get("date") or "")[:10]
    closed_at = _parse_iso_dt(last.get("created_at"))
    if not last_date_s or closed_at is None:
        return []

    now = _dt.now(_tz.utc)
    hours_since = (now - closed_at).total_seconds() / 3600.0
    if hours_since < DAILY_REPORT_AUTO_CLOSE_HOURS:
        return []

    try:
        last_d = _date.fromisoformat(last_date_s)
    except ValueError:
        return []

    yesterday = now.date() - _td(days=1)
    closed_days: list[str] = []
    d = last_d + _td(days=1)
    while d <= yesterday and len(closed_days) < 14:
        day_s = d.isoformat()
        try:
            rec, _billing, skip = await persist_daily_report(
                client,
                day_s,
                use_ai=False,
                auto_closed=True,
                allow_overwrite=False,
            )
            if rec and not skip:
                closed_days.append(day_s)
                logger.info("daily_reports auto-close: %s", day_s)
        except Exception as e:  # noqa: BLE001
            logger.warning("daily_reports auto-close failed for %s: %s", day_s, e)
            break
        d += _td(days=1)
    return closed_days


@router.post("/api/pos/close-day")
async def pos_close_day(req: CloseDayRequest):
    """Zamknięcie dnia → daily_reports + opcjonalne podsumowanie AI."""
    from datetime import datetime as _dt, timezone as _tz, date as _date

    from server import _is_missing_column_error, _with_billing, require_tenant_account_key

    require_tenant_account_key()
    day = (req.date or _dt.now(_tz.utc).strftime("%Y-%m-%d")).strip()
    try:
        _date.fromisoformat(day)
    except ValueError:
        raise HTTPException(status_code=400, detail="Nieprawidłowa data (YYYY-MM-DD).")

    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as client:
        try:
            record, billing, _skip = await persist_daily_report(
                client,
                day,
                revenue=req.total_revenue,
                waste=req.total_waste_cost,
                invoice=req.total_invoice_cost,
                use_ai=True,
                allow_overwrite=True,
            )
        except httpx.HTTPStatusError as e:
            if (
                _is_missing_column_error(e)
                or "daily_reports" in (e.response.text or "").lower()
                or e.response.status_code == 404
            ):
                return {
                    "ok": False,
                    "needs_migration": True,
                    "message": (
                        "Uruchom migrację ADD_DAILY_REPORTS.sql w Supabase "
                        "(tabela daily_reports)."
                    ),
                }
            raise HTTPException(status_code=502, detail=f"daily_reports: {e.response.text}") from e

    revenue = float((record or {}).get("total_revenue") or 0)
    waste = float((record or {}).get("total_waste_cost") or 0)
    invoice = float((record or {}).get("total_invoice_cost") or 0)
    return _with_billing(
        {
            "ok": True,
            "id": (record or {}).get("id"),
            "report": record,
            "message": (
                f"Raport dobowy {day} zapisany. "
                f"Zysk netto: {round(revenue - waste - invoice, 2)} zł."
            ),
        },
        billing,
    )


@router.get("/api/reports/daily")
async def reports_daily():
    """Archiwum raportów dobowych + safety-net auto-close."""
    from server import require_tenant_account_key

    require_tenant_account_key()
    async with httpx.AsyncClient(timeout=60.0, verify=httpx_verify()) as client:
        try:
            auto_closed = await auto_close_stale_daily_reports(client)
            rows = await sb_get(
                client,
                "daily_reports",
                params={"select": "*", "order": "date.desc", "limit": "2000"},
            )
            out = {"ok": True, "reports": rows or []}
            if auto_closed:
                out["auto_closed_dates"] = auto_closed
            return out
        except httpx.HTTPStatusError:
            return {"ok": True, "reports": [], "needs_migration": True}
