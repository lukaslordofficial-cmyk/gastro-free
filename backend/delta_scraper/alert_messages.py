"""
Filtrowanie i formułowanie alertów cenowych.
Tylko spadki cen produktów powiązanych z magazynem / menu użytkownika.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Callable, Optional

from delta_scraper.models import ChangeEvent

logger = logging.getLogger("delta_scraper.alerts")


def _norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9ąćęłńóśźż\s]", " ", s, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", s).strip()


async def load_user_product_terms(
    client: Any,
    sb_get: Callable,
) -> list[str]:
    """Nazwy z magazynu + składniki aktywnych receptur."""
    terms: list[str] = []
    try:
        inv = await sb_get(client, "inventory_items", params={
            "select": "name",
            "limit": "2000",
        })
        for row in inv or []:
            n = (row.get("name") or "").strip()
            if n:
                terms.append(n)
    except Exception as e:
        logger.debug("inventory terms: %s", e)

    try:
        menu = await sb_get(client, "menu_items", params={
            "select": "name,id",
            "is_active": "eq.true",
            "limit": "500",
        })
        for row in menu or []:
            n = (row.get("name") or "").strip()
            if n:
                terms.append(n)
        # Składniki receptur (jeśli tabela istnieje)
        try:
            ri = await sb_get(client, "recipe_ingredients", params={
                "select": "ingredient_name,name",
                "limit": "2000",
            })
            for row in ri or []:
                n = (row.get("ingredient_name") or row.get("name") or "").strip()
                if n:
                    terms.append(n)
        except Exception:
            pass
    except Exception:
        pass

    # Unikalne
    seen: set[str] = set()
    out: list[str] = []
    for t in terms:
        k = _norm(t)
        if k and k not in seen:
            seen.add(k)
            out.append(t)
    return out


def product_matches_user_terms(product_name: str, user_terms: list[str], threshold: int = 65) -> bool:
    if not product_name or not user_terms:
        return False
    try:
        from rapidfuzz import fuzz
    except ImportError:
        q = _norm(product_name)
        return any(q in _norm(t) or _norm(t) in q for t in user_terms if len(_norm(t)) >= 3)

    q = _norm(product_name)
    best = 0
    for t in user_terms:
        tt = _norm(t)
        if not tt:
            continue
        score = max(fuzz.token_set_ratio(q, tt), fuzz.partial_ratio(q, tt))
        if score > best:
            best = score
        if best >= threshold:
            return True
    return False


def fallback_drop_message(product_name: str, details: dict) -> str:
    before = details.get("price_before")
    after = details.get("price_after")
    try:
        b, a = float(before), float(after)
        if b > 0:
            pct = abs((a - b) / b) * 100
            return (
                f"Szefie, cena „{product_name}” spadła o {pct:.0f}% "
                f"(z {b:.2f} zł do {a:.2f} zł) — warto rozważyć większe zamówienie."
            )
    except (TypeError, ValueError):
        pass
    diff = details.get("difference") or ""
    return (
        f"Szefie, dobra wiadomość: „{product_name}” jest teraz tańszy "
        f"({details.get('before')} → {details.get('after')}{', ' + str(diff) if diff else ''})."
    )


async def craft_price_drop_message(
    product_name: str,
    details: dict,
    *,
    openai_client: Any = None,
) -> str:
    """Ładny komunikat — OpenAI jeśli dostępne, inaczej szablon."""
    base = fallback_drop_message(product_name, details)
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        return base
    try:
        from openai import AsyncOpenAI
        client = openai_client or AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
        model = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")
        prompt = (
            "Napisz JEDEN krótki komunikat po polsku (max 2 zdania) dla managera restauracji. "
            "Ton: konkretny, partnerski, bez emoji. Zacznij od 'Szefie,'. "
            f"Produkt: {product_name}. "
            f"Cena była: {details.get('before')}, jest: {details.get('after')}, "
            f"różnica: {details.get('difference')}."
        )
        r = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Piszesz zwięzłe alerty cenowe dla gastronomii."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=120,
            temperature=0.5,
        )
        text = (r.choices[0].message.content or "").strip()
        return text if len(text) > 10 else base
    except Exception as e:
        logger.debug("craft message fallback: %s", e)
        return base


async def filter_and_enrich_alerts(
    changes: list[ChangeEvent],
    *,
    client: Any,
    sb_get: Callable,
    is_first_run: bool,
) -> list[ChangeEvent]:
    """
    Zostawia wyłącznie spadki cen produktów z magazynu/menu.
    Dodaje details.message z ładnym tekstem.
    """
    if is_first_run:
        return []

    drops = [c for c in changes if c.change_type == "price_drop" and c.product_name]
    if not drops:
        return []

    terms = await load_user_product_terms(client, sb_get)
    if not terms:
        # Bez magazynu/menu — nie spamuj alertami
        logger.info("Brak terminów magazyn/menu — pomijam alerty cenowe")
        return []

    out: list[ChangeEvent] = []
    for ch in drops:
        if not product_matches_user_terms(ch.product_name or "", terms):
            continue
        msg = await craft_price_drop_message(ch.product_name or "", ch.details or {})
        details = dict(ch.details or {})
        details["message"] = msg
        details["matched_to_user_stock"] = True
        out.append(ChangeEvent(
            change_type="price_drop",
            product_name=ch.product_name,
            details=details,
        ))
    return out
