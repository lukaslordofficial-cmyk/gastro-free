# Łowca Okazji — Odmiana / Wariant produktu (rozszerzenie)

## Problem
Restaurator może doprecyzować produkt magazynowy opcjonalną ODMIANĄ/WARIANTEM
(np. ziemniak → Irys, jabłko → Jonagold, marchew → BIO). Łowca Okazji ma najpierw
szukać dokładnie tej odmiany; jeśli nie znajdzie — NIE podmieniać automatycznie,
tylko zaproponować zamienniki (inne odmiany tego samego produktu) do ręcznego
dodania do koszyka. Kompatybilność wsteczna: brak odmiany = dawne zachowanie.

## Architektura (istniejąca)
- Backend: FastAPI + Supabase (supabase_rest). Łowca: compare_offers_impl.py,
  bargain_hunter.py, smart_basket_optimizer, matching_utils, pl_fuzzy_norm.
- Frontend: Expo / React Native. Magazyn: app/(tabs)/magazyn.tsx + components/magazyn/*.
  Łowca: components/DealHunterModal.tsx + lib/bargainHunter.ts.

## Zaimplementowano (2026-06)
- backend/variant_matching.py — NOWY moduł czystych funkcji (normalizacja PL bez
  wycinania bio/premium; base_matches_offer stem-aware; variant_matches_offer z
  tolerancją '70+/kl. I/65/70'; offer_variant_label; classify_offer exact/substitute/none).
- models.CompareItem.variant (Optional).
- compare_offers_impl.py: dla pozycji z odmianą zbiera oferty produktu podstawowego,
  do koszyka wpuszcza WYŁĄCZNIE exact; buduje result['variant_reports'] z zamiennikami
  (grupowane po odmianie, sort po cenie, z catalog_product_id + supplier_id do add-to-cart);
  fallback odmiany z magazynu (inv_variant_by_id, fail-soft). Kompatybilne wstecz.
- supabase_migrations/ADD_INVENTORY_VARIANT.sql — kolumna inventory_items.variant.
- Frontend: pole "Odmiana / wariant (opcjonalnie)" w formularzu magazynu + zapis/edycja
  (inventoryService, BLANK_FORM, payload, openEditItem); wyświetlanie "Odmiana: X" na karcie;
  DealHunterModal wysyła variant, renderuje "🔎 Szukasz: …", ostrzeżenie o braku odmiany
  i listę zamienników z "+" (addSubstituteToCart → draft koszyka dostawcy); typy w
  lib/bargainHunter.ts (VariantReport) + passthrough w normalizeOptimizeResult; lib/types.ts.

## Testy
- backend: tests/test_variant_matching.py (13), tests/test_variant_compare_offers.py (4) — PASS.
- Regresja: deal_hunter_phase2 + smart_basket_optimizer + actions_orders_lp_routes — PASS.
- Testing agent iteration_1.json: backend 100%, brak regresji.

## Ograniczenia środowiska
- Pełna aplikacja NIE uruchamia się w sandboxie (brak sekretów Supabase + Expo/RN).
  Weryfikacja frontendu wymaga uruchomienia przez użytkownika (Expo + realna baza).
- Wymagane: zastosować migrację ADD_INVENTORY_VARIANT.sql na bazie Supabase.

## Backlog / next
- Eskalacja AI przy niepewnym dopasowaniu odmiany (obecnie deterministyczne).
- Wariant honorowany też w ścieżce krytycznych braków (fallback z magazynu już działa).
