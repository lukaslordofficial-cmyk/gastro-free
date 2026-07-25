from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import httpx

from delta_scraper.crawler import DEFAULT_MAX_DEPTH, DEFAULT_MAX_PAGES, crawl_supplier_site
from delta_scraper.differ import diff_products, text_unified_diff
from delta_scraper.fetcher import fetch_page
from delta_scraper.hashing import content_hash, normalize_text
from delta_scraper.models import ChangeEvent, CheckResult, ScrapedProduct
from delta_scraper.parser import extract_products_from_html, extract_products_from_text

logger = logging.getLogger("delta_scraper.engine")

CatalogSyncFn = Callable[[httpx.AsyncClient, str, list[ScrapedProduct]], Any]

# SCRAPER_AI_INTERPRET=1 (domyślnie) — po crawlu filtr OpenAI (tylko produkty kulinarne)
def _ai_interpret_enabled() -> bool:
    v = os.getenv("SCRAPER_AI_INTERPRET", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


async def _refine_products_with_ai(
    products: list[ScrapedProduct],
    crawl_raw_sample: str = "",
) -> tuple[list[ScrapedProduct], dict]:
    """Scala heurystykę z AI (AI filtruje śmieci, ale nie kasuje dobrych trafień bez ceny)."""
    if not _ai_interpret_enabled():
        return products, {"ai_used": False, "reason": "disabled"}
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        return products, {"ai_used": False, "reason": "no_api_key"}

    lines = []
    for p in products[:300]:
        lines.append(f"{p.name} | {p.price_pln} PLN | {p.volume_label or p.unit}")
    raw = "\n---\n".join(lines)
    if crawl_raw_sample:
        raw = (raw + "\n---\n" + crawl_raw_sample[:14000]) if raw else crawl_raw_sample[:20000]
    if not raw.strip():
        return products, {"ai_used": False, "reason": "empty"}

    try:
        from delta_scraper.ai_interpreter import interpret_culinary_products
        refined, meta = await interpret_culinary_products(raw)
        if not refined:
            return products, {**meta, "kept_heuristic": True}

        # Merge: AI nazwy + heurystyka (więcej pokrycia, np. Sokołów)
        by_key: dict[str, ScrapedProduct] = {}
        for p in refined + products:
            k = p.key()
            if not k:
                continue
            prev = by_key.get(k)
            if prev is None:
                by_key[k] = p
            elif (not prev.price_pln or prev.price_pln <= 0) and p.price_pln > 0:
                by_key[k] = p
        merged = list(by_key.values())
        return merged, {**meta, "merged_count": len(merged), "heuristic_count": len(products), "ai_count": len(refined)}
    except Exception as e:
        logger.warning("AI refine skipped: %s", e)
        return products, {"ai_used": False, "error": str(e)[:160]}


async def _load_last_products(
    sb_get: Callable,
    client: httpx.AsyncClient,
    target_id: str,
) -> tuple[list[ScrapedProduct], Optional[str]]:
    rows = await sb_get(client, "scrape_snapshots", params={
        "select": "products_json,content_hash",
        "target_id": f"eq.{target_id}",
        "order": "captured_at.desc",
        "limit": "1",
    })
    if not rows:
        return [], None
    row = rows[0]
    products = [ScrapedProduct.from_dict(p) for p in (row.get("products_json") or [])]
    return products, row.get("content_hash")


def _products_to_offer_format(products: list[ScrapedProduct]) -> list[dict]:
    """Wszystkie nazwane produkty — nawet bez ceny (cena 0), żeby fuzzy mógł je zmatchować."""
    from delta_scraper.parser import is_valid_product_name
    return [
        {
            "product_name": p.name,
            "price_netto": p.price_pln if p.price_pln and p.price_pln > 0 else None,
            "unit": p.unit or "szt",
            "volume_label": p.volume_label or "",
            "product_code": (p.product_code or None) or None,
        }
        for p in products
        if is_valid_product_name(p.name or "")
    ]


def _products_fingerprint(products: list[ScrapedProduct]) -> str:
    lines = []
    for p in sorted(products, key=lambda x: (x.name or "").lower()):
        lines.append(f"{(p.name or '').strip().lower()}|{p.price_pln:.4f}|{p.unit}|{p.volume_label}")
    return normalize_text("\n".join(lines))


def _parse_products(parse_input: str, css_selector: Optional[str]) -> list[ScrapedProduct]:
    if css_selector or (parse_input and parse_input.strip().startswith("<")):
        return extract_products_from_html(parse_input, css_selector)
    return extract_products_from_text(parse_input)


async def check_target_record(
    client: httpx.AsyncClient,
    target: dict,
    *,
    sb_get: Callable,
    sb_post: Callable,
    sb_patch: Callable,
    httpx_verify: Callable,
    catalog_sync_fn: Optional[CatalogSyncFn] = None,
    force: bool = False,
    max_pages: int = DEFAULT_MAX_PAGES,
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> CheckResult:
    """
    Sprawdza pojedynczy wiersz scrape_targets.
    Od seed URL automatycznie przeszukuje podstrony produktowe (crawl).
    """
    target_id = str(target["id"])
    url = target["url"]
    supplier_id = target.get("supplier_id")
    fetch_mode = target.get("fetch_mode") or "auto"
    css_selector = target.get("css_selector")
    verify = httpx_verify()

    try:
        async def _fetch_html(page_url: str):
            # Seed / pierwsze strony: tryb z targetu; podstrony też auto (SPA fallback).
            return await fetch_page(
                page_url, mode=fetch_mode, verify=verify, css_selector=css_selector,
            )

        max_pages = int(os.getenv("SCRAPER_MAX_PAGES", str(DEFAULT_MAX_PAGES)) or DEFAULT_MAX_PAGES)
        max_pages = max(10, min(max_pages, 120))  # twardy sufit — ochrona przed przeciążeniem
        max_depth = int(os.getenv("SCRAPER_MAX_DEPTH", str(DEFAULT_MAX_DEPTH)) or DEFAULT_MAX_DEPTH)
        max_depth = max(1, min(max_depth, 4))

        products, _visited_urls, crawl_meta = await crawl_supplier_site(
            url,
            fetch_html=_fetch_html,
            parse_products=lambda raw: _parse_products(raw, css_selector),
            max_pages=max_pages,
            max_depth=max_depth,
        )

        # AI: odfiltruj opakowania / śmieci; gdy 0 produktów — i tak daj próbki tekstu stron
        sample = ""
        if isinstance(crawl_meta, dict):
            sample = str(crawl_meta.pop("text_sample", "") or "")
        products, ai_meta = await _refine_products_with_ai(products, crawl_raw_sample=sample)
        if isinstance(crawl_meta, dict):
            crawl_meta = {**crawl_meta, "ai_interpret": ai_meta}
        else:
            crawl_meta = {"ai_interpret": ai_meta}

        fingerprint = _products_fingerprint(products)
        new_hash = content_hash(fingerprint) if fingerprint else content_hash(url)

        old_hash = target.get("content_hash")
        if not force and old_hash and old_hash == new_hash:
            await sb_patch(client, "scrape_targets", {"id": f"eq.{target_id}"}, {
                "last_checked_at": datetime.now(timezone.utc).isoformat(),
            })
            catalog_sync = None
            last_products, _ = await _load_last_products(sb_get, client, target_id)
            use_products = last_products or products
            if supplier_id and use_products and catalog_sync_fn:
                try:
                    catalog_sync = await catalog_sync_fn(
                        client, str(supplier_id), use_products,
                    )
                except Exception as e:
                    logger.exception("catalog sync (hash-skip) failed")
                    catalog_sync = {"error": str(e)[:200]}
            if isinstance(catalog_sync, dict):
                catalog_sync = {**catalog_sync, "crawl": crawl_meta}
            elif catalog_sync is None and crawl_meta:
                catalog_sync = {"crawl": crawl_meta}
            return CheckResult(
                target_id=target_id, url=url, changed=False, skipped_hash=True,
                product_count=int(target.get("product_count") or 0) or len(use_products),
                catalog_sync=catalog_sync,
            )

        old_products, _ = await _load_last_products(sb_get, client, target_id)
        is_first_run = not old_products and not old_hash

        changes: list[ChangeEvent] = []
        if not is_first_run:
            changes = diff_products(old_products, products)
        else:
            changes = [ChangeEvent(
                change_type="new_items",
                product_name=None,
                details={
                    "summary": (
                        f"Baseline: {len(products)} produktów "
                        f"({crawl_meta.get('pages_crawled', 1)} stron)"
                    ),
                    "count": len(products),
                    "pages_crawled": crawl_meta.get("pages_crawled"),
                },
            )]

        # Alerty tylko: spadki cen produktów z magazynu/menu + ładny komunikat AI
        from delta_scraper.alert_messages import filter_and_enrich_alerts
        alert_events = await filter_and_enrich_alerts(
            changes, client=client, sb_get=sb_get, is_first_run=is_first_run,
        )

        now = datetime.now(timezone.utc).isoformat()
        await sb_post(client, "scrape_snapshots", {
            "target_id": target_id,
            "content_hash": new_hash,
            "products_json": [p.to_dict() for p in products],
            "product_count": len(products),
            "text_length": len(fingerprint),
            "captured_at": now,
        })

        patch_target: dict = {
            "content_hash": new_hash,
            "last_checked_at": now,
            "product_count": len(products),
            "updated_at": now,
        }
        if alert_events:
            patch_target["last_changed_at"] = now
        await sb_patch(client, "scrape_targets", {"id": f"eq.{target_id}"}, patch_target)

        for ch in alert_events:
            await sb_post(client, "price_alerts", ch.to_alert_row(
                url=url, target_id=target_id, supplier_id=supplier_id,
            ))

        catalog_sync = None
        if supplier_id and products and catalog_sync_fn:
            try:
                catalog_sync = await catalog_sync_fn(client, str(supplier_id), products)
            except Exception as e:
                logger.exception("catalog sync failed")
                catalog_sync = {"error": str(e)[:200]}
        if isinstance(catalog_sync, dict):
            catalog_sync = {**catalog_sync, "crawl": crawl_meta}
        else:
            catalog_sync = {"crawl": crawl_meta}

        if old_products and alert_events:
            old_text = "\n".join(p.raw_line or p.name for p in old_products[:50])
            new_text = "\n".join(p.raw_line or p.name for p in products[:50])
            diff_preview = text_unified_diff(old_text, new_text, max_lines=40)
            if diff_preview:
                logger.info("Delta %s:\n%s", url, diff_preview[:2000])

        new_count = sum(1 for c in changes if c.change_type == "new_items" and c.product_name)
        return CheckResult(
            target_id=target_id,
            url=url,
            changed=bool(alert_events),
            skipped_hash=False,
            product_count=len(products),
            new_product_count=new_count,
            changes=alert_events,
            catalog_sync=catalog_sync,
        )

    except Exception as e:
        logger.exception("check_target failed: %s", url)
        return CheckResult(
            target_id=target_id, url=url, changed=False, error=str(e)[:300],
        )


async def check_all_targets(
    client: httpx.AsyncClient,
    *,
    sb_get: Callable,
    sb_post: Callable,
    sb_patch: Callable,
    httpx_verify: Callable,
    catalog_sync_fn: Optional[CatalogSyncFn] = None,
    force: bool = False,
    target_ids: Optional[list[str]] = None,
) -> list[CheckResult]:
    params: dict = {
        "select": "*",
        "is_active": "eq.true",
        "order": "last_checked_at.asc.nullsfirst",
    }
    rows = await sb_get(client, "scrape_targets", params=params)
    if target_ids:
        ids_set = set(target_ids)
        rows = [r for r in (rows or []) if str(r.get("id")) in ids_set]

    results: list[CheckResult] = []
    for row in rows or []:
        results.append(await check_target_record(
            client, row,
            sb_get=sb_get, sb_post=sb_post, sb_patch=sb_patch,
            httpx_verify=httpx_verify,
            catalog_sync_fn=catalog_sync_fn,
            force=force,
        ))
    return results
