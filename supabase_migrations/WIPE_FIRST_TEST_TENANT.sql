-- =============================================================================
-- WIPE: shared demo tenant `default` + first early-test profile
-- Project: tucmmrcwwcltkqwyvzxa
--
-- SAFE SCOPE (do NOT expand without review):
--   1) account_key = 'default'  — shared demo / race-fallback wallet (Premium leak)
--   2) first test profile lukaslord.official@gmail.com
--      account_key = ak_8adc1de5fced4ae8bb1e554b92f54bdf
--
-- Does NOT touch other beta profiles (mithril.*, palac.*, etc.).
-- Idempotent deletes.
-- =============================================================================

DO $$
DECLARE
  wipe_keys text[] := ARRAY[
    'default',
    'ak_8adc1de5fced4ae8bb1e554b92f54bdf'
  ];
  k text;
  t text;
  tenant_tables text[] := ARRAY[
    'inventory_items',
    'inventory_categories',
    'menu_items',
    'suppliers',
    'waste_logs',
    'warehouse_inventory',
    'supplier_offers',
    'revenue_entries',
    'fixed_costs',
    'variable_cost_entries',
    'daily_reports',
    'token_usage',
    'sales_log',
    'financial_records',
    'subscriptions'
  ];
  sid uuid;
BEGIN
  FOREACH k IN ARRAY wipe_keys LOOP
    -- Catalog / offer children via suppliers of this tenant
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'suppliers'
    ) THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'supplier_catalog'
      ) THEN
        DELETE FROM public.supplier_catalog sc
        WHERE sc.supplier_id IN (
          SELECT s.id FROM public.suppliers s WHERE s.account_key = k
        );
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'supplier_offer_items'
      ) THEN
        DELETE FROM public.supplier_offer_items soi
        WHERE soi.offer_id IN (
          SELECT o.id FROM public.supplier_offers o WHERE o.account_key = k
        )
        OR soi.supplier_id IN (
          SELECT s.id FROM public.suppliers s WHERE s.account_key = k
        );
      END IF;
    END IF;

    -- recipe_ingredients via menu_items
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'recipe_ingredients'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'menu_items'
    ) THEN
      DELETE FROM public.recipe_ingredients ri
      WHERE ri.menu_item_id IN (
        SELECT m.id FROM public.menu_items m WHERE m.account_key = k
      );
    END IF;

    -- expiry batches / invoice children if present
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'inventory_expiry_batches'
    ) THEN
      BEGIN
        DELETE FROM public.inventory_expiry_batches b
        WHERE b.account_key = k
           OR b.inventory_item_id IN (
                SELECT i.id FROM public.inventory_items i WHERE i.account_key = k
              );
      EXCEPTION WHEN undefined_column THEN
        DELETE FROM public.inventory_expiry_batches b
        WHERE b.inventory_item_id IN (
          SELECT i.id FROM public.inventory_items i WHERE i.account_key = k
        );
      END;
    END IF;

    FOREACH t IN ARRAY tenant_tables LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = t
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'account_key'
      ) THEN
        EXECUTE format('DELETE FROM public.%I WHERE account_key = %L', t, k);
      END IF;
    END LOOP;
  END LOOP;

  -- Usuń profil pierwszego testu (auth user opcjonalnie — wymaga dashboard / Admin API)
  DELETE FROM public.profiles
  WHERE id = '8adc1de5-fced-4ae8-bb1e-554b92f54bdf'
     OR account_key = 'ak_8adc1de5fced4ae8bb1e554b92f54bdf'
     OR lower(email) = 'lukaslord.official@gmail.com';
END $$;

-- Po wipe: NIE odtwarzaj Premium na „default”.
-- Jeśli ktoś potrzebuje legacy wiersza — Free + 0 (nie 1000, żeby nie kusiło UI).
INSERT INTO public.subscriptions (account_key, tier_level, credits_balance, status, free_starter_claimed)
VALUES ('default', 0, 0, 'active', true)
ON CONFLICT (account_key) DO UPDATE
SET tier_level = 0,
    credits_balance = 0,
    status = 'active',
    free_starter_claimed = true,
    updated_at = now();

NOTIFY pgrst, 'reload schema';
