"""
Inspiracje Kulinarne — cache lokalny + generowanie przepisu AI.

Wydzielone z server.py. Cache jest na dysku Railway (oszczędza OpenAI),
klucz zawsze zawiera account_key — zero przecieku przepisów między tenantami.
Obrazki dań NIE idą przez ten endpoint (lokalne assety / Supabase Storage).
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional

import httpx
from fastapi import HTTPException
from openai import APIError, OpenAIError
from pydantic import BaseModel, Field

logger = logging.getLogger("gastro")

INSPIRATION_CACHE_FILE = Path(__file__).parent / ".inspiration_recipe_cache.json"

INSPIRATION_SYSTEM = (
    "You are a professional Head Chef and Food Technologist acting as an AI assistant "
    "for a culinary mobile application's \"Inspirations\" section. Your task is to generate "
    "a comprehensive, restaurant-quality recipe based ONLY on the Polish dish name provided "
    "by the user.\n\n"
    "CRITICAL RULES:\n"
    "1. Language: You must always respond in Polish.\n"
    "2. Output Format: You must return the data strictly as a valid JSON object. "
    "Do not include any markdown formatting (like ```json) in the raw API response.\n"
    "3. Scaling: Default measurements must be calculated for exactly 2 portions "
    "(except for shared platters/boards, which should be scaled for 4-6 portions). "
    "All ingredients must use strict metric units (g, ml, pcs, tbsp, tsp) as separate "
    "numeric values and text labels to allow frontend scaling. "
    "Use Polish unit labels: g, ml, szt, łyżeczka, łyżka.\n"
    "3b. QUANTITIES (CRITICAL): base_quantity MUST be whole integers ≥ 1. "
    "Never use fractions like 0.25. For spices/salt/pepper use at least 1–2 units "
    "PER PORTION (so for 2 portions: base_quantity ≥ 2–4).\n"
    "4. Tone: Impersonal verbs for steps (e.g., \"Pokroić\", \"Rozgrzać\")."
)

INSPIRATION_JSON_SCHEMA = {
    "name": "InspirationRecipe",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "dish_name",
            "prep_time_minutes",
            "difficulty",
            "default_portions",
            "short_teaser",
            "ingredients_sections",
            "steps",
            "chef_tip",
        ],
        "properties": {
            "dish_name": {"type": "string"},
            "prep_time_minutes": {"type": "integer"},
            "difficulty": {"type": "string", "enum": ["Łatwy", "Średni", "Trudny"]},
            "default_portions": {"type": "integer"},
            "short_teaser": {"type": "string"},
            "ingredients_sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["section_name", "ingredients"],
                    "properties": {
                        "section_name": {"type": "string"},
                        "ingredients": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "base_quantity", "unit"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "base_quantity": {"type": "number"},
                                    "unit": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            },
            "steps": {"type": "array", "items": {"type": "string"}},
            "chef_tip": {"type": "string"},
        },
    },
}


class InspirationRecipeRequest(BaseModel):
    dish_name: str
    slug: Optional[str] = None
    force_refresh: bool = False


class InspirationIngredient(BaseModel):
    name: str
    base_quantity: float
    unit: str


class InspirationIngredientSection(BaseModel):
    section_name: str
    ingredients: list[InspirationIngredient] = Field(default_factory=list)


class InspirationRecipeResponse(BaseModel):
    dish_name: str
    prep_time_minutes: int
    difficulty: str
    default_portions: int
    short_teaser: str
    ingredients_sections: list[InspirationIngredientSection]
    steps: list[str]
    chef_tip: str
    cached: bool = False
    slug: Optional[str] = None
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


def inspiration_cache_key(slug: str, dish_name: str, account_key: Optional[str] = None) -> str:
    raw = (slug or "").strip().lower() or (dish_name or "").strip().lower()
    base = re.sub(r"\s+", "_", raw)
    ak = (account_key or "default").strip() or "default"
    return f"{ak}::{base}"


def read_inspiration_cache() -> dict:
    try:
        if INSPIRATION_CACHE_FILE.exists():
            return json.loads(INSPIRATION_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def write_inspiration_cache(cache: dict) -> None:
    try:
        INSPIRATION_CACHE_FILE.write_text(
            json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8"
        )
    except Exception as e:
        logger.warning("inspiration cache write failed: %s", e)


def normalize_inspiration_quantities(recipe) -> None:
    """Inspiracje: base_quantity → całkowite; min. 1 jednostka na porcję."""
    portions = max(1, int(getattr(recipe, "default_portions", None) or 1))
    for sec in getattr(recipe, "ingredients_sections", None) or []:
        ings = getattr(sec, "ingredients", None) or []
        for ing in ings:
            try:
                base = float(getattr(ing, "base_quantity", 0) or 0)
            except (TypeError, ValueError):
                base = 0.0
            per = base / portions
            if per < 1:
                setattr(ing, "base_quantity", float(portions))
            else:
                setattr(ing, "base_quantity", float(max(1, int(round(base)))))


async def inspiration_recipe(req: InspirationRecipeRequest):
    """Pełny przepis JSON dla modułu Inspiracje — z cache po slug/nazwie + account_key."""
    from server import (
        INSPIRATIONS_MODEL,
        _bill_openai_response,
        _guard_ai,
        _httpx_verify,
        _openai,
        get_account_key,
        require_tenant_account_key,
    )

    require_tenant_account_key()
    dish_name = (req.dish_name or "").strip()
    if not dish_name:
        raise HTTPException(status_code=400, detail="Podaj nazwę potrawy.")
    slug = (req.slug or "").strip() or None
    key = inspiration_cache_key(slug or "", dish_name, get_account_key())

    if not req.force_refresh:
        cache = read_inspiration_cache()
        hit = cache.get(key)
        if isinstance(hit, dict) and hit.get("dish_name"):
            try:
                cached_recipe = InspirationRecipeResponse(
                    **{
                        **hit,
                        "cached": True,
                        "slug": slug,
                        "credits_deducted": 0,
                        "credits_remaining": None,
                    }
                )
                normalize_inspiration_quantities(cached_recipe)
                return cached_recipe
            except Exception:
                pass

    client = _openai()
    await _guard_ai()

    try:
        resp = await client.chat.completions.create(
            model=INSPIRATIONS_MODEL,
            temperature=0.35,
            messages=[
                {"role": "system", "content": INSPIRATION_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Wygeneruj przepis dla potrawy: {dish_name}. "
                        "Zwróć wyłącznie JSON zgodny ze schematem."
                    ),
                },
            ],
            response_format={"type": "json_schema", "json_schema": INSPIRATION_JSON_SCHEMA},
        )
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"OpenAI: {e.message}") from e
    except OpenAIError as e:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"OpenAI: {e}") from e

    billing = {"credits_deducted": 0, "credits_remaining": None}
    async with httpx.AsyncClient(timeout=30.0, verify=_httpx_verify()) as httpx_c:
        billing = await _bill_openai_response(
            httpx_c,
            resp,
            endpoint="/api/inspirations/recipe",
            model=INSPIRATIONS_MODEL,
            extras={"dish_name": dish_name, "slug": slug},
        )

    raw = (resp.choices[0].message.content or "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502, detail=f"Model zwrócił nie-JSON: {e}: {raw[:200]}"
        ) from e

    try:
        recipe = InspirationRecipeResponse(
            **data,
            cached=False,
            slug=slug,
            credits_deducted=int(billing.get("credits_deducted") or 0),
            credits_remaining=billing.get("credits_remaining"),
        )
    except Exception as e:
        raise HTTPException(
            status_code=502, detail=f"Niepoprawna struktura przepisu: {e}"
        ) from e

    normalize_inspiration_quantities(recipe)

    cache = read_inspiration_cache()
    cache[key] = recipe.model_dump(exclude={"cached", "credits_deducted", "credits_remaining"})
    write_inspiration_cache(cache)
    return recipe
