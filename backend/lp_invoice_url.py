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
    attempts = [
        "/".join(quote(seg, safe="") for seg in path.split("/")),
        "/".join(quote(seg, safe="/") for seg in path.split("/")),
        path.lstrip("/"),
    ]
    own = client is None
    http = client or httpx.AsyncClient(timeout=30.0, verify=verify)
    last_msg = "Storage nie zwrócił signedURL"
    try:
        for enc_path in attempts:
            sign_url = f"{base}/storage/v1/object/sign/{quote(bucket, safe='')}/{enc_path}"
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
                last_msg = data.get("message") or data.get("error") or r.text[:200]
                continue
            signed = data.get("signedURL") or data.get("signedUrl") or data.get("url")
            if not signed:
                continue
            signed = str(signed)
            if signed.startswith("http"):
                return signed
            if not signed.startswith("/"):
                signed = "/" + signed
            if signed.startswith("/storage/v1"):
                return f"{base}{signed}"
            return f"{base}/storage/v1{signed}"
        raise RuntimeError(f"Storage sign failed: {last_msg}")
    finally:
        if own:
            await http.aclose()


async def upload_private_bytes(
    *,
    bucket: str,
    path: str,
    content: bytes,
    content_type: str,
    client: Optional[httpx.AsyncClient] = None,
    verify: Any = True,
) -> str:
    """PUT pliku do prywatnego bucketa. Zwraca ``bucket:path``."""
    base = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or "").strip()
    if not base or not key:
        raise RuntimeError("Brak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    enc_path = "/".join(quote(seg, safe="") for seg in path.strip("/").split("/"))
    url = f"{base}/storage/v1/object/{quote(bucket, safe='')}/{enc_path}"
    own = client is None
    http = client or httpx.AsyncClient(timeout=60.0, verify=verify)
    try:
        r = await http.post(
            url,
            headers={
                "Authorization": f"Bearer {key}",
                "apikey": key,
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            content=content,
        )
        if r.status_code >= 400:
            # Niektóre instancje Storage wolą PUT
            r = await http.put(
                url,
                headers={
                    "Authorization": f"Bearer {key}",
                    "apikey": key,
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
                content=content,
            )
        if r.status_code >= 400:
            msg = (r.text or "")[:200]
            raise RuntimeError(f"Storage upload failed: {msg}")
        return f"{bucket}:{path.strip('/')}"
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
