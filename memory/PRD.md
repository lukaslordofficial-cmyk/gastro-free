# Gastro-18 — Podział monolitu server.py (chore/split-monoliths)

## Zadanie
Repo: https://github.com/lukaslordofficial-cmyk/gastro-18 (branch `chore/split-monoliths`),
sklonowane do `/app/gastro-18`. Stack: FastAPI + Supabase REST (PostgREST) + OpenAI.
Cel: rozbić `backend/server.py` (11 472 linii) na moduły ~250 linii/plik, BEZ zmiany działania.

## Co zrobiono (2026-06)
- `server.py`: 11 472 → **348 linii**. Zostały tylko: FastAPI app, CORS, include_router,
  middleware multi-tenant, startup/shutdown, oraz re-eksporty (`from server import X` działa jak dawniej).
- Wydzielono **46 modułów** (byte-preserving — kod przeniesiony 1:1):
  - `app_core.py` — konfiguracja, klienci (OpenAI/HTTP), helpery bazowe.
  - `constants.py`, `models.py`/`models_scan.py`/`models_lp.py` — dane/schematy/Pydantic.
  - warstwy domenowe: matching, catalog_units, billing/subscription, interpret, actions,
    vision/catalog/invoice/menu, compare/orders/dispatch, analytics (periods/sales/waste/pnl/runners),
    local producers (lp_*).
- Architektura warstwowa (czysty DAG, brak cykli importów). Moduły domenowe importują z `app_core`.
- Test relokacji: `tests/test_pos_webhook_routes.py::test_single_recompute_definition` zaktualizowany,
  by sprawdzać źródło modułu, w którym funkcja teraz mieszka (intencja guardu zachowana).

## Weryfikacja
- Import OK, 106 tras (jak przed zmianą). Uvicorn startuje, `/api/health` = ok, 95 ścieżek OpenAPI.
- Suite testów repo: **299 passed / 46 failed / 1 skipped** — IDENTYCZNIE jak przed refaktorem.
  46 failów jest PRZED-ISTNIEJĄCYCH (testy integracyjne wymagające żywego serwera + kilka zależnych od danych).
  **Zero regresji** względem baseline.

## Pliki wciąż >250 linii (świadomie — pojedyncze duże funkcje / spójne dane)
constants.py(863, dane), orders_impl.py(687: `orders_critical_by_category` 586),
compare_offers_impl.py(626: `compare_offers` 594), invoice_impl.py(457: `_save_invoice` 379),
analytics_pnl.py(383: `_compute_true_pnl` 241), dispatch_impl.py(352), menu_confirm_impl.py(340).
Dalszy podział wymaga refaktoru wnętrza pojedynczych funkcji (ryzyko zmiany logiki) — celowo pominięty.
