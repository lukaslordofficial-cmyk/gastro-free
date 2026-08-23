"""
Heurystyka kategorii magazynu (słowa kluczowe, bez LLM).
Wydzielone z server.py (dekalog §I).
"""
from __future__ import annotations

from typing import Callable, Optional

from pl_fuzzy_norm import food_match_key, norm_pl
from rapidfuzz import fuzz

# Dopasowanie tokenowe (nie substring) — „gin” NIE łapie się w „virgin”.
CAT_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("Oleje i tłuszcze", (
        "oliwa", "oliw", "olive", "olej", "oleju", "olejem", "rzepak", "slonecznik",
        "smalec", "tluszcz", "frytur", "ghee", "klarowan", "oil",
    )),
    ("Warzywa i owoce", (
        "pomidor", "cebula", "czosnek", "salat", "ogorek", "baklazan", "jabl", "banan",
        "cytryn", "marchew", "ziemniak", "papryk", "brokul", "kalafior", "burak", "kapust",
        "szpinak", "awokado", "grzyb", "pieczark", "owoc", "warzyw", "por", "seler", "pietruszk",
        "koper", "koperek", "bazyl", "natk", "rzodkiew", "cukini", "dyni", "gruszk", "truskawk", "malin",
        "borowk", "jagod", "winogron", "arbuz", "melon", "ananas", "mango", "kiwi", "batat",
        "bob", "fasol", "groch", "groszek", "kalarep", "bruksel",
    )),
    ("Nabiał", (
        "mleko", "ser", "smietan", "jogurt", "maslo", "twarog", "mozarella", "mozzarella",
        "parmezan", "jajk", "jajec", "kefir", "maslank", "ricotta", "feta",
        "goud", "cheddar", "camembert",
    )),
    ("Mięso i wędliny", (
        "kurczak", "wolow", "wieprz", "indyk", "schab", "karkow", "wedlin", "boczek", "kielbas",
        "szynk", "filet", "udziec", "mieso", "wolovina", "kaczka", "ges", "baranin",
        "cielecin", "mielon", "parowk", "kabanos", "salami", "prosciutto",
    )),
    ("Ryby i owoce morza", (
        "ryba", "ryby", "losos", "dorsz", "krewet", "tuna", "tunczyk", "sledz", "makrel",
        "kalmar", "osmiornic", "malz", "krewetki", "owoc morza", "mintaj", "pstrag",
    )),
    ("Pieczywo", (
        "chleb", "bulka", "bagiet", "ciabatta", "tortilla", "wrap", "pieczyw", "croissant",
        "rogal", "focacci", "pita",
    )),
    ("Przyprawy", (
        "przypraw", "pieprz", "papryka mielona", "curry", "oregano", "tymianek", "kminek",
        "cynamon", "kurkum", "chili", "przyprawa", "ziola", "lisc laurowy",
    )),
    ("Wywary i sosy", (
        "bulion", "wywar", "fond", "sos ", "sosy", "demi-glace", "demi glace", "passata",
        "koncentrat pomidor", "musztard", "ketchup", "majonez",
    )),
    ("Alkohole", (
        "wino", "piwo", "wodka", "whisky", "whiskey", "rum", "gin", "likier", "prosecco",
        "szampan", "cydr", "aperol", "campari", "alkohol", "tequila", "brandy", "koniak",
        "cognac", "wermut", "porto", "martini",
    )),
    ("Napoje", (
        "sok", "woda", "cola", "napoj", "kawa", "herbata", "syrop", "tonik", "lemoniad",
        "nektar", "energy", "izoton",
    )),
    ("Mrożonki", (
        "mrozon", "frozen", "lody", "mrozonka", "mrozone", "mrozony",
    )),
    ("Chemia i czystość", (
        "detergent", "plyn do naczy", "plyn do podlog", "mydlo", "papier toalet", "recznik papier",
        "folia spozyw", "worki na smieci", "dezynfek", "chlor", "wybielacz", "chem",
    )),
    ("Opakowania", (
        "pojemnik", "tacka", "pudelek", "pudelko", "opakowan", "kubek", "pokrywk", "slomk",
        "serwetk", "talerz jednoraz", "sztucce",
    )),
    ("Suchy magazyn", (
        "maka", "ryz", "makaron", "cukier", "sol", "ocet", "konserw", "fasola such",
        "soczewic", "kasza", "platki", "drozdze", "proszek do pieczenia", "skrobia",
        "pasztet", "cukier puder", "maka pszen",
    )),
]


def norm(s: str) -> str:
    return " ".join((s or "").lower().split())


def keyword_token_hit(word: str, key: str) -> bool:
    """Tokenowe dopasowanie słowa kluczowego (nie substring w środku tokenu)."""
    w = (word or "").strip().lower()
    if not w or not key:
        return False
    if " " in w:
        return f" {w} " in f" {key} " or key.startswith(w) or key.endswith(w)
    for t in key.split():
        if t == w:
            return True
        if len(w) >= 4 and t.startswith(w):
            return True
    return False


def _fuzzy_pick_category(wanted: str, user_names: list[str], threshold: int = 70) -> Optional[str]:
    if not wanted or not user_names:
        return None
    q = norm_pl(wanted)
    best_name: Optional[str] = None
    best_score = 0.0
    for un in user_names:
        cand = norm_pl(un)
        if not cand:
            continue
        s = max(float(fuzz.token_set_ratio(q, cand)), float(fuzz.partial_ratio(q, cand)))
        if s > best_score:
            best_score = s
            best_name = un
    if best_score >= threshold and best_name:
        return best_name
    return None


def guess_category_free(
    product_name: str,
    *,
    ai_category: Optional[str] = None,
    user_categories: Optional[list[dict]] = None,
    neighbor_category: Optional[str] = None,
    resolve_by_fuzzy: Optional[Callable] = None,
) -> str:
    """Bezpłatne przypisanie kategorii: słowa kluczowe + kategorie użytkownika + AI hint."""
    user_cats = user_categories or []
    user_names = [(c.get("name") or "").strip() for c in user_cats if (c.get("name") or "").strip()]

    def _map_to_user(wanted: str) -> str:
        if not wanted:
            return "Inne"
        if not user_names:
            return wanted
        for un in user_names:
            if norm(un) == norm(wanted) or norm_pl(un) == norm_pl(wanted):
                return un
        if resolve_by_fuzzy is not None:
            hit, _score = resolve_by_fuzzy(
                wanted, [{"name": n} for n in user_names], key="name", threshold=70,
            )
            if hit:
                return hit["name"]
        else:
            picked = _fuzzy_pick_category(wanted, user_names, threshold=70)
            if picked:
                return picked
        wn = norm_pl(wanted)
        for un in user_names:
            unp = norm_pl(un)
            if wn and unp and (wn in unp or unp in wn):
                return un
        return wanted if wanted != "Inne" else "Inne"

    if neighbor_category and neighbor_category.strip() and norm(neighbor_category) != "inne":
        return _map_to_user(neighbor_category.strip())

    key = food_match_key(product_name) + " " + norm_pl(product_name)
    best_cat = None
    best_score = 0
    for cat_label, words in CAT_KEYWORDS:
        hits = [(w, len(w)) for w in words if keyword_token_hit(w, key)]
        if not hits:
            continue
        score = len(hits) * 10 + max(L for _, L in hits)
        if score > best_score:
            best_score = score
            best_cat = cat_label
    if best_cat and best_score > 0:
        return _map_to_user(best_cat)

    ai = (ai_category or "").strip()
    if ai and norm(ai) != "inne":
        oilish = any(keyword_token_hit(w, key) for w in (
            "oliwa", "oliw", "olive", "olej", "oil", "smalec", "frytur", "ghee",
        ))
        if oilish and norm_pl(ai) == "alkohole":
            return _map_to_user("Oleje i tłuszcze")
        return _map_to_user(ai)

    return _map_to_user("Inne")


def expiry_status(iso_date: str) -> str:
    from datetime import date as _date
    try:
        exp = _date.fromisoformat(iso_date[:10])
    except ValueError:
        return "warning"
    today = _date.today()
    delta = (exp - today).days
    if delta < 0:
        return "expired"
    if delta <= 7:
        return "warning"
    return "fresh"
