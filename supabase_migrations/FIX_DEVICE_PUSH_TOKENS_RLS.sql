-- =============================================================================
-- Harden RLS: device_push_tokens
-- Poprzednia polityka "device_push_tokens_all" miała USING(true)/WITH CHECK(true)
-- — każdy klient mógł czytać/pisać wszystkie tokeny.
--
-- Uruchom w Supabase SQL Editor PO ADD_DEVICE_PUSH_TOKENS.sql (i po FIX_PROD_SECURITY_RLS.sql
-- jeśli używasz current_account_key — tu wystarczy auth.uid()).
-- Idempotentne.
-- =============================================================================

ALTER TABLE IF EXISTS public.device_push_tokens ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'device_push_tokens'
  ) THEN
    RAISE NOTICE 'device_push_tokens missing — run ADD_DEVICE_PUSH_TOKENS.sql first';
    RETURN;
  END IF;

  -- Usuń stare otwarte / własne polityki klienckie (zostaw service_* jeśli są)
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'device_push_tokens'
      AND policyname NOT LIKE 'service_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.device_push_tokens', p);
  END LOOP;

  -- Klient: tylko własne wiersze (user_id = auth.uid())
  CREATE POLICY device_push_tokens_own_select ON public.device_push_tokens
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

  CREATE POLICY device_push_tokens_own_insert ON public.device_push_tokens
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

  CREATE POLICY device_push_tokens_own_update ON public.device_push_tokens
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

  CREATE POLICY device_push_tokens_own_delete ON public.device_push_tokens
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());

  DROP POLICY IF EXISTS service_all_device_push_tokens ON public.device_push_tokens;
  CREATE POLICY service_all_device_push_tokens ON public.device_push_tokens
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

  REVOKE ALL ON public.device_push_tokens FROM anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_tokens TO authenticated;
  GRANT ALL ON public.device_push_tokens TO service_role;
END $$;
