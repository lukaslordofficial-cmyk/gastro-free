-- FIX: kolumna account_key na supplier_orders (+ RLS + backfill z suppliers)
-- Objaw: eksport PDF/Excel: "column supplier_orders.account_key does not exist"
-- Uruchom w Supabase SQL Editor (produkcja).

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
  SELECT p.account_key INTO k
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
  RETURN COALESCE(NULLIF(trim(k), ''), 'default');
END;
$$;

REVOKE ALL ON FUNCTION public.current_account_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_account_key() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_account_key() TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'supplier_orders'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_orders'
      AND column_name = 'account_key'
  ) THEN
    ALTER TABLE public.supplier_orders
      ADD COLUMN account_key text NOT NULL DEFAULT 'default';
  END IF;
END $$;

-- Backfill z dostawcy
UPDATE public.supplier_orders o
SET account_key = s.account_key
FROM public.suppliers s
WHERE o.supplier_id = s.id
  AND s.account_key IS NOT NULL
  AND s.account_key <> ''
  AND (o.account_key IS NULL OR o.account_key = 'default');

CREATE INDEX IF NOT EXISTS supplier_orders_account_key_idx
  ON public.supplier_orders (account_key);

CREATE INDEX IF NOT EXISTS supplier_orders_ak_status_idx
  ON public.supplier_orders (account_key, status);

ALTER TABLE public.supplier_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_orders_tenant_select ON public.supplier_orders;
DROP POLICY IF EXISTS supplier_orders_tenant_insert ON public.supplier_orders;
DROP POLICY IF EXISTS supplier_orders_tenant_update ON public.supplier_orders;
DROP POLICY IF EXISTS supplier_orders_tenant_delete ON public.supplier_orders;
DROP POLICY IF EXISTS supplier_orders_tenant_all ON public.supplier_orders;

CREATE POLICY supplier_orders_tenant_select ON public.supplier_orders
  FOR SELECT TO authenticated
  USING (account_key = public.current_account_key());

CREATE POLICY supplier_orders_tenant_insert ON public.supplier_orders
  FOR INSERT TO authenticated
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY supplier_orders_tenant_update ON public.supplier_orders
  FOR UPDATE TO authenticated
  USING (account_key = public.current_account_key())
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY supplier_orders_tenant_delete ON public.supplier_orders
  FOR DELETE TO authenticated
  USING (account_key = public.current_account_key());
