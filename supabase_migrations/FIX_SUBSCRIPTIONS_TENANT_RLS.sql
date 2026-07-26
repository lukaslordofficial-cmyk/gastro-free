-- =============================================================================
-- FIX: Izolacja subscriptions per account_key (usuń otwarte RLS)
-- Uruchom w Supabase SQL Editor (project tucmmrcwwcltkqwyvzxa)
-- Idempotentne.
--
-- Problem: polityka "anon_all_subscriptions" (USING true) OR-uje się z
-- "subscriptions_own_account" → każdy anon/authenticated widzi WSZYSTKIE
-- portfele (w tym Premium pierwszego konta testowego).
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

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Usuń otwarte polityki (OR z właściwą izolacją = wyciek).
DROP POLICY IF EXISTS "anon_all_subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_all" ON public.subscriptions;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.subscriptions;

DROP POLICY IF EXISTS "subscriptions_own_account" ON public.subscriptions;
CREATE POLICY "subscriptions_own_account" ON public.subscriptions
  FOR ALL TO authenticated
  USING (account_key = public.current_account_key())
  WITH CHECK (account_key = public.current_account_key());

-- service_role omija RLS; jawna polityka dla jasności ops.
DROP POLICY IF EXISTS "service_all_subscriptions" ON public.subscriptions;
CREATE POLICY "service_all_subscriptions" ON public.subscriptions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Anon NIE ma dostępu do portfeli.
REVOKE ALL ON public.subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

NOTIFY pgrst, 'reload schema';
