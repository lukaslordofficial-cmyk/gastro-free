-- =============================================================================
-- kitchen_utensils: izolacja tenant + RLS (naczynia w Magazynie)
-- Idempotentne.
-- =============================================================================

ALTER TABLE public.kitchen_utensils
  ADD COLUMN IF NOT EXISTS account_key text;

CREATE INDEX IF NOT EXISTS kitchen_utensils_account_key_idx
  ON public.kitchen_utensils (account_key);

-- Backfill: jeśli są wiersze bez account_key, zostaw NULL / default —
-- FE seeduje per konto; stare globalne wiersze nie pokazujemy nowym kontom.

ALTER TABLE public.kitchen_utensils ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  p text;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'kitchen_utensils'
      AND policyname NOT LIKE '%tenant%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.kitchen_utensils', p);
  END LOOP;
END $$;

DROP POLICY IF EXISTS kitchen_utensils_tenant_select ON public.kitchen_utensils;
DROP POLICY IF EXISTS kitchen_utensils_tenant_insert ON public.kitchen_utensils;
DROP POLICY IF EXISTS kitchen_utensils_tenant_update ON public.kitchen_utensils;
DROP POLICY IF EXISTS kitchen_utensils_tenant_delete ON public.kitchen_utensils;

CREATE POLICY kitchen_utensils_tenant_select ON public.kitchen_utensils
  FOR SELECT TO authenticated
  USING (account_key = public.current_account_key());

CREATE POLICY kitchen_utensils_tenant_insert ON public.kitchen_utensils
  FOR INSERT TO authenticated
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY kitchen_utensils_tenant_update ON public.kitchen_utensils
  FOR UPDATE TO authenticated
  USING (account_key = public.current_account_key())
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY kitchen_utensils_tenant_delete ON public.kitchen_utensils
  FOR DELETE TO authenticated
  USING (account_key = public.current_account_key());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kitchen_utensils TO authenticated;

NOTIFY pgrst, 'reload schema';
