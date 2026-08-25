"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `menu_scan_impl`."""
from __future__ import annotations

from fastapi import File
from fastapi import HTTPException
from fastapi import UploadFile
from http_ssl import httpx_verify as _httpx_verify
from ingredient_name_norm import apply_whole_product_names_to_dishes as _apply_whole_product_names_to_dishes
from menu_image_context_tags import attach_image_context_tags as _attach_image_context_tags
from openai import APIError
from openai import OpenAIError
from recipe_ingredient_units import apply_integer_quantities_to_dishes as _apply_integer_quantities_to_dishes
from recipe_ingredient_units import canonicalize_ingredient_units as _canonicalize_ingredient_units
from typing import Optional
from vision_batch_merge import merge_menu_vision_batches as _merge_menu_vision_batches
from vision_batch_merge import merge_recipe_ocr_batches as _merge_recipe_ocr_batches
import asyncio
import httpx
import json
from app_core import CHAT_MODEL, PDF_MAX_PAGES, _openai, get_account_key, require_tenant_account_key
from billing_credits import _bill_openai_response
from constants import _MENU_SCAN_JSON_SCHEMA, _MENU_SCAN_SYSTEM_PROMPT, _MENU_SUGGEST_BATCH_SIZE, _MENU_SUGGEST_BATCH_TIMEOUT_S, _MENU_SUGGEST_JSON_SCHEMA, _MENU_SUGGEST_SYSTEM_PROMPT, _RECIPE_OCR_JSON_SCHEMA
from models import MenuScanDish, MenuScanResponse, RecipeOcrResponse, SuggestRecipeRequest, SuggestRecipeResponse, SuggestedDishOut
from subscription_core import _guard_ai
from vision_ocr import _images_from_upload, _openai_vision_json_batches



# scan-expiration: backend/inventory_expiry_scan_routes.py (include_router)


async def _list_tenant_account_keys(client: httpx.AsyncClient) -> list[str]:
    from tenant_expiry_alerts import list_tenant_account_keys
    return await list_tenant_account_keys(client)


async def _run_expiry_alerts_for_tenant(
    httpx_c: httpx.AsyncClient,
    *,
    today,
    warn_until,
) -> tuple[list[dict], Optional[str]]:
    """Jeden tenant: partie kończące ważność + opcjonalne danie dnia + Expo Push."""
    from tenant_expiry_alerts import run_expiry_alerts_for_tenant

    async def _suggest(names: list[str]) -> Optional[str]:
        await _guard_ai(needs_credits=False)
        client = _openai()
        resp = await client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.4,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Jesteś szefem kuchni. Na podstawie produktów kończących ważność "
                        "zaproponuj jedno konkretne „Danie dnia” po polsku "
                        "(nazwa + 1 zdanie). Odpowiedz samym tekstem."
                    ),
                },
                {"role": "user", "content": f"Produkty do wykorzystania: {', '.join(names)}"},
            ],
        )
        return (resp.choices[0].message.content or "").strip() or None

    return await run_expiry_alerts_for_tenant(
        httpx_c,
        today=today,
        warn_until=warn_until,
        account_key=get_account_key(),
        suggest_dish_fn=_suggest,
    )


async def menu_scan(file: UploadFile = File(...)):
    """Skanuje wgrane menu (obraz lub PDF) modelem GPT-4o Vision i zwraca podgląd potraw.
    Nic nie zapisuje — użytkownik zatwierdza po edycji (potwierdzenie w /menu/confirm-scan)."""
    require_tenant_account_key()
    client = _openai()
    await _guard_ai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    image_uris, pages_meta = _images_from_upload(contents, file.content_type or "", file.filename or "")
    contents = b""

    data, billing = await _openai_vision_json_batches(
        client,
        image_uris=image_uris,
        system_prompt=_MENU_SCAN_SYSTEM_PROMPT,
        json_schema=_MENU_SCAN_JSON_SCHEMA,
        endpoint="/api/menu/scan",
        user_text=(
            "Wyodrębnij WSZYSTKIE potrawy z tego menu zgodnie ze schematem. "
            f"Strony {pages_meta.get('pages_rendered')}"
            f"{'/' + str(pages_meta.get('pages_total')) if pages_meta.get('truncated') else ''}."
        ),
        pages_meta=pages_meta,
        merge_fn=_merge_menu_vision_batches,
    )
    image_uris = []

    dishes_raw = data.get("dishes") or []
    dishes: list[MenuScanDish] = []
    for d in dishes_raw:
        try:
            dishes.append(MenuScanDish(**d))
        except Exception:
            continue

    warnings: list[str] = []
    if not dishes:
        warnings.append("Nie udało się rozpoznać żadnej potrawy na wgranym menu.")
    if pages_meta.get("truncated"):
        warnings.append(
            f"PDF ma {pages_meta.get('pages_total')} stron — przeanalizowano pierwsze "
            f"{pages_meta.get('pages_rendered')} (limit {PDF_MAX_PAGES})."
        )
    # Ujednolić jednostki: ten sam składnik = ta sama jednostka we wszystkich potrawach.
    _canonicalize_ingredient_units(dishes)
    _attach_image_context_tags(dishes)
    return MenuScanResponse(
        dishes=dishes, warnings=warnings,
        credits_deducted=int(billing.get("credits_deducted") or 0),
        credits_remaining=billing.get("credits_remaining"),
    )


async def recipe_ocr_text(file: UploadFile = File(...)):
    """Odczytuje tekst przepisu z zdjęcia notatek (odręczne lub drukowane)."""
    require_tenant_account_key()
    client = _openai()
    await _guard_ai()
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Pusty plik.")

    image_uris, pages_meta = _images_from_upload(
        contents, file.content_type or "", file.filename or "", max_pages=12,
    )
    contents = b""

    data, billing = await _openai_vision_json_batches(
        client,
        image_uris=image_uris,
        system_prompt=(
            "Jesteś asystentem kuchennym. Odczytujesz przepisy z notatek i zdjęć. "
            "Zwracasz wyłącznie JSON ze schematem."
        ),
        json_schema=_RECIPE_OCR_JSON_SCHEMA,
        endpoint="/api/recipes/ocr-text",
        user_text=(
            "Przeczytaj CAŁY tekst przepisu / receptury z tych stron notatek. "
            "Zachowaj kolejność kroków i ilości. Zwróć wyłącznie treść przepisu po polsku, "
            "bez komentarzy ani wstępów. Jeśli tekst jest nieczytelny — oddaj to, co da się odczytać."
        ),
        cont_text=(
            "Kontynuacja przepisu z kolejnych stron. Dopisz wyłącznie tekst z TYCH stron "
            "(kolejne kroki / składniki), bez powtarzania wcześniejszych."
        ),
        pages_meta=pages_meta,
        merge_fn=_merge_recipe_ocr_batches,
    )
    image_uris = []

    text = (data.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Nie udało się odczytać tekstu przepisu ze zdjęcia.")

    return RecipeOcrResponse(
        text=text,
        credits_deducted=int(billing.get("credits_deducted") or 0),
        credits_remaining=billing.get("credits_remaining"),
    )


async def menu_suggest_recipe(req: SuggestRecipeRequest):
    """Dla listy potraw AI proponuje brakujące składniki i/lub gramaturę.
    Dla każdej potrawy:
    - jeśli `ingredients` puste → proponuje pełny wzorcowy skład + gramatury,
    - jeśli `ingredients` niepuste, ale bez ilości LUB brak `portion_weight_value` →
      proponuje gramatury wzorcowe (nie zmienia nazw składników użytkownika).
    Zwraca WYŁĄCZNIE sugestie — decyduje frontend, czy je zastosować.

    Przetwarzanie partiami (max 4 dania / call OpenAI), żeby uniknąć timeoutów proxy Railway.
    """
    require_tenant_account_key()
    if not req.dishes:
        raise HTTPException(status_code=400, detail="Brak potraw do przetworzenia.")

    client = _openai()
    await _guard_ai()

    payload_dishes = [
        {
            "name": d.name,
            "category": d.category or "Inne",
            "has_ingredients": bool(d.ingredients),
            "ingredients": [
                {"name": i.name, "has_quantity": i.quantity is not None, "unit": i.unit or "g"}
                for i in d.ingredients
            ],
            "has_portion_weight": d.portion_weight_value is not None,
            "portion_weight_unit_hint": d.portion_weight_unit,
        }
        for d in req.dishes
    ]

    out: list[SuggestedDishOut] = []
    credits_deducted = 0
    credits_remaining = None

    async def _suggest_batch(batch: list[dict]) -> tuple[list[SuggestedDishOut], dict]:
        try:
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=CHAT_MODEL,
                    temperature=0.2,
                    messages=[
                        {"role": "system", "content": _MENU_SUGGEST_SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps({"dishes": batch}, ensure_ascii=False)},
                    ],
                    response_format={"type": "json_schema", "json_schema": _MENU_SUGGEST_JSON_SCHEMA},
                ),
                timeout=_MENU_SUGGEST_BATCH_TIMEOUT_S,
            )
        except asyncio.TimeoutError as e:
            raise HTTPException(
                status_code=504,
                detail=(
                    "Sugestie AI przekroczyły limit czasu. "
                    "Spróbuj ponownie lub uruchom sugestie dla mniejszej liczby potraw."
                ),
            ) from e
        except APIError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Serwis AI chwilowo niedostępny: {e.message}",
            ) from e
        except OpenAIError as e:  # pragma: no cover
            raise HTTPException(
                status_code=502,
                detail=f"Serwis AI chwilowo niedostępny: {e}",
            ) from e

        billing = {"credits_deducted": 0, "credits_remaining": None}
        async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
            billing = await _bill_openai_response(
                httpx_c, resp, endpoint="/api/menu/suggest-recipe", model=CHAT_MODEL,
                extras={"dishes_count": len(batch)},
            )

        raw = (resp.choices[0].message.content or "").strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=502,
                detail="Model AI zwrócił niepoprawną odpowiedź. Spróbuj ponownie.",
            ) from e

        batch_out: list[SuggestedDishOut] = []
        for d in data.get("dishes") or []:
            try:
                batch_out.append(SuggestedDishOut(**d))
            except Exception:
                continue
        return batch_out, billing

    for i in range(0, len(payload_dishes), _MENU_SUGGEST_BATCH_SIZE):
        batch = payload_dishes[i : i + _MENU_SUGGEST_BATCH_SIZE]
        batch_out, billing = await _suggest_batch(batch)
        out.extend(batch_out)
        credits_deducted += int(billing.get("credits_deducted") or 0)
        if billing.get("credits_remaining") is not None:
            credits_remaining = billing.get("credits_remaining")

    # Ujednolić jednostki: ten sam składnik = ta sama jednostka we wszystkich potrawach.
    _canonicalize_ingredient_units(out)
    # Części produktu (żółtko…) → cały produkt magazynowy (jajko).
    _apply_whole_product_names_to_dishes(out)
    # Ilości: zawsze całkowite ≥ 1 (bez 0.25 g pieprzu).
    _apply_integer_quantities_to_dishes(out)
    return SuggestRecipeResponse(
        dishes=out,
        credits_deducted=credits_deducted,
        credits_remaining=credits_remaining,
    )

__all__ = ['_list_tenant_account_keys', '_run_expiry_alerts_for_tenant', 'menu_scan', 'menu_suggest_recipe', 'recipe_ocr_text']
