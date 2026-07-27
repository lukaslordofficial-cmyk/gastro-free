-- =============================================================================
-- GASTRO MANAGER — „Boska Waga w Ręku” (cultivation minigame)
-- Wklej i uruchom w Supabase SQL Editor. Skrypt IDEMPOTENTNY.
-- Project ref (info): tucmmrcwwcltkqwyvzxa
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.divine_weight_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key     text NOT NULL DEFAULT 'default',
  estimate_g      numeric(12, 2) NOT NULL,
  actual_g        numeric(12, 2) NOT NULL,
  abs_error_g     numeric(12, 2) NOT NULL,
  signed_error_g  numeric(12, 2) NOT NULL,
  points          integer NOT NULL DEFAULT 0,
  streak          integer NOT NULL DEFAULT 0,
  rank_id         smallint NOT NULL DEFAULT 1 CHECK (rank_id BETWEEN 1 AND 5),
  improved        boolean NOT NULL DEFAULT false,
  item_name       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS divine_weight_attempts_account_key_idx
  ON public.divine_weight_attempts (account_key);
CREATE INDEX IF NOT EXISTS divine_weight_attempts_created_at_idx
  ON public.divine_weight_attempts (account_key, created_at DESC);

CREATE TABLE IF NOT EXISTS public.divine_weight_stats (
  account_key       text PRIMARY KEY,
  total_attempts    integer NOT NULL DEFAULT 0,
  total_points      integer NOT NULL DEFAULT 0,
  current_streak    integer NOT NULL DEFAULT 0,
  current_rank      smallint NOT NULL DEFAULT 1 CHECK (current_rank BETWEEN 1 AND 5),
  best_rank         smallint NOT NULL DEFAULT 1 CHECK (best_rank BETWEEN 1 AND 5),
  last_abs_error_g  numeric(12, 2),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.divine_weight_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divine_weight_stats ENABLE ROW LEVEL SECURITY;

-- Tenant policies (prefer current_account_key() when present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'divine_weight_attempts' AND policyname = 'divine_weight_attempts_tenant_all'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'current_account_key'
    ) THEN
      CREATE POLICY divine_weight_attempts_tenant_all ON public.divine_weight_attempts
        FOR ALL TO authenticated
        USING (account_key = public.current_account_key())
        WITH CHECK (account_key = public.current_account_key());
    ELSE
      CREATE POLICY divine_weight_attempts_tenant_all ON public.divine_weight_attempts
        FOR ALL TO authenticated
        USING (
          account_key IN (
            SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid()
          )
        )
        WITH CHECK (
          account_key IN (
            SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid()
          )
        );
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'divine_weight_stats' AND policyname = 'divine_weight_stats_tenant_all'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'current_account_key'
    ) THEN
      CREATE POLICY divine_weight_stats_tenant_all ON public.divine_weight_stats
        FOR ALL TO authenticated
        USING (account_key = public.current_account_key())
        WITH CHECK (account_key = public.current_account_key());
    ELSE
      CREATE POLICY divine_weight_stats_tenant_all ON public.divine_weight_stats
        FOR ALL TO authenticated
        USING (
          account_key IN (
            SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid()
          )
        )
        WITH CHECK (
          account_key IN (
            SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid()
          )
        );
    END IF;
  END IF;
END $$;

-- Service role / anon fallback for backend middleware (same pattern as other tables)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'divine_weight_attempts' AND policyname = 'divine_weight_attempts_service'
  ) THEN
    CREATE POLICY divine_weight_attempts_service ON public.divine_weight_attempts
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'divine_weight_stats' AND policyname = 'divine_weight_stats_service'
  ) THEN
    CREATE POLICY divine_weight_stats_service ON public.divine_weight_stats
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
