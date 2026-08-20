-- =============================================================================
-- restaurant_profile: izolacja tenant (account_key + RLS)
-- Backend woła tę tabelę service_role, ale RLS musi być tenant-aware
-- na wypadek zapytań z klienta. Idempotentne.
-- =============================================================================

ALTER TABLE public.restaurant_profile
  ADD COLUMN IF NOT EXISTS account_key text;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_profile_account_key_uidx
  ON public.restaurant_profile (account_key)
  WHERE account_key IS NOT NULL;

ALTER TABLE public.restaurant_profile ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  p text;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'restaurant_profile'
      AND policyname NOT LIKE '%tenant%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.restaurant_profile', p);
  END LOOP;
END $$;

DROP POLICY IF EXISTS restaurant_profile_tenant_select ON public.restaurant_profile;
DROP POLICY IF EXISTS restaurant_profile_tenant_insert ON public.restaurant_profile;
DROP POLICY IF EXISTS restaurant_profile_tenant_update ON public.restaurant_profile;
DROP POLICY IF EXISTS restaurant_profile_tenant_delete ON public.restaurant_profile;

CREATE POLICY restaurant_profile_tenant_select ON public.restaurant_profile
  FOR SELECT TO authenticated
  USING (account_key = public.current_account_key());

CREATE POLICY restaurant_profile_tenant_insert ON public.restaurant_profile
  FOR INSERT TO authenticated
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY restaurant_profile_tenant_update ON public.restaurant_profile
  FOR UPDATE TO authenticated
  USING (account_key = public.current_account_key())
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY restaurant_profile_tenant_delete ON public.restaurant_profile
  FOR DELETE TO authenticated
  USING (account_key = public.current_account_key());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_profile TO authenticated;

NOTIFY pgrst, 'reload schema';
