"""
Feedback testerów — POST /api/feedback (+ admin list).
Załączniki → bucket app-feedback; e-mail → kontakt@gastromanager.org.
"""
from __future__ import annotations

import html
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from cron_auth import require_cron_secret
from http_ssl import httpx_verify
from lp_invoice_url import create_storage_signed_url, upload_private_bytes
from notify_resend import is_resend_configured, send_email
from supabase_rest import sb_get, sb_post

logger = logging.getLogger("feedback")
router = APIRouter(tags=["feedback"])

FEEDBACK_BUCKET = "app-feedback"
FEEDBACK_INBOX = "kontakt@gastromanager.org"
MAX_FILES = 5
MAX_FILE_BYTES = 12 * 1024 * 1024
ALLOWED_KINDS = frozenset({"bug", "usability", "improvement", "feature", "general"})
KIND_LABELS = {
    "bug": "Błąd / coś nie działa",
    "usability": "Problem z działaniem lub obsługą",
    "improvement": "Pomysł na usprawnienie",
    "feature": "Pomysł na nową funkcję",
    "general": "Ogólna opinia",
}
_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._\-]+")


def _safe_filename(name: str) -> str:
    base = (name or "plik").strip().replace("\\", "/").split("/")[-1]
    cleaned = _SAFE_NAME_RE.sub("_", base).strip("._") or "plik"
    return cleaned[:120]


@router.post("/api/feedback")
async def submit_feedback(
    request: Request,
    kind: str = Form(...),
    message: str = Form(...),
    location: Optional[str] = Form(None),
    expected_behavior: Optional[str] = Form(None),
    app_version: Optional[str] = Form(None),
    files: Optional[list[UploadFile]] = File(None),
):
    """Zapisuje opinię testera + opcjonalne załączniki; wysyła mail do kontaktu."""
    from lp_orders import _auth_user_id_from_request
    from server import require_tenant_account_key

    ak = require_tenant_account_key()
    kind_key = (kind or "").strip().lower()
    if kind_key not in ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail="Nieprawidłowy rodzaj zgłoszenia.")
    body = (message or "").strip()
    if len(body) < 5:
        raise HTTPException(status_code=400, detail="Opisz uwagę dokładniej (min. 5 znaków).")
    if len(body) > 8000:
        raise HTTPException(status_code=400, detail="Opis jest zbyt długi (max 8000 znaków).")

    loc = (location or "").strip()[:120] or None
    expected = (expected_behavior or "").strip()[:4000] or None
    ver = (app_version or "").strip()[:40] or None

    uid = await _auth_user_id_from_request(request)
    user_email: Optional[str] = None
    attachments: list[dict[str, Any]] = []

    upload_list = [f for f in (files or []) if f and (f.filename or "").strip()]
    if len(upload_list) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Maksymalnie {MAX_FILES} załączników.")

    async with httpx.AsyncClient(timeout=90.0, verify=httpx_verify()) as client:
        if uid:
            try:
                rows = await sb_get(
                    client,
                    "profiles",
                    params={
                        "select": "id,email,account_key",
                        "id": f"eq.{uid}",
                        "limit": "1",
                    },
                )
                row = rows[0] if isinstance(rows, list) and rows else None
                if row:
                    user_email = str(row.get("email") or "").strip() or None
            except Exception:  # noqa: BLE001
                logger.info("feedback: profile email lookup skipped")

        for f in upload_list:
            raw = await f.read()
            if not raw:
                continue
            if len(raw) > MAX_FILE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Plik „{f.filename}” jest za duży (max 12 MB).",
                )
            ctype = (f.content_type or "application/octet-stream").split(";")[0].strip()
            fname = _safe_filename(f.filename or "plik")
            path = f"{ak}/{datetime.now(timezone.utc).strftime('%Y/%m')}/{uuid.uuid4().hex}_{fname}"
            try:
                ref = await upload_private_bytes(
                    bucket=FEEDBACK_BUCKET,
                    path=path,
                    content=raw,
                    content_type=ctype,
                    client=client,
                    verify=httpx_verify(),
                )
            except Exception as e:  # noqa: BLE001
                logger.exception("feedback upload failed")
                raise HTTPException(
                    status_code=502,
                    detail=f"Nie udało się zapisać załącznika: {str(e)[:160]}",
                ) from e
            attachments.append(
                {
                    "ref": ref,
                    "name": fname,
                    "content_type": ctype,
                    "size": len(raw),
                }
            )

        payload = {
            "account_key": ak,
            "user_id": uid,
            "user_email": user_email,
            "kind": kind_key,
            "message": body,
            "location": loc,
            "expected_behavior": expected,
            "attachments": attachments,
            "status": "new",
            "app_version": ver,
        }
        try:
            inserted = await sb_post(client, "app_feedback", payload)
        except httpx.HTTPStatusError as e:
            detail = (e.response.text or str(e))[:200]
            logger.exception("feedback insert failed: %s", detail)
            raise HTTPException(
                status_code=502,
                detail=(
                    "Nie udało się zapisać zgłoszenia w bazie. "
                    "Uruchom migrację ADD_APP_FEEDBACK.sql, potem spróbuj ponownie."
                ),
            ) from e
        except Exception as e:  # noqa: BLE001
            logger.exception("feedback insert failed")
            raise HTTPException(
                status_code=502,
                detail=f"Nie udało się zapisać zgłoszenia: {str(e)[:160]}",
            ) from e

        row = (inserted[0] if isinstance(inserted, list) and inserted else inserted) or {}
        feedback_id = str(row.get("id") or "")
        created_at = str(row.get("created_at") or datetime.now(timezone.utc).isoformat())

    # Mail do zespołu — best-effort (zapis w DB już się udał).
    email_ok = False
    if is_resend_configured():
        kind_label = KIND_LABELS.get(kind_key, kind_key)
        att_lines = ""
        if attachments:
            items = "".join(
                f"<li>{html.escape(a.get('name') or '?')} "
                f"({html.escape(a.get('content_type') or '')}, {int(a.get('size') or 0)} B)"
                f"<br/><code>{html.escape(a.get('ref') or '')}</code></li>"
                for a in attachments
            )
            att_lines = f"<p><b>Załączniki:</b></p><ul>{items}</ul>"
        else:
            att_lines = "<p><b>Załączniki:</b> brak</p>"

        subject = f"[Feedback] {kind_label} · {ak}"
        html_body = f"""
        <h2>Nowe zgłoszenie z aplikacji</h2>
        <p><b>ID:</b> {html.escape(feedback_id)}</p>
        <p><b>Konto:</b> {html.escape(ak)}</p>
        <p><b>Użytkownik:</b> {html.escape(user_email or '—')} / {html.escape(uid or '—')}</p>
        <p><b>Kiedy:</b> {html.escape(created_at)}</p>
        <p><b>Rodzaj:</b> {html.escape(kind_label)}</p>
        <p><b>Gdzie:</b> {html.escape(loc or '—')}</p>
        <p><b>Wersja apki:</b> {html.escape(ver or '—')}</p>
        <p><b>Opis:</b></p>
        <pre style="white-space:pre-wrap;font-family:sans-serif">{html.escape(body)}</pre>
        <p><b>Jak powinno działać:</b></p>
        <pre style="white-space:pre-wrap;font-family:sans-serif">{html.escape(expected or '—')}</pre>
        {att_lines}
        """
        text_body = (
            f"ID: {feedback_id}\nKonto: {ak}\nUser: {user_email or uid}\n"
            f"Rodzaj: {kind_label}\nGdzie: {loc or '—'}\n\n{body}\n\n"
            f"Oczekiwane: {expected or '—'}\n"
        )
        try:
            result = await send_email(
                to=FEEDBACK_INBOX,
                subject=subject,
                html=html_body,
                text=text_body,
            )
            email_ok = bool(result.get("ok"))
        except Exception:  # noqa: BLE001
            logger.exception("feedback email failed")

    return {
        "ok": True,
        "id": feedback_id or None,
        "created_at": created_at,
        "attachments_count": len(attachments),
        "email_sent": email_ok,
        "message": "Dziękujemy za zgłoszenie! Twoja opinia pomoże nam ulepszyć Gastro-Managera.",
    }


@router.get("/api/admin/feedback")
async def admin_list_feedback(request: Request, limit: int = 50):
    """Lista zgłoszeń dla administratora (X-Cron-Secret)."""
    require_cron_secret(request)
    lim = max(1, min(int(limit or 50), 200))
    async with httpx.AsyncClient(timeout=45.0, verify=httpx_verify()) as client:
        rows = await sb_get(
            client,
            "app_feedback",
            params={
                "select": "*",
                "order": "created_at.desc",
                "limit": str(lim),
            },
        )
        out: list[dict[str, Any]] = []
        for row in rows if isinstance(rows, list) else []:
            item = dict(row)
            signed: list[dict[str, Any]] = []
            for att in item.get("attachments") or []:
                if not isinstance(att, dict):
                    continue
                ref = str(att.get("ref") or "")
                entry = dict(att)
                if ":" in ref:
                    bucket, path = ref.split(":", 1)
                    try:
                        entry["signed_url"] = await create_storage_signed_url(
                            bucket=bucket,
                            path=path,
                            expires_in=3600,
                            client=client,
                            verify=httpx_verify(),
                        )
                    except Exception as e:  # noqa: BLE001
                        entry["signed_url_error"] = str(e)[:120]
                signed.append(entry)
            item["attachments"] = signed
            out.append(item)
    return {"ok": True, "count": len(out), "items": out}
