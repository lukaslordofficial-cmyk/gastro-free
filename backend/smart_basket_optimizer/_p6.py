from __future__ import annotations

from bargain_hunter import PRICE_TOLERANCE
from bargain_hunter import fmt_pln
from typing import Any
from typing import Optional
import hashlib
import json
import time
from ._p0 import CACHE_TTL_SEC, _RESULT_CACHE, resolve_lead_time_days



def apply_cart_objective(
    result: dict[str, Any],
    objective: Optional[str],
    suppliers_meta: Optional[dict[str, dict]] = None,
) -> dict[str, Any]:
    """Ustaw recommended_scenario_id wg preferencji użytkownika.

    - lowest_price → split_max (najniższa suma produktów)
    - min_deliveries → monolith (minimalna liczba dostaw)
    - fast_delivery → scenariusz z najkrótszym max(lead_time) wśród dostawców
    """
    if not result or not isinstance(result, dict):
        return result
    obj = (objective or "").strip().lower()
    aliases = {
        "najniższa cena": "lowest_price",
        "najnizsza cena": "lowest_price",
        "price": "lowest_price",
        "lowest": "lowest_price",
        "minimalna liczba dostaw": "min_deliveries",
        "min dostaw": "min_deliveries",
        "monolith": "min_deliveries",
        "szybki czas dostawy": "fast_delivery",
        "szybka dostawa": "fast_delivery",
        "fast": "fast_delivery",
        "lead_time": "fast_delivery",
    }
    obj = aliases.get(obj, obj)
    if obj not in ("lowest_price", "min_deliveries", "fast_delivery"):
        result["cart_objective"] = objective
        return result

    scenarios = {
        "split_max": result.get("scenario_split_max") or {},
        "monolith": result.get("scenario_monolith") or {},
        "smart_hybrid": result.get("scenario_smart_hybrid") or {},
    }
    meta = suppliers_meta or {}

    def _max_lead(sc: dict) -> float:
        leads = []
        for g in sc.get("suppliers") or []:
            sid = g.get("supplier_id")
            m = meta.get(sid) or {}
            leads.append(resolve_lead_time_days(m))
        return max(leads) if leads else 1e9

    def _supplier_count(sc: dict) -> int:
        return len(sc.get("suppliers") or [])

    pick_id = None
    if obj == "lowest_price":
        pick_id = "split_max"
        # jeśli split niewykonalny — najtańszy viable
        if not (scenarios["split_max"] or {}).get("suppliers"):
            ranked = sorted(
                [(sid, sc) for sid, sc in scenarios.items() if sc.get("suppliers")],
                key=lambda x: float(x[1].get("total_pln") or 1e18),
            )
            pick_id = ranked[0][0] if ranked else None
    elif obj == "min_deliveries":
        pick_id = "monolith"
        if not (scenarios["monolith"] or {}).get("suppliers"):
            ranked = sorted(
                [(sid, sc) for sid, sc in scenarios.items() if sc.get("suppliers")],
                key=lambda x: (_supplier_count(x[1]), float(x[1].get("total_pln") or 1e18)),
            )
            pick_id = ranked[0][0] if ranked else None
    else:  # fast_delivery
        ranked = sorted(
            [(sid, sc) for sid, sc in scenarios.items() if sc.get("suppliers")],
            key=lambda x: (_max_lead(x[1]), float(x[1].get("total_pln") or 1e18)),
        )
        pick_id = ranked[0][0] if ranked else None

    if pick_id:
        result["recommended_scenario_id"] = pick_id
        result["cheaper_variant"] = (
            "split" if pick_id == "split_max"
            else ("monolith" if pick_id == "monolith" else "hybrid")
        )
    result["cart_objective"] = obj
    return result


def build_smart_speech(result: dict) -> str:
    if not result.get("items_requested") or not any(
        i.get("found") for i in result["items_requested"]
    ):
        return (
            "Niestety nie znalazłem produktów w katalogu dostawców. "
            "Dodaj oferty dostawców (faktura / katalog PDF)."
        )
    if not result.get("is_multivariable"):
        best = result.get("best_option")
        if best and best.get("supplier_name"):
            return (
                f"Najlepsza oferta: {best['supplier_name']} za "
                f"{fmt_pln(best.get('total_pln') or 0)}. Możesz od razu zamówić."
            )
        if best and best.get("suppliers"):
            names = ", ".join(g["supplier_name"] for g in best["suppliers"])
            return f"Optymalny koszyk: {names} łącznie {fmt_pln(best.get('total_pln') or 0)}."
        return "Znalazłem oferty — wybierz poniżej."

    parts = []
    for sc in result.get("scenarios") or []:
        if not sc.get("viable"):
            continue
        parts.append(
            f"{sc['label']}: {sc['supplier_count']} dost. · {fmt_pln(sc['total_pln'])}"
        )
    speech = " | ".join(parts) if parts else "Porównaj scenariusze poniżej."
    sav = float(result.get("savings_amount") or 0)
    if sav > PRICE_TOLERANCE:
        speech += f" Możesz zaoszczędzić do {fmt_pln(sav)} vs konsolidacja."
    speech += " Który wariant wybierasz?"
    return speech


# ── Cache ────────────────────────────────────────────────────────────────────

def make_cache_key(critical_fingerprint: str, price_fingerprint: str) -> str:
    raw = f"{critical_fingerprint}|{price_fingerprint}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def fingerprint_critical(critical: list[dict]) -> str:
    rows = sorted(
        (str(c.get("id") or c.get("name")), round(float(c.get("deficit") or c.get("quantity") or 0), 4))
        for c in critical
    )
    return hashlib.sha256(json.dumps(rows).encode()).hexdigest()


def fingerprint_prices(per_item: list[dict], suppliers_meta: dict) -> str:
    blob = []
    for pi in per_item:
        quotes = []
        for sid, b in sorted((pi.get("best_by_supplier") or {}).items()):
            quotes.append((sid, round(float(b.get("line_total") or 0), 2)))
        blob.append((pi["product_name"], quotes))
    meta = {
        sid: (
            round(float(m.get("min_order_value") or 0), 2),
            round(float(m.get("shipping_cost") or 0), 2),
            round(float(m.get("free_shipping_threshold") or 0), 2),
        )
        for sid, m in sorted(suppliers_meta.items())
    }
    return hashlib.sha256(json.dumps({"i": blob, "m": meta}, sort_keys=True).encode()).hexdigest()


def cache_get(key: str) -> Optional[dict]:
    entry = _RESULT_CACHE.get(key)
    if not entry:
        return None
    exp, payload = entry
    if time.time() > exp:
        _RESULT_CACHE.pop(key, None)
        return None
    out = dict(payload)
    out["from_cache"] = True
    return out


def cache_set(key: str, payload: dict, ttl: int = CACHE_TTL_SEC) -> None:
    clean = {k: v for k, v in payload.items() if k != "from_cache"}
    _RESULT_CACHE[key] = (time.time() + ttl, clean)


def cache_clear() -> None:
    _RESULT_CACHE.clear()

__all__ = ['apply_cart_objective', 'build_smart_speech', 'cache_clear', 'cache_get', 'cache_set', 'fingerprint_critical', 'fingerprint_prices', 'make_cache_key']
