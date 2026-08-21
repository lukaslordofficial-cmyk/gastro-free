-- =============================================================================
-- pos_sales_log: izolacja tenant (account_key + RLS)
-- Backend filtruje service_role przez _TENANT_TABLES; RLS na wypadek klienta.
-- Idempotentne.
-- =============================================================================

ALTER TABLE public.pos_sales_log
  ADD COLUMN IF NOT EXISTS account_key text NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS pos_sales_log_account_key_idx
  ON public.pos_sales_log (account_key);

ALTER TABLE public.pos_sales_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  p text;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pos_sales_log'
      AND policyname NOT LIKE '%tenant%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.pos_sales_log', p);
  END LOOP;
END $$;

DROP POLICY IF EXISTS pos_sales_log_tenant_select ON public.pos_sales_log;
DROP POLICY IF EXISTS pos_sales_log_tenant_insert ON public.pos_sales_log;
DROP POLICY IF EXISTS pos_sales_log_tenant_update ON public.pos_sales_log;
DROP POLICY IF EXISTS pos_sales_log_tenant_delete ON public.pos_sales_log;

CREATE POLICY pos_sales_log_tenant_select ON public.pos_sales_log
  FOR SELECT TO authenticated
  USING (account_key = public.current_account_key());

CREATE POLICY pos_sales_log_tenant_insert ON public.pos_sales_log
  FOR INSERT TO authenticated
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY pos_sales_log_tenant_update ON public.pos_sales_log
  FOR UPDATE TO authenticated
  USING (account_key = public.current_account_key())
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY pos_sales_log_tenant_delete ON public.pos_sales_log
  FOR DELETE TO authenticated
  USING (account_key = public.current_account_key());

COMMENT ON COLUMN public.pos_sales_log.account_key IS
  'Tenant key — musi zgadzać się z profiles.account_key restauracji.';
