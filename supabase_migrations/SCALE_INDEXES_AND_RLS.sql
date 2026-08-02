-- =============================================================================
-- SCALE: indeksy B-Tree + audyt RLS pod wielu tenantów naraz (dekalog §IV / §VII)
-- Uruchom w Supabase SQL Editor. Idempotentne.
-- Indeksy z kolumną status/created_at — TYLKO jeśli kolumna istnieje (unika 42703).
-- =============================================================================

-- --- 1) Pewne indeksy --------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inv_items_ak ON public.inventory_items (account_key);
CREATE INDEX IF NOT EXISTS idx_inv_cats_ak ON public.inventory_categories (account_key);
CREATE INDEX IF NOT EXISTS idx_suppliers_ak ON public.suppliers (account_key);
CREATE INDEX IF NOT EXISTS idx_rev_ak_ym ON public.revenue_entries (account_key, year_month);
CREATE INDEX IF NOT EXISTS idx_fixed_ak_ym ON public.fixed_costs (account_key, year_month);
CREATE INDEX IF NOT EXISTS idx_var_ak_ym ON public.variable_cost_entries (account_key, year_month);
CREATE INDEX IF NOT EXISTS idx_offers_ak ON public.supplier_offers (account_key);
CREATE INDEX IF NOT EXISTS idx_offer_items_supplier ON public.supplier_offer_items (supplier_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_ak ON public.menu_items (account_key);
CREATE INDEX IF NOT EXISTS idx_waste_logs_ak ON public.waste_logs (account_key);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_menu
  ON public.recipe_ingredients (menu_item_id);

-- --- 2) Warunkowe indeksy (kolumna może nie istnieć) --------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supplier_offers' AND column_name = 'status'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_offers_ak_status ON public.supplier_offers (account_key, status)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supplier_orders' AND column_name = 'status'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_status ON public.supplier_orders (status)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supplier_orders' AND column_name = 'created_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_created ON public.supplier_orders (created_at DESC)';
  END IF;
END $$;

-- --- current_account_key (jeśli brak) ---------------------------------------
CREATE OR REPLACE FUNCTION public.current_account_key()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT p.account_key INTO k
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
  IF k IS NOT NULL AND length(trim(k)) > 0 THEN
    RETURN k;
  END IF;
  RETURN 'ak_' || replace(auth.uid()::text, '-', '');
END;
$$;

REVOKE ALL ON FUNCTION public.current_account_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_account_key() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_account_key() TO service_role;

-- --- RLS: tabele z kolumną account_key --------------------------------------
DO $$
DECLARE
  t text;
  p text;
  tables text[] := ARRAY[
    'inventory_items',
    'inventory_categories',
    'suppliers',
    'supplier_offers',
    'supplier_orders',
    'menu_items',
    'waste_logs',
    'revenue_entries',
    'fixed_costs',
    'variable_cost_entries',
    'financial_records',
    'supplier_catalog'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
    END IF;

    -- supplier_catalog może nie mieć account_key (tenant przez supplier_id)
    IF t = 'supplier_catalog' THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'account_key'
      ) THEN
        -- polityka przez join do suppliers
        EXECUTE 'ALTER TABLE public.supplier_catalog ENABLE ROW LEVEL SECURITY';
        DROP POLICY IF EXISTS supplier_catalog_tenant_all ON public.supplier_catalog;
        CREATE POLICY supplier_catalog_tenant_all ON public.supplier_catalog
          FOR ALL TO authenticated
          USING (
            EXISTS (
              SELECT 1 FROM public.suppliers s
              WHERE s.id = supplier_id AND s.account_key = public.current_account_key()
            )
          )
          WITH CHECK (
            EXISTS (
              SELECT 1 FROM public.suppliers s
              WHERE s.id = supplier_id AND s.account_key = public.current_account_key()
            )
          );
        CONTINUE;
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'account_key'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN account_key text NOT NULL DEFAULT %L',
        t, 'default'
      );
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_delete', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_all', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
       USING (account_key = public.current_account_key())',
      t || '_tenant_select', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
       WITH CHECK (account_key = public.current_account_key())',
      t || '_tenant_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
       USING (account_key = public.current_account_key())
       WITH CHECK (account_key = public.current_account_key())',
      t || '_tenant_update', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
       USING (account_key = public.current_account_key())',
      t || '_tenant_delete', t
    );
  END LOOP;
END $$;

-- --- recipe_ingredients: tenant przez menu_items (brak własnego account_key) -
DO $$
DECLARE
  p text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'recipe_ingredients'
  ) THEN
    ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;

    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'recipe_ingredients'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.recipe_ingredients', p);
    END LOOP;

    CREATE POLICY recipe_ingredients_tenant_all ON public.recipe_ingredients
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.menu_items m
          WHERE m.id = menu_item_id AND m.account_key = public.current_account_key()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.menu_items m
          WHERE m.id = menu_item_id AND m.account_key = public.current_account_key()
        )
      );

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_ingredients TO authenticated;
  END IF;
END $$;

-- --- supplier_offer_items / supplier_order_items przez parent --------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'supplier_offer_items'
  ) THEN
    ALTER TABLE public.supplier_offer_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS supplier_offer_items_tenant_all ON public.supplier_offer_items;
    CREATE POLICY supplier_offer_items_tenant_all ON public.supplier_offer_items
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.suppliers s
          WHERE s.id = supplier_id AND s.account_key = public.current_account_key()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.suppliers s
          WHERE s.id = supplier_id AND s.account_key = public.current_account_key()
        )
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'supplier_order_items'
  ) THEN
    ALTER TABLE public.supplier_order_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS supplier_order_items_tenant_all ON public.supplier_order_items;
    CREATE POLICY supplier_order_items_tenant_all ON public.supplier_order_items
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.supplier_orders o
          JOIN public.suppliers s ON s.id = o.supplier_id
          WHERE o.id = order_id AND s.account_key = public.current_account_key()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.supplier_orders o
          JOIN public.suppliers s ON s.id = o.supplier_id
          WHERE o.id = order_id AND s.account_key = public.current_account_key()
        )
      );
  END IF;
END $$;
