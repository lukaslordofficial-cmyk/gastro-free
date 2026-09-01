-- invoices: izolacja tenant (account_key + RLS)
-- Problem: ADD_INVOICE_EXPIRY_BATCHES tworzyło politykę anon_all_invoices
-- (każdy zalogowany widział WSZYSTKIE faktury wszystkich kont).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS account_key text;

-- Backfill z dostawcy (jeśli powiązanie)
UPDATE public.invoices i
SET account_key = s.account_key
FROM public.suppliers s
WHERE i.supplier_id IS NOT NULL
  AND i.supplier_id = s.id
  AND (i.account_key IS NULL OR btrim(i.account_key) = '' OR i.account_key = 'default')
  AND s.account_key IS NOT NULL
  AND btrim(s.account_key) <> ''
  AND s.account_key <> 'default';

CREATE INDEX IF NOT EXISTS invoices_account_key_idx
  ON public.invoices (account_key);

CREATE INDEX IF NOT EXISTS invoices_account_created_idx
  ON public.invoices (account_key, created_at DESC);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Usuń otwarte polityki (w tym anon_all)
DO $$
DECLARE
  p text;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoices'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.invoices', p);
  END LOOP;
END $$;

DROP POLICY IF EXISTS invoices_tenant_select ON public.invoices;
DROP POLICY IF EXISTS invoices_tenant_insert ON public.invoices;
DROP POLICY IF EXISTS invoices_tenant_update ON public.invoices;
DROP POLICY IF EXISTS invoices_tenant_delete ON public.invoices;

CREATE POLICY invoices_tenant_select ON public.invoices
  FOR SELECT TO authenticated
  USING (account_key = public.current_account_key());

CREATE POLICY invoices_tenant_insert ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY invoices_tenant_update ON public.invoices
  FOR UPDATE TO authenticated
  USING (account_key = public.current_account_key())
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY invoices_tenant_delete ON public.invoices
  FOR DELETE TO authenticated
  USING (account_key = public.current_account_key());

COMMENT ON COLUMN public.invoices.account_key IS
  'Tenant key — izolacja faktur zakupowych per restauracja.';
