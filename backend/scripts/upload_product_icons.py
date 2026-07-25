#!/usr/bin/env python3
"""
Tworzy bucket Supabase `product-icons` (public) i wgrywa wycięte ikony mięs
pod kanonicznymi slugami (antrykot_wolowy_stek.png itd.).

Użycie (z katalogu backend/):
  python scripts/upload_product_icons.py

Wymaga SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY w backend/.env
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import ssl
import certifi
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    or os.environ.get("SUPABASE_ANON_KEY", "").strip()
)
BUCKET = "product-icons"


def _verify():
    mode = os.environ.get("OPENAI_SSL_VERIFY", "auto").strip().lower()
    if mode in ("0", "false", "no"):
        return False
    if mode in ("certifi", "bundle"):
        return certifi.where()
    try:
        return ssl.create_default_context()
    except Exception:
        return False

MEATS_DIR = ROOT.parent / "frontend" / "assets" / "premium" / "meats"

# meat_01 … meat_25 → slug (kolejność siatki 5×5)
MEAT_SLUGS = [
    "antrykot_wolowy_stek",
    "schab_z_koscia",
    "piers_z_kurczaka",
    "boczek_surowy_plastry",
    "szynka_parmenska_prosciutto",
    "salami_plastry",
    "zeberka_wolowe_wieprzowe",
    "poledwiczka_surowa_kawalek",
    "poledwica_wolowa_cala",
    "kielbaski_surowe",
    "stek_z_koscia_tomahawk",
    "mieso_mielone_wolowe",
    "mieso_gulaszowe_kostka",
    "piers_z_kaczki",
    "stek_wolowy_mignon",
    "karkowka_surowa_kawalek",
    "schab_bez_kosci_stek",
    "golen_z_koscia_buko",
    "podudzia_z_kurczaka_palki",
    "boczek_pieczony_marynowany",
    "szynka_w_siatce_sznurowana",
    "boczek_ze_skora_kawalek",
    "mieso_wolowe_kawalek",
    "mieso_drobne_kostka",
    "chorizo_pepperoni_plastry",
]

SEAFOOD_SLUGS = [
    "losos_stek_fillet",
    "pstrag_caly_surowy",
    "krewetki_szare_surowe",
    "tunczyk_stek_surowy",
    "dorsz_poledwica_filet",
    "dorada_cala_surowa",
    "makrela_cala_dwie_sztuki",
    "mule_malze_czarne",
    "kalmar_caly_z_mackami",
    "przegrzebki_malze_swiete",
    "karmazyn_lub_dorada_rozowa",
    "krazki_kalmarow",
    "osmiornica_macki_ugotowane",
    "wenery_malze_w_muszelkach",
    "ostrygi_zamkniete_muszle",
    "okon_morski_dwie_ryby",
    "krewetki_gotowane_rozowe",
    "tilapia_filet_rozowy",
    "szproty_lub_sardynki_starka",
    "krab_nogi_szczypce",
]


def headers() -> dict:
    return {
        "Authorization": f"Bearer {SERVICE_KEY}",
        "apikey": SERVICE_KEY,
    }


def ensure_bucket(client: httpx.Client) -> None:
    r = client.get(f"{SUPABASE_URL}/storage/v1/bucket/{BUCKET}", headers=headers())
    if r.status_code == 200:
        print(f"bucket OK: {BUCKET}")
        return
    r = client.post(
        f"{SUPABASE_URL}/storage/v1/bucket",
        headers={**headers(), "Content-Type": "application/json"},
        json={
            "id": BUCKET,
            "name": BUCKET,
            "public": True,
            "file_size_limit": 5_000_000,
            "allowed_mime_types": ["image/png", "image/webp", "image/jpeg"],
        },
    )
    if r.status_code in (200, 201):
        print(f"bucket created: {BUCKET}")
    else:
        print(f"bucket create failed: {r.status_code} {r.text[:300]}")
        sys.exit(1)


def upload_file(client: httpx.Client, local: Path, remote_path: str) -> str:
    data = local.read_bytes()
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{remote_path}"
    r = client.post(
        url,
        headers={
            **headers(),
            "Content-Type": "image/png",
            "x-upsert": "true",
        },
        content=data,
    )
    if r.status_code not in (200, 201):
        # retry PUT upsert
        r = client.put(
            url,
            headers={
                **headers(),
                "Content-Type": "image/png",
                "x-upsert": "true",
            },
            content=data,
        )
    if r.status_code not in (200, 201):
        raise RuntimeError(f"upload {remote_path}: {r.status_code} {r.text[:200]}")
    public = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{remote_path}"
    return public


def upsert_catalog_rows(client: httpx.Client, rows: list[dict]) -> None:
    """Opcjonalna tabela product_image_catalog — jeśli nie istnieje, pomijamy."""
    r = client.post(
        f"{SUPABASE_URL}/rest/v1/product_image_catalog",
        headers={
            **headers(),
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        json=rows,
    )
    if r.status_code in (200, 201):
        print(f"catalog rows upserted: {len(rows)}")
    elif r.status_code == 404 or "Could not find" in r.text or "PGRST" in r.text:
        print("table product_image_catalog missing — run ADD_PRODUCT_IMAGE_CATALOG.sql (optional)")
    else:
        print(f"catalog upsert warn: {r.status_code} {r.text[:200]}")


def main() -> None:
    if not SUPABASE_URL or not SERVICE_KEY:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)
    if not MEATS_DIR.exists():
        print(f"Meats dir missing: {MEATS_DIR}")
        sys.exit(1)

    with httpx.Client(timeout=60.0, verify=_verify()) as client:
        ensure_bucket(client)
        uploaded = []
        for i, slug in enumerate(MEAT_SLUGS, start=1):
            local = MEATS_DIR / f"meat_{i:02d}.png"
            if not local.exists():
                print(f"SKIP missing {local.name}")
                continue
            remote = f"mieso/{slug}.png"
            public = upload_file(client, local, remote)
            print(f"OK {remote}")
            uploaded.append(
                {
                    "slug": slug,
                    "category": "mieso",
                    "label_pl": slug.replace("_", " "),
                    "aliases": [],
                    "storage_path": remote,
                    "public_url": public,
                }
            )

        seafood_dir = MEATS_DIR.parent / "seafood"
        if seafood_dir.exists():
            for slug in SEAFOOD_SLUGS:
                local = seafood_dir / f"{slug}.png"
                if not local.exists():
                    print(f"SKIP missing {local.name}")
                    continue
                remote = f"ryby/{slug}.png"
                public = upload_file(client, local, remote)
                print(f"OK {remote}")
                uploaded.append(
                    {
                        "slug": slug,
                        "category": "ryby_owoce_morza",
                        "label_pl": slug.replace("_", " "),
                        "aliases": [],
                        "storage_path": remote,
                        "public_url": public,
                    }
                )
        else:
            print("seafood/ not present yet — catalog entries ready in app code")

        veg_dir = MEATS_DIR.parent / "vegetables"
        veg_slugs_file = Path(__file__).parent / "vegetable_slugs.txt"
        if veg_dir.exists() and veg_slugs_file.exists():
            veg_slugs = [
                ln.strip()
                for ln in veg_slugs_file.read_text(encoding="utf-8").splitlines()
                if ln.strip() and not ln.strip().startswith("#")
            ]
            for slug in veg_slugs:
                local = veg_dir / f"{slug}.png"
                if not local.exists():
                    print(f"SKIP missing {local.name}")
                    continue
                remote = f"warzywa/{slug}.png"
                public = upload_file(client, local, remote)
                print(f"OK {remote}")
                uploaded.append(
                    {
                        "slug": slug,
                        "category": "warzywa",
                        "label_pl": slug.replace("_", " "),
                        "aliases": [],
                        "storage_path": remote,
                        "public_url": public,
                    }
                )
        else:
            print("vegetables/ not present yet")

        herbs_dir = MEATS_DIR.parent / "herbs"
        herbs_slugs_file = Path(__file__).parent / "herbs_slugs.txt"
        if herbs_dir.exists() and herbs_slugs_file.exists():
            herbs_slugs = [
                ln.strip()
                for ln in herbs_slugs_file.read_text(encoding="utf-8").splitlines()
                if ln.strip() and not ln.strip().startswith("#")
            ]
            for slug in herbs_slugs:
                local = herbs_dir / f"{slug}.png"
                if not local.exists():
                    print(f"SKIP missing {local.name}")
                    continue
                remote = f"ziola/{slug}.png"
                public = upload_file(client, local, remote)
                print(f"OK {remote}")
                uploaded.append(
                    {
                        "slug": slug,
                        "category": "ziola_grzyby",
                        "label_pl": slug.replace("_", " "),
                        "aliases": [],
                        "storage_path": remote,
                        "public_url": public,
                    }
                )
        else:
            print("herbs/ not present yet")

        fruits_dir = MEATS_DIR.parent / "fruits"
        if fruits_dir.exists():
            for local in sorted(fruits_dir.glob("*.png")):
                slug = local.stem
                if slug == "awokado_hass":
                    # już w warzywach — unikamy duplikatu w buckecie
                    continue
                remote = f"owoce/{slug}.png"
                public = upload_file(client, local, remote)
                print(f"OK {remote}")
                uploaded.append(
                    {
                        "slug": slug,
                        "category": "owoce",
                        "label_pl": slug.replace("_", " "),
                        "aliases": [],
                        "storage_path": remote,
                        "public_url": public,
                    }
                )
        else:
            print("fruits/ not present yet")

        dairy_dir = MEATS_DIR.parent / "dairy"
        if dairy_dir.exists():
            for local in sorted(dairy_dir.glob("*.png")):
                slug = local.stem
                remote = f"nabial/{slug}.png"
                public = upload_file(client, local, remote)
                print(f"OK {remote}")
                uploaded.append(
                    {
                        "slug": slug,
                        "category": "nabial",
                        "label_pl": slug.replace("_", " "),
                        "aliases": [],
                        "storage_path": remote,
                        "public_url": public,
                    }
                )
        else:
            print("dairy/ not present yet")

        dry_dir = MEATS_DIR.parent / "dry"
        if dry_dir.exists():
            for local in sorted(dry_dir.glob("*.png")):
                slug = local.stem.lstrip("\ufeff")
                remote = f"sucha/{slug}.png"
                public = upload_file(client, local, remote)
                print(f"OK {remote}")
                uploaded.append(
                    {
                        "slug": slug,
                        "category": "sucha_spizarnia",
                        "label_pl": slug.replace("_", " "),
                        "aliases": [],
                        "storage_path": remote,
                        "public_url": public,
                    }
                )
        else:
            print("dry/ not present yet")

        liquids_dir = MEATS_DIR.parent / "liquids"
        if liquids_dir.exists():
            for local in sorted(liquids_dir.glob("*.png")):
                slug = local.stem.lstrip("\ufeff")
                remote = f"plynne/{slug}.png"
                public = upload_file(client, local, remote)
                print(f"OK {remote}")
                uploaded.append(
                    {
                        "slug": slug,
                        "category": "plynna_spizarnia",
                        "label_pl": slug.replace("_", " "),
                        "aliases": [],
                        "storage_path": remote,
                        "public_url": public,
                    }
                )
        else:
            print("liquids/ not present yet")

        for folder, remote_prefix, category in (
            ("bread", "pieczywo", "pieczywo"),
            ("cafe", "kawa", "kawa_bar"),
            ("drinks", "napoje", "napoje"),
            ("wine", "wino", "wino_piwo"),
            ("spirits", "alkohole", "alkohole_mocne"),
            ("packaging", "opakowania", "opakowania"),
            ("pastes", "pasty", "pasty_bazy"),
            ("roots", "korzeniowe", "korzeniowe"),
            ("polish", "polska", "kuchnia_polska"),
            ("frozen", "mrozonki", "mrozonki"),
            ("grains", "makarony", "makarony_kasze"),
            ("placeholders", "placeholdery", "placeholdery"),
        ):
            d = MEATS_DIR.parent / folder
            if not d.exists():
                print(f"{folder}/ not present yet")
                continue
            for local in sorted(d.glob("*.png")):
                slug = local.stem.lstrip("\ufeff")
                remote = f"{remote_prefix}/{slug}.png"
                public = upload_file(client, local, remote)
                print(f"OK {remote}")
                uploaded.append(
                    {
                        "slug": slug,
                        "category": category,
                        "label_pl": slug.replace("_", " "),
                        "aliases": [],
                        "storage_path": remote,
                        "public_url": public,
                    }
                )

        if uploaded:
            upsert_catalog_rows(client, uploaded)

        print(json.dumps({"uploaded": len(uploaded), "bucket": BUCKET}, indent=2))


if __name__ == "__main__":
    main()
