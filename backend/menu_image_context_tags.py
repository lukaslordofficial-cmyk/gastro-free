"""
Heurystyczne tagi grafiki z nazwy dania (bez dodatkowego kosztu OpenAI).

Wydzielone z server.py (dekalog §I).
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Protocol


def norm_pl_tag(raw: str) -> str:
    s = (raw or "").lower()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def extract_image_context_tags(name: str) -> list[str]:
    """Heurystyczne tagi grafiki z nazwy dania."""
    n = norm_pl_tag(name)
    tags: list[str] = []
    rules = [
        (r"\bkaczk", ["kaczka", "drób", "mięso pieczone"]),
        (r"\b(kurczak|chicken|de volaille)", ["kurczak", "drób"]),
        (r"\bindyk", ["indyk", "drób"]),
        (r"\b(wolow|beef|stek|ribeye|tatar)", ["wołowina", "mięso"]),
        (r"\b(wieprz|schab|golonk|boczek|zeberk)", ["wieprzowina", "mięso"]),
        (r"\b(ryb|losos|dorsz|pstrag|tunczyk|fish)", ["ryba"]),
        (r"\b(wege|vegan|tofu|falafel)", ["wege"]),
        (r"\b(zupa|rosol|barszcz|zurek|gazpacho|ramen|pho)", ["zupa"]),
        (r"\bpomidor|tomato", ["pomidor", "czerwone"]),
        (r"\bburger", ["burger"]),
        (r"\bpizza", ["pizza"]),
        (r"\b(makaron|pasta|spaghetti)", ["makaron"]),
        (r"\bsalatk|salad", ["sałatka"]),
        (r"\b(udko|udo)\b", ["udo", "pieczeń"]),
        (r"\b(pieczon|roast|grill)", ["pieczeń", "mięso pieczone"]),
        (r"\bchrupiac|crispy", ["chrupiące"]),
        (r"\bjablk|apple", ["jabłko"]),
        (r"\bpekin|peking", ["kaczka", "azja"]),
        (r"\bsushi|nigiri|maki", ["sushi", "ryba"]),
        (r"\b(deser|ciasto|lody|tiramisu)", ["deser"]),
        (r"\b(lemoniad|lemonade)", ["lemoniada", "napój"]),
        (r"\b(sok|juice|smoothie|koktajl|cocktail)", ["napój"]),
    ]
    seen: set[str] = set()
    for pattern, add in rules:
        if re.search(pattern, n):
            for t in add:
                if t not in seen:
                    seen.add(t)
                    tags.append(t)
    return tags


class _DishWithTags(Protocol):
    name: str
    image_context_tags: list[str]


def attach_image_context_tags(dishes: list[Any]) -> None:
    for d in dishes:
        if getattr(d, "image_context_tags", None):
            continue
        d.image_context_tags = extract_image_context_tags(getattr(d, "name", "") or "")
