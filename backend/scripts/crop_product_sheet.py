#!/usr/bin/env python3
"""
Wycinanie miniaturek z planszy Midjourney (5×5 itd.) bez ucinania talerzy.

Ulepszenia względem starej wersji:
- granice komórek w float (bez kumulacji błędów //)
- overlap: lekko nachodzi na sąsiadów / czarne fugi (talerze często wystają)
- BEZ agresywnego getbbox() który obcinał krawędzie
- wyśrodkowanie treści na czarnym kwadracie z marginesem

Przykład:
  python scripts/crop_product_sheet.py sheet.png --cols 5 --rows 5 --overlap 0.1 --margin 0.08 --out out --prefix fish
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def _content_bbox(rgb: np.ndarray, black_thr: int = 28) -> tuple[int, int, int, int] | None:
    """BBox pikseli wyraźnie jaśniejszych od czarnego tła."""
    lum = rgb.max(axis=2)
    mask = lum > black_thr
    if not mask.any():
        return None
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _strip_edge_neighbors(rgb: np.ndarray, black_thr: int = 28) -> np.ndarray:
    """Usuń wąskie crescent-y sąsiadów przy krawędziach (białe talerze Midjourney)."""
    out = rgb.copy()
    h, w = out.shape[:2]
    lum = out.max(axis=2).astype(np.float64)
    col = lum.mean(axis=0)

    def clear_side(from_right: bool) -> None:
        nonlocal out
        zone = int(0.22 * w)
        if from_right:
            xs = list(range(w - 1, w - zone - 1, -1))
        else:
            xs = list(range(0, zone))
        # najciemniejsza kolumna w strefie krawędzi = potencjalna fuga
        scores = [(col[x], x) for x in xs]
        dark_val, split = min(scores, key=lambda t: t[0])
        # wymagaj: fuga ciemna + na zewnątrz od niej jest jasna treść (sąsiad)
        if dark_val > black_thr * 1.8:
            return
        if from_right:
            outer = col[split:w].max() if split < w else 0
            inner = col[max(0, split - zone) : split].mean() if split > 0 else 0
            if outer > black_thr * 2.5 and inner > dark_val + 15:
                out[:, split:] = 0
        else:
            outer = col[0 : split + 1].max() if split >= 0 else 0
            inner = col[split + 1 : min(w, split + 1 + zone)].mean() if split < w - 1 else 0
            if outer > black_thr * 2.5 and inner > dark_val + 15:
                out[:, : split + 1] = 0

    clear_side(True)
    clear_side(False)
    return out


def _isolate_center_dish(tile: Image.Image, black_thr: int = 16) -> Image.Image:
    """Zostaw centralny talerz; usuń fragmenty sąsiadów z overlapu."""
    rgba = tile.convert("RGBA")
    rgb = np.array(rgba.convert("RGB"), dtype=np.uint8)
    h, w = rgb.shape[:2]

    band = max(2, int(min(h, w) * 0.035))
    rgb[:band, :] = 0
    rgb[-band:, :] = 0
    rgb[:, :band] = 0
    rgb[:, -band:] = 0

    # Najpierw odetnij ew. crescent sąsiada (przed floodem)
    rgb = _strip_edge_neighbors(rgb, black_thr=max(22, black_thr))

    scale = 3
    sw, sh = max(1, w // scale), max(1, h // scale)
    small = np.array(Image.fromarray(rgb).resize((sw, sh), Image.Resampling.BILINEAR))
    lum = small.max(axis=2)
    mask = lum > black_thr
    if not mask.any():
        return Image.fromarray(rgb, mode="RGB").convert("RGBA")

    cy, cx = sh // 2, sw // 2
    if not mask[cy, cx]:
        ys, xs = np.where(mask)
        i = int(np.argmin((ys - cy) ** 2 + (xs - cx) ** 2))
        cy, cx = int(ys[i]), int(xs[i])

    keep_s = np.zeros((sh, sw), dtype=bool)
    stack = [(cy, cx)]
    keep_s[cy, cx] = True
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < sh and 0 <= nx < sw and mask[ny, nx] and not keep_s[ny, nx]:
                keep_s[ny, nx] = True
                stack.append((ny, nx))

    soft = lum > max(6, black_thr - 8)
    for _ in range(5):
        p = np.pad(keep_s, 1, constant_values=False)
        keep_s = keep_s | (
            (p[0:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, 0:-2] | p[1:-1, 2:]) & soft
        )

    yy, xx = np.ogrid[:sh, :sw]
    rad2 = (0.56 * min(sh, sw)) ** 2
    keep_s = keep_s & (((xx - sw // 2) ** 2 + (yy - sh // 2) ** 2) <= rad2)

    keep = (
        np.array(
            Image.fromarray((keep_s.astype(np.uint8) * 255), mode="L").resize(
                (w, h), Image.Resampling.BILINEAR
            )
        )
        > 100
    )

    out = np.zeros_like(rgb)
    out[keep] = rgb[keep]
    # jeszcze raz po izolacji — wyczyść resztki przy krawędzi
    out = _strip_edge_neighbors(out, black_thr=max(22, black_thr))
    return Image.fromarray(out, mode="RGB").convert("RGBA")


def fit_on_black(
    tile: Image.Image,
    size: int = 512,
    margin: float = 0.08,
    black_thr: int = 18,
    isolate: bool = True,
) -> Image.Image:
    """Wyśrodkuj danie na czarnym kwadracie z oddechem wokół."""
    rgba = tile.convert("RGBA")
    if isolate:
        rgba = _isolate_center_dish(rgba, black_thr=black_thr)
    rgb = np.array(rgba.convert("RGB"))
    bbox = _content_bbox(rgb, black_thr=max(12, black_thr - 6))
    if bbox is None:
        canvas = Image.new("RGB", (size, size), (0, 0, 0))
        t = rgba.convert("RGB")
        t.thumbnail((size, size), Image.Resampling.LANCZOS)
        canvas.paste(t, ((size - t.width) // 2, (size - t.height) // 2))
        return canvas

    x0, y0, x1, y1 = bbox
    crop = rgba.crop((x0, y0, x1, y1)).convert("RGB")
    cw, ch = crop.size
    inner = max(1, int(size * (1.0 - 2.0 * margin)))
    scale = min(inner / cw, inner / ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    canvas.paste(crop, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def crop_sheet(
    src: Path,
    out_dir: Path,
    cols: int,
    rows: int,
    padding: int = 0,
    overlap: float = 0.10,
    margin: float = 0.08,
    out_size: int = 512,
    prefix: str = "product",
    names: list[str] | None = None,
    trim_bbox: bool = False,
) -> list[Path]:
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    cell_w = w / cols
    cell_h = h / rows
    ox = cell_w * overlap
    oy = cell_h * overlap
    out_dir.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    idx = 0
    for r in range(rows):
        for c in range(cols):
            left = c * cell_w - ox + padding
            top = r * cell_h - oy + padding
            right = (c + 1) * cell_w + ox - padding
            bottom = (r + 1) * cell_h + oy - padding
            left = max(0, int(round(left)))
            top = max(0, int(round(top)))
            right = min(w, int(round(right)))
            bottom = min(h, int(round(bottom)))
            if right <= left or bottom <= top:
                continue
            tile = img.crop((left, top, right, bottom))
            if trim_bbox:
                bbox = tile.getbbox()
                if bbox:
                    tile = tile.crop(bbox)
            fitted = fit_on_black(tile, size=out_size, margin=margin)
            if names and idx < len(names):
                fname = f"{names[idx]}.webp"
            else:
                fname = f"{prefix}_{idx + 1:02d}.webp"
            idx += 1
            path = out_dir / fname
            fitted.save(path, "WEBP", quality=82, method=6)
            saved.append(path)
    return saved


def main() -> None:
    p = argparse.ArgumentParser(description="Crop Midjourney dish sheet without clipping plates")
    p.add_argument("src", type=Path)
    p.add_argument("--cols", type=int, required=True)
    p.add_argument("--rows", type=int, required=True)
    p.add_argument("--padding", type=int, default=0)
    p.add_argument("--overlap", type=float, default=0.10, help="Ułamek komórki nachodzący na sąsiadów")
    p.add_argument("--margin", type=float, default=0.08, help="Margines wokół dania na czarnym tle")
    p.add_argument("--size", type=int, default=512, help="Wyjściowy kwadrat WebP")
    p.add_argument("--out", type=Path, default=Path("cropped_products"))
    p.add_argument("--prefix", default="product")
    p.add_argument("--trim-bbox", action="store_true", help="Stare zachowanie getbbox (niezalecane)")
    p.add_argument("--names", type=Path, help="Plik: jeden slug na linię")
    args = p.parse_args()
    names = None
    if args.names:
        names = [
            ln.strip().lstrip("\ufeff")
            for ln in args.names.read_text(encoding="utf-8-sig").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
    files = crop_sheet(
        args.src,
        args.out,
        args.cols,
        args.rows,
        padding=args.padding,
        overlap=args.overlap,
        margin=args.margin,
        out_size=args.size,
        prefix=args.prefix,
        names=names,
        trim_bbox=args.trim_bbox,
    )
    print(f"OK: {len(files)} files -> {args.out.resolve()}")


if __name__ == "__main__":
    main()
