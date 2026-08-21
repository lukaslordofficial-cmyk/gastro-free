"""
Profil restauracji (dane lokalu) — wydzielone z server.py (dekalog §I).

Źródła (kolejność odczytu): restaurant_profile → dysk → profiles
(lokal_profile_json / restaurant_name / shipping_*).
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from supabase_rest import sb_get, sb_patch, sb_post

logger = logging.getLogger("restaurant_profile")

PROFILE_KEYS = (
    "contact_email",
    "contact_phone",
    "company_name",
    "delivery_address",
    "bank_account",
    "nip",
    "regon",
)

_BACKEND_DIR = Path(__file__).resolve().parent


def _get_account_key() -> str:
    from server import get_account_key

    return get_account_key()


def empty_restaurant_profile() -> dict[str, str]:
    return {k: "" for k in PROFILE_KEYS}


def normalize_restaurant_profile(raw: dict | None) -> dict[str, str]:
    out = empty_restaurant_profile()
    if not raw:
        return out
    for k in PROFILE_KEYS:
        out[k] = str(raw.get(k) or "").strip()
    return out


def _profile_disk_path() -> Path:
    from server import _ACCOUNT_KEY_DEFAULT, _account_key_ctx

    ak = (_account_key_ctx.get() or _ACCOUNT_KEY_DEFAULT).strip() or "default"
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", ak)[:80]
    return _BACKEND_DIR / f".restaurant_profile_{safe}.json"


def _read_profile_disk() -> dict[str, str]:
    try:
        path = _profile_disk_path()
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            return normalize_restaurant_profile(data if isinstance(data, dict) else {})
    except Exception:  # noqa: BLE001
        pass
    return empty_restaurant_profile()


def _write_profile_disk(profile: dict) -> None:
    try:
        _profile_disk_path().write_text(
            json.dumps(normalize_restaurant_profile(profile), ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("Nie udało się zapisać profilu na dysku: %s", e)


def delivery_from_shipping_row(row: dict) -> str:
    street = str(row.get("shipping_street") or "").strip()
    building = str(row.get("shipping_building") or "").strip()
    city = str(row.get("shipping_city") or "").strip()
    post = str(row.get("shipping_post_code") or "").strip()
    if city or post or building:
        line1 = " ".join(x for x in (street, building) if x).strip()
        line2 = " ".join(x for x in (post, city) if x).strip()
        return ", ".join(x for x in (line1, line2) if x)
    return street


async def auth_profiles_row(client: httpx.AsyncClient) -> dict:
    selects = (
        "id,email,restaurant_name,shipping_phone,shipping_street,"
        "shipping_building,shipping_city,shipping_post_code,"
        "shipping_nip,shipping_regon,lokal_profile_json",
        "id,email,restaurant_name,shipping_phone,shipping_street,"
        "shipping_building,shipping_city,shipping_post_code,"
        "shipping_nip,shipping_regon",
        "id,email,restaurant_name,shipping_phone,shipping_street,"
        "shipping_building,shipping_city,shipping_post_code",
        "id,email,restaurant_name",
    )
    ak = _get_account_key()
    for select in selects:
        try:
            rows = await sb_get(
                client,
                "profiles",
                params={"select": select, "account_key": f"eq.{ak}", "limit": "1"},
            ) or []
            if rows and isinstance(rows[0], dict):
                return rows[0]
        except Exception:  # noqa: BLE001
            continue
    return {}


def _merge_lokal_json(row: dict, profile: dict) -> dict:
    raw = row.get("lokal_profile_json")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:  # noqa: BLE001
            raw = None
    if not isinstance(raw, dict):
        return profile
    out = dict(profile)
    for k in PROFILE_KEYS:
        val = str(raw.get(k) or "").strip()
        if val:
            out[k] = val
    return out


async def enrich_from_auth_profiles(client: httpx.AsyncClient, profile: dict) -> dict:
    out = dict(profile)
    row = await auth_profiles_row(client)
    if not row:
        return out
    out = _merge_lokal_json(row, out)
    if not (out.get("company_name") or "").strip():
        out["company_name"] = str(row.get("restaurant_name") or "").strip()
    if not (out.get("delivery_address") or "").strip():
        out["delivery_address"] = delivery_from_shipping_row(row)
    if not (out.get("contact_phone") or "").strip():
        out["contact_phone"] = str(row.get("shipping_phone") or "").strip()
    if not (out.get("nip") or "").strip():
        out["nip"] = str(row.get("shipping_nip") or "").strip()
    if not (out.get("regon") or "").strip():
        out["regon"] = str(row.get("shipping_regon") or "").strip()
    if not (out.get("contact_email") or "").strip():
        out["contact_email"] = str(row.get("email") or "").strip()
    return out


async def get_restaurant_profile(client: httpx.AsyncClient) -> dict:
    select_full = ",".join(PROFILE_KEYS)
    base = empty_restaurant_profile()
    disk = _read_profile_disk()
    try:
        try:
            rows = await sb_get(
                client,
                "restaurant_profile",
                params={"select": select_full, "limit": "1"},
            )
        except httpx.HTTPError:
            rows = await sb_get(
                client,
                "restaurant_profile",
                params={"select": "contact_email,contact_phone", "limit": "1"},
            )
        if rows:
            base = normalize_restaurant_profile(rows[0])
        for k in PROFILE_KEYS:
            if not (base.get(k) or "").strip() and (disk.get(k) or "").strip():
                base[k] = disk[k]
    except httpx.HTTPError:
        base = normalize_restaurant_profile(disk)
    return await enrich_from_auth_profiles(client, base)


async def _patch_profiles(client: httpx.AsyncClient, row: dict, patch: dict) -> bool:
    if not patch:
        return False
    filters: list[dict[str, str]] = []
    pid = row.get("id")
    if pid:
        filters.append({"id": f"eq.{pid}"})
    filters.append({"account_key": f"eq.{_get_account_key()}"})
    for params in filters:
        try:
            await sb_patch(client, "profiles", params, patch)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("profiles patch %s failed: %s", list(patch.keys()), exc)
    return False


async def sync_to_auth_profiles(client: httpx.AsyncClient, merged: dict) -> None:
    row = await auth_profiles_row(client)
    company = (merged.get("company_name") or "").strip()
    delivery = (merged.get("delivery_address") or "").strip()
    phone = (merged.get("contact_phone") or "").strip()
    nip = (merged.get("nip") or "").strip()
    regon = (merged.get("regon") or "").strip()

    core: dict[str, Any] = {
        "restaurant_name": company,
        "shipping_street": delivery,
        "shipping_phone": phone,
    }
    if delivery:
        core["shipping_building"] = ""
        core["shipping_city"] = ""
        core["shipping_post_code"] = ""
    ok = await _patch_profiles(client, row, core)
    if not ok:
        if company:
            await _patch_profiles(client, row, {"restaurant_name": company})
        if delivery:
            await _patch_profiles(client, row, {"shipping_street": delivery})
        if phone:
            await _patch_profiles(client, row, {"shipping_phone": phone})

    lokal = {k: (merged.get(k) or "") for k in PROFILE_KEYS}
    await _patch_profiles(client, row, {"lokal_profile_json": lokal})

    extra: dict[str, str] = {}
    if nip:
        extra["shipping_nip"] = nip
    if regon:
        extra["shipping_regon"] = regon
    if extra:
        await _patch_profiles(client, row, extra)


async def write_restaurant_profile_table(client: httpx.AsyncClient, merged: dict) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    payload_full = {**{k: merged[k] for k in PROFILE_KEYS}, "updated_at": ts}
    payload_min = {
        "contact_email": merged["contact_email"],
        "contact_phone": merged["contact_phone"],
        "updated_at": ts,
    }
    payload_mid = {
        **payload_min,
        "company_name": merged["company_name"],
        "delivery_address": merged["delivery_address"],
    }
    try:
        rows = await sb_get(client, "restaurant_profile", params={"select": "id", "limit": "1"})
    except httpx.HTTPError as exc:
        logger.warning("restaurant_profile list failed: %s", exc)
        return
    for payload in (payload_full, payload_mid, payload_min):
        try:
            if rows:
                await sb_patch(
                    client, "restaurant_profile", {"id": f"eq.{rows[0]['id']}"}, payload
                )
            else:
                await sb_post(client, "restaurant_profile", payload)
                rows = await sb_get(
                    client, "restaurant_profile", params={"select": "id", "limit": "1"}
                ) or rows
            return
        except httpx.HTTPError as exc:
            logger.warning("restaurant_profile write tier failed (%s): %s", list(payload), exc)


async def set_restaurant_profile(client: httpx.AsyncClient, updates: dict) -> dict:
    current = await get_restaurant_profile(client)
    merged = {**current}
    for k in PROFILE_KEYS:
        if k in updates and updates[k] is not None:
            merged[k] = str(updates[k]).strip()
    _write_profile_disk(merged)
    await sync_to_auth_profiles(client, merged)
    await write_restaurant_profile_table(client, merged)
    return await get_restaurant_profile(client)


async def account_login_email(client: httpx.AsyncClient) -> str:
    row = await auth_profiles_row(client)
    return str(row.get("email") or "").strip()


def order_footer(profile: dict, *, fallback_email: str = "") -> str:
    email = (profile.get("contact_email") or "").strip() or (fallback_email or "").strip() or "(brak)"
    phone = (profile.get("contact_phone") or "").strip() or "(brak)"
    return (
        "--- Wiadomość wygenerowana automatycznie przez asystenta AI Gastro-Manager. "
        "Prosimy NIE ODPOWIADAĆ na tego maila. Kontakt z restauracją wyłącznie pod adresem: "
        f"{email} lub numerem telefonu: {phone}. ---"
    )
