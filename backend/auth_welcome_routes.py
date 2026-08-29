"""
Welcome + verification e-mail po rejestracji (Resend → kontakt@gastromanager.org).
"""
from __future__ import annotations

import html as html_lib
import logging
import os
import re
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from health_routes import auto_confirm_denied_reason, normalize_email
from http_ssl import httpx_verify
from notify_resend import is_resend_configured, send_email
from rate_limit import allow_auto_confirm
from supabase_rest import require_supabase
from url_safety import (
    build_supabase_auth_admin_url,
    build_supabase_auth_generate_link_url,
)

logger = logging.getLogger("auth.welcome")

router = APIRouter(tags=["auth-welcome"])

_WELCOME_FROM_DEFAULT = "kontakt@gastromanager.org"
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class WelcomeEmailBody(BaseModel):
    user_id: str = Field(..., min_length=8, max_length=80)
    email: str = Field(..., min_length=3, max_length=254)
    restaurant_name: Optional[str] = Field(default=None, max_length=120)
    redirect_to: Optional[str] = Field(default=None, max_length=500)


def _welcome_from() -> str:
    raw = (os.environ.get("WELCOME_FROM_EMAIL") or _WELCOME_FROM_DEFAULT).strip()
    if not raw or "@" not in raw:
        return _WELCOME_FROM_DEFAULT
    host = raw.rsplit("@", 1)[-1].lower()
    blocked = ("gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com")
    if host in blocked or raw.lower() == "onboarding@resend.dev":
        return _WELCOME_FROM_DEFAULT
    return raw


def _supabase_creds() -> tuple[str, str]:
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        or os.environ.get("SUPABASE_ANON_KEY", "").strip()
    )
    return url, key


def _safe_redirect(raw: str | None) -> str | None:
    s = (raw or "").strip()
    if not s or len(s) > 500:
        return None
    low = s.lower()
    if low.startswith(("gastromanager://", "exp://", "exps://", "https://")):
        return s
    return None


def _extract_action_link(payload: dict[str, Any]) -> str | None:
    props = payload.get("properties") if isinstance(payload.get("properties"), dict) else {}
    for key in ("action_link", "actionLink"):
        link = (props.get(key) or payload.get(key) or "").strip()
        if link.startswith("http"):
            return link
    return None


async def _generate_verify_link(
    client: httpx.AsyncClient,
    *,
    supabase_url: str,
    supabase_key: str,
    email: str,
    redirect_to: str | None,
) -> str | None:
    url = build_supabase_auth_generate_link_url(supabase_url)
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }
    bodies: list[dict[str, Any]] = [
        {"type": "magiclink", "email": email},
        {"type": "signup", "email": email},
    ]
    if redirect_to:
        for b in bodies:
            b["options"] = {"redirect_to": redirect_to}

    for body in bodies:
        try:
            r = await client.post(url, headers=headers, json=body)
        except Exception as e:  # noqa: BLE001
            logger.warning("generate_link request failed: %s", e)
            continue
        if r.status_code >= 400:
            logger.info("generate_link type=%s status=%s", body.get("type"), r.status_code)
            continue
        try:
            data = r.json() or {}
        except Exception:  # noqa: BLE001
            continue
        if isinstance(data, dict):
            link = _extract_action_link(data)
            if link:
                return link
    return None


def build_welcome_email_html(
    *,
    restaurant_name: str | None,
    verify_link: str | None,
) -> tuple[str, str]:
    name = (restaurant_name or "").strip() or "w Gastro Manager"
    if name and name != "w Gastro Manager":
        greeting = f"Witaj w gronie użytkowników Gastro Manager — {html_lib.escape(name)}!"
    else:
        greeting = "Witaj w gronie użytkowników Gastro Manager!"

    if verify_link:
        btn = (
            f'<p style="margin:28px 0 12px">'
            f'<a href="{html_lib.escape(verify_link)}" '
            f'style="display:inline-block;background:#00FF78;color:#0A0A0A;'
            f'font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">'
            f"Potwierdź e-mail i otwórz aplikację</a></p>"
            f'<p style="font-size:12px;color:#5a6b62;word-break:break-all">'
            f"Jeśli przycisk nie działa, wklej link:<br/>{html_lib.escape(verify_link)}</p>"
        )
        text_link = f"\n\nPotwierdź e-mail:\n{verify_link}\n"
    else:
        btn = (
            "<p style=\"margin:20px 0;color:#3d5248\">"
            "Zaloguj się w aplikacji Gastro Manager tym samym adresem e-mail i hasłem.</p>"
        )
        text_link = "\n\nZaloguj się w aplikacji Gastro Manager.\n"

    html = f"""<!DOCTYPE html>
<html lang="pl"><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#122018;line-height:1.5;padding:24px">
  <h1 style="font-size:22px;margin:0 0 12px;color:#0A120E">{greeting}</h1>
  <p>Dziękujemy, że dołączyłeś/aś do Gastro Manager — narzędzia stworzonego dla restauracji, które chcą mieć magazyn, menu, finanse i dostawy w jednym miejscu.</p>
  <p>Na start masz dostęp do kredytu AI i okresu próbnego Premium. Wystarczy potwierdzić adres e-mail i zalogować się w aplikacji.</p>
  {btn}
  <p style="margin-top:28px;font-size:13px;color:#5a6b62">Pozdrawiamy,<br/>Zespół Gastro Manager<br/>kontakt@gastromanager.org</p>
</body></html>"""

    text = (
        f"{greeting}\n\n"
        "Dziękujemy, że dołączyłeś/aś do Gastro Manager.\n"
        "Na start masz dostęp do kredytu AI i okresu próbnego Premium."
        f"{text_link}\n"
        "Pozdrawiamy,\nZespół Gastro Manager\nkontakt@gastromanager.org\n"
    )
    return html, text


@router.post("/api/auth/welcome-email")
async def auth_welcome_email(body: WelcomeEmailBody, request: Request):
    """
    Po rejestracji: powitanie + link weryfikacyjny (Resend).
    Wymaga świeżego user_id + zgodnego e-maila (jak auto-confirm).
    """
    if not is_resend_configured():
        raise HTTPException(status_code=503, detail="Wysyłka e-mail nie jest skonfigurowana (RESEND_API_KEY).")

    ip = request.client.host if request.client else "0"
    if not allow_auto_confirm(ip):
        raise HTTPException(status_code=429, detail="Zbyt wiele prób. Spróbuj za chwilę.")

    email = normalize_email(body.email)
    if not email or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Nieprawidłowy e-mail.")

    require_supabase()
    supabase_url, supabase_key = _supabase_creds()
    uid = (body.user_id or "").strip()
    generic_fail = HTTPException(status_code=400, detail="Nie można wysłać wiadomości powitalnej.")
    redirect_to = _safe_redirect(body.redirect_to)

    try:
        user_url = build_supabase_auth_admin_url(supabase_url, uid)
    except HTTPException:
        raise generic_fail

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=25.0, verify=httpx_verify()) as client:
        lookup = await client.get(user_url, headers=headers)
        if lookup.status_code >= 400:
            logger.info("welcome lookup failed status=%s", lookup.status_code)
            raise generic_fail
        try:
            user = lookup.json() or {}
        except Exception:  # noqa: BLE001
            raise generic_fail
        if not isinstance(user, dict) or auto_confirm_denied_reason(user, email):
            raise generic_fail

        verify_link = await _generate_verify_link(
            client,
            supabase_url=supabase_url,
            supabase_key=supabase_key,
            email=email,
            redirect_to=redirect_to,
        )

    html, text = build_welcome_email_html(
        restaurant_name=body.restaurant_name,
        verify_link=verify_link,
    )
    result = await send_email(
        to=email,
        subject="Witamy w Gastro Manager — potwierdź e-mail",
        html=html,
        text=text,
        from_email=_welcome_from(),
        from_name="Gastro Manager",
    )
    if not result.get("ok"):
        logger.warning("welcome email failed: %s", result.get("error"))
        raise HTTPException(
            status_code=502,
            detail="Nie udało się wysłać e-maila powitalnego. Spróbuj ponownie za chwilę.",
        )

    return {
        "ok": True,
        "email": email,
        "verify_link_included": bool(verify_link),
        "id": result.get("id"),
    }
