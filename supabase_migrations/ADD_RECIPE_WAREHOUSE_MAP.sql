-- Mapowanie składników receptury → produkty magazynu (POS / Ustawienia).
-- Bez tej kolumny PostgREST zwraca: "Could not find the 'warehouse_product_id' column..."

ALTER TABLE recipe_ingredients
  ADD COLUMN IF NOT EXISTS warehouse_product_id uuid
  REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_warehouse
  ON recipe_ingredients(warehouse_product_id);

COMMENT ON COLUMN recipe_ingredients.warehouse_product_id IS
  'Opcjonalne FK do inventory_items — mapowanie POS / odejmowanie ze stanu.';
