-- =============================================================================
-- GASTRO MANAGER — Soft-delete dla dostawców i magazynu (odwracalne usuwanie)
-- Wklej i uruchom w Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Skrypt jest IDEMPOTENTNY — można uruchamiać wielokrotnie.
-- Po uruchomieniu komendy głosowe „usuń wszystkich dostawców" / „usuń produkt z
-- magazynu" będą działać odwracalnie (rekord zostaje, ustawiany jest is_active=false).
-- =============================================================================

-- 1) suppliers.is_active — soft-delete dostawców
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active ON suppliers(is_active);

-- 2) inventory_items.is_active — soft-delete produktów magazynowych
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_inventory_items_is_active ON inventory_items(is_active);
