"""
Welcome + verification e-mail po rejestracji (Resend → asystent.dostaw@gastromanager.org).
Dodatkowo: zapis adresu dostawy do profiles + force-unconfirm gdy Confirm email=OFF w Supabase.
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
from supabase_rest import require_supabase, sb_patch
from url_safety import (
    build_supabase_auth_admin_url,
    build_supabase_auth_generate_link_url,
)

logger = logging.getLogger("auth.welcome")

router = APIRouter(tags=["auth-welcome"])

# Resend nie przyjmuje From z Gmail/Outlook — używamy domeny gastromanager.org.
_WELCOME_FROM_DEFAULT = "asystent.dostaw@gastromanager.org"
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DEFAULT_VERIFY_REDIRECT = "https://gastromanager.org/auth/verified"


class ShippingBody(BaseModel):
    phone: Optional[str] = Field(default=None, max_length=40)
    street: Optional[str] = Field(default=None, max_length=200)
    building: Optional[str] = Field(default=None, max_length=40)
    city: Optional[str] = Field(default=None, max_length=120)
    post_code: Optional[str] = Field(default=None, max_length=20)
    nip: Optional[str] = Field(default=None, max_length=20)
    regon: Optional[str] = Field(default=None, max_length=20)
    contact_email: Optional[str] = Field(default=None, max_length=254)


class WelcomeEmailBody(BaseModel):
    user_id: str = Field(..., min_length=8, max_length=80)
    email: str = Field(..., min_length=3, max_length=254)
    restaurant_name: Optional[str] = Field(default=None, max_length=120)
    redirect_to: Optional[str] = Field(default=None, max_length=500)
    shipping: Optional[ShippingBody] = None
    # Gdy true — jeśli konto ma już email_confirmed_at (Confirm email OFF), wyczyść to.
    force_unconfirm: bool = True


def _welcome_from() -> str:
    raw = (os.environ.get("WELCOME_FROM_EMAIL") or os.environ.get("RESEND_FROM_EMAIL") or _WELCOME_FROM_DEFAULT).strip()
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
        # Blokuj localhost w redirectach z maila
        if "localhost" in low or "127.0.0.1" in low:
            return None
        return s
    return None


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def _compose_delivery_address(ship: ShippingBody | None) -> str:
    if not ship:
        return ""
    street = (ship.street or "").strip()
    building = (ship.building or "").strip()
    city = (ship.city or "").strip()
    post = (ship.post_code or "").strip()
    line1 = " ".join(x for x in (street, building) if x)
    line2 = " ".join(x for x in (post, city) if x)
    return ", ".join(x for x in (line1, line2) if x)


def _extract_action_link(payload: dict[str, Any]) -> str | None:
    props = payload.get("properties") if isinstance(payload.get("properties"), dict) else {}
    for key in ("action_link", "actionLink"):
        link = (props.get(key) or payload.get(key) or "").strip()
        if link.startswith("http"):
            return link
    return None


async def _force_unconfirm_if_needed(
    client: httpx.AsyncClient,
    *,
    user_url: str,
    headers: dict[str, str],
    user: dict[str, Any],
) -> bool:
    """Gdy Confirm email=OFF, Supabase ustawia email_confirmed_at od razu — czyścimy to Admin API."""
    confirmed = user.get("email_confirmed_at") or user.get("confirmed_at")
    if not confirmed:
        return False
    payloads = (
        {"email_confirm": False},
        {"email_confirmed_at": None},
    )
    for body in payloads:
        try:
            r = await client.put(user_url, headers=headers, json=body)
            if r.status_code < 400:
                return True
            r2 = await client.patch(user_url, headers=headers, json=body)
            if r2.status_code < 400:
                return True
        except Exception as e:  # noqa: BLE001
            logger.warning("force_unconfirm failed: %s", e)
    logger.info("force_unconfirm: nie udało się wyczyścić email_confirmed_at")
    return False


async def _persist_shipping_profile(
    client: httpx.AsyncClient,
    *,
    user_id: str,
    email: str,
    restaurant_name: str | None,
    shipping: ShippingBody | None,
) -> None:
    name = (restaurant_name or "").strip()
    ship = shipping or ShippingBody()
    delivery = _compose_delivery_address(ship)
    phone = (ship.phone or "").strip()
    contact_email = (ship.contact_email or email or "").strip()
    nip = _digits(ship.nip) or None
    regon = _digits(ship.regon) or None

    payload: dict[str, Any] = {
        "restaurant_name": name or None,
        "shipping_phone": phone or None,
        "shipping_street": (ship.street or "").strip() or None,
        "shipping_building": (ship.building or "").strip() or None,
        "shipping_city": (ship.city or "").strip() or None,
        "shipping_post_code": (ship.post_code or "").strip() or None,
        "shipping_nip": nip,
        "shipping_regon": regon,
        "lokal_profile_json": {
            "contact_email": contact_email,
            "contact_phone": phone,
            "company_name": name,
            "delivery_address": delivery,
            "bank_account": "",
            "nip": nip or "",
            "regon": regon or "",
        },
    }
    # Usuń None z top-level poza lokal_profile_json — PostgREST OK z nullami, ale mniejszy payload.
    try:
        await sb_patch(client, "profiles", {"id": f"eq.{user_id}"}, payload)
    except Exception as e:  # noqa: BLE001
        logger.warning("persist shipping profile failed: %s", e)
        # Fallback bez kolumn podatkowych / json
        slim = {
            "restaurant_name": name or None,
            "shipping_phone": phone or None,
            "shipping_street": (ship.street or "").strip() or None,
            "shipping_building": (ship.building or "").strip() or None,
            "shipping_city": (ship.city or "").strip() or None,
            "shipping_post_code": (ship.post_code or "").strip() or None,
        }
        try:
            await sb_patch(client, "profiles", {"id": f"eq.{user_id}"}, slim)
        except Exception as e2:  # noqa: BLE001
            logger.warning("persist shipping slim failed: %s", e2)


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
    # signup najpierw — potwierdza e-mail; magiclink tylko jako fallback.
    redirect = redirect_to or _DEFAULT_VERIFY_REDIRECT
    bodies: list[dict[str, Any]] = [
        {"type": "signup", "email": email},
        {"type": "magiclink", "email": email},
    ]
    for b in bodies:
        b["options"] = {"redirect_to": redirect}

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
            f"Potwierdź e-mail</a></p>"
            f'<p style="font-size:12px;color:#5a6b62;word-break:break-all">'
            f"Jeśli przycisk nie działa, wklej link:<br/>{html_lib.escape(verify_link)}</p>"
        )
        text_link = f"\n\nPotwierdź e-mail:\n{verify_link}\n"
    else:
        btn = (
            "<p style=\"margin:20px 0;color:#3d5248\">"
            "Sprawdź skrzynkę — wyślemy osobny link potwierdzający, gdy będzie dostępny.</p>"
        )
        text_link = "\n\nPotwierdź e-mail linkiem z wiadomości, potem zaloguj się w aplikacji.\n"

    html = f"""<!DOCTYPE html>
<html lang="pl"><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#122018;line-height:1.5;padding:24px">
  <h1 style="font-size:22px;margin:0 0 12px;color:#0A120E">{greeting}</h1>
  <p>Dziękujemy, że dołączyłeś/aś do Gastro Manager — narzędzia stworzonego dla restauracji, które chcą mieć magazyn, menu, finanse i dostawy w jednym miejscu.</p>
  <p><strong>Kliknij poniższy link, aby potwierdzić e-mail.</strong> Dopiero potem będzie można zalogować się w aplikacji.</p>
  {btn}
  <p style="margin-top:28px;font-size:13px;color:#5a6b62">Pozdrawiamy,<br/>Zespół Gastro Manager<br/>asystent.dostaw@gastromanager.org</p>
</body></html>"""

    text = (
        f"{greeting}\n\n"
        "Dziękujemy, że dołączyłeś/aś do Gastro Manager.\n"
        "Kliknij link, aby potwierdzić e-mail — dopiero potem możesz się zalogować."
        f"{text_link}\n"
        "Pozdrawiamy,\nZespół Gastro Manager\nasystent.dostaw@gastromanager.org\n"
    )
    return html, text


@router.post("/api/auth/welcome-email")
async def auth_welcome_email(body: WelcomeEmailBody, request: Request):
    """
    Po rejestracji: (opcjonalnie) force-unconfirm + zapis shipping → profiles + mail z linkiem.
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
    redirect_to = _safe_redirect(body.redirect_to) or _DEFAULT_VERIFY_REDIRECT

    try:
        user_url = build_supabase_auth_admin_url(supabase_url, uid)
    except HTTPException:
        raise generic_fail

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }

    unconfirmed = False
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

        if body.force_unconfirm:
            unconfirmed = await _force_unconfirm_if_needed(
                client, user_url=user_url, headers=headers, user=user
            )

        await _persist_shipping_profile(
            client,
            user_id=uid,
            email=email,
            restaurant_name=body.restaurant_name,
            shipping=body.shipping,
        )

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
        "force_unconfirmed": unconfirmed,
        "redirect_to": redirect_to,
        "id": result.get("id"),
    }
