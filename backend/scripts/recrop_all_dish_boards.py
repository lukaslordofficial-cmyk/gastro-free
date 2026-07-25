#!/usr/bin/env python3
"""Przetnij wszystkie znane plansze dań na nowo (overlap + fit na czarnym)."""
from __future__ import annotations

import os
import re
import shutil
import tempfile
from pathlib import Path

from PIL import Image

# import lokalnego skryptu
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from crop_product_sheet import crop_sheet  # noqa: E402

ASSETS = Path(r"C:/Users/NOWYUY~1/.cursor/projects/c-Users-Nowy-u-ytkownik-Desktop-gastromanager-15/assets")
DISHES = Path(r"C:/Users/NOWYUY~1/Desktop/gastromanager 15/Gastro-Manager-fixed/frontend/assets/premium/dishes")

# (folder, prefix, name_substrings) — pierwszy istniejący plik wygrywa
BOARDS: list[tuple[str, str, list[str]]] = [
    ("fish", "fish", ["dania_rybne"]),
    ("vegan", "vegan", ["49_nowe_wege", "18_23_34-2d20", "18_23_34-35153"]),
    ("breakfast", "breakfast", ["48_sniadania", "19_11_41"]),
    ("soups_pl", "soup_pl", ["52_poprawione_zupy", "1_zupy"]),
    ("soups_asia", "soup_asia", ["2_zupy", "zupy_orientaln"]),
    ("soups_polish", "soup_pl_classic", ["46_zupy_polskie"]),
    ("burgers", "burger", ["burgery_i_sandwiche", "burgery"]),
    ("street", "street", ["street_food", "4_street"]),
    ("starters", "starter", ["51_przystawki", "5_przystawki", "przystawki-0622"]),
    ("salads", "salad", ["sa__tki", "salatki", "sałatki"]),
    ("sides", "side", ["sur_wki", "surowki", "8_sur"]),
    ("kebabs", "kebab", ["kebab"]),
    ("dinners", "dinner", ["10_obiady", "obiady"]),
    ("dumplings", "dumpling", ["11_m_czne", "m_czne", "pierogi"]),
    ("pizzas", "pizza", ["12_pizze", "pizze"]),
    ("pastas", "pasta", ["13_makarony", "makarony"]),
    ("bbq", "bbq", ["14_mi_sa", "miesa", "mi_sa"]),
    ("asian", "asian", ["16_azjatycka", "azjatycka"]),
    ("indian", "indian", ["17_kuchnia_indyjska", "indyjska"]),
    ("mexican", "mexican", ["18_dania_meksyka", "meksyka"]),
    ("mediterranean", "mediterranean", ["srodziem", "r_dziem", "śródziem"]),
    ("caucasian", "caucasian", ["50_nowa_gruzinska", "gruzin", "kaukask"]),
    ("cakes", "cake", ["25_ciasta", "ciasta"]),
    ("desserts_cups", "dessert_cup", ["26_desery", "desery_w_kubkach"]),
    ("ice_cream", "ice", ["27_lody", "lody"]),
    ("pancakes", "pancake", ["28_pancake", "nalesniki", "naleśniki"]),
    ("french_desserts", "french", ["29_francusk", "francuskei_desery", "francuskie"]),
    ("pastries", "pastry", ["30_drozdzowki", "drozdzowki", "drożdżówki"]),
    ("coffees", "coffee", ["31_kawy", "kawy"]),
    ("teas", "tea", ["32_herbaty", "herbaty"]),
    ("lemonades", "lemonade", ["33_lemoniady", "lemoniady"]),
    ("juices", "juice", ["34_soki", "soki_smoothie", "smoothie"]),
    ("cocktails", "cocktail", ["35_drinki", "drinki"]),
    ("beers", "beer", ["36_piwa", "piwa"]),
    ("wines", "wine", ["37_wina", "wina"]),
    ("spirits", "spirit", ["38_driny", "driny", "alkohole"]),
    ("energy_drinks", "energy", ["39_energetyk", "energetyk_ii"]),
    ("catering", "catering", ["40_catering", "catering-"]),
    ("sauces", "sauce", ["45_sosy", "41_sosy", "sosy_i_dipy", "dipy"]),
    ("roasts", "roast", ["42_pieczenie", "pieczenie_i_miesa"]),
    ("breads", "bread", ["43_bagiet", "bagiety", "pieczywo"]),
    ("polish", "polish", ["44_polskie", "polskie"]),
    ("apps", "app", ["fine_app", "apps_", "przystawki_fine"]),
    ("sushi", "sushi", ["sushi", "nigiri", "15_"]),
]


def find_board(keys: list[str]) -> Path | None:
    try:
        names = os.listdir(ASSETS)
    except OSError:
        return None
    for key in keys:
        key_l = key.lower()
        for name in names:
            if key_l in name.lower() and Path(name).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                p = ASSETS / name
                try:
                    if p.is_file() and p.stat().st_size > 50_000:
                        return p
                except OSError:
                    continue
    return None


def existing_stems(folder: Path, prefix: str) -> list[str] | None:
    """Zachowaj nazwy plików (fish_01.webp …) jeśli już są."""
    files = sorted(folder.glob(f"{prefix}_*.webp"))
    if len(files) == 25:
        return [f.stem for f in files]
    files = sorted(folder.glob("*.webp"))
    if len(files) == 25:
        return [f.stem for f in files]
    return None


def main() -> None:
    tmp_root = Path(tempfile.mkdtemp(prefix="dish_recrop_"))
    print("tmp", tmp_root)
    ok = 0
    missing = []
    for folder, prefix, keys in BOARDS:
        src = find_board(keys)
        if not src:
            missing.append(folder)
            print(f"SKIP {folder}: brak planszy ({keys})")
            continue
        out = DISHES / folder
        out.mkdir(parents=True, exist_ok=True)
        names = existing_stems(out, prefix)
        # kopiuj przez short path / temp (unicode)
        local = tmp_root / f"{folder}_board{src.suffix}"
        shutil.copy2(src, local)
        # wyczyść stare webp w folderze
        for old in out.glob("*.webp"):
            old.unlink()
        files = crop_sheet(
            local,
            out,
            cols=5,
            rows=5,
            padding=0,
            overlap=0.10,
            margin=0.12,
            out_size=512,
            prefix=prefix,
            names=names,
            trim_bbox=False,
        )
        print(f"OK {folder}: {len(files)} <- {src.name[:60]}…")
        ok += 1
        # smoke: open first
        if files:
            im = Image.open(files[0])
            print(f"   sample {files[0].name} {im.size}")

    print(f"\nDone: {ok} folders. Missing boards: {missing}")


if __name__ == "__main__":
    main()
