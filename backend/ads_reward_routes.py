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

    # Google: treść do weryfikacji = query BEZ ostatnich parametrów signature i key_id
    # (kolejność oryginalna, bez re-encode — urlencode psuje podpis).
    qs = query_string or ""
    cut = qs.find("signature=")
    if cut > 0:
        payload = qs[: cut - 1].encode("utf-8")  # usuń trailing '&'
    else:
        pairs = parse_qsl(qs, keep_blank_values=True)
        filtered = [(k, v) for (k, v) in pairs if k not in ("signature", "key_id")]
        payload = urlencode(filtered, doseq=True).encode("utf-8")

    pad = "=" * ((4 - len(signature_b64) % 4) % 4)
    try:
        raw_sig = base64.urlsafe_b64decode(signature_b64 + pad)
    except Exception:
        try:
            raw_sig = base64.b64decode(signature_b64 + pad)
        except Exception as e:
            logger.warning("AdMob SSV signature b64 decode failed: %s", e)
            return False

    pub = serialization.load_pem_public_key(pem.encode("utf-8"), backend=default_backend())
    if not isinstance(pub, ec.EllipticCurvePublicKey):
        return False
    try:
        # AdMob: ECDSA DER; czasem raw r||s (64 B)
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


def _is_console_test_ping(params: dict[str, str], account_key: str) -> bool:
    """Ping z panelu AdMob (Verify) — często bez user_id/custom_data albo z testowym tx."""
    tx = (params.get("transaction_id") or "").strip().lower()
    if not tx or tx in {"test", "0", "dummy"} or tx.startswith("test"):
        return True
    if not account_key or account_key.lower() in {"default", "test", "null", "undefined"}:
        return True
    # Brak typowych pól nagrody z prawdziwego callbacka
    if not (params.get("ad_unit") or params.get("reward_amount") or params.get("reward_item")):
        if not (params.get("user_id") or params.get("custom_data")):
            return True
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

    Ping walidacyjny z panelu AdMob (Verify) musi dostać HTTP 200 OK —
    często bez user_id/custom_data; wtedy nie przyznajemy kredytów.
    """
    qs = request.url.query or ""
    params = dict(parse_qsl(qs, keep_blank_values=True))
    signature = (params.get("signature") or "").strip()
    key_id = (params.get("key_id") or "").strip()
    transaction_id = (params.get("transaction_id") or "").strip()
    custom_data = (params.get("custom_data") or "").strip()
    user_id = (params.get("user_id") or "").strip()
    account_key = custom_data or user_id

    # Pusty GET / health / wstępny ping konsoli
    if not qs.strip():
        logger.info("AdMob SSV empty ping — OK")
        return Response(content="OK", media_type="text/plain")

    # Konsola czasem wysyła niekompletny request — nie wolno zwracać 400
    if not signature or not key_id:
        logger.info(
            "AdMob SSV incomplete ping (sig=%s key=%s) — OK",
            bool(signature),
            bool(key_id),
        )
        return Response(content="OK", media_type="text/plain")

    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        try:
            keys = await _fetch_admob_keys(client)
        except Exception as e:
            logger.exception("AdMob keys fetch failed")
            # Konsola Verify i tak oczekuje 200 przy samym „czy endpoint żyje”;
            # przy prawdziwym callbacku i tak nie przyznamy bez kluczy.
            if _is_console_test_ping(params, account_key):
                return Response(content="OK", media_type="text/plain")
            raise HTTPException(status_code=502, detail=f"Nie pobrano kluczy AdMob: {e}") from e

        pem = keys.get(key_id) or keys.get(str(key_id))
        if not pem:
            # key_id bywa int w JSON, a w query stringiem
            for k, v in keys.items():
                if str(k) == str(key_id):
                    pem = v
                    break
        if not pem:
            logger.warning("AdMob SSV unknown key_id=%s — OK for ping", key_id)
            if _is_console_test_ping(params, account_key) or not transaction_id:
                return Response(content="OK", media_type="text/plain")
            raise HTTPException(status_code=400, detail="Nieznany key_id AdMob.")

        if not _verify_admob_signature(qs, signature, key_id, pem):
            # Test tool AdMob bywa kapryśny względem encodingu — nie blokuj Verify 403/400
            if _is_console_test_ping(params, account_key):
                logger.warning("AdMob SSV test ping signature mismatch — returning OK")
                return Response(content="OK", media_type="text/plain")
            raise HTTPException(status_code=403, detail="Nieprawidłowy podpis SSV.")

        # Zweryfikowany callback bez konta / testowy — potwierdź odbiór, bez grantu
        if _is_console_test_ping(params, account_key) or not transaction_id:
            logger.info(
                "AdMob SSV test/verified ping (tx=%s ak=%s) — no grant",
                transaction_id or "-",
                account_key or "-",
            )
            return Response(content="OK", media_type="text/plain")

        event_id = f"admob_ssv_{transaction_id}"[:200]
        if await _already(client, event_id):
            return Response(content="OK", media_type="text/plain")

        limit = _daily_limit()
        used = await _count_today(client, account_key)
        if limit > 0 and used >= limit:
            await _mark(client, event_id, "admob.reward.ssv_capped")
            return Response(content="OK", media_type="text/plain")

        await _grant(client, account_key)
        await _mark(client, event_id, "admob.reward.ssv")
        day = datetime.now(timezone.utc).strftime("%Y%m%d")
        claim_id = (
            f"admob_claim_{account_key}_{day}_ssv_"
            f"{hashlib.sha1(transaction_id.encode()).hexdigest()[:12]}"
        )
        await _mark(client, claim_id, "admob.reward.ssv_claim")

    return Response(content="OK", media_type="text/plain")
