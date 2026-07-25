"""Agregacja historii kredytów (bez pełnego bootstrappingu FastAPI)."""
from datetime import datetime, timezone, timedelta


def _aggregate_credit_history(items: list[dict], *, window_sec: int = 150) -> list[dict]:
    # Lokalna kopia logiki z server.py — szybki test bez importu aplikacji.
    def _parse_usage_ts(iso):
        if not iso:
            return 0.0
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()

    if not items:
        return []

    by_req: dict[str, list[dict]] = {}
    orphans: list[dict] = []
    for it in items:
        ex = it.get("extras") if isinstance(it.get("extras"), dict) else {}
        rid = ex.get("request_id") if ex else None
        if rid:
            by_req.setdefault(str(rid), []).append(it)
        else:
            orphans.append(it)

    def _merge_group(group: list[dict]) -> dict:
        group = sorted(group, key=lambda x: _parse_usage_ts(x.get("created_at")), reverse=True)
        head = dict(group[0])
        head["credits"] = sum(int(g.get("credits") or 0) for g in group)
        head["cost_pln"] = round(sum(float(g.get("cost_pln") or 0) for g in group), 6)
        ex = dict(head.get("extras") or {}) if isinstance(head.get("extras"), dict) else {}
        ex["aggregated_calls"] = len(group)
        head["extras"] = ex
        return head

    merged = [_merge_group(g) for g in by_req.values()]
    orphans_sorted = sorted(orphans, key=lambda x: _parse_usage_ts(x.get("created_at")), reverse=True)
    i = 0
    while i < len(orphans_sorted):
        cluster = [orphans_sorted[i]]
        j = i + 1
        while j < len(orphans_sorted):
            prev = cluster[-1]
            cur = orphans_sorted[j]
            if (cur.get("endpoint") or "") != (prev.get("endpoint") or ""):
                break
            dt = abs(_parse_usage_ts(prev.get("created_at")) - _parse_usage_ts(cur.get("created_at")))
            if dt > window_sec:
                break
            cluster.append(cur)
            j += 1
        merged.append(_merge_group(cluster))
        i = j
    merged.sort(key=lambda x: _parse_usage_ts(x.get("created_at")), reverse=True)
    return merged


def test_aggregate_by_request_id():
    t0 = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
    rows = [
        {
            "id": f"r{i}",
            "endpoint": "/api/orders/compare-offers",
            "model": "gpt-4o-mini",
            "credits": 1,
            "cost_pln": 0.01,
            "created_at": (t0 + timedelta(seconds=i)).isoformat(),
            "extras": {"request_id": "abc", "credits_charged": 1},
        }
        for i in range(13)
    ]
    # newest first like API
    rows = list(reversed(rows))
    out = _aggregate_credit_history(rows)
    assert len(out) == 1
    assert out[0]["credits"] == 13
    assert out[0]["extras"]["aggregated_calls"] == 13


def test_aggregate_legacy_time_window():
    t0 = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
    rows = []
    for i in range(5):
        rows.append({
            "id": f"a{i}",
            "endpoint": "/api/orders/compare-offers",
            "model": "mini",
            "credits": 1,
            "cost_pln": 0.01,
            "created_at": (t0 + timedelta(seconds=i * 10)).isoformat(),
            "extras": {},
        })
    rows.append({
        "id": "scan",
        "endpoint": "/api/documents/process",
        "model": "vision",
        "credits": 8,
        "cost_pln": 0.2,
        "created_at": (t0 + timedelta(minutes=5)).isoformat(),
        "extras": {},
    })
    rows = sorted(rows, key=lambda r: r["created_at"], reverse=True)
    out = _aggregate_credit_history(rows)
    deal = next(x for x in out if x["endpoint"] == "/api/orders/compare-offers")
    scan = next(x for x in out if x["endpoint"] == "/api/documents/process")
    assert deal["credits"] == 5
    assert scan["credits"] == 8
    assert len(out) == 2
