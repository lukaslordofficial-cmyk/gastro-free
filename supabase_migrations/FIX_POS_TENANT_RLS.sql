-- =============================================================================
-- POS: izolacja tenant (pos_settings, pos_products, recipes)
-- Problem: tabele POS nie miały account_key / otwarte RLS → jeden lokal
-- widział mapowanie i klucze API innego.
-- Idempotentne — uruchom w Supabase SQL Editor.
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

CREATE TABLE IF NOT EXISTS public.pos_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_system text,
  api_key text,
  location_id text,
  webhook_url text,
  is_connected boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  account_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pos_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_external_id text NOT NULL,
  name text NOT NULL,
  price_pln numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  account_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_product_id uuid,
  warehouse_product_id uuid,
  quantity_per_portion numeric NOT NULL DEFAULT 0,
  unit text,
  account_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  t text;
  p text;
  tables text[] := ARRAY['pos_settings', 'pos_products', 'recipes'];
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

-- Jeden wiersz ustawień POS na restaurację (gdy duplikaty — index się nie utworzy)
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS pos_settings_account_key_uidx
    ON public.pos_settings (account_key)
    WHERE account_key IS NOT NULL AND btrim(account_key) <> '' AND account_key <> 'default';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'pos_settings: duplikaty account_key — pominięto unique index';
END $$;

-- SKU POS unikalny per tenant (gdy są duplikaty — index się nie utworzy, reszta migracji OK)
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS pos_products_tenant_sku_uq
    ON public.pos_products (account_key, pos_external_id);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'pos_products: duplikaty (account_key, pos_external_id) — pominięto unique index';
END $$;

COMMENT ON COLUMN public.pos_settings.account_key IS
  'Tenant key — izolacja konfiguracji POS per restauracja.';
COMMENT ON COLUMN public.pos_products.account_key IS
  'Tenant key — izolacja produktów POS per restauracja.';
COMMENT ON COLUMN public.recipes.account_key IS
  'Tenant key — izolacja receptur POS per restauracja.';

NOTIFY pgrst, 'reload schema';
