"""
Podpisane URL-e do faktur w Storage (bucket producer-documents).
WWW zapisuje invoice_url jako ``bucket:path``, nie http — apka musi to rozwiązać.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional
from urllib.parse import quote

import httpx

logger = logging.getLogger("lp.invoice")

DEFAULT_DOCS_BUCKET = "producer-documents"


def parse_invoice_storage_ref(ref: Optional[str]) -> Optional[dict[str, str]]:
    raw = (ref or "").strip()
    if not raw:
        return None
    if raw.startswith("http://") or raw.startswith("https://"):
        return {"kind": "http", "url": raw}
    if ":" in raw:
        bucket, path = raw.split(":", 1)
        bucket = bucket.strip()
        path = path.strip().lstrip("/")
        if bucket and path:
            return {"kind": "storage", "bucket": bucket, "path": path}
    return {"kind": "storage", "bucket": DEFAULT_DOCS_BUCKET, "path": raw.lstrip("/")}


async def create_storage_signed_url(
    *,
    bucket: str,
    path: str,
    expires_in: int = 3600,
    client: Optional[httpx.AsyncClient] = None,
    verify: Any = True,
) -> str:
    base = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or "").strip()
    if not base or not key:
        raise RuntimeError("Brak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")

    # Storage sign API: POST /storage/v1/object/sign/{bucket}/{path}
    enc_path = "/".join(quote(seg, safe="") for seg in path.split("/"))
    sign_url = f"{base}/storage/v1/object/sign/{quote(bucket, safe='')}/{enc_path}"

    own = client is None
    http = client or httpx.AsyncClient(timeout=30.0, verify=verify)
    try:
        r = await http.post(
            sign_url,
            headers={
                "Authorization": f"Bearer {key}",
                "apikey": key,
                "Content-Type": "application/json",
            },
            json={"expiresIn": int(expires_in)},
        )
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            msg = data.get("message") or data.get("error") or r.text[:200]
            raise RuntimeError(f"Storage sign failed: {msg}")
        signed = data.get("signedURL") or data.get("signedUrl") or data.get("url")
        if not signed:
            raise RuntimeError("Storage nie zwrócił signedURL")
        signed = str(signed)
        if signed.startswith("http"):
            return signed
        if not signed.startswith("/"):
            signed = "/" + signed
        if signed.startswith("/storage/v1"):
            return f"{base}{signed}"
        return f"{base}/storage/v1{signed}"
    finally:
        if own:
            await http.aclose()


def order_invoice_raw(order: dict[str, Any]) -> str:
    return str(
        order.get("invoice_url")
        or order.get("settlement_invoice_url")
        or order.get("invoice_file_url")
        or ""
    ).strip()


async def resolve_order_invoice_url(
    order: dict[str, Any],
    *,
    client: Optional[httpx.AsyncClient] = None,
    verify: Any = True,
    expires_in: int = 3600,
) -> Optional[str]:
    raw = order_invoice_raw(order)
    if not raw:
        return None
    parsed = parse_invoice_storage_ref(raw)
    if not parsed:
        return None
    if parsed.get("kind") == "http":
        return parsed["url"]
    return await create_storage_signed_url(
        bucket=parsed["bucket"],
        path=parsed["path"],
        expires_in=expires_in,
        client=client,
        verify=verify,
    )
