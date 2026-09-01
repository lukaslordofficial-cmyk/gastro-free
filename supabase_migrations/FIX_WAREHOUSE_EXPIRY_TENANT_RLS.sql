-- =============================================================================
-- Magazyn / daty ważności: usuń otwarte polityki anon_all_* i dodaj RLS tenant.
-- ADD_WAREHOUSE_INVENTORY_EXPIRY.sql tworzyło USING (true) — wyciek między kontami
-- jeśli FIX_TENANT_RLS nie był odpalony PO tej migracji.
-- Idempotentne.
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
  RETURN 'ak_' || replace(auth.uid()::text, '-', '');
END;
$$;

REVOKE ALL ON FUNCTION public.current_account_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_account_key() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_account_key() TO service_role;

DROP POLICY IF EXISTS "anon_all_warehouse_inventory" ON public.warehouse_inventory;
DROP POLICY IF EXISTS "anon_all_warehouse_expiry_alerts" ON public.warehouse_expiry_alerts;

DO $$
DECLARE
  t text;
  p text;
  tables text[] := ARRAY['warehouse_inventory', 'warehouse_expiry_alerts'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
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

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (account_key)',
      t || '_account_key_idx', t
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND policyname NOT LIKE '%tenant%'
        AND policyname NOT LIKE 'service_%'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
    END LOOP;

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

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

COMMENT ON COLUMN public.warehouse_expiry_alerts.account_key IS
  'Tenant key — izolacja alertów dat ważności per restauracja.';

NOTIFY pgrst, 'reload schema';
