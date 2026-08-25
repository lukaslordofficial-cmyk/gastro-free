"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `compare_merge`."""
from __future__ import annotations

from pl_fuzzy_norm import food_match_key as _food_match_key
from pl_fuzzy_norm import norm_pl as _norm_pl
from rapidfuzz import fuzz
from matching_utils import _food_keys_same_product



def _merge_duplicate_compare_items(per_item: list[dict]) -> list[dict]:
    """Łączy linie porównania, które to ten sam produkt magazynowy / ten sam food_key.

    Chroni przed podwójnym zamówieniem (np. „filet z kurczaka” + „kurczak filet” → 2× 6 kg).
    Różne cięcia (filet vs pierś) mają inny food_key i zostają osobno.
    """
    if len(per_item) <= 1:
        return per_item

    def _group_key(pi: dict) -> str:
        inv = pi.get("inventory_id")
        if inv:
            return f"inv:{inv}"
        fk = (pi.get("food_key") or _food_match_key(pi.get("product_name") or "")).strip()
        unit = (pi.get("unit") or "").strip().lower()
        return f"fk:{fk}|{unit}" if fk else f"name:{_norm_pl(pi.get('product_name') or '')}|{unit}"

    # Najpierw scal po kompatybilnym food_key (rukola / sałata rukola)
    coalesced: list[dict] = []
    used = [False] * len(per_item)
    for i, a in enumerate(per_item):
        if used[i]:
            continue
        cluster = [a]
        used[i] = True
        ka = (a.get("food_key") or _food_match_key(a.get("product_name") or "")).strip()
        ua = (a.get("unit") or "").strip().lower()
        ia = a.get("inventory_id")
        for j in range(i + 1, len(per_item)):
            if used[j]:
                continue
            b = per_item[j]
            if ia and b.get("inventory_id") and str(ia) == str(b.get("inventory_id")):
                cluster.append(b)
                used[j] = True
                continue
            ub = (b.get("unit") or "").strip().lower()
            if ua and ub and ua != ub:
                continue
            kb = (b.get("food_key") or _food_match_key(b.get("product_name") or "")).strip()
            if _food_keys_same_product(
                ka, kb, a.get("product_name") or "", b.get("product_name") or "",
            ):
                cluster.append(b)
                used[j] = True
        merge_token = id(cluster[0])
        for c in cluster:
            c["_merge_into"] = merge_token
        coalesced.extend(cluster)

    buckets: dict[str, list[dict]] = {}
    for pi in coalesced:
        mk = pi.get("_merge_into")
        key = f"merge:{mk}" if mk is not None else _group_key(pi)
        buckets.setdefault(key, []).append(pi)

    merged: list[dict] = []
    for group in buckets.values():
        if len(group) == 1:
            merged.append(group[0])
            continue
        # Dodatkowo: wymagaj podobieństwa nazw jeśli tylko food_key (uniknij przypadkowych zderzeń)
        if not group[0].get("inventory_id") and len(group) > 1:
            refined: list[list[dict]] = []
            for pi in group:
                placed = False
                for cluster in refined:
                    ref = cluster[0].get("product_name") or ""
                    cand = pi.get("product_name") or ""
                    if fuzz.token_set_ratio(_norm_pl(ref), _norm_pl(cand)) >= 86:
                        cluster.append(pi)
                        placed = True
                        break
                if not placed:
                    refined.append([pi])
            subgroups = refined
        else:
            subgroups = [group]

        for cluster in subgroups:
            if len(cluster) == 1:
                merged.append(cluster[0])
                continue
            base = dict(cluster[0])
            total_qty = sum(float(x.get("quantity") or 0) for x in cluster)
            total_base = sum(float(x.get("base_quantity") or x.get("quantity") or 0) for x in cluster)
            total_target = sum(float(x.get("target_quantity") or x.get("quantity") or 0) for x in cluster)
            names = [str(x.get("product_name") or "") for x in cluster]
            # Preferuj najdłuższą / najbardziej opisową nazwę
            best_name = max(names, key=lambda n: (len(n), n))
            # Połącz oferty: per dostawca najtańsza linia, przeliczona do nowej ilości
            bbs: dict[str, dict] = {}
            for x in cluster:
                for sid, q in (x.get("best_by_supplier") or {}).items():
                    prev = bbs.get(sid)
                    up = float(q.get("unit_price_base") or 0)
                    if prev is None or up < float(prev.get("unit_price_base") or 1e18):
                        bbs[sid] = dict(q)
            for sid, q in bbs.items():
                up = float(q.get("unit_price_base") or 0)
                q["line_total"] = round(up * total_base, 2)
                q["order_base_qty"] = round(total_base, 4)
            base["product_name"] = best_name
            base["quantity"] = round(total_qty, 4)
            base["base_quantity"] = round(total_base, 4)
            base["target_quantity"] = round(total_target, 4)
            base["quantity_min"] = round(total_target * 0.9, 4)
            base["quantity_max"] = round(total_target * 1.1, 4)
            base["best_by_supplier"] = bbs
            base["merged_from"] = names
            base.pop("_merge_into", None)
            merged.append(base)
    for m in merged:
        m.pop("_merge_into", None)
    return merged


def _dedupe_products_across_supplier_groups(groups: list[dict]) -> list[dict]:
    """Jeden produkt może być tylko u jednego dostawcy — zostaw najtańszą linię."""
    if not groups:
        return groups
    best: dict[str, tuple[float, int, dict]] = {}
    for gi, g in enumerate(groups):
        for it in g.get("items") or []:
            key = _norm_pl(it.get("product_name") or it.get("matched_name") or "")
            if not key:
                continue
            lt = float(it.get("line_total") or 0)
            prev = best.get(key)
            if prev is None or lt < prev[0] - 1e-9:
                best[key] = (lt, gi, it)
    out: list[dict] = []
    for gi, g in enumerate(groups):
        kept = []
        for it in g.get("items") or []:
            key = _norm_pl(it.get("product_name") or it.get("matched_name") or "")
            hit = best.get(key)
            if hit and hit[1] == gi:
                kept.append(it)
        if not kept:
            continue
        ng = dict(g)
        ng["items"] = kept
        ng["subtotal_pln"] = round(sum(float(x.get("line_total") or 0) for x in kept), 2)
        min_v = float(ng.get("min_order_value") or 0)
        ng["meets_minimum_order"] = (min_v <= 0) or (ng["subtotal_pln"] >= min_v)
        if min_v > 0:
            ng["gap_to_minimum_pln"] = round(max(0.0, min_v - ng["subtotal_pln"]), 2)
        out.append(ng)
    return out


def _recompute_scenario_totals(sc: dict) -> None:
    if not isinstance(sc, dict):
        return
    groups = sc.get("suppliers") or []
    sc["supplier_count"] = len(groups)
    sc["products_pln"] = round(sum(float(g.get("subtotal_pln") or 0) for g in groups), 2)
    ship = float(sc.get("shipping_pln") or 0)
    sc["total_pln"] = round(float(sc["products_pln"]) + ship, 2)


def _sanitize_optimize_unique_products(result: dict) -> dict:
    """Po optymalizacji: zero podwójnych SKU między dostawcami w scenariuszach."""
    if not isinstance(result, dict):
        return result
    for key in ("scenario_split_max", "scenario_monolith", "scenario_smart_hybrid"):
        sc = result.get(key)
        if isinstance(sc, dict) and isinstance(sc.get("suppliers"), list):
            sc["suppliers"] = _dedupe_products_across_supplier_groups(sc["suppliers"])
            _recompute_scenario_totals(sc)
    scenarios = result.get("scenarios")
    if isinstance(scenarios, list):
        for sc in scenarios:
            if isinstance(sc, dict) and isinstance(sc.get("suppliers"), list):
                sc["suppliers"] = _dedupe_products_across_supplier_groups(sc["suppliers"])
                _recompute_scenario_totals(sc)
    for key in ("variant_split", "option_optimized"):
        vs = result.get(key)
        if isinstance(vs, dict) and isinstance(vs.get("suppliers"), list):
            vs["suppliers"] = _dedupe_products_across_supplier_groups(vs["suppliers"])
            vs["total_pln"] = round(
                sum(float(g.get("subtotal_pln") or 0) for g in vs["suppliers"]), 2,
            )
    best = result.get("best_option")
    if isinstance(best, dict):
        if isinstance(best.get("suppliers"), list):
            best["suppliers"] = _dedupe_products_across_supplier_groups(best["suppliers"])
    return result


def _filter_compare_to_requested_products(result: dict, allowed_names: list[str]) -> dict:
    """Usuń z koszyków dostawców pozycje spoza listy zamówionych braków (anti-bleed)."""
    if not isinstance(result, dict) or not allowed_names:
        return result
    allowed_norm = {_norm_pl(n) for n in allowed_names if n and str(n).strip()}
    allowed_food = {_food_match_key(n) for n in allowed_names if n and str(n).strip()}

    def _ok(name: str) -> bool:
        raw = (name or "").strip()
        if not raw:
            return False
        n = _norm_pl(raw)
        if n in allowed_norm:
            return True
        fk = _food_match_key(raw)
        if fk and fk in allowed_food:
            return True
        for an in allowed_names:
            if _food_keys_same_product(fk, _food_match_key(an), raw, an):
                return True
        return False

    def _filter_groups(groups: list) -> list:
        out = []
        for g in groups or []:
            if not isinstance(g, dict):
                continue
            items = [
                it for it in (g.get("items") or [])
                if _ok(str(it.get("product_name") or it.get("matched_name") or ""))
            ]
            if not items:
                continue
            ng = dict(g)
            ng["items"] = items
            ng["subtotal_pln"] = round(sum(float(x.get("line_total") or 0) for x in items), 2)
            min_v = float(ng.get("min_order_value") or 0)
            ng["meets_minimum_order"] = (min_v <= 0) or (ng["subtotal_pln"] >= min_v)
            if min_v > 0:
                ng["gap_to_minimum_pln"] = round(max(0.0, min_v - ng["subtotal_pln"]), 2)
            out.append(ng)
        return out

    for key in ("scenario_split_max", "scenario_monolith", "scenario_smart_hybrid"):
        sc = result.get(key)
        if isinstance(sc, dict) and isinstance(sc.get("suppliers"), list):
            sc["suppliers"] = _filter_groups(sc["suppliers"])
            _recompute_scenario_totals(sc)
    if isinstance(result.get("scenarios"), list):
        for sc in result["scenarios"]:
            if isinstance(sc, dict) and isinstance(sc.get("suppliers"), list):
                sc["suppliers"] = _filter_groups(sc["suppliers"])
                _recompute_scenario_totals(sc)
    for key in ("variant_split", "option_optimized"):
        vs = result.get(key)
        if isinstance(vs, dict) and isinstance(vs.get("suppliers"), list):
            vs["suppliers"] = _filter_groups(vs["suppliers"])
            vs["total_pln"] = round(
                sum(float(g.get("subtotal_pln") or 0) for g in vs["suppliers"]), 2,
            )
    best = result.get("best_option")
    if isinstance(best, dict):
        if isinstance(best.get("suppliers"), list):
            best["suppliers"] = _filter_groups(best["suppliers"])
        if isinstance(best.get("items"), list):
            best["items"] = [
                it for it in best["items"]
                if _ok(str(it.get("product_name") or it.get("matched_name") or ""))
            ]
            best["subtotal_pln"] = round(
                sum(float(x.get("line_total") or 0) for x in best["items"]), 2,
            )
            best["total_pln"] = best.get("total_pln") or best["subtotal_pln"]
    return result

__all__ = ['_dedupe_products_across_supplier_groups', '_filter_compare_to_requested_products', '_merge_duplicate_compare_items', '_recompute_scenario_totals', '_sanitize_optimize_unique_products']
