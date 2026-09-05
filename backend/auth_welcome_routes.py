"""
Welcome + verification e-mail po rejestracji (Resend → kontakt@gastromanager.org).
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

from health_routes import normalize_email
from http_ssl import httpx_verify
from notify_resend import is_resend_configured, send_email
from supabase_rest import require_supabase, sb_patch
from url_safety import (
    assert_supabase_origin,
    build_supabase_auth_admin_url,
    build_supabase_auth_generate_link_url,
)

logger = logging.getLogger("auth.welcome")

router = APIRouter(tags=["auth-welcome"])

# Resend nie przyjmuje From z Gmail/Outlook — domena gastromanager.org.
# Widoczny kontakt w stopce zawsze kontakt@; From domyślnie też kontakt@
# (gdy Resend wymaga asystent.dostaw@ — ustaw WELCOME_FROM_EMAIL / RESEND_FROM_EMAIL).
_WELCOME_FROM_DEFAULT = "kontakt@gastromanager.org"
_CONTACT_VISIBLE = "kontakt@gastromanager.org"
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DEFAULT_VERIFY_REDIRECT = "https://gastromanager.org/auth/verified"
_DEFAULT_RESET_REDIRECT = "https://gastromanager.org/auth/nowe-haslo"


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


async def _generate_auth_link(
    client: httpx.AsyncClient,
    *,
    supabase_url: str,
    supabase_key: str,
    email: str,
    redirect_to: str | None,
    link_types: list[str],
) -> str | None:
    url = build_supabase_auth_generate_link_url(supabase_url)
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }
    redirect = redirect_to or _DEFAULT_VERIFY_REDIRECT
    for link_type in link_types:
        body: dict[str, Any] = {"type": link_type, "email": email, "options": {"redirect_to": redirect}}
        try:
            r = await client.post(url, headers=headers, json=body)
        except Exception as e:  # noqa: BLE001
            logger.warning("generate_link request failed: %s", e)
            continue
        if r.status_code >= 400:
            logger.info("generate_link type=%s status=%s", link_type, r.status_code)
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


async def _generate_verify_link(
    client: httpx.AsyncClient,
    *,
    supabase_url: str,
    supabase_key: str,
    email: str,
    redirect_to: str | None,
) -> str | None:
    return await _generate_auth_link(
        client,
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        email=email,
        redirect_to=redirect_to,
        link_types=["signup", "magiclink"],
    )


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
  <p style="margin-top:28px;font-size:13px;color:#5a6b62">Pozdrawiamy,<br/>Zespół Gastro Manager<br/>{_CONTACT_VISIBLE}</p>
</body></html>"""

    text = (
        f"{greeting}\n\n"
        "Dziękujemy, że dołączyłeś/aś do Gastro Manager.\n"
        "Kliknij link, aby potwierdzić e-mail — dopiero potem możesz się zalogować."
        f"{text_link}\n"
        f"Pozdrawiamy,\nZespół Gastro Manager\n{_CONTACT_VISIBLE}\n"
    )
    return html, text


def build_reset_password_email_html(*, reset_link: str | None) -> tuple[str, str]:
    if reset_link:
        btn = (
            f'<p style="margin:28px 0 12px">'
            f'<a href="{html_lib.escape(reset_link)}" '
            f'style="display:inline-block;background:#00FF78;color:#0A0A0A;'
            f'font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">'
            f"Ustaw nowe hasło</a></p>"
            f'<p style="font-size:12px;color:#5a6b62;word-break:break-all">'
            f"Jeśli przycisk nie działa, wklej link:<br/>{html_lib.escape(reset_link)}</p>"
        )
        text_link = f"\n\nUstaw nowe hasło:\n{reset_link}\n"
    else:
        btn = (
            "<p style=\"margin:20px 0;color:#3d5248\">"
            "Jeśli konto istnieje, spróbuj ponownie za chwilę albo napisz na "
            f"{_CONTACT_VISIBLE}.</p>"
        )
        text_link = f"\n\nSkontaktuj się: {_CONTACT_VISIBLE}\n"

    html = f"""<!DOCTYPE html>
<html lang="pl"><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#122018;line-height:1.5;padding:24px">
  <h1 style="font-size:22px;margin:0 0 12px;color:#0A120E">Reset hasła — Gastro Manager</h1>
  <p>Otrzymaliśmy prośbę o ustawienie nowego hasła. Kliknij poniższy link (ważny czasowo).</p>
  <p>Jeśli to nie Ty — zignoruj tę wiadomość.</p>
  {btn}
  <p style="margin-top:28px;font-size:13px;color:#5a6b62">Pozdrawiamy,<br/>Zespół Gastro Manager<br/>{_CONTACT_VISIBLE}</p>
</body></html>"""
    text = (
        "Reset hasła — Gastro Manager\n\n"
        "Kliknij link, aby ustawić nowe hasło."
        f"{text_link}\n"
        f"Pozdrawiamy,\nZespół Gastro Manager\n{_CONTACT_VISIBLE}\n"
    )
    return html, text


@router.post("/api/auth/welcome-email")
async def auth_welcome_email(body: WelcomeEmailBody, request: Request):
    """
    Po rejestracji: (opcjonalnie) force-unconfirm + zapis shipping → profiles + mail z linkiem.
    Bez rate-limitu 429 — maile auth idą przez Resend, nie przez limit Supabase.
    """
    if not is_resend_configured():
        raise HTTPException(status_code=503, detail="Wysyłka e-mail nie jest skonfigurowana (RESEND_API_KEY).")

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
        if not isinstance(user, dict):
            raise generic_fail
        # Tylko zgodność e-maila — bez limitu wieku (wcześniej 15 min blokowało ponowną wysyłkę).
        if normalize_email(str(user.get("email") or "")) != email:
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


class ResetPasswordBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    redirect_to: Optional[str] = Field(default=None, max_length=500)


@router.post("/api/auth/reset-password-email")
async def auth_reset_password_email(body: ResetPasswordBody, request: Request):
    """
    Reset hasła przez Resend (link recovery). NIGDY nie wysyłamy starego hasła (RODO).
    Zawsze zwraca ok — bez enumeracji kont. Bez rate-limitu 429.
    """
    # unused request kept for parity / future IP logging
    _ = request
    email = normalize_email(body.email)
    # Odpowiedź zawsze sukces — nie zdradzamy czy konto istnieje.
    soft_ok = {"ok": True, "email_sent": True}

    if not email or not _EMAIL_RE.match(email):
        return soft_ok
    if not is_resend_configured():
        logger.warning("reset-password: Resend not configured")
        return soft_ok

    require_supabase()
    supabase_url, supabase_key = _supabase_creds()
    redirect_to = _safe_redirect(body.redirect_to) or _DEFAULT_RESET_REDIRECT

    async with httpx.AsyncClient(timeout=25.0, verify=httpx_verify()) as client:
        reset_link = await _generate_auth_link(
            client,
            supabase_url=supabase_url,
            supabase_key=supabase_key,
            email=email,
            redirect_to=redirect_to,
            link_types=["recovery"],
        )

    if not reset_link:
        # Brak linku (brak konta / błąd Admin) — i tak soft ok.
        logger.info("reset-password: no recovery link for request")
        return soft_ok

    html, text = build_reset_password_email_html(reset_link=reset_link)
    result = await send_email(
        to=email,
        subject="Gastro Manager — ustaw nowe hasło",
        html=html,
        text=text,
        from_email=_welcome_from(),
        from_name="Gastro Manager",
    )
    if not result.get("ok"):
        logger.warning("reset-password email failed: %s", result.get("error"))
    return soft_ok


class RegisterBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=6, max_length=128)
    restaurant_name: Optional[str] = Field(default=None, max_length=120)
    redirect_to: Optional[str] = Field(default=None, max_length=500)
    shipping: Optional[ShippingBody] = None


@router.post("/api/auth/register")
async def auth_register(body: RegisterBody, request: Request):
    """
    Rejestracja przez Admin API (bez maila Supabase = bez limitu e-mail Auth).
    Potwierdzenie idzie wyłącznie Resendem z linkiem weryfikacyjnym.
    """
    _ = request
    if not is_resend_configured():
        raise HTTPException(status_code=503, detail="Wysyłka e-mail nie jest skonfigurowana (RESEND_API_KEY).")

    email = normalize_email(body.email)
    if not email or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Nieprawidłowy e-mail.")
    password = body.password or ""
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Hasło musi mieć co najmniej 6 znaków.")

    require_supabase()
    supabase_url, supabase_key = _supabase_creds()
    redirect_to = _safe_redirect(body.redirect_to) or _DEFAULT_VERIFY_REDIRECT

    create_url = f"{assert_supabase_origin(supabase_url)}/auth/v1/admin/users"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }
    ship = body.shipping
    meta: dict[str, Any] = {
        "restaurant_name": (body.restaurant_name or "").strip() or None,
    }
    if ship:
        meta.update(
            {
                "shipping_phone": (ship.phone or "").strip() or None,
                "shipping_street": (ship.street or "").strip() or None,
                "shipping_building": (ship.building or "").strip() or None,
                "shipping_city": (ship.city or "").strip() or None,
                "shipping_post_code": (ship.post_code or "").strip() or None,
                "shipping_nip": _digits(ship.nip) or None,
                "shipping_regon": _digits(ship.regon) or None,
            }
        )

    payload = {
        "email": email,
        "password": password,
        "email_confirm": False,
        "user_metadata": meta,
    }

    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as client:
        created = await client.post(create_url, headers=headers, json=payload)
        if created.status_code in (400, 422):
            try:
                err = created.json() or {}
            except Exception:  # noqa: BLE001
                err = {}
            msg = str(err.get("msg") or err.get("message") or err.get("error_description") or "").lower()
            if "already" in msg or "registered" in msg or "exists" in msg:
                raise HTTPException(
                    status_code=409,
                    detail="Ten e-mail jest już zarejestrowany — przejdź do logowania.",
                )
            raise HTTPException(status_code=400, detail="Nie udało się utworzyć konta.")
        if created.status_code >= 400:
            logger.info("admin create user failed status=%s body=%s", created.status_code, created.text[:200])
            raise HTTPException(status_code=400, detail="Nie udało się utworzyć konta.")
        try:
            user = created.json() or {}
        except Exception as e:  # noqa: BLE001
            logger.warning("register parse user: %s", e)
            raise HTTPException(status_code=400, detail="Nie udało się utworzyć konta.")
        uid = str(user.get("id") or "").strip()
        if not uid:
            raise HTTPException(status_code=400, detail="Nie udało się utworzyć konta.")

        user_url = build_supabase_auth_admin_url(supabase_url, uid)
        await _force_unconfirm_if_needed(client, user_url=user_url, headers=headers, user=user)
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
        logger.warning("register welcome email failed: %s", result.get("error"))
        # Konto już istnieje — nie failujemy całej rejestracji; użytkownik może poprosić o ponowny link.
        return {
            "ok": True,
            "user_id": uid,
            "email": email,
            "verify_link_included": False,
            "email_warning": True,
        }

    return {
        "ok": True,
        "user_id": uid,
        "email": email,
        "verify_link_included": bool(verify_link),
        "redirect_to": redirect_to,
        "id": result.get("id"),
    }
