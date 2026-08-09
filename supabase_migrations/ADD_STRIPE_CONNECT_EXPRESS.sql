-- =============================================================================
-- Lokalni Przetwórcy — Stripe Connect Express (Marketplace / Destination Charges)
-- Uruchom w Supabase SQL Editor.
-- =============================================================================

-- Kolumny widoczności (jeśli brak z WWW / wcześniejszych migracji)
ALTER TABLE public.local_producers
  ADD COLUMN IF NOT EXISTS verification_status text;

ALTER TABLE public.local_producers
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Konto Express dystrybutora (acct_...) — wymagane przed sprzedażą w marketplace.
ALTER TABLE public.local_producers
  ADD COLUMN IF NOT EXISTS stripe_connect_id text;

-- Legacy / sync z wcześniejszego kodu (opcjonalne).
ALTER TABLE public.local_producers
  ADD COLUMN IF NOT EXISTS stripe_account_id text;

ALTER TABLE public.local_producers
  ADD COLUMN IF NOT EXISTS payouts_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.local_producers
  ADD COLUMN IF NOT EXISTS stripe_onboarding_complete boolean NOT NULL DEFAULT false;

-- Backfill: jeśli ktoś miał już stripe_account_id, skopiuj do stripe_connect_id.
UPDATE public.local_producers
SET stripe_connect_id = stripe_account_id
WHERE (stripe_connect_id IS NULL OR btrim(stripe_connect_id) = '')
  AND stripe_account_id IS NOT NULL
  AND btrim(stripe_account_id) <> '';

CREATE INDEX IF NOT EXISTS local_producers_stripe_connect_id_idx
  ON public.local_producers (stripe_connect_id)
  WHERE stripe_connect_id IS NOT NULL;

COMMENT ON COLUMN public.local_producers.stripe_connect_id IS
  'Stripe Connect Express account id (acct_...). Wymagane, aby produkty były widoczne dla restauratorów.';

-- HARD RULE (RLS): restaurator widzi tylko zatwierdzonych + Connect onboarded.
DROP POLICY IF EXISTS lp_producers_restaurant_select ON public.local_producers;
CREATE POLICY lp_producers_restaurant_select ON public.local_producers
  FOR SELECT TO authenticated
  USING (
    public.is_lp_admin()
    OR auth_user_id = auth.uid()
    OR (
      active = true
      AND verified = true
      AND stripe_connect_id IS NOT NULL
      AND btrim(stripe_connect_id) <> ''
      AND (
        verification_status IS NULL
        OR verification_status = 'approved'
      )
      AND archived_at IS NULL
    )
  );

-- Produkty: widoczne dla restauratora tylko gdy producent ma Connect.
DROP POLICY IF EXISTS lp_products_select ON public.producer_products;
CREATE POLICY lp_products_select ON public.producer_products
  FOR SELECT TO authenticated
  USING (
    public.is_lp_admin()
    OR public.is_producer_owner(producer_id)
    OR (
      available = true
      AND EXISTS (
        SELECT 1 FROM public.local_producers lp
        WHERE lp.id = producer_id
          AND lp.active = true
          AND lp.verified = true
          AND lp.stripe_connect_id IS NOT NULL
          AND btrim(lp.stripe_connect_id) <> ''
          AND (lp.verification_status IS NULL OR lp.verification_status = 'approved')
          AND lp.archived_at IS NULL
      )
    )
  );

NOTIFY pgrst, 'reload schema';
