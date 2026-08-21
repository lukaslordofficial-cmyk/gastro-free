"""
POST /api/voice/transcribe — Whisper STT (wydzielone z server.py).
"""
from __future__ import annotations

import io
from typing import Optional

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from openai import APIError, OpenAIError
from pydantic import BaseModel

from http_ssl import httpx_verify

router = APIRouter(tags=["voice-transcribe"])


class TranscribeResponse(BaseModel):
    text: str
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


@router.post("/api/voice/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...), language: str = Form("pl")):
    from server import STT_MODEL, _bill_openai_response, _guard_ai, _openai

    client = _openai()
    await _guard_ai()
    contents = await audio.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Puste nagranie audio.")

    filename = audio.filename or "audio.webm"
    if "." not in filename:
        ct = (audio.content_type or "").lower()
        ext = (
            "webm"
            if "webm" in ct
            else "wav"
            if "wav" in ct
            else "mp3"
            if ("mpeg" in ct or "mp3" in ct)
            else "m4a"
            if ("m4a" in ct or "mp4" in ct or "aac" in ct)
            else "webm"
        )
        filename = f"{filename}.{ext}"

    buf = io.BytesIO(contents)
    buf.name = filename

    try:
        resp = await client.audio.transcriptions.create(
            model=STT_MODEL,
            file=buf,
            language=language or "pl",
            prompt=(
                "Kontekst: restauracja / gastronomia. Raportowanie strat magazynowych, "
                "dodawanie kosztów, przychodów, produktów magazynowych, dań z menu, "
                "dostawców. Ilości w kg, litrach, sztukach. Ceny w PLN."
            ),
        )
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"Whisper API: {e.message}") from e
    except OpenAIError as e:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"Whisper: {e}") from e

    billing = {"credits_deducted": 0, "credits_remaining": None}
    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as httpx_c:
        billing = await _bill_openai_response(
            httpx_c,
            resp,
            endpoint="/api/voice/transcribe",
            model=STT_MODEL,
            extras={"filename": filename},
        )

    return TranscribeResponse(
        text=(getattr(resp, "text", "") or "").strip(),
        credits_deducted=int(billing.get("credits_deducted") or 0),
        credits_remaining=billing.get("credits_remaining"),
    )
