"""
GET/PUT /api/restaurant/profile — wydzielone z server.py.
Wymaga tenant account key (nie „default”).
"""
from __future__ import annotations

from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from http_ssl import httpx_verify
from restaurant_profile import get_restaurant_profile, set_restaurant_profile

router = APIRouter(tags=["restaurant-profile"])


def _require_tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


class ProfilePayload(BaseModel):
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    company_name: Optional[str] = None
    delivery_address: Optional[str] = None
    bank_account: Optional[str] = None
    nip: Optional[str] = None
    regon: Optional[str] = None


@router.get("/api/restaurant/profile")
async def get_profile_endpoint():
    _require_tenant()
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        p = await get_restaurant_profile(client)
    complete = bool(
        (p.get("contact_email") or "").strip() and (p.get("contact_phone") or "").strip()
    )
    return {**p, "complete": complete}


@router.put("/api/restaurant/profile")
async def put_profile_endpoint(payload: ProfilePayload):
    _require_tenant()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Brak pól do zapisania.")
    email = (updates.get("contact_email") or "").strip() if "contact_email" in updates else None
    if email is not None and email and ("@" not in email or "." not in email):
        raise HTTPException(status_code=400, detail="Podaj poprawny adres e-mail.")
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        merged = await set_restaurant_profile(client, updates)
    complete = bool(
        (merged.get("contact_email") or "").strip()
        and (merged.get("contact_phone") or "").strip()
    )
    return {"ok": True, **merged, "complete": complete}
