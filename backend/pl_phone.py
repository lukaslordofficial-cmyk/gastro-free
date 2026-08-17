"""Numery PL dla Furgonetki / ORLEN Paczka."""
from __future__ import annotations

import re
from typing import Optional

PL_LANDLINE_AREA_CODES = {
    "12", "13", "14", "15", "16", "17", "18",
    "22", "23", "24", "25", "29",
    "32", "33", "34",
    "41", "42", "43", "44", "46", "48",
    "52", "54", "55", "56", "58", "59",
    "61", "62", "63", "65", "67", "68",
    "71", "74", "75", "76", "77",
    "81", "82", "83", "84", "85", "86", "87", "89",
    "91", "94", "95",
}


def pl_phone_digits(raw: Optional[str]) -> str:
    d = re.sub(r"\D", "", str(raw or ""))
    if d.startswith("00"):
        d = d[2:]
    if d.startswith("48") and len(d) >= 11:
        d = d[2:]
    if len(d) > 9:
        d = d[-9:]
    return d


def is_pl_landline(raw: Optional[str]) -> bool:
    d = pl_phone_digits(raw)
    if len(d) != 9:
        return False
    return d[:2] in PL_LANDLINE_AREA_CODES


def is_pl_mobile(raw: Optional[str]) -> bool:
    d = pl_phone_digits(raw)
    if len(d) != 9:
        return False
    if d[:2] in PL_LANDLINE_AREA_CODES:
        return False
    return d[0] in "45678"


def pick_pl_mobile(*candidates: Optional[str]) -> Optional[str]:
    for c in candidates:
        if is_pl_mobile(c):
            return pl_phone_digits(c)
    return None


def assign_courier_phones(
    pickup_phone: str,
    receiver_phone: str,
    extra_phones: Optional[list[Optional[str]]] = None,
) -> tuple[str, str]:
    extras = extra_phones or []
    pickup_m = pick_pl_mobile(pickup_phone, *extras, receiver_phone)
    receiver_m = pick_pl_mobile(receiver_phone, *extras, pickup_phone)
    pickup = pickup_m or pl_phone_digits(pickup_phone) or str(pickup_phone or "")
    receiver = receiver_m or pl_phone_digits(receiver_phone) or str(receiver_phone or "")
    return pickup, receiver


def courier_requires_mobile_message(phone: Optional[str] = None) -> str:
    d = pl_phone_digits(phone)
    prefix = d[:2]
    landline_hint = (
        f" Numer {d or phone} wygląda na stacjonarny (kierunkowy {prefix})."
        if is_pl_landline(phone)
        else ""
    )
    return (
        "Kurier (np. ORLEN Paczka) wymaga numeru komórkowego (9 cyfr, np. 500…)."
        + landline_hint
        + " Uzupełnij telefon komórkowy w danych dostawy restauracji albo w profilu dystrybutora i spróbuj ponownie."
    )


def humanize_courier_phone_error(raw: str) -> str:
    msg = str(raw or "").strip()
    lower = msg.lower()
    if (
        "stacjonar" in lower
        or "komórkow" in lower
        or "komorkow" in lower
        or ("9 cyfr" in lower and "podano" in lower)
        or ("7 cyfr" in lower and "telefon" in lower)
    ):
        return courier_requires_mobile_message()
    return msg
