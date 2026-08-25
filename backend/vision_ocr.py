"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `vision_ocr`."""
from __future__ import annotations

from fastapi import HTTPException
from http_ssl import httpx_verify as _httpx_verify
from openai import APIError
from openai import OpenAIError
from token_billing import merge_billing_events
from token_billing import tokens_from_usage
from typing import Any
from typing import Optional
import base64
import httpx
import json
from app_core import PDF_MAX_PAGES, PDF_VISION_BATCH_SIZE, VISION_MODEL
from billing_credits import _bill_openai_response



def _images_from_upload(
    contents: bytes,
    mime: str,
    filename: str,
    *,
    max_pages: Optional[int] = None,
) -> tuple[list[str], dict[str, Any]]:
    """Render upload to base64 data-URIs for GPT-4o Vision.

    Returns ``(uris, meta)`` where meta contains:
    ``pages_total``, ``pages_rendered``, ``truncated``.

    PDFs: PyMuPDF JPEG ~108 dpi, up to ``PDF_MAX_PAGES`` (default 40).
    Short docs (etykiety) can pass a lower ``max_pages``.
    """
    limit = PDF_MAX_PAGES if max_pages is None else max(1, int(max_pages))
    name = (filename or "").lower()
    is_pdf = "pdf" in (mime or "").lower() or name.endswith(".pdf")
    if is_pdf:
        try:
            import fitz  # PyMuPDF
        except Exception as e:  # pragma: no cover
            raise HTTPException(status_code=500, detail=f"Brak biblioteki PDF: {e}") from e
        uris: list[str] = []
        try:
            doc = fitz.open(stream=contents, filetype="pdf")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Nie udało się otworzyć PDF: {e}") from e
        pages_total = int(doc.page_count or 0)
        zoom = fitz.Matrix(1.5, 1.5)
        for page in doc[:limit]:
            pix = page.get_pixmap(matrix=zoom)
            try:
                img_bytes = pix.tobytes("jpeg")
                uris.append("data:image/jpeg;base64," + base64.b64encode(img_bytes).decode())
            except Exception:
                png = pix.tobytes("png")
                uris.append("data:image/png;base64," + base64.b64encode(png).decode())
        doc.close()
        if not uris:
            raise HTTPException(status_code=400, detail="PDF nie zawiera stron.")
        meta = {
            "pages_total": pages_total,
            "pages_rendered": len(uris),
            "truncated": pages_total > len(uris),
        }
        return uris, meta
    # image
    img_mime = mime if (mime or "").startswith("image/") else "image/jpeg"
    return (
        [f"data:{img_mime};base64," + base64.b64encode(contents).decode()],
        {"pages_total": 1, "pages_rendered": 1, "truncated": False},
    )


async def _openai_vision_json_batches(
    client: Any,
    *,
    image_uris: list[str],
    system_prompt: str,
    json_schema: dict,
    endpoint: str,
    user_text: str,
    cont_text: Optional[str] = None,
    batch_size: Optional[int] = None,
    pages_meta: Optional[dict] = None,
    merge_fn: Any = None,
) -> tuple[dict, dict]:
    """Wywołuje Vision w partiach stron; zwraca (merged_json, billing)."""
    if not image_uris:
        raise HTTPException(status_code=400, detail="Brak stron dokumentu do analizy.")

    bs = max(1, int(batch_size or PDF_VISION_BATCH_SIZE))
    batches = [image_uris[i : i + bs] for i in range(0, len(image_uris), bs)]
    n = len(batches)
    parsed_parts: list[dict] = []
    billing_events: list[dict] = []
    pages_rendered = int((pages_meta or {}).get("pages_rendered") or len(image_uris))

    async with httpx.AsyncClient(timeout=60.0, verify=_httpx_verify()) as httpx_c:
        for bi, batch in enumerate(batches):
            start_page = bi * bs + 1
            end_page = bi * bs + len(batch)
            if bi == 0:
                text = user_text
            else:
                text = cont_text or (
                    f"To KONTYNUACJA tego samego dokumentu — partia {bi + 1}/{n} "
                    f"(strony {start_page}–{end_page} z {pages_rendered}). "
                    "Zachowaj ten sam typ dokumentu. Wyodrębnij pozycje widoczne na TYCH stronach. "
                    "Uzupełnij dane dostawcy / kwoty tylko jeśli widać je na tych stronach."
                )
                if n > 1:
                    text = (
                        f"Partia {bi + 1}/{n}, strony {start_page}–{end_page} z {pages_rendered}. "
                        + text
                    )

            user_content: list[dict] = [{"type": "text", "text": text}]
            for uri in batch:
                user_content.append({"type": "image_url", "image_url": {"url": uri}})

            try:
                resp = await client.chat.completions.create(
                    model=VISION_MODEL,
                    temperature=0.0,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    response_format={"type": "json_schema", "json_schema": json_schema},
                )
            except APIError as e:
                raise HTTPException(status_code=502, detail=f"OpenAI Vision: {e.message}") from e
            except OpenAIError as e:  # pragma: no cover
                raise HTTPException(status_code=502, detail=f"OpenAI: {e}") from e

            raw = (resp.choices[0].message.content or "").strip()
            try:
                part = json.loads(raw)
            except json.JSONDecodeError as e:
                raise HTTPException(
                    status_code=502,
                    detail=f"Model zwrócił nie-JSON (partia {bi + 1}/{n}): {e}: {raw[:200]}",
                ) from e
            if isinstance(part, dict):
                parsed_parts.append(part)

            # Kredyty = wyłącznie tokeny z resp.usage (to, co OpenAI faktycznie pobiera).
            usage = getattr(resp, "usage", None)
            pt, ct, cached, audio = tokens_from_usage(usage) if usage is not None else (0, 0, 0, 0.0)
            billing_events.append(
                await _bill_openai_response(
                    httpx_c,
                    resp,
                    endpoint=endpoint,
                    model=VISION_MODEL,
                    extra_credits=0,
                    extras={
                        "vision_batch": bi + 1,
                        "vision_batches": n,
                        "pages_in_batch": len(batch),
                        "pages_rendered": pages_rendered,
                        "page_from": start_page,
                        "page_to": end_page,
                        "prompt_tokens": pt,
                        "completion_tokens": ct,
                        "cached_tokens": cached,
                    },
                )
            )

    merge = merge_fn or (lambda parts: parts[0] if parts else {})
    merged = merge(parsed_parts) if parsed_parts else {}
    if not isinstance(merged, dict):
        merged = {}
    billing = merge_billing_events(billing_events)
    return merged, billing

__all__ = ['_images_from_upload', '_openai_vision_json_batches']
