"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `subscription_core`."""
from __future__ import annotations

from datetime import datetime
from fastapi import HTTPException
from http_ssl import httpx_verify as _httpx_verify
from supabase_rest import sb_get
from supabase_rest import sb_patch
from supabase_rest import sb_post
from typing import Optional
import httpx
from app_core import get_account_key, logger
from constants import FEATURE_CATALOG, STARTER_CREDITS, TIER_CONFIG, TOPUP_PACKAGES, TRIAL_DAYS



def _trial_active(sub: dict) -> bool:
    """True gdy trial_ends_at > now — Free dostaje features Premium (tier 2) przez 30 dni."""
    from datetime import datetime, timezone
    end = _parse_dt(sub.get("trial_ends_at"))
    if not end:
        return False
    return datetime.now(timezone.utc) < end


def _premium_entitled(sub: dict) -> bool:
    """Płatny Profesjonalny (tier>=2) LUB aktywny 30-dniowy trial Premium."""
    return int(sub.get("tier_level") or 0) >= 2 or _trial_active(sub)


def _trial_ends_iso_from_now() -> str:
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone.utc) + timedelta(days=TRIAL_DAYS)).isoformat()


def _parse_dt(val):
    from datetime import datetime, timezone
    if not val:
        return None
    s = str(val).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def _ensure_subscription(client: httpx.AsyncClient) -> dict:
    """Pobiera (lub tworzy) pojedynczy wiersz subskrypcji dla konta restauracji."""
    key = get_account_key()
    if not key or key == "default":
        # Nie twórz / nie czytaj shared demo wallet przy braku prawdziwego tenanta.
        return {
            "account_key": "default",
            "tier_level": 0,
            "credits_balance": 0,
            "status": "active",
            "current_period_end": None,
            "trial_ends_at": None,
            "free_starter_claimed": True,
        }
    rows = await sb_get(client, "subscriptions",
                        params={"select": "*", "account_key": f"eq.{key}", "limit": "1"})
    if rows:
        return rows[0]
    payload = {
        "account_key": key,
        "tier_level": 0,
        "credits_balance": STARTER_CREDITS,
        "status": "active",
        "current_period_end": None,
        "free_starter_claimed": True,
        # Free + 100 kr. + 30-dniowy trial Premium; po trial_ends_at → Free, kredyty zostają
        "trial_ends_at": _trial_ends_iso_from_now(),
    }
    created = await sb_post(client, "subscriptions", payload)
    if isinstance(created, list) and created:
        return created[0]
    return payload


def _apply_renewals(sub: dict):
    """Leniwe odnawianie: dolicza grant co 30 dni dla aktywnej subskrypcji tier>0.
    Dla anulowanej — po wygaśnięciu okresu degraduje do Free. Zwraca (sub, changes|None)."""
    from datetime import datetime, timezone, timedelta
    tier = int(sub.get("tier_level") or 0)
    status = sub.get("status") or "active"
    end = _parse_dt(sub.get("current_period_end"))
    if tier <= 0 or not end:
        return sub, None
    now = datetime.now(timezone.utc)
    if status == "canceled":
        if now >= end:
            changes = {"tier_level": 0, "current_period_end": None, "status": "expired"}
            return {**sub, **changes}, changes
        return sub, None
    grant = TIER_CONFIG.get(tier, {}).get("monthly_grant", 0)
    bal = int(sub.get("credits_balance") or 0)
    added = 0
    while now >= end and grant > 0:
        bal += grant
        added += grant
        end = end + timedelta(days=30)
    if added:
        changes = {"credits_balance": bal, "current_period_end": end.isoformat()}
        return {**sub, **changes}, changes
    return sub, None


async def _get_subscription(client: httpx.AsyncClient) -> dict:
    sub = await _ensure_subscription(client)
    sub2, changes = _apply_renewals(sub)
    if changes:
        try:
            await sb_patch(client, "subscriptions", {"account_key": f"eq.{get_account_key()}"}, changes)
        except Exception as e:  # noqa: BLE001
            logger.debug(f"renewal patch skipped: {e}")
    return sub2


async def _check_ai_access(client: httpx.AsyncClient, *, needs_credits: bool = True,
                           needs_deal_hunter: bool = False) -> dict:
    """Autoryzacja tieru przed operacją AI. Rzuca 403 gdy brak uprawnień/kredytów.

    Produkcja: brak tabeli subscriptions → 503 (fail-closed).
    Lokalnie / bez RAILWAY: fail-open tylko gdy migracja jeszcze nie wgrana.
    """
    from http_ssl import is_production_runtime

    try:
        sub = await _get_subscription(client)
    except httpx.HTTPStatusError as e:
        if is_production_runtime():
            logger.error("subscriptions niedostępne w produkcji: %s", e)
            raise HTTPException(
                status_code=503,
                detail="Subskrypcje niedostępne. Spróbuj ponownie za chwilę.",
            ) from e
        logger.warning("subscriptions niedostępne → autoryzacja pominięta (dev): %s", e)
        return {"tier_level": 2, "credits_balance": 10 ** 9, "status": "active"}
    # Łowca: płatny tier 2 LUB aktywny 30-dniowy trial Premium
    if needs_deal_hunter and not _premium_entitled(sub):
        raise HTTPException(
            status_code=403,
            detail="Moduł „Łowca Okazji” dostępny w planie Profesjonalnym (Tier 2) "
                   "lub podczas 30-dniowego trialu Premium. "
                   "Ulepsz subskrypcję w zakładce Subskrypcja.")
    bal = int(sub.get("credits_balance") or 0)
    if needs_credits and bal <= 0:
        raise HTTPException(
            status_code=403,
            detail=f"Brak kredytów AI (saldo: {bal}). Doładuj portfel w zakładce Subskrypcja, "
                   "aby korzystać z funkcji AI (operacje ręczne pozostają dostępne).")
    return sub


async def _guard_ai(*, needs_credits: bool = True, needs_deal_hunter: bool = False) -> dict:
    """Otwiera własnego klienta Supabase i weryfikuje dostęp (dla endpointów bez klienta)."""
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as c:
        return await _check_ai_access(c, needs_credits=needs_credits,
                                      needs_deal_hunter=needs_deal_hunter)


# Comprehensive report endpoint: backend/reports_routes.py (include_router)


# ─────────────────────────────────────────────────────────────────────────────
# Subskrypcje i Portfel Kredytowy — helpers (endpointy: subscription_routes.py)
# ─────────────────────────────────────────────────────────────────────────────

def _subscription_view(sub: dict, message: Optional[str] = None) -> dict:
    tier = int(sub.get("tier_level") or 0)
    cfg = TIER_CONFIG.get(tier, TIER_CONFIG[0])
    bal = int(sub.get("credits_balance") or 0)
    trial_active = _trial_active(sub)
    premium = _premium_entitled(sub)
    effective_tier = max(tier, 2) if premium else tier
    features = []
    for f in FEATURE_CATALOG:
        needs_dh = f["requires_deal_hunter"]
        reason = None
        if needs_dh and not premium:
            reason = "Wymaga planu Profesjonalny lub aktywnego trialu Premium (30 dni)"
        elif bal <= 0:
            reason = "Brak kredytów"
        features.append({**f, "locked": reason is not None, "locked_reason": reason})
    tier_label = cfg["name"]
    if trial_active and tier < 2:
        tier_label = f"{cfg['name']} · trial Premium"
    return {
        "tier_level": tier,
        "effective_tier_level": effective_tier,
        "tier_name": tier_label,
        "credits_balance": bal,
        "max_credits": cfg["max_credits"],
        "credits_pln": round(bal / 100.0, 2),
        "status": sub.get("status") or "active",
        "current_period_end": sub.get("current_period_end"),
        "trial_ends_at": sub.get("trial_ends_at"),
        "trial_active": trial_active,
        "deal_hunter_unlocked": premium,
        "premium_ui": premium or bal > 0,
        "features": features,
        "topup_packages": [{"key": k, **v} for k, v in TOPUP_PACKAGES.items()],
        "plans": [
            {"tier_level": t, "name": c["name"], "price_pln": c["price_pln"],
             "price_note": c.get("price_note"),
             "monthly_grant": c["monthly_grant"], "max_credits": c["max_credits"],
             "deal_hunter": c["deal_hunter"], "perks": c.get("perks", [])}
            for t, c in TIER_CONFIG.items()
        ],
        "message": message,
    }


def _parse_usage_ts(iso: Optional[str]) -> float:
    if not iso:
        return 0.0
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _aggregate_credit_history(items: list[dict], *, window_sec: int = 150) -> list[dict]:
    """
    Scala wiele mikropłatności (np. 13× −1 w Łowcy) w jedną akcję z pełną kwotą.
    1) grupuje po extras.request_id
    2) legacy: ten sam endpoint w oknie czasowym ~window_sec
    Wejście: najnowsze pierwsze.
    """
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
        head["id"] = head.get("id") or group[0].get("id")
        ex = dict(head.get("extras") or {}) if isinstance(head.get("extras"), dict) else {}
        ex["aggregated_calls"] = len(group)
        head["extras"] = ex
        return head

    merged: list[dict] = [_merge_group(g) for g in by_req.values()]

    # Legacy burst merge (newest-first walk)
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

__all__ = ['_aggregate_credit_history', '_apply_renewals', '_check_ai_access', '_ensure_subscription', '_get_subscription', '_guard_ai', '_parse_dt', '_parse_usage_ts', '_premium_entitled', '_subscription_view', '_trial_active', '_trial_ends_iso_from_now']
