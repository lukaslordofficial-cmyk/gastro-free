-- =============================================================================
-- Kategoria magazynowa „Półprodukty” (combo) — seed dla istniejących kont.
-- Idempotent: nie tworzy duplikatów po nazwie (case-insensitive).
-- =============================================================================

INSERT INTO public.inventory_categories (name, color, icon_name, sort_order, account_key)
SELECT
  'Półprodukty',
  '#A855F7',
  'package',
  125,
  ak.account_key
FROM (
  SELECT DISTINCT account_key
  FROM public.inventory_categories
  WHERE account_key IS NOT NULL AND btrim(account_key) <> ''
) ak
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inventory_categories ic
  WHERE ic.account_key = ak.account_key
    AND lower(btrim(ic.name)) = lower('Półprodukty')
);

-- Istniejące combo → kategoria Półprodukty + jednostka porcja (best-effort)
UPDATE public.inventory_items ii
SET
  category_id = ic.id,
  unit = CASE
    WHEN ii.unit IS NULL OR btrim(ii.unit) = '' OR lower(ii.unit) IN ('szt', 'szt.', 'opak')
      THEN 'porcja'
    ELSE ii.unit
  END
FROM public.inventory_categories ic
WHERE ii.is_combo_polprodukt IS TRUE
  AND ii.account_key IS NOT NULL
  AND ic.account_key = ii.account_key
  AND lower(btrim(ic.name)) = lower('Półprodukty')
  AND (
    ii.category_id IS DISTINCT FROM ic.id
    OR ii.unit IS NULL
    OR lower(btrim(ii.unit)) IN ('szt', 'szt.', 'opak', '')
  );
