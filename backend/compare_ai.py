"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `compare_ai`."""
from __future__ import annotations

from pl_fuzzy_norm import norm_pl as _norm_pl
from supabase_rest import sb_get
from supabase_rest import sb_patch
from typing import Optional
import httpx
import json
from app_core import CHAT_MODEL, _openai, logger
from billing_credits import _bill_openai_response
from constants import AI_CATALOG_MAX_CANDIDATES, AI_SYNONYM_CONF_MIN



# --- Algorytm porównywania ---------------------------------------------------
# Katalogi hurt + LP: backend/deal_hunter_catalog.py (import u góry pliku)


async def _load_supplier_reliability_scores(client: httpx.AsyncClient) -> dict[str, float]:
    """
    Agreguje Reliability Score z supplier_orders (received_ok) / reviews.
    Fail-soft: pusty dict gdy kolumny / tabela jeszcze nie istnieją.

    TODO(Phase 4 FE): post-delivery rating form → received_ok / missing_count
    na supplier_orders lub wiersze w supplier_delivery_reviews.
    """
    from collections import defaultdict
    from smart_basket_optimizer import compute_reliability_score

    ok_map: dict[str, int] = defaultdict(int)
    bad_map: dict[str, int] = defaultdict(int)
    miss_map: dict[str, int] = defaultdict(int)
    review_map: dict[str, int] = defaultdict(int)

    try:
        rows = await sb_get(client, "supplier_orders", params={
            "select": "supplier_id,received_ok,missing_count",
            "received_ok": "not.is.null",
            "limit": "2000",
        }) or []
        for r in rows:
            sid = r.get("supplier_id")
            if not sid:
                continue
            if r.get("received_ok") is True:
                ok_map[sid] += 1
            elif r.get("received_ok") is False:
                bad_map[sid] += 1
            try:
                miss_map[sid] += int(r.get("missing_count") or 0)
            except (TypeError, ValueError):
                pass
            review_map[sid] += 1
    except Exception as e:
        logger.debug(f"reliability from supplier_orders skipped: {e}")

    try:
        suppliers = await sb_get(client, "suppliers", params={"select": "id", "limit": "2000"}) or []
        sid_csv = ",".join(str(s["id"]) for s in suppliers if s.get("id"))
        if sid_csv:
            revs = await sb_get(client, "supplier_delivery_reviews", params={
                "select": "supplier_id,received_ok,missing_count",
                "supplier_id": f"in.({sid_csv})",
                "limit": "2000",
            }) or []
        else:
            revs = []
        for r in revs:
            sid = r.get("supplier_id")
            if not sid:
                continue
            if r.get("received_ok") is True:
                ok_map[sid] += 1
            else:
                bad_map[sid] += 1
            try:
                miss_map[sid] += int(r.get("missing_count") or 0)
            except (TypeError, ValueError):
                pass
            review_map[sid] += 1
    except Exception as e:
        logger.debug(f"reliability from delivery_reviews skipped: {e}")

    out: dict[str, float] = {}
    for sid in set(list(ok_map) + list(bad_map) + list(review_map)):
        score = compute_reliability_score(
            received_ok_count=ok_map.get(sid, 0),
            received_bad_count=bad_map.get(sid, 0),
            missing_total=miss_map.get(sid, 0),
            review_count=review_map.get(sid, 0),
        )
        if score is not None:
            out[sid] = score
    return out


async def _ai_confirm_synonym(
    httpx_c: httpx.AsyncClient,
    warehouse_name: str,
    supplier_name: str,
    *,
    request_id: Optional[str] = None,
) -> tuple[bool, float, dict]:
    """GPT-4o-mini (fallback): para magazyn ↔ jedna oferta. Preferuj _ai_catalog_agent_match."""
    try:
        client = _openai()
        prompt = (
            f"Czy produkt z hurtowni '{supplier_name}' to JEST TEN SAM TOWAR "
            f"co produkt z magazynu kuchni '{warehouse_name}'? "
            "Dopuszczalne: synonim, wariant opakowania, marka. "
            "Odrzuć podobieństwo tylko literowe / inny produkt. "
            'Odpowiedz wyłącznie JSON: {"is_match": boolean, "confidence": float}.'
        )
        resp = await client.chat.completions.create(
            model=CHAT_MODEL, temperature=0.0,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        usage = getattr(resp, "usage", None)
        billing = {"credits_deducted": 0}
        if usage:
            extras = {"synonym_check": f"{warehouse_name} ~ {supplier_name}"}
            if request_id:
                extras["request_id"] = request_id
            billing = await _bill_openai_response(
                httpx_c, resp,
                endpoint="/api/orders/compare-offers",
                model=CHAT_MODEL,
                extras=extras,
            )
        data = json.loads((resp.choices[0].message.content or "{}").strip())
        return bool(data.get("is_match")), float(data.get("confidence") or 0.0), billing
    except Exception as e:  # noqa: BLE001
        logger.warning(f"_ai_confirm_synonym failed: {e}")
        return False, 0.0, {"credits_deducted": 0}


async def _ai_catalog_agent_match(
    httpx_c: httpx.AsyncClient,
    warehouse_name: str,
    candidates: list[dict],
    *,
    request_id: Optional[str] = None,
) -> tuple[set[str], float, dict]:
    """Agent OpenAI: wyszukaj w REALNYCH wierszach katalogów dostawców.

    candidates: [{id, name, supplier_name, variant?, sim?}]
    Zwraca (matched_catalog_ids, confidence, billing).
    Pusta lista = produktu NIE MA u dostawców (found=false) — bez zgadywania.
    """
    if not warehouse_name or not candidates:
        return set(), 0.0, {"credits_deducted": 0}
    # Deduplikuj po id, limituj długość promptu
    seen: set[str] = set()
    lines: list[str] = []
    id_by_norm: dict[str, str] = {}
    for c in candidates[:AI_CATALOG_MAX_CANDIDATES]:
        cid = str(c.get("id") or "").strip()
        name = str(c.get("name") or "").strip()
        if not cid or not name or cid in seen:
            continue
        seen.add(cid)
        sup = str(c.get("supplier_name") or "Dostawca").strip()
        variant = str(c.get("variant") or "").strip()
        vbit = f" | wariant={variant}" if variant else ""
        # Tag informacyjny: czy produkt występuje też w recepturach menu użytkownika.
        # NIE oznacza dostępności — obie grupy są pełnoprawnymi ofertami dostawcy.
        tag = "w_recepturach_menu" if c.get("in_menu") else "dodatkowa_oferta"
        lines.append(f"- id={cid} | dostawca={sup} | nazwa={name}{vbit} | tag={tag}")
        id_by_norm[_norm_pl(name)] = cid
    if not lines:
        return set(), 0.0, {"credits_deducted": 0}

    catalog_block = "\n".join(lines)
    prompt = (
        "Jesteś agentem zakupowym restauracji (Łowca Okazji). "
        "Masz dostęp do ofert z katalogów dostawców wgranych przez użytkownika. "
        "Zadanie: znaleźć oferty, które są TYM SAMYM towarem co zamówienie z magazynu.\n\n"
        f"ZAMÓWIENIE Z MAGAZYNU: \"{warehouse_name}\"\n\n"
        "OFERTY Z KATALOGÓW (wyłącznie te — nic spoza listy):\n"
        f"{catalog_block}\n\n"
        "ZNACZENIE TAGÓW:\n"
        "• w_recepturach_menu = produkt pojawia się też w recepturach menu użytkownika.\n"
        "• dodatkowa_oferta = produkt w katalogu dostawcy, ale niepowiązany z recepturami.\n"
        "OBA tagi to REALNE oferty do zamówienia. Tag NIE oznacza braku towaru.\n"
        "Jeśli zamówienie z magazynu pasuje do oferty z tagiem dodatkowa_oferta — DOPASUJ ją.\n\n"
        "ZASADY:\n"
        "1. Dopasuj gdy to TEN SAM towar — także przy:\n"
        "   • liczbie mnogiej/pojedynczej (batat = bataty, pomidor = pomidory),\n"
        "   • innej kolejności słów (filet z kurczaka = kurczak filet),\n"
        "   • synonimie / wariancie opakowania / marce / gramaturze.\n"
        "2. NIE odrzucaj oferty tylko dlatego, że ma tag dodatkowa_oferta.\n"
        "3. NIE dopasowuj tylko podobieństwa literowego "
        "(np. „grzanek” ≠ „granulat czosnkowy”).\n"
        "4. Jeśli ŻADNA oferta nie jest tym towarem — matched_ids = [].\n"
        "5. Nie wymyślaj produktów spoza listy. Zwracaj wyłącznie id z listy.\n"
        "6. Możesz zwrócić wiele id (różni dostawcy / warianty).\n\n"
        "Odpowiedz WYŁĄCZNIE JSON:\n"
        '{"matched_ids": ["..."], "confidence": 0.0, "reason": "krótko"}'
    )
    try:
        client = _openai()
        resp = await client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=0.0,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Jesteś precyzyjnym agentem matchingu katalogów B2B gastronomii PL. "
                        "Rozpoznajesz synonimy, odmiany i kolejność słów. "
                        "False positive (zły produkt w koszyku) jest gorszy niż false negative, "
                        "ale typowe pary jak batat/bataty albo filet z kurczaka/kurczak filet "
                        "MUSISZ uznać za match z wysoką pewnością."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        billing = {"credits_deducted": 0}
        usage = getattr(resp, "usage", None)
        if usage:
            extras = {
                "catalog_agent": warehouse_name,
                "candidates": len(lines),
            }
            if request_id:
                extras["request_id"] = request_id
            billing = await _bill_openai_response(
                httpx_c, resp,
                endpoint="/api/orders/compare-offers",
                model=CHAT_MODEL,
                extras=extras,
            )
        data = json.loads((resp.choices[0].message.content or "{}").strip())
        conf = float(data.get("confidence") or 0.0)
        raw_ids = data.get("matched_ids") or []
        allowed = set(seen)
        matched: set[str] = set()
        if isinstance(raw_ids, list):
            for x in raw_ids:
                cid = str(x or "").strip()
                if cid in allowed:
                    matched.add(cid)
        # Guard: niska pewność → odrzuć (lepiej „nie znaleziono”)
        if conf < AI_SYNONYM_CONF_MIN:
            return set(), conf, billing
        return matched, conf, billing
    except Exception as e:  # noqa: BLE001
        logger.warning(f"_ai_catalog_agent_match failed: {e}")
        return set(), 0.0, {"credits_deducted": 0}


async def _persist_synonyms(httpx_c: httpx.AsyncClient, additions: dict) -> None:
    """Dopisuje nowe (potwierdzone przez AI) synonimy do inventory_items.synonyms,
    aby kolejne porównania działały natychmiast, bez zużywania tokenów AI.
    additions: {inv_id: {"existing": list[str], "new": set[str]}}"""
    for inv_id, slot in additions.items():
        merged = list(slot.get("existing") or [])
        low = {str(x).strip().lower() for x in merged}
        changed = False
        for name in slot.get("new") or set():
            key = str(name).strip().lower()
            if key and key not in low:
                merged.append(name)
                low.add(key)
                changed = True
        if changed:
            try:
                await sb_patch(httpx_c, "inventory_items", {"id": f"eq.{inv_id}"},
                               {"synonyms": merged})
            except Exception as e:  # noqa: BLE001
                logger.warning(f"_persist_synonyms patch failed for {inv_id}: {e}")

__all__ = ['_ai_catalog_agent_match', '_ai_confirm_synonym', '_load_supplier_reliability_scores', '_persist_synonyms']
