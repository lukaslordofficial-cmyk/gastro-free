"""Formatowanie szablonów e-mail/SMS zamówienia do dostawcy (pure)."""
from __future__ import annotations

from typing import Any, Optional


def fmt_pln(v: float) -> str:
    return f"{v:.2f}".replace(".", ",") + " zł"


def fmt_qty(q: float) -> str:
    return f"{q:.0f}" if float(q).is_integer() else f"{q:.2f}".replace(".", ",")


def is_internal_order_note(notes: Optional[str]) -> bool:
    """Notatki wewnętrzne (koszyk / draft) — nie trafiają do maila do dostawcy."""
    t = (notes or "").strip().lower()
    if not t:
        return True
    markers = (
        "łowca okazji",
        "lowca okazji",
        "zapisane na później",
        "zapisane na pozniej",
        "na później",
        "na pozniej",
        "[internal]",
    )
    return any(m in t for m in markers)


def resolve_restaurant_label(
    *,
    profile: dict,
    req_restaurant_name: Optional[str],
) -> str:
    company = (profile.get("company_name") or "").strip()
    req_name = (req_restaurant_name or "").strip()
    if not req_name or req_name.lower() in ("nasza restauracja", "restauracja"):
        return company or req_name or "Nasza restauracja"
    return req_name


def build_supplier_order_message(
    *,
    supplier_hello: str,
    supplier_email: Optional[str],
    supplier_id: Optional[str],
    restaurant: str,
    today: str,
    delivery: str,
    items: list[dict],
    subtotal: float,
    notes: Optional[str],
    contact_block: str,
    contact_phone: str,
    footer: str,
) -> dict[str, Any]:
    rows_html = ""
    for i in items:
        qty = fmt_qty(float(i.get("quantity") or 0))
        unit = i.get("unit", "")
        name = i.get("matched_name") or i.get("product_name", "")
        line = float(i.get("line_total") or 0)
        rows_html += (
            f"<tr>"
            f"<td style='padding:8px 10px;border:1px solid #E2E8F0'>{name}</td>"
            f"<td style='padding:8px 10px;border:1px solid #E2E8F0;text-align:center'>"
            f"{qty} {unit}</td>"
            f"<td style='padding:8px 10px;border:1px solid #E2E8F0;text-align:right'>"
            f"{fmt_pln(line)}</td>"
            f"</tr>"
        )

    safe_notes = (notes or "").strip()
    if is_internal_order_note(safe_notes):
        safe_notes = ""
    notes_html = (
        f'<p style="margin-top:12px"><strong>Uwagi do zamówienia:</strong> {safe_notes}</p>'
        if safe_notes
        else ""
    )
    delivery_block = ""
    if delivery:
        delivery_block = (
            f"<p style='margin:0 0 14px 0;color:#64748B;font-size:13px'>"
            f"Adres dostawy: <strong>{delivery}</strong></p>"
        )
    delivery_text = f"Adres dostawy: {delivery}\n" if delivery else ""

    email_html = f"""<div style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;max-width:640px;line-height:1.5">
  <p>Szanowni Państwo (<strong>{supplier_hello}</strong>),</p>
  <p>
    w imieniu restauracji <strong>{restaurant}</strong> przesyłamy do firmy
    <strong>{supplier_hello}</strong> zamówienie towaru z prośbą o potwierdzenie realizacji.
  </p>
  <p style="margin:0 0 4px 0;color:#64748B;font-size:13px">Data zamówienia: {today}</p>
  <p style="margin:0 0 14px 0;color:#64748B;font-size:13px">Odbiorca / hurtownia: <strong>{supplier_hello}</strong></p>
  {delivery_block}
  <table style="border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:14px">
    <thead>
      <tr style="background:#F1F5F9">
        <th style="padding:10px 12px;border:1px solid #E2E8F0;text-align:left">Pozycja</th>
        <th style="padding:10px 12px;border:1px solid #E2E8F0;text-align:center">Ilość</th>
        <th style="padding:10px 12px;border:1px solid #E2E8F0;text-align:right">Wartość orientacyjna</th>
      </tr>
    </thead>
    <tbody>{rows_html}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="padding:10px 12px;border:1px solid #E2E8F0;text-align:right;font-weight:700">
          Łączna wartość orientacyjna
        </td>
        <td style="padding:10px 12px;border:1px solid #E2E8F0;text-align:right;font-weight:700">{fmt_pln(subtotal)}</td>
      </tr>
    </tfoot>
  </table>
  <p>
    Prosimy o potwierdzenie: <strong>dostępności produktów</strong>, ostatecznych cen netto
    oraz <strong>terminu i formy dostawy</strong>.
    Podane kwoty mają charakter orientacyjny (na podstawie aktualnego cennika) —
    wiążące będą ceny potwierdzone przez Państwa.
  </p>
  {notes_html}
  <p>{contact_block}</p>
  <p style="margin-top:20px">
    Z poważaniem,<br/>
    <strong>{restaurant}</strong>
  </p>
  <p style="color:#94A3B8;font-size:12px;border-top:1px solid #E2E8F0;padding-top:12px;margin-top:20px">{footer}</p>
</div>"""

    email_text_lines = [
        f"Szanowni Państwo ({supplier_hello}),",
        "",
        f"W imieniu restauracji {restaurant} przesyłamy do firmy {supplier_hello} "
        f"zamówienie towaru (data: {today}) z prośbą o potwierdzenie realizacji.",
        f"Hurtownia: {supplier_hello}",
    ]
    if delivery_text:
        email_text_lines.append(delivery_text.strip())
    email_text_lines += ["", "Zamawiane pozycje:"]
    for i in items:
        pname = i.get("matched_name") or i.get("product_name", "")
        email_text_lines.append(
            f"• {pname} — {fmt_qty(float(i.get('quantity') or 0))} {i.get('unit', '')} "
            f"(orient. {fmt_pln(float(i.get('line_total') or 0))})"
        )
    email_text_lines += [
        "",
        f"Łączna wartość orientacyjna: {fmt_pln(subtotal)}",
        "",
        "Prosimy o potwierdzenie dostępności, ostatecznych cen netto oraz terminu i formy dostawy.",
        "Podane kwoty mają charakter orientacyjny — wiążące będą ceny potwierdzone przez Państwa.",
    ]
    if safe_notes:
        email_text_lines += ["", f"Uwagi: {safe_notes}"]
    if contact_block:
        email_text_lines += ["", contact_block]
    email_text_lines += ["", "Z poważaniem,", restaurant, "", footer]
    email_text = "\n".join(email_text_lines)

    sms_items = "; ".join(
        f"{fmt_qty(float(i.get('quantity') or 0))} {i.get('unit', '')} "
        f"{(i.get('matched_name') or i.get('product_name') or '')}"
        for i in items
    )
    sms_text = (
        f"{restaurant} — zamówienie ({today}): {sms_items}. "
        f"Orient. {fmt_pln(subtotal)}. Prosimy o potwierdzenie dostępności i terminu dostawy."
    )
    if contact_phone:
        sms_text += f" Kontakt: {contact_phone}."

    return {
        "supplier_id": supplier_id,
        "supplier_name": supplier_hello,
        "supplier_email": supplier_email,
        "email_subject": f"Zamówienie towaru — {restaurant} → {supplier_hello} | {today}",
        "email_html": email_html,
        "email_text": email_text,
        "email_body_text": email_text,
        "sms_text": sms_text,
        "subtotal_pln": subtotal,
    }
