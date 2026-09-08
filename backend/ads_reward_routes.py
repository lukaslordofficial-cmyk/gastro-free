"""
AdMob rewarded ads — grant +1 AI credit.

- POST /api/ads/claim-reward  (auth + X-Account-Key) — po obejrzeniu reklamy w apce
- GET  /api/ads/reward-ssv    (public) — Server-Side Verification callback z AdMob

Idempotencja przez tabelę stripe_webhook_events (prefix admob_*).
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get, sb_patch, sb_post

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ads-reward"])

ADMOB_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json"
_keys_cache: dict[str, Any] = {"at": 0.0, "keys": {}}


def _daily_limit() -> int:
    try:
        return max(0, int(os.getenv("AD_REWARD_DAILY_LIMIT", "5")))
    except ValueError:
        return 5


def _min_interval_sec() -> int:
    try:
        return max(30, int(os.getenv("AD_REWARD_MIN_INTERVAL_SEC", "90")))
    except ValueError:
        return 90


def _ak() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


class ClaimRewardBody(BaseModel):
    source: Optional[str] = "rewarded_ad"


async def _fetch_admob_keys(client: httpx.AsyncClient) -> dict[str, str]:
    now = time.time()
    if _keys_cache["keys"] and now - float(_keys_cache["at"]) < 3600:
        return _keys_cache["keys"]  # type: ignore[return-value]
    r = await client.get(ADMOB_KEYS_URL, timeout=20.0)
    r.raise_for_status()
    data = r.json() or {}
    out: dict[str, str] = {}
    for item in data.get("keys") or []:
        kid = str(item.get("keyId") or item.get("key_id") or "")
        pem = str(item.get("pem") or "")
        if kid and pem:
            out[kid] = pem
    _keys_cache["keys"] = out
    _keys_cache["at"] = now
    return out


def _verify_admob_signature(query_string: str, signature_b64: str, key_id: str, pem: str) -> bool:
    """ECDSA P-256 + SHA256 — zgodnie z dokumentacją AdMob SSV."""
    try:
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec, utils
        from cryptography.exceptions import InvalidSignature
    except ImportError as e:
        logger.error("Brak pakietu cryptography do weryfikacji SSV: %s", e)
        return False

    # Payload = query bez signature i key_id (kolejność oryginalna parametrów)
    pairs = parse_qsl(query_string, keep_blank_values=True)
    filtered = [(k, v) for (k, v) in pairs if k not in ("signature", "key_id")]
    payload = urlencode(filtered, doseq=True).encode("utf-8")

    raw_sig = base64.urlsafe_b64decode(signature_b64 + "==")
    pub = serialization.load_pem_public_key(pem.encode("utf-8"), backend=default_backend())
    if not isinstance(pub, ec.EllipticCurvePublicKey):
        return False
    try:
        # AdMob często podaje DER; czasem raw r||s
        try:
            pub.verify(raw_sig, payload, ec.ECDSA(hashes.SHA256()))
            return True
        except InvalidSignature:
            if len(raw_sig) == 64:
                r = int.from_bytes(raw_sig[:32], "big")
                s = int.from_bytes(raw_sig[32:], "big")
                der = utils.encode_dss_signature(r, s)
                pub.verify(der, payload, ec.ECDSA(hashes.SHA256()))
                return True
            raise
    except Exception as e:
        logger.warning("AdMob SSV signature invalid: %s", e)
        return False


async def _already(client: httpx.AsyncClient, event_id: str) -> bool:
    try:
        rows = await sb_get(
            client,
            "stripe_webhook_events",
            params={"select": "id", "id": f"eq.{event_id}", "limit": "1"},
        )
        return bool(rows)
    except Exception:
        return False


async def _mark(client: httpx.AsyncClient, event_id: str, event_type: str) -> None:
    try:
        await sb_post(
            client,
            "stripe_webhook_events",
            {
                "id": event_id[:200],
                "event_type": event_type[:120],
                "processed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception as e:
        logger.warning("ad reward idempotency mark failed: %s", e)


async def _count_today(client: httpx.AsyncClient, account_key: str) -> int:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"admob_claim_{account_key}_{day}"
    try:
        rows = await sb_get(
            client,
            "stripe_webhook_events",
            params={
                "select": "id",
                "id": f"like.{prefix}*",
                "limit": "100",
            },
        )
        return len(rows or [])
    except Exception:
        return 0


async def _last_claim_too_soon(client: httpx.AsyncClient, account_key: str) -> bool:
    prefix = f"admob_claim_{account_key}_"
    try:
        rows = await sb_get(
            client,
            "stripe_webhook_events",
            params={
                "select": "id,processed_at",
                "id": f"like.{prefix}*",
                "order": "processed_at.desc",
                "limit": "1",
            },
        )
        if not rows:
            return False
        ts = rows[0].get("processed_at") or ""
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds()
        return age < _min_interval_sec()
    except Exception:
        return False


async def _grant(client: httpx.AsyncClient, account_key: str) -> dict:
    from billing_stripe._p0 import _add_credits_safe

    return await _add_credits_safe(
        client, sb_get, sb_patch, sb_post, account_key, 1, extra=None,
    )


@router.post("/api/ads/claim-reward")
async def claim_reward(_body: ClaimRewardBody = ClaimRewardBody()):
    """Po EARNED_REWARD w aplikacji — +1 kredyt z limitem dziennym."""
    ak = _ak()
    limit = _daily_limit()
    if limit <= 0:
        raise HTTPException(status_code=503, detail="Nagrody za reklamy są wyłączone.")

    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        used = await _count_today(client, ak)
        if used >= limit:
            rows = await sb_get(
                client,
                "subscriptions",
                params={"select": "credits_balance", "account_key": f"eq.{ak}", "limit": "1"},
            )
            bal = int((rows[0].get("credits_balance") if rows else 0) or 0)
            raise HTTPException(
                status_code=429,
                detail=f"Dzienny limit reklam ({limit}) wyczerpany. Saldo: {bal}.",
            )
        if await _last_claim_too_soon(client, ak):
            raise HTTPException(
                status_code=429,
                detail="Poczekaj chwilę przed kolejną reklamą.",
            )

        day = datetime.now(timezone.utc).strftime("%Y%m%d")
        stamp = datetime.now(timezone.utc).strftime("%H%M%S%f")
        event_id = f"admob_claim_{ak}_{day}_{stamp}"
        if await _already(client, event_id):
            raise HTTPException(status_code=409, detail="Duplikat żądania.")

        sub = await _grant(client, ak)
        await _mark(client, event_id, "admob.reward.claim")
        bal = int(sub.get("credits_balance") or 0)
        return {
            "ok": True,
            "credits_balance": bal,
            "credits_added": 1,
            "message": f"Dodano +1 kredyt AI. Saldo: {bal}.",
            "daily_used": used + 1,
            "daily_limit": limit,
        }


@router.get("/api/ads/reward-ssv")
async def reward_ssv(request: Request):
    """
    Callback AdMob Server-Side Verification.
    W konsoli AdMob ustaw URL: https://<railway>/api/ads/reward-ssv
    custom_data / user_id = account_key.
    """
    qs = request.url.query
    params = dict(parse_qsl(qs, keep_blank_values=True))
    signature = (params.get("signature") or "").strip()
    key_id = (params.get("key_id") or "").strip()
    transaction_id = (params.get("transaction_id") or "").strip()
    custom_data = (params.get("custom_data") or "").strip()
    user_id = (params.get("user_id") or "").strip()
    account_key = custom_data or user_id

    if not signature or not key_id or not transaction_id:
        raise HTTPException(status_code=400, detail="Brak signature/key_id/transaction_id.")
    if not account_key or account_key == "default":
        raise HTTPException(status_code=400, detail="Brak account_key w custom_data/user_id.")

    event_id = f"admob_ssv_{transaction_id}"[:200]

    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        if await _already(client, event_id):
            return Response(content="OK", media_type="text/plain")

        try:
            keys = await _fetch_admob_keys(client)
        except Exception as e:
            logger.exception("AdMob keys fetch failed")
            raise HTTPException(status_code=502, detail=f"Nie pobrano kluczy AdMob: {e}") from e

        pem = keys.get(key_id)
        if not pem:
            raise HTTPException(status_code=400, detail="Nieznany key_id AdMob.")

        if not _verify_admob_signature(qs, signature, key_id, pem):
            raise HTTPException(status_code=403, detail="Nieprawidłowy podpis SSV.")

        limit = _daily_limit()
        used = await _count_today(client, account_key)
        # SSV też liczymy do limitu (osobny wpis claim-like)
        if limit > 0 and used >= limit:
            await _mark(client, event_id, "admob.reward.ssv_capped")
            return Response(content="OK", media_type="text/plain")

        await _grant(client, account_key)
        await _mark(client, event_id, "admob.reward.ssv")
        # Dodatkowo wpis „claim” żeby limit dzienny widział SSV
        day = datetime.now(timezone.utc).strftime("%Y%m%d")
        claim_id = f"admob_claim_{account_key}_{day}_ssv_{hashlib.sha1(transaction_id.encode()).hexdigest()[:12]}"
        await _mark(client, claim_id, "admob.reward.ssv_claim")

    return Response(content="OK", media_type="text/plain")
