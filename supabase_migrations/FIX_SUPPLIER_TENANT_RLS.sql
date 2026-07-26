-- =============================================================================
-- FIX: Izolacja ofert / katalogu dostawców per account_key
-- Uruchom w Supabase SQL Editor (project tucmmrcwwcltkqwyvzxa)
-- PO ADD_TENANT_ISOLATION.sql / FIX_TENANT_RLS.sql
-- Idempotentne.
--
-- Problem: supplier_offers miało account_key bez RLS; supplier_offer_items
-- i supplier_catalog bez izolacji → nowy tenant widział oferty/katalog
-- z konta testowego („nieznani dostawcy” przy 1 własnym dostawcy).
--
-- Przypomnij też: FIX_FINANCE_TENANT_RLS.sql (finanse / token_usage).
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

-- ── supplier_offers: kolumna account_key + RLS ───────────────────────────────
DO $$
DECLARE
  p text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'supplier_offers'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supplier_offers'
      AND column_name = 'account_key'
  ) THEN
    ALTER TABLE public.supplier_offers
      ADD COLUMN account_key text NOT NULL DEFAULT 'default';
  END IF;

  CREATE INDEX IF NOT EXISTS supplier_offers_account_key_idx
    ON public.supplier_offers (account_key);

  -- Backfill z suppliers gdy account_key = 'default'
  UPDATE public.supplier_offers o
  SET account_key = s.account_key
  FROM public.suppliers s
  WHERE o.supplier_id = s.id
    AND (o.account_key IS NULL OR o.account_key = 'default')
    AND s.account_key IS NOT NULL
    AND s.account_key <> 'default';

  ALTER TABLE public.supplier_offers ENABLE ROW LEVEL SECURITY;

  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_offers'
      AND policyname NOT LIKE '%tenant%'
      AND policyname NOT LIKE 'service_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.supplier_offers', p);
  END LOOP;

  DROP POLICY IF EXISTS supplier_offers_tenant_select ON public.supplier_offers;
  DROP POLICY IF EXISTS supplier_offers_tenant_insert ON public.supplier_offers;
  DROP POLICY IF EXISTS supplier_offers_tenant_update ON public.supplier_offers;
  DROP POLICY IF EXISTS supplier_offers_tenant_delete ON public.supplier_offers;

  CREATE POLICY supplier_offers_tenant_select ON public.supplier_offers
    FOR SELECT TO authenticated
    USING (account_key = public.current_account_key());
  CREATE POLICY supplier_offers_tenant_insert ON public.supplier_offers
    FOR INSERT TO authenticated
    WITH CHECK (account_key = public.current_account_key());
  CREATE POLICY supplier_offers_tenant_update ON public.supplier_offers
    FOR UPDATE TO authenticated
    USING (account_key = public.current_account_key())
    WITH CHECK (account_key = public.current_account_key());
  CREATE POLICY supplier_offers_tenant_delete ON public.supplier_offers
    FOR DELETE TO authenticated
    USING (account_key = public.current_account_key());

  GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_offers TO authenticated;
END $$;

-- ── supplier_offer_items: RLS przez suppliers.account_key ────────────────────
DO $$
DECLARE
  p text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'supplier_offer_items'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.supplier_offer_items ENABLE ROW LEVEL SECURITY;

  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_offer_items'
      AND policyname NOT LIKE '%tenant%'
      AND policyname NOT LIKE 'service_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.supplier_offer_items', p);
  END LOOP;

  DROP POLICY IF EXISTS supplier_offer_items_tenant_all ON public.supplier_offer_items;

  CREATE POLICY supplier_offer_items_tenant_all ON public.supplier_offer_items
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

  GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_offer_items TO authenticated;
END $$;

-- ── supplier_catalog: RLS przez suppliers.account_key ────────────────────────
DO $$
DECLARE
  p text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'supplier_catalog'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.supplier_catalog ENABLE ROW LEVEL SECURITY;

  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_catalog'
      AND policyname NOT LIKE '%tenant%'
      AND policyname NOT LIKE 'service_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.supplier_catalog', p);
  END LOOP;

  DROP POLICY IF EXISTS supplier_catalog_tenant_all ON public.supplier_catalog;

  CREATE POLICY supplier_catalog_tenant_all ON public.supplier_catalog
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

  GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_catalog TO authenticated;
END $$;

NOTIFY pgrst, 'reload schema';
