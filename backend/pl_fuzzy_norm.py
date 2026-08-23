"""
Normalizacja PL + food_match_key (fuzzy produktów/faktur).
Wydzielone z server.py (dekalog §I).
"""
from __future__ import annotations

import re
import unicodedata

FUZZY_MATCH_THRESHOLD = 68

UNIT_RE = re.compile(
    r"\b\d+[.,]?\d*\s*"
    r"(?:kg|g|mg|dag|l|ml|cl|dl|szt\.?|opak\.?|op\.?|kartonow?y?|karton|"
    r"sztuk[a-zi]*|opakowa[a-z]*)\b",
    re.IGNORECASE,
)
NOISE_RE = re.compile(r"[^a-z0-9\s]")

TOKEN_SYNONYMS = {
    "filet": "piers", "filety": "piers", "filetem": "piers", "filetu": "piers",
    "piersi": "piers", "piersiami": "piers", "piers": "piers",
    "kurczaka": "kurczak", "kurczakiem": "kurczak", "kurczaki": "kurczak",
    "kurczakowi": "kurczak", "drobiowy": "kurczak", "drobiowa": "kurczak", "drobiowe": "kurczak",
    "indyka": "indyk", "indykiem": "indyk",
    "wolowego": "wolow", "wolowa": "wolow", "wolowy": "wolow", "wolowe": "wolow",
    "wolowina": "wolow", "wolowiny": "wolow",
    "wieprzowego": "wieprz", "wieprzowa": "wieprz", "wieprzowy": "wieprz", "wieprzowina": "wieprz",
    "oliwek": "oliw", "oliwa": "oliw", "oliwy": "oliw", "oliwie": "oliw", "olive": "oliw",
    "cukru": "cukier", "cukrem": "cukier",
    "soli": "sol", "sola": "sol",
    "pieprzu": "pieprz",
    "czosnku": "czosnek", "czosnkiem": "czosnek",
    "cebuli": "cebula",
    "pomidorow": "pomidor", "pomidory": "pomidor", "pomidora": "pomidor",
    "ziemniakow": "ziemniak", "ziemniaki": "ziemniak",
    "majonezu": "majonez", "musztardy": "musztarda",
    "smietany": "smietana", "mleka": "mleko",
    "masla": "maslo", "maslem": "maslo",
    "sera": "ser", "serem": "ser",
    "mozarella": "mozzarella", "mozzarelli": "mozzarella", "mozarell": "mozzarella",
    "mozzarella": "mozzarella", "mozz": "mozzarella", "buffalo": "buffalo",
    "jajka": "jajko", "jajek": "jajko", "jaja": "jajko",
    "koper": "koper", "koperek": "koper", "koperki": "koper", "kopru": "koper", "koprem": "koper",
    "marchewka": "marchew", "marchewki": "marchew", "marchewek": "marchew", "marchew": "marchew",
}


def strip_accents(text: str) -> str:
    """Usuwa polskie znaki diakrytyczne: ą→a, ć→c, ł→l, ó→o itd."""
    if not text:
        return ""
    text = text.replace("ł", "l").replace("Ł", "L")
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def canon_token(t: str) -> str:
    """Lekki stem + synonimy kulinarne (filet↔pierś, kurczaka→kurczak)."""
    if t in TOKEN_SYNONYMS:
        return TOKEN_SYNONYMS[t]
    for suf in ("ami", "ach", "owi", "iem", "ow", "om", "em", "ie"):
        if len(t) > len(suf) + 3 and t.endswith(suf):
            stem = t[: -len(suf)]
            return TOKEN_SYNONYMS.get(stem, stem)
    if len(t) >= 6 and t[-1] in "ayiue":
        stem = t[:-1]
        return TOKEN_SYNONYMS.get(stem, stem)
    return t


def norm_pl(text: str) -> str:
    """Pełna normalizacja PL dla fuzzy matchingu."""
    if not text:
        return ""
    s = strip_accents(str(text)).lower()
    s = UNIT_RE.sub(" ", s)
    s = NOISE_RE.sub(" ", s)
    tokens = [t for t in s.split() if len(t) >= 2]
    stop = {
        "do", "od", "na", "za", "ze", "we", "po", "pod", "nad", "przy",
        "bez", "dla", "oraz", "lub", "albo", "a", "i", "z", "w",
    }
    brands = {
        "sokolow", "sokolów", "animex", "morliny", "berlinki", "henkel",
        "premium", "bio", "eko", "organic", "light", "classic", "extra",
        "select", "selection", "gourmet", "fresh", "swieze", "swiezy",
        "opak", "opakowanie", "promocja", "virgin", "extra",
        "rolka", "rolki", "rolke", "kostka", "kostki", "blok", "bloki",
        "plastry", "plaster", "krazek", "krazki", "kreg", "kregi",
        "tacka", "tacki", "luz", "luzem", "porcja", "porcje", "paczka",
        "paczk", "szt", "sztuka", "sztuki",
    }
    tokens = [
        canon_token(t) for t in tokens
        if t not in stop and t not in brands
    ]
    tokens = [t for t in tokens if len(t) >= 2 and t not in stop]
    return " ".join(sorted(set(tokens)))


def food_match_key(text: str) -> str:
    """Klucz deduplikacji: pomidor / pomidory → ten sam stem. Zachowuje liczby (18% ≠ 30%)."""
    s = norm_pl(text)
    raw = strip_accents(str(text or "")).lower()
    for m in re.findall(r"\d+[.,]?\d*", raw):
        num = m.replace(",", ".")
        if num and num not in s:
            s = f"{s} {num}".strip()
    stop = {"z", "ze", "do", "w", "we", "na", "i", "oraz", "bez", "typ", "luz"}
    out: list[str] = []
    for t in s.split():
        if t in stop:
            continue
        if t.isdigit() or re.match(r"^\d+[.]?\d*$", t):
            out.append(t)
            continue
        base = t
        for suf in ("ami", "ach", "owie", "owi", "ow", "om"):
            if len(t) >= 5 and t.endswith(suf):
                base = t[: -len(suf)]
                break
        else:
            for suf in ("y", "i", "e", "a"):
                if len(t) >= 6 and t.endswith(suf):
                    base = t[: -len(suf)]
                    break
        if len(base) >= 3:
            out.append(base)
    return " ".join(sorted(set(out)))
