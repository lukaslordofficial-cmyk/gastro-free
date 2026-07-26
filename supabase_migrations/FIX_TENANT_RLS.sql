-- =============================================================================
-- FIX: RLS tenant — insert/update działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działa działają nawet gdy wiersz w profiles
-- jeszcze nie istnieje (np. race po rejestracji).
-- Uruchom w Supabase SQL Editor PO ADD_TENANT_ISOLATION.sql
-- =============================================================================

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
  -- Fallback zgodny z AuthContext: ak_<uuid bez kresek>
  RETURN 'ak_' || replace(auth.uid()::text, '-', '');
END;
$$;

REVOKE ALL ON FUNCTION public.current_account_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_account_key() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_account_key() TO service_role;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'inventory_items',
    'inventory_categories',
    'menu_items',
    'suppliers',
    'waste_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_delete', t);

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

-- recipe_ingredients: brak account_key — dostęp przez menu_item właściciela
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'recipe_ingredients'
  ) THEN
    ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS recipe_ingredients_tenant_all ON public.recipe_ingredients;
    CREATE POLICY recipe_ingredients_tenant_all ON public.recipe_ingredients
      FOR ALL TO authenticated
      USING (
        menu_item_id IN (
          SELECT m.id FROM public.menu_items m
          WHERE m.account_key = public.current_account_key()
        )
      )
      WITH CHECK (
        menu_item_id IN (
          SELECT m.id FROM public.menu_items m
          WHERE m.account_key = public.current_account_key()
        )
      );
  END IF;
END $$;
