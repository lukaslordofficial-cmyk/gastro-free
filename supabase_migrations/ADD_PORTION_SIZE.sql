-- =============================================================================
-- ADD_PORTION_SIZE.sql
-- Migracja: przenosi "wielkość porcji" z tabeli recipe_ingredients (legacy wiersz
-- 'Porcja') do parametru nadrzędnego menu_items.portion_size_grams.
-- Uruchom w Supabase SQL Editor.
-- =============================================================================

-- 1) Kolumny nadrzędne na potrawie
ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS portion_size_grams NUMERIC NULL;

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS portion_size_unit TEXT NULL;

-- 2) Backfill z legacy wierszy 'Porcja' (kg→g, l→ml zamieniamy 1:1 na gramy
--    zgodnie z domyślną gęstością kulinarną 1 g = 1 ml).
WITH legacy AS (
    SELECT DISTINCT ON (menu_item_id)
           menu_item_id,
           CASE
               WHEN LOWER(TRIM(unit)) = 'kg'                            THEN quantity * 1000.0
               WHEN LOWER(TRIM(unit)) IN ('l', 'litr', 'litry')         THEN quantity * 1000.0
               WHEN LOWER(TRIM(unit)) IN ('g', 'gram', 'gramy', 'ml')   THEN quantity
               ELSE quantity
           END AS qty_grams,
           CASE
               WHEN LOWER(TRIM(unit)) IN ('l', 'litr', 'litry', 'ml')   THEN 'ml'
               WHEN LOWER(TRIM(unit)) IN ('szt', 'szt.', 'sztuka', 'sztuki', 'porcja', 'porcje') THEN 'szt'
               ELSE 'g'
           END AS unit_norm
    FROM recipe_ingredients
    WHERE LOWER(TRIM(ingredient_name)) IN (
        'porcja', 'porcje',
        'wielkosc porcji', 'wielkość porcji',
        'gramatura', 'gramatura porcji'
    )
    ORDER BY menu_item_id, quantity DESC
)
UPDATE menu_items mi
SET portion_size_grams = legacy.qty_grams,
    portion_size_unit  = legacy.unit_norm
FROM legacy
WHERE mi.id = legacy.menu_item_id
  AND mi.portion_size_grams IS NULL;

-- 3) Usuń legacy wiersze 'Porcja' — nie mają być więcej składnikiem receptury.
DELETE FROM recipe_ingredients
WHERE LOWER(TRIM(ingredient_name)) IN (
    'porcja', 'porcje',
    'wielkosc porcji', 'wielkość porcji',
    'gramatura', 'gramatura porcji'
);

-- 4) (Opcjonalnie) usuń wpisy 'Porcja' z magazynu, jeśli parser AI wcześniej je dodał.
DELETE FROM inventory_items
WHERE LOWER(TRIM(name)) IN (
    'porcja', 'porcje',
    'wielkosc porcji', 'wielkość porcji',
    'gramatura', 'gramatura porcji'
);
