"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `analytics_periods`."""
from __future__ import annotations

from typing import Optional
from voice_period_intent_guard import strip_pl_month as _strip_pl_month
import re
from constants import _MONTHS_PL, _MONTH_NAMES_PL



# Domyślny rok finansowy gdy użytkownik nie poda roku („zyski z lipca”).
# Wcześniej na sztywno 2025 (seed SIM) — teraz bieżący rok kalendarzowy.
def _default_finance_year() -> int:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).year


def _period_days(period_type: str, limit_days) -> int:
    try:
        if limit_days and int(limit_days) > 0:
            return int(limit_days)
    except (TypeError, ValueError):
        pass
    return {"day": 1, "week": 7, "month": 30, "year": 365, "custom": 7}.get(period_type, 7)


def _period_label(period_type: str, days: int) -> str:
    return {
        "day": "ostatni dzień",
        "week": "ostatni tydzień",
        "month": "ostatni miesiąc",
        "year": "ostatni rok",
        "custom": f"ostatnie {days} dni",
    }.get(period_type, f"ostatnie {days} dni")



def _resolve_period_window(
    period_type: Optional[str] = None,
    limit_days=None,
    period_hint: Optional[str] = None,
):
    """Zwraca (since_iso, until_iso, label). Obsługuje miesiące kalendarzowe (lipiec, lipiec 2025, 2026-07)."""
    from datetime import datetime, timezone, timedelta
    from calendar import monthrange

    now = datetime.now(timezone.utc)
    hint = (period_hint or "").strip()

    # YYYY-MM
    m_iso = re.match(r"^(\d{4})-(\d{1,2})$", hint)
    if m_iso:
        y, mo = int(m_iso.group(1)), int(m_iso.group(2))
        if 1 <= mo <= 12:
            last = monthrange(y, mo)[1]
            since = datetime(y, mo, 1, tzinfo=timezone.utc)
            until = datetime(y, mo, last, 23, 59, 59, tzinfo=timezone.utc)
            return since.isoformat(), until.isoformat(), f"{_MONTH_NAMES_PL[mo]} {y}"

    # rok w tekście (np. „lipiec 2025”, „zyski z lipca 2025”)
    y_hint = None
    m_yr = re.search(r"(20\d{2})", hint)
    if m_yr:
        y_hint = int(m_yr.group(1))

    # nazwa miesiąca PL — szukaj w całym tekście (nie tylko exact match)
    # UWAGA: nie używaj 3-literowych skrótów (sie=się→fałszywy sierpień, lip, mar…)
    key = _strip_pl_month(hint)
    mo = None
    month_tokens = sorted(
        ((n, num) for n, num in _MONTHS_PL.items() if len(n) >= 4 or n in ("maj",)),
        key=lambda kv: -len(kv[0]),
    )
    for name, num in month_tokens:
        if name == "sie":
            continue  # „się” po strip → sie
        if len(name) <= 3:
            if re.search(rf"\b{re.escape(name)}\b", key):
                mo = num
                break
        elif name in key:
            mo = num
            break
    if mo is None and key in _MONTHS_PL and key != "sie":
        mo = _MONTHS_PL[key]

    if mo is not None:
        # Bez roku w komendzie → bieżący rok kalendarzowy.
        y = y_hint if y_hint is not None else _default_finance_year()
        last = monthrange(y, mo)[1]
        since = datetime(y, mo, 1, tzinfo=timezone.utc)
        until = datetime(y, mo, last, 23, 59, 59, tzinfo=timezone.utc)
        return since.isoformat(), until.isoformat(), f"{_MONTH_NAMES_PL[mo]} {y}"

    # sam rok: „2025” / „rok 2025” / „w 2025 roku”
    if y_hint is not None and mo is None:
        since = datetime(y_hint, 1, 1, tzinfo=timezone.utc)
        until = datetime(y_hint, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        return since.isoformat(), until.isoformat(), f"rok {y_hint}"

    # period_type z UI (tydzień / miesiąc / rok) — rzeczywiste okno względem „teraz”.
    pt = (period_type or "").strip().lower()

    if pt == "week":
        until = now.replace(hour=23, minute=59, second=59, microsecond=0)
        since = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
        return (
            since.isoformat(),
            until.isoformat(),
            f"ostatnie 7 dni · {_MONTH_NAMES_PL[now.month]} {now.year}",
        )
    if pt == "month":
        y, mo = now.year, now.month
        last = monthrange(y, mo)[1]
        since = datetime(y, mo, 1, tzinfo=timezone.utc)
        until = datetime(y, mo, last, 23, 59, 59, tzinfo=timezone.utc)
        return since.isoformat(), until.isoformat(), f"{_MONTH_NAMES_PL[mo]} {y}"
    if pt == "year":
        y = now.year
        since = datetime(y, 1, 1, tzinfo=timezone.utc)
        until = datetime(y, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        return since.isoformat(), until.isoformat(), f"rok {y}"

    # Hint bez miesiąca/roku (np. „ranking sprzedaży”) — bieżący rok.
    y = _default_finance_year()
    since = datetime(y, 1, 1, tzinfo=timezone.utc)
    until = datetime(y, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    return since.isoformat(), until.isoformat(), f"rok {y}"


def _sels_from_hint(hint: Optional[str]) -> Optional[list[dict]]:
    """Z hintu „zyski z grudnia 2025” zbuduj selected_periods (gdy drzewko puste)."""
    if not hint or not str(hint).strip():
        return None
    since, until, label = _resolve_period_window("month", None, str(hint).strip())
    # Wyciągnij rok/miesiąc z okna
    try:
        y = int(since[:4])
        m = int(since[5:7])
        # cały rok?
        if since[5:10] == "01-01" and until[5:10] == "12-31":
            return [{"kind": "year", "year": y}]
        return [{"kind": "month", "year": y, "month": m}]
    except Exception:
        return None


def _merge_period_sels(p: dict) -> Optional[list[dict]]:
    """Drzewko ma priorytet; gdy puste / niespójne z transcriptem — buduj z hintu."""
    sels = _coerce_selected_periods(p.get("selected_periods"))
    hint = None
    for k in ("period_1", "note", "_transcript"):
        v = p.get(k)
        if isinstance(v, str) and v.strip():
            hint = v.strip()
            break
    from_hint = _sels_from_hint(hint)
    if not sels:
        return from_hint
    if from_hint:
        # Jeśli transcript ma jawny rok, a drzewko inny — bierz transcript (częsty bug 2026 vs 2025)
        hy = from_hint[0].get("year")
        if hy and any(int(s.get("year") or 0) != int(hy) for s in sels):
            y_in_hint = bool(re.search(r"20\d{2}", hint or ""))
            if y_in_hint:
                return from_hint
    return sels


def _coerce_selected_periods(raw) -> Optional[list[dict]]:
    """Normalizuje selected_periods z frontu (drzewko dat) do listy dictów."""
    if not raw or not isinstance(raw, list):
        return None
    out: list[dict] = []
    for sel in raw[:24]:
        if not isinstance(sel, dict):
            continue
        kind = str(sel.get("kind") or "month").strip().lower()
        if kind not in ("year", "month", "week", "day"):
            continue
        try:
            y = int(sel.get("year"))
        except (TypeError, ValueError):
            continue
        if y < 2000 or y > 2100:
            continue
        item: dict = {"kind": kind, "year": y}
        if kind in ("month", "week", "day"):
            try:
                m = int(sel.get("month") or 0)
            except (TypeError, ValueError):
                continue
            if not (1 <= m <= 12):
                continue
            item["month"] = m
        if kind == "week":
            try:
                item["week"] = max(1, min(5, int(sel.get("week") or 1)))
            except (TypeError, ValueError):
                item["week"] = 1
        if kind == "day":
            try:
                item["day"] = max(1, min(31, int(sel.get("day") or 1)))
            except (TypeError, ValueError):
                item["day"] = 1
        out.append(item)
    return out or None


def _window_from_period_sel(sel: dict) -> tuple[str, str, str]:
    """{kind, year, month?, week?, day?} → (since_iso, until_iso, label) z czasem UTC (Z)."""
    from calendar import monthrange
    kind = (sel.get("kind") or "month").lower()
    y = int(sel.get("year") or _default_finance_year())
    if kind == "year":
        return (
            f"{y}-01-01T00:00:00Z",
            f"{y}-12-31T23:59:59Z",
            f"rok {y}",
        )
    m = int(sel.get("month") or 1)
    last = monthrange(y, m)[1]
    if kind == "month":
        return (
            f"{y}-{m:02d}-01T00:00:00Z",
            f"{y}-{m:02d}-{last:02d}T23:59:59Z",
            f"{_MONTH_NAMES_PL[m]} {y}",
        )
    if kind == "day":
        d = max(1, min(last, int(sel.get("day") or 1)))
        return (
            f"{y}-{m:02d}-{d:02d}T00:00:00Z",
            f"{y}-{m:02d}-{d:02d}T23:59:59Z",
            f"{d:02d}.{m:02d}.{y}",
        )
    w = max(1, min(5, int(sel.get("week") or 1)))
    start_day = 1 + (w - 1) * 7
    end_day = min(last, start_day + 6)
    if start_day > last:
        start_day = max(1, last - 6)
        end_day = last
    return (
        f"{y}-{m:02d}-{start_day:02d}T00:00:00Z",
        f"{y}-{m:02d}-{end_day:02d}T23:59:59Z",
        f"tydzień {w} · {_MONTH_NAMES_PL[m]} {y}",
    )


def _resolve_selected_or_hint(
    period_type: Optional[str],
    limit_days,
    period_hint: Optional[str],
    selected_periods: Optional[list],
) -> tuple[str, str, str]:
    """Jedno okno: suma zaznaczeń z drzewka (min..max) albo hint/period_type."""
    coerced = _coerce_selected_periods(selected_periods)
    if coerced:
        ranges = []
        labels = []
        for sel in coerced:
            s, u, lbl = _window_from_period_sel(sel)
            ranges.append((s, u))
            labels.append(lbl)
        if ranges:
            since = min(r[0] for r in ranges)
            until = max(r[1] for r in ranges)
            return since, until, " + ".join(labels)
    return _resolve_period_window(period_type, limit_days, period_hint)

__all__ = ['_coerce_selected_periods', '_default_finance_year', '_merge_period_sels', '_period_days', '_period_label', '_resolve_period_window', '_resolve_selected_or_hint', '_sels_from_hint', '_window_from_period_sel']
