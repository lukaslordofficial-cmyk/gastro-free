"""
Normalizacja nazw składników (część→całość, plural→singular, combo).
Wydzielone z server.py (dekalog §I).
"""
from __future__ import annotations

def norm_name(s: str) -> str:
    return " ".join((s or "").lower().split())


# Części produktu → cały produkt (magazyn/receptura kupuje całość, nie części).
PART_TO_WHOLE: dict[str, str] = {
    # jajko
    "zoltko": "jajko", "zoltka": "jajko", "zoltek": "jajko",
    "zoltkajaja": "jajko", "zoltkojaja": "jajko", "zoltkojajka": "jajko",
    "zoltkajajka": "jajko", "zoltkojaj": "jajko", "zoltkajaj": "jajko",
    "bialko": "jajko", "bialka": "jajko",
    "bialkojaja": "jajko", "bialkojajka": "jajko", "bialkojaj": "jajko",
    "eggyolk": "jajko", "eggwhite": "jajko", "yolk": "jajko",
    "melanz": "jajko", "melanz jajeczny": "jajko",
    # cytrusy / owoce
    "skorka cytryny": "cytryna", "skorkacytryny": "cytryna",
    "sok z cytryny": "cytryna", "sokzcytryny": "cytryna", "sok cytrynowy": "cytryna",
    "skorka pomaranczy": "pomarańcza", "skorkapomaranczy": "pomarańcza",
    "sok z pomaranczy": "pomarańcza", "skorka limonki": "limonka",
    "sok z limonki": "limonka", "skorka limetki": "limonka",
    # warzywa / zioła
    "lisc pietruszki": "pietruszka", "natka pietruszki": "pietruszka",
    "korzen pietruszki": "pietruszka", "lisc selera": "seler",
    "zabek czosnku": "czosnek", "zabki czosnku": "czosnek",
    # mięso / inne
    "skorka kurczaka": "kurczak", "kosci kurczaka": "kurczak",
    "skorka indyka": "indyk", "miazsz awokado": "awokado",
}


def strip_diacritics_pl(s: str) -> str:
    table = str.maketrans({
        "ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n",
        "ó": "o", "ś": "s", "ź": "z", "ż": "z",
    })
    return (s or "").lower().translate(table)


def whole_product_name(name: str) -> str:
    """Mapuje część produktu (np. żółtko) na cały produkt magazynowy (jajko)."""
    raw = (name or "").strip()
    if not raw:
        return raw
    key = strip_diacritics_pl(norm_name(raw))
    key_compact = key.replace(" ", "")
    mapped = PART_TO_WHOLE.get(key) or PART_TO_WHOLE.get(key_compact)
    if mapped:
        return mapped
    # „żółtko jaja / żółtko z jajka / białko jajka” itp.
    if "zoltko" in key_compact or key_compact.startswith("bialkojaj") or (
        "bialko" in key_compact and "jaj" in key_compact
    ):
        return "jajko"
    if key_compact.startswith("skorkacytr") or key_compact.startswith("sokzcytr"):
        return "cytryna"
    if key_compact.startswith("skorkapomar") or key_compact.startswith("sokzpomar"):
        return "pomarańcza"
    return raw


# Plural / stem-ish → singular display (pomidory→pomidor). Used at recipe + inventory write.
PLURAL_TO_SINGULAR: dict[str, str] = {
    "pomidory": "pomidor", "pomidorow": "pomidor", "pomidora": "pomidor",
    "jajka": "jajko", "jajek": "jajko", "jaja": "jajko",
    "ziemniaki": "ziemniak", "ziemniakow": "ziemniak",
    "marchewki": "marchew", "marchewek": "marchew",
    "ogorki": "ogórek", "ogorkow": "ogórek",
    "papryki": "papryka", "cukinie": "cukinia", "baklazany": "bakłażan",
    "pieczarki": "pieczarka", "pieczarek": "pieczarka",
    "grzyby": "grzyb", "grzybow": "grzyb",
    "borowiki": "borowik", "borowikow": "borowik",
    "boczniaki": "boczniak", "boczniakow": "boczniak",
    "cebule": "cebula", "cytryny": "cytryna", "limonki": "limonka",
    "jablka": "jabłko", "jablek": "jabłko", "banany": "banan", "bananow": "banan",
    "truskawki": "truskawka", "truskawek": "truskawka",
    "maliny": "malina", "orzechy": "orzech", "orzechow": "orzech",
    "migdaly": "migdał", "oliwki": "oliwka", "oliwek": "oliwka",
    "bulki": "bułka", "bulek": "bułka", "chleby": "chleb",
    "kielbasy": "kiełbasa", "kielbas": "kiełbasa",
    "boczki": "boczek", "filety": "filet", "piersi": "pierś",
    "steki": "stek", "kotlety": "kotlet", "kotletow": "kotlet",
    "krewetki": "krewetka", "krewetek": "krewetka",
}


# Dish-like names that must NOT become warehouse SKUs — rewrite to buyable ingredient.
DISH_LIKE_TO_INGREDIENT: dict[str, str] = {
    "risotto": "ryż arborio",
    "risotto grzybowe": "ryż arborio",
    "risotto z grzybami": "ryż arborio",
    "paella": "ryż bomba",
    "couscous": "kuskus",
    "kuskus": "kuskus",
    "polenta": "kasza kukurydziana",
    "gnocchi": "gnocchi (półprodukt)",
    "nalesniki": "mąka pszenna",
    "naleśniki": "mąka pszenna",
}


def normalize_ingredient_name(name: str) -> str:
    """Kanoniczna nazwa składnika: całe produkty + singular PL (pomidory→pomidor)."""
    raw = whole_product_name((name or "").strip())
    if not raw:
        return raw
    key = strip_diacritics_pl(norm_name(raw))
    if key in PLURAL_TO_SINGULAR:
        return PLURAL_TO_SINGULAR[key]
    # Ostatni token liczby mnogiej (np. „pomidory cherry” → „pomidor cherry”)
    parts = key.split()
    if len(parts) >= 2 and parts[-1] in PLURAL_TO_SINGULAR:
        last = PLURAL_TO_SINGULAR[parts[-1]]
        orig_parts = raw.split()
        if orig_parts:
            orig_parts[-1] = last
            return " ".join(orig_parts)
    # Dish-like → buyable ingredient
    if key in DISH_LIKE_TO_INGREDIENT:
        return DISH_LIKE_TO_INGREDIENT[key]
    for dish_key, ing in DISH_LIKE_TO_INGREDIENT.items():
        if key == dish_key or key.startswith(dish_key + " "):
            return ing
    return raw


def apply_normalize_ingredient_names_to_dishes(dishes: list) -> None:
    """In-place: normalize ingredient names (singular + dish→SKU rewrite)."""
    for d in dishes or []:
        ings = getattr(d, "suggested_ingredients", None)
        if ings is None and isinstance(d, dict):
            ings = d.get("suggested_ingredients") or d.get("ingredients")
        if not ings:
            ings = getattr(d, "ingredients", None)
        if not ings:
            continue
        for ing in ings:
            if hasattr(ing, "name"):
                ing.name = normalize_ingredient_name(getattr(ing, "name", "") or "")
            elif isinstance(ing, dict) and "name" in ing:
                ing["name"] = normalize_ingredient_name(ing.get("name") or "")


def is_combo_polprodukt_name(name: str) -> bool:
    """Wykrywa półprodukt combo (nie kupowany jako jeden SKU).

    Reguły (menu scan → magazyn):
    1. Mix / mieszanka / zestaw warzyw lub sałat bez jednego buyable SKU.
    2. Przetworzone/grillowane/pieczone/smażone mieszanki (np. „warzywa grillowane”).
    3. Domowe frytki / pieczone dodatki złożone z wielu składników.
    4. Nazwy z „mix”, „mixem”, „assorted”, „selection” + warzywa/mięsa.
    NIE oznacza: pojedynczego surowca (pomidor, boczek, ryż).
    """
    n = strip_diacritics_pl(norm_name(name or ""))
    if not n or len(n) < 4:
        return False
    # Jawne combo / półprodukt
    if any(k in n for k in (
        "polprodukt", "pol-produkt", "combo", "mise en place", "prep ",
    )):
        return True
    # Mix / mieszanka
    if any(k in n for k in ("mieszanka", "mix warzyw", "mix salat", "mix salat", "vegetable mix", "assorted")):
        return True
    if n.startswith("mix ") or " mix" in n:
        if any(k in n for k in ("warzyw", "salat", "mies", "grzyb", "owoc")):
            return True
    # Przetworzone mieszanki (grill / piecz / smaż) — typowo nie jeden SKU
    processed = any(k in n for k in (
        "grillowan", "pieczon", "smazo", "smazon", "duszone", "gotowane",
        "blanszowan", "marynowan", "glazurowan",
    ))
    multi = any(k in n for k in (
        "warzyw", "salat", "grzyb", "owoc", "mies", "dodatk", "zestaw",
    ))
    if processed and multi:
        return True
    # Klasyczne przykłady
    if n in (
        "warzywa grillowane", "warzywa pieczone", "warzywa duszone",
        "warzywa smażone", "warzywa smazone", "grilled vegetables",
        "pieczone warzywa", "grillowane warzywa", "smażone warzywa",
        "smazone warzywa", "mix sałat", "mix salat", "sałatka mieszana",
        "salatka mieszana",
    ):
        return True
    return False


# Propozycje składników combo (gdy wykryto półprodukt bez receptury).
COMBO_DEFAULT_INGREDIENTS: dict[str, list[str]] = {
    "warzywa grillowane": ["cukinia", "papryka", "bakłażan", "olej rzepakowy"],
    "warzywa pieczone": ["cukinia", "papryka", "bakłażan", "olej rzepakowy"],
    "pieczone warzywa": ["cukinia", "papryka", "bakłażan", "olej rzepakowy"],
    "grillowane warzywa": ["cukinia", "papryka", "bakłażan", "olej rzepakowy"],
    "mix sałat": ["sałata rzymska", "rukola", "roszponka"],
    "mix salat": ["sałata rzymska", "rukola", "roszponka"],
}


def combo_default_ingredients(name: str) -> list[str]:
    key = strip_diacritics_pl(norm_name(name or ""))
    if key in COMBO_DEFAULT_INGREDIENTS:
        return list(COMBO_DEFAULT_INGREDIENTS[key])
    for k, ings in COMBO_DEFAULT_INGREDIENTS.items():
        if k in key or key in k:
            return list(ings)
    if "warzyw" in key and any(p in key for p in ("grill", "piecz", "smaz", "smaż")):
        return ["cukinia", "papryka", "bakłażan", "olej rzepakowy"]
    return []


def apply_whole_product_names_to_dishes(dishes: list) -> None:
    """In-place: części → całe produkty + singular PL (pomidory→pomidor)."""
    apply_normalize_ingredient_names_to_dishes(dishes)


