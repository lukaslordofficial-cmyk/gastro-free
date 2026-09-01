-- =============================================================================
-- Produkcja: zamknij USING(true) dla authenticated/anon, twarde billing RLS,
-- recenzje dostaw per tenant. Idempotentne.
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

-- ── subscriptions: klient czyta/tworzy portfel, NIE zmienia tier/kredytów ──
DO $$
DECLARE p text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'subscriptions'
      AND policyname NOT LIKE 'service_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.subscriptions', p);
  END LOOP;

  DROP POLICY IF EXISTS subscriptions_own_select ON public.subscriptions;
  DROP POLICY IF EXISTS subscriptions_own_insert ON public.subscriptions;
  CREATE POLICY subscriptions_own_select ON public.subscriptions
    FOR SELECT TO authenticated
    USING (account_key = public.current_account_key());
  CREATE POLICY subscriptions_own_insert ON public.subscriptions
    FOR INSERT TO authenticated
    WITH CHECK (account_key = public.current_account_key());

  DROP POLICY IF EXISTS service_all_subscriptions ON public.subscriptions;
  CREATE POLICY service_all_subscriptions ON public.subscriptions
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

  REVOKE ALL ON public.subscriptions FROM anon;
  REVOKE UPDATE, DELETE ON public.subscriptions FROM authenticated;
  GRANT SELECT, INSERT ON public.subscriptions TO authenticated;
  GRANT ALL ON public.subscriptions TO service_role;
END $$;

CREATE OR REPLACE FUNCTION public.subscriptions_client_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    NEW.tier_level := 0;
    NEW.stripe_customer_id := NULL;
    NEW.stripe_subscription_id := NULL;
    IF NEW.credits_balance IS NULL OR NEW.credits_balance > 100 THEN
      NEW.credits_balance := 100;
    END IF;
    NEW.status := 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_client_insert_guard ON public.subscriptions;
CREATE TRIGGER subscriptions_client_insert_guard
  BEFORE INSERT ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.subscriptions_client_insert_guard();

-- ── supplier_delivery_reviews: tenant przez suppliers.account_key ───────────
DO $$
DECLARE p text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'supplier_delivery_reviews'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.supplier_delivery_reviews ENABLE ROW LEVEL SECURITY;

  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_delivery_reviews'
      AND policyname NOT LIKE 'service_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.supplier_delivery_reviews', p);
  END LOOP;

  DROP POLICY IF EXISTS supplier_delivery_reviews_tenant_all ON public.supplier_delivery_reviews;
  CREATE POLICY supplier_delivery_reviews_tenant_all ON public.supplier_delivery_reviews
    FOR ALL TO authenticated
    USING (
      supplier_id IN (
        SELECT s.id FROM public.suppliers s
        WHERE s.account_key = public.current_account_key()
      )
    )
    WITH CHECK (
      supplier_id IN (
        SELECT s.id FROM public.suppliers s
        WHERE s.account_key = public.current_account_key()
      )
    );

  REVOKE ALL ON public.supplier_delivery_reviews FROM anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_delivery_reviews TO authenticated;
END $$;

-- ── Pas bezpieczeństwa: USING(true) dla anon/authenticated (nie service_role) ─
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND qual = 'true'
      AND (with_check IS NULL OR with_check = 'true')
      AND policyname NOT LIKE 'service_%'
      AND (
        roles = '{public}'
        OR 'anon' = ANY (roles)
        OR 'authenticated' = ANY (roles)
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
