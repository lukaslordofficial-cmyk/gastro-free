-- =============================================================================
-- PROD SCALE: gorące indeksy account_key (10k+ tenantów równolegle)
-- Idempotentne. Uruchom w Supabase SQL Editor.
-- Nie rusza istniejących polityk RLS z SCALE_INDEXES_AND_RLS.sql.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'account_key'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_subscriptions_ak ON public.subscriptions (account_key)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'token_usage' AND column_name = 'account_key'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_token_usage_ak ON public.token_usage (account_key)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'token_usage' AND column_name = 'account_key'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'token_usage' AND column_name = 'created_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_token_usage_ak_created ON public.token_usage (account_key, created_at DESC)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supplier_orders' AND column_name = 'account_key'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_supplier_orders_ak ON public.supplier_orders (account_key)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supplier_orders'
      AND column_name = 'account_key'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supplier_orders' AND column_name = 'status'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_supplier_orders_ak_status ON public.supplier_orders (account_key, status)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'waste_logs' AND column_name = 'account_key'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'waste_logs' AND column_name = 'created_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_waste_logs_ak_created ON public.waste_logs (account_key, created_at DESC)';
  END IF;
END $$;

-- RLS: subscriptions + token_usage (backend i tak filtruje service_role)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions', 'token_usage'] LOOP
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
      CONTINUE;
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
