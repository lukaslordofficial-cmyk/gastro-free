-- stripe_webhook_events: backend używa service_role (omija RLS).
-- anon_all wyciekało historię eventów Stripe między kontami.
DROP POLICY IF EXISTS "anon_all_stripe_webhook_events" ON public.stripe_webhook_events;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.stripe_webhook_events TO service_role;

-- Pas bezpieczeństwa: residualne polityki USING(true) z starych ADD_*.sql
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname ILIKE 'anon_all_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;
