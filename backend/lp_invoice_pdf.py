"""
PDF rachunku / faktury marketplace LP.

Sprzedawca = profil przetwórcy (local_producers), nigdy platforma.
Czcionka TTF z polskimi znakami (UTF-8) — bez Helvetica / podmiany „zł” na „?ł”.
"""
from __future__ import annotations

import io
import logging
import re
from pathlib import Path
from typing import Any, Optional

import fitz

logger = logging.getLogger("lp.invoice_pdf")

FONT_DIR = Path(__file__).resolve().parent / "fonts"
FONT_REGULAR = FONT_DIR / "InvoiceSans-Regular.ttf"
FONT_BOLD = FONT_DIR / "InvoiceSans-Bold.ttf"

PAGE_W = 595.0
PAGE_H = 842.0
MARGIN = 48.0
PLATFORM_NAME_RE = re.compile(r"^\s*gastro\s*manager\s*$", re.I)


def format_pln(amount: Any) -> str:
    try:
        n = float(amount or 0)
    except (TypeError, ValueError):
        n = 0.0
    sign = "-" if n < 0 else ""
    n = abs(n)
    raw = f"{n:.2f}"
    intpart, frac = raw.split(".")
    groups: list[str] = []
    while intpart:
        groups.append(intpart[-3:])
        intpart = intpart[:-3]
    grouped = " ".join(reversed(groups)) if groups else "0"
    return f"{sign}{grouped},{frac} zł"


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def seller_from_producer(producer: Optional[dict[str, Any]]) -> dict[str, Optional[str]]:
    p = producer or {}
    billing_person = " ".join(
        x for x in (_clean(p.get("billing_first_name")), _clean(p.get("billing_last_name"))) if x
    )
    candidates = [
        _clean(p.get("company_name")),
        billing_person,
        _clean(p.get("owner_name")),
    ]
    name = next((n for n in candidates if n and not PLATFORM_NAME_RE.match(n)), "") or (
        "Sprzedawca (uzupełnij profil)"
    )
    street = _clean(p.get("billing_address")) or _clean(p.get("address"))
    zipc = _clean(p.get("billing_zip")) or _clean(p.get("postal_code"))
    city = _clean(p.get("billing_city")) or _clean(p.get("city"))
    voiv = _clean(p.get("billing_voivodeship")) or _clean(p.get("voivodeship"))
    country = _clean(p.get("billing_country"))
    address_parts = [
        street,
        " ".join(x for x in (zipc, city) if x),
        voiv,
        country if country and country.upper() != "PL" else "",
    ]
    address = ", ".join(x for x in address_parts if x)
    return {
        "name": name,
        "address": address or None,
        "tax_id": _clean(p.get("tax_identifier")) or None,
        "bank_account": _clean(p.get("bank_account")) or None,
    }


def settlement_type_of(producer: Optional[dict[str, Any]]) -> str:
    raw = str((producer or {}).get("settlement_document_type") or "").strip()
    if raw in ("receipt", "non_vat_invoice", "vat_invoice", "vat_rr"):
        return raw
    billing = str((producer or {}).get("billing_type") or "").strip().lower()
    if billing == "vat_rr":
        return "vat_rr"
    if billing == "vat_exempt":
        return "non_vat_invoice"
    if billing == "unregistered":
        return "receipt"
    if billing == "vat":
        return "vat_invoice"
    return "vat_invoice"


def round_money(amount: Any) -> float:
    try:
        n = float(amount or 0)
    except (TypeError, ValueError):
        n = 0.0
    return round(n + 1e-9, 2)


def vat_rate_to_percent(rate: Any, *, default: float = 5.0) -> float:
    raw = str(rate or "").strip().lower()
    if raw in ("", "zw", "0"):
        return 0.0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return float(default)


def invoice_filename(settlement_type: str, order_id: str) -> str:
    short = (order_id or "dokument")[:8].upper()
    prefix = {
        "receipt": "rachunek",
        "non_vat_invoice": "faktura",
        "vat_rr": "faktura-vat-rr",
    }.get(settlement_type, "faktura-vat")
    return f"{prefix}-{short}.pdf"


def _doc_title(kind: str) -> str:
    if kind == "non_vat_invoice":
        return "FAKTURA"
    if kind == "receipt":
        return "RACHUNEK"
    if kind == "vat_rr":
        return "FAKTURA VAT-RR"
    return "FAKTURA VAT"


def _doc_subtitle(kind: str) -> Optional[str]:
    if kind == "non_vat_invoice":
        return "Dokument bez VAT — sprzedawca zwolniony"
    if kind == "receipt":
        return "Działalność nierejestrowana"
    if kind == "vat_rr":
        return "Wystawca: nabywca (restauracja) · Dostawca: rolnik ryczałtowy"
    return None


def _fonts() -> tuple[fitz.Font, fitz.Font]:
    if not FONT_REGULAR.is_file() or not FONT_BOLD.is_file():
        raise FileNotFoundError(f"Brak czcionek faktury w {FONT_DIR}")
    return fitz.Font(fontfile=str(FONT_REGULAR)), fitz.Font(fontfile=str(FONT_BOLD))


def _wrap(font: fitz.Font, text: str, size: float, max_width: float) -> list[str]:
    words = [w for w in (text or "").split() if w]
    if not words:
        return [""]
    lines: list[str] = []
    cur = ""
    for word in words:
        nxt = f"{cur} {word}".strip()
        if font.text_length(nxt, fontsize=size) <= max_width:
            cur = nxt
            continue
        if cur:
            lines.append(cur)
        if font.text_length(word, fontsize=size) <= max_width:
            cur = word
            continue
        chunk = ""
        for ch in word:
            trial = chunk + ch
            if font.text_length(trial, fontsize=size) <= max_width:
                chunk = trial
            else:
                if chunk:
                    lines.append(chunk)
                chunk = ch
        cur = chunk
    if cur:
        lines.append(cur)
    return lines or [""]


def _item_name(item: dict[str, Any]) -> str:
    prod = item.get("producer_products") or {}
    if isinstance(prod, list):
        prod = prod[0] if prod else {}
    raw = _clean(prod.get("title") or item.get("title") or item.get("name")) or "Produkt"
    return re.sub(r"\s*\([^)]*\)\s*$", "", raw).strip() or "Produkt"


def _item_unit(item: dict[str, Any]) -> str:
    prod = item.get("producer_products") or {}
    if isinstance(prod, list):
        prod = prod[0] if prod else {}
    unit = _clean(prod.get("unit") or item.get("unit"))
    if unit:
        return unit
    raw = _clean(prod.get("title") or item.get("title") or item.get("name"))
    m = re.search(r"\(([^)]+)\)\s*$", raw)
    return _clean(m.group(1)) if m else "szt"


def _item_vat_rate(item: dict[str, Any], *, kind: str) -> float:
    if kind == "vat_rr":
        return 7.0
    prod = item.get("producer_products") or {}
    if isinstance(prod, list):
        prod = prod[0] if prod else {}
    return vat_rate_to_percent(prod.get("vat_rate"), default=5.0)


def build_invoice_pdf(
    *,
    producer: dict[str, Any],
    order: dict[str, Any],
    items: list[dict[str, Any]],
) -> bytes:
    regular, bold = _fonts()
    kind = settlement_type_of(producer)
    seller = seller_from_producer(producer)
    show_vat = kind in ("vat_invoice", "vat_rr")
    is_vat_rr = kind == "vat_rr"
    hide_seller_nip = kind == "receipt"

    shipping = 0.0
    try:
        shipping = float(order.get("delivery_cost") or order.get("shipping_cost") or 0) or 0.0
    except (TypeError, ValueError):
        shipping = 0.0
    shipping = round_money(shipping)

    products_gross = 0.0
    sum_net = 0.0
    sum_vat = 0.0
    line_rows: list[dict[str, str]] = []
    for it in items or []:
        try:
            qty = float(it.get("quantity") or 0) or 0.0
        except (TypeError, ValueError):
            qty = 0.0
        try:
            unit_gross = float(it.get("unit_price") or 0) or 0.0
        except (TypeError, ValueError):
            unit_gross = 0.0
        products_gross = round_money(products_gross + round_money(qty * unit_gross))
        name = _item_name(it)
        unit = _item_unit(it) or "szt"
        if show_vat:
            rate = _item_vat_rate(it, kind=kind)
            factor = 1.0 + (rate / 100.0)
            unit_net = round_money(unit_gross / factor) if factor else round_money(unit_gross)
            line_net = round_money(qty * unit_net)
            line_vat = round_money(line_net * (rate / 100.0))
            sum_net = round_money(sum_net + line_net)
            sum_vat = round_money(sum_vat + line_vat)
            line_rows.append({
                "name": name,
                "unit": unit,
                "qty": str(int(qty) if qty == int(qty) else qty),
                "unit_price": format_pln(unit_net),
                "line_total": format_pln(line_net),
                "vat": f"{int(rate) if rate == int(rate) else rate}%",
            })
        else:
            line_gross = round_money(qty * unit_gross)
            line_rows.append({
                "name": name,
                "unit": unit,
                "qty": str(int(qty) if qty == int(qty) else qty),
                "unit_price": format_pln(round_money(unit_gross)),
                "line_total": format_pln(line_gross),
                "vat": "",
            })

    if show_vat and shipping > 0:
        ship_rate = 7.0 if is_vat_rr else 5.0
        factor = 1.0 + (ship_rate / 100.0)
        ship_net = round_money(shipping / factor)
        ship_vat = round_money(ship_net * (ship_rate / 100.0))
        sum_net = round_money(sum_net + ship_net)
        sum_vat = round_money(sum_vat + ship_vat)
        shipping_display = ship_net
        grand = round_money(sum_net + sum_vat)
    elif show_vat:
        shipping_display = 0.0
        grand = round_money(sum_net + sum_vat)
    else:
        shipping_display = shipping
        grand = round_money(products_gross + shipping)

    year = __import__("datetime").datetime.now().year
    short = (order.get("id") or "")[:8].upper()
    default_no = {
        "receipt": f"R/{year}/{short}",
        "non_vat_invoice": f"FZ/{year}/{short}",
        "vat_rr": f"RR/{year}/{short}",
    }.get(kind, f"FV/{year}/{short}")
    doc_no = _clean(order.get("invoice_number")) or default_no
    issue_place = (
        _clean(producer.get("billing_city"))
        or _clean(producer.get("city"))
        or "Polska"
    )
    created = _clean(order.get("created_at"))
    if created and len(created) >= 10:
        issue_date = f"{created[8:10]}.{created[5:7]}.{created[0:4]}"
    else:
        from datetime import date
        issue_date = date.today().strftime("%d.%m.%Y")

    buyer_name = _clean(order.get("restaurant_name")) or _clean(order.get("delivery_name")) or "—"
    buyer_address = ", ".join(
        x for x in (
            _clean(order.get("delivery_address")),
            " ".join(
                x for x in (
                    _clean(order.get("delivery_postal_code")),
                    _clean(order.get("delivery_city")),
                ) if x
            ),
        ) if x
    )

    doc = fitz.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    page.insert_font(fontname="inv", fontfile=str(FONT_REGULAR))
    page.insert_font(fontname="invb", fontfile=str(FONT_BOLD))

    y = 52.0
    ink = (0.08, 0.09, 0.1)
    muted = (0.32, 0.34, 0.36)
    accent = (0.22, 0.45, 0.34)
    right = PAGE_W - MARGIN
    content_w = PAGE_W - 2 * MARGIN

    def baseline(top: float, size: float) -> float:
        return PAGE_H - top - size

    def draw(text: str, x: float, top: float, size: float, *, bold_t: bool = False, color=ink, align: str = "left") -> None:
        font = bold if bold_t else regular
        fname = "invb" if bold_t else "inv"
        w = font.text_length(text, fontsize=size)
        xd = x
        if align == "right":
            xd = x - w
        elif align == "center":
            xd = x - w / 2
        page.insert_text(
            (xd, baseline(top, size)),
            text,
            fontsize=size,
            fontname=fname,
            color=color,
        )

    def hline(top: float, x1: float, x2: float, width: float = 0.7, color=(0.78, 0.8, 0.82)) -> None:
        yy = PAGE_H - top
        page.draw_line(fitz.Point(x1, yy), fitz.Point(x2, yy), color=color, width=width)

    def new_page_if_needed(need: float) -> None:
        nonlocal page, y
        if y + need < PAGE_H - 56:
            return
        page = doc.new_page(width=PAGE_W, height=PAGE_H)
        page.insert_font(fontname="inv", fontfile=str(FONT_REGULAR))
        page.insert_font(fontname="invb", fontfile=str(FONT_BOLD))
        y = 56.0

    draw(_doc_title(kind), PAGE_W / 2, y, 20, bold_t=True, align="center")
    y += 26
    sub = _doc_subtitle(kind)
    if sub:
        draw(sub, PAGE_W / 2, y, 10, color=muted, align="center")
        y += 16
    hline(y, MARGIN, right, 1.4, accent)
    y += 22

    sale_raw = _clean(order.get("courier_pickup_at")) or _clean(order.get("updated_at")) or created
    if sale_raw and len(sale_raw) >= 10:
        sale_date = f"{sale_raw[8:10]}.{sale_raw[5:7]}.{sale_raw[0:4]}"
    else:
        sale_date = issue_date

    draw(f"Numer: {doc_no}", MARGIN, y, 10, bold_t=True)
    y += 14
    draw(f"Data wystawienia: {issue_date}", MARGIN, y, 9)
    draw(f"Data sprzedaży: {sale_date}", right, y, 9, align="right")
    y += 16
    draw(f"Miejsce wystawienia: {issue_place}", MARGIN, y, 9, color=muted)
    y += 18
    hline(y, MARGIN, right, 0.5)
    y += 22

    col_w = (content_w - 24) / 2
    left_x = MARGIN
    right_x = MARGIN + col_w + 24
    left_label = "WYSTAWCA (NABYWCA)" if is_vat_rr else "SPRZEDAWCA"
    right_label = "DOSTAWCA (ROLNIK RYCZAŁTOWY)" if is_vat_rr else "NABYWCA"
    draw(left_label, left_x, y, 8, bold_t=True, color=accent)
    draw(right_label, right_x, y, 8, bold_t=True, color=accent)
    y += 14

    farmer_lines = [seller["name"] or "—"]
    if seller.get("address"):
        farmer_lines.append(str(seller["address"]))
    if seller.get("tax_id") and not hide_seller_nip:
        farmer_lines.append(f"NIP: {seller['tax_id']}")
    if seller.get("bank_account"):
        farmer_lines.append(f"Konto: {seller['bank_account']}")
    restaurant_lines = [buyer_name, buyer_address] if buyer_address else [buyer_name]
    buyer_nip = _clean(order.get("buyer_tax_id") or order.get("restaurant_nip"))
    # lp_ship may be only in notes — keep optional
    if buyer_nip:
        restaurant_lines.append(f"NIP: {buyer_nip}")
    if is_vat_rr:
        seller_lines, buyer_lines = restaurant_lines, farmer_lines
    else:
        seller_lines, buyer_lines = farmer_lines, restaurant_lines
    sw = [w for line in seller_lines for w in _wrap(regular, line, 9, col_w - 4)]
    bw = [w for line in buyer_lines for w in _wrap(regular, line, 9, col_w - 4)]
    for i in range(max(len(sw), len(bw), 1)):
        if i < len(sw) and sw[i]:
            draw(sw[i], left_x, y, 9)
        if i < len(bw) and bw[i]:
            draw(bw[i], right_x, y, 9)
        y += 12

    y += 6
    draw("Metoda płatności: Stripe (Płatność online) · Status: ZAPŁACONO", MARGIN, y, 9, bold_t=True, color=accent)
    y += 14
    hline(y, MARGIN, right, 0.5)
    y += 20
    draw("POZYCJE", MARGIN, y, 10, bold_t=True)
    y += 16
    hline(y, MARGIN, right, 0.8, accent)
    y += 14

    col_lp = MARGIN
    col_name = MARGIN + 22
    col_qty = MARGIN + 250
    col_unit = MARGIN + 290
    col_price = MARGIN + 360
    col_vat = MARGIN + 430
    draw("Lp", col_lp, y, 8, bold_t=True, color=muted)
    draw("Nazwa", col_name, y, 8, bold_t=True, color=muted)
    draw("Ilość", col_qty, y, 8, bold_t=True, color=muted, align="right")
    draw("Jm.", col_unit, y, 8, bold_t=True, color=muted)
    draw("Cena", col_price, y, 8, bold_t=True, color=muted, align="right")
    if show_vat:
        draw("VAT", col_vat, y, 8, bold_t=True, color=muted, align="right")
    draw("Wartość", right, y, 8, bold_t=True, color=muted, align="right")
    y += 10
    hline(y, MARGIN, right, 0.4)
    # border between Ilość and Jm.
    page.draw_line(
        fitz.Point(col_unit - 6, PAGE_H - (y - 10)),
        fitz.Point(col_unit - 6, PAGE_H - y),
        color=(0.55, 0.58, 0.6),
        width=0.7,
    )
    y += 14

    for i, row in enumerate(line_rows, start=1):
        new_page_if_needed(48)
        names = _wrap(regular, row["name"], 9, 200)
        draw(str(i), col_lp, y, 9)
        draw(names[0], col_name, y, 9)
        draw(row["qty"], col_qty, y, 9, align="right")
        draw(row.get("unit") or "szt", col_unit, y, 9)
        draw(row["unit_price"], col_price, y, 9, align="right")
        if show_vat:
            draw(row["vat"], col_vat, y, 9, align="right")
        draw(row["line_total"], right, y, 9, bold_t=True, align="right")
        y += 12
        for extra in names[1:]:
            draw(extra, col_name, y, 9)
            y += 11
        y += 4

    if shipping > 0:
        new_page_if_needed(24)
        draw("Dostawa", col_name, y, 9)
        draw(format_pln(shipping_display if show_vat else shipping), right, y, 9, bold_t=True, align="right")
        y += 16

    y += 4
    hline(y, MARGIN, right, 0.8, accent)
    y += 20
    if show_vat:
        draw("Netto:", right - 130, y, 10, color=muted)
        draw(format_pln(sum_net), right, y, 10, align="right")
        y += 14
        draw("VAT:" if not is_vat_rr else "Zwrot VAT:", right - 130, y, 10, color=muted)
        draw(format_pln(sum_vat), right, y, 10, align="right")
        y += 14
    draw("Do zapłaty:", right - 130, y, 12, bold_t=True)
    draw(format_pln(grand), right, y, 12, bold_t=True, align="right")
    y += 28
    hline(y, MARGIN, right, 0.5)
    y += 22

    notes = []
    if kind == "non_vat_invoice":
        notes.append(
            "Podstawa zwolnienia z VAT: art. 113 ust. 1 ustawy o podatku od towarów i usług "
            "(zwolnienie podmiotowe) — o ile dotyczy sprzedawcy."
        )
    elif kind == "receipt":
        notes.append(
            "Rachunek wystawiony w ramach działalności nierejestrowanej "
            "(art. 5 ust. 1 ustawy Prawo przedsiębiorców). Dokument nie jest fakturą VAT. "
            "Sprzedawca nie posługuje się NIP."
        )
    elif kind == "vat_rr":
        notes.append(
            "Faktura VAT-RR wystawiona przez nabywcę produktów rolnych (restaurację) "
            "na rzecz rolnika ryczałtowego. Zryczałtowany zwrot podatku — art. 115–118 ustawy o VAT."
        )
    else:
        notes.append("Dokument wystawiony elektronicznie. Zachowaj kopię zgodnie z przepisami.")
    notes.append("Podpis odręczny nie jest wymagany.")
    notes.append(
        "Platforma marketplace jest wyłącznie pośrednikiem i nie jest stroną umowy sprzedaży towaru. "
        "Sprzedawcą jest podmiot wskazany powyżej."
    )
    for note in notes:
        for wl in _wrap(regular, note, 8, content_w):
            new_page_if_needed(16)
            draw(wl, PAGE_W / 2, y, 8, color=muted, align="center")
            y += 11

    out = io.BytesIO()
    doc.save(out, deflate=True, garbage=4)
    doc.close()
    return out.getvalue()


async def fetch_stored_invoice_bytes(
    order: dict[str, Any],
    *,
    client,
    verify: Any = True,
) -> Optional[tuple[bytes, str]]:
    """Zwraca (bytes, content_type) wgranego dokumentu albo None."""
    from lp_invoice_url import (
        create_storage_signed_url,
        order_invoice_raw,
        parse_invoice_storage_ref,
    )

    raw = order_invoice_raw(order)
    if not raw:
        return None
    parsed = parse_invoice_storage_ref(raw)
    if not parsed:
        return None
    url = parsed.get("url") if parsed.get("kind") == "http" else None
    if not url:
        try:
            url = await create_storage_signed_url(
                bucket=parsed["bucket"],
                path=parsed["path"],
                expires_in=120,
                client=client,
                verify=verify,
            )
        except Exception as e:
            logger.info("stored invoice sign failed: %s", e)
            return None
    try:
        r = await client.get(url)
    except Exception as e:
        logger.info("stored invoice fetch failed: %s", e)
        return None
    if r.status_code >= 400 or not r.content:
        return None
    ctype = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
    if r.content[:4] == b"%PDF":
        return r.content, "application/pdf"
    if ctype.startswith("image/") or r.content[:3] == b"\xff\xd8\xff":
        return r.content, ctype or "image/jpeg"
    if ctype:
        return r.content, ctype
    return r.content, "application/octet-stream"


async def load_order_invoice_items(client, order_id: str) -> list[dict[str, Any]]:
    from supabase_rest import sb_get

    try:
        rows = await sb_get(client, "producer_order_items", params={
            "select": "quantity,unit_price,product_id,producer_products(title,unit,vat_rate)",
            "order_id": f"eq.{order_id}",
        }) or []
        if rows:
            return rows
    except Exception:
        rows = []
    rows = await sb_get(client, "producer_order_items", params={
        "select": "quantity,unit_price,product_id",
        "order_id": f"eq.{order_id}",
    }) or []
    pids = [str(r.get("product_id")) for r in rows if r.get("product_id")]
    products: dict[str, dict[str, Any]] = {}
    if pids:
        joined = ",".join(pids)
        try:
            prows = await sb_get(client, "producer_products", params={
                "select": "id,title,unit",
                "id": f"in.({joined})",
            }) or []
            products = {str(p.get("id")): p for p in prows}
        except Exception:
            products = {}
    for r in rows:
        p = products.get(str(r.get("product_id"))) or {}
        r["producer_products"] = {"title": p.get("title"), "unit": p.get("unit"), "vat_rate": p.get("vat_rate")}
    return rows
