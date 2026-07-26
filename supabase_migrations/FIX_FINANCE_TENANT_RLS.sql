-- =============================================================================
-- FIX: Izolacja finansów + token_usage per account_key (jak magazyn/menu)
-- Uruchom w Supabase SQL Editor PO FIX_TENANT_RLS.sql
-- Idempotentne.
--
-- Problem: revenue/fixed/variable/daily_reports/token_usage miały otwarte RLS
-- (lub brak account_key) → nowi użytkownicy widzieli dane demo z 'default'.
--
-- UWAGA (2026-07): nadal aktualne przy wyciekach tenantowych.
-- Dla ofert/katalogu dostawców uruchom też FIX_SUPPLIER_TENANT_RLS.sql.
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

DO $$
DECLARE
  t text;
  p text;
  tables text[] := ARRAY[
    'revenue_entries',
    'fixed_costs',
    'variable_cost_entries',
    'daily_reports',
    'token_usage',
    'sales_log',
    'financial_records'
  ];
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

    -- Usuń otwarte / stare polityki (OR w RLS wyciekało dane).
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

-- daily_reports: date UNIQUE globalnie blokuje multi-tenant → (account_key, date)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'daily_reports'
  ) THEN
    ALTER TABLE public.daily_reports DROP CONSTRAINT IF EXISTS daily_reports_date_key;
    -- Nazwa z CREATE TABLE IF NOT EXISTS bywa inna
    BEGIN
      ALTER TABLE public.daily_reports DROP CONSTRAINT IF EXISTS daily_reports_date_unique;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_account_date_uidx
      ON public.daily_reports (account_key, date);
  END IF;
END $$;

-- Wyczyść wyłącznie współdzielone demo finance pod account_key='default'
-- (nie tyka kont ak_* użytkowników). Bezpieczne: to dane SIM/test lipcowe.
DO $$
DECLARE
  t text;
  wipe text[] := ARRAY[
    'revenue_entries',
    'fixed_costs',
    'variable_cost_entries',
    'daily_reports',
    'token_usage',
    'sales_log',
    'financial_records'
  ];
BEGIN
  FOREACH t IN ARRAY wipe LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'account_key'
    ) THEN
      EXECUTE format('DELETE FROM public.%I WHERE account_key = %L', t, 'default');
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
