-- ============================================================================
-- Gastro Manager — System Subskrypcji i Portfela Kredytowego
-- Uruchom w Supabase → SQL Editor (idempotentny — można uruchamiać wielokrotnie).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key         text UNIQUE NOT NULL DEFAULT 'default',
  tier_level          int  NOT NULL DEFAULT 0,          -- 0=Free, 1=Podstawowy, 2=Profesjonalny
  credits_balance     int  NOT NULL DEFAULT 100,        -- 1 kredyt = 1 jednostka; starter = 100
  free_starter_claimed boolean NOT NULL DEFAULT false,  -- jednorazowy pakiet startowy (100 kr.)
  status              text NOT NULL DEFAULT 'active',   -- active | canceled | expired
  current_period_end  timestamptz,
  trial_ends_at       timestamptz,                     -- 30-dniowy trial Premium (features tier 2)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Pojedynczy wiersz konta demo — Free, 0 kredytów (nie dziel portfela testowego).
INSERT INTO public.subscriptions (account_key, tier_level, credits_balance, status, free_starter_claimed)
VALUES ('default', 0, 0, 'active', true)
ON CONFLICT (account_key) DO NOTHING;

-- auto-aktualizacja updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Uprawnienia REST API (PostgREST) — bez tego anon/service_role mogą nie widzieć tabeli
GRANT ALL ON public.subscriptions TO anon, authenticated, service_role;

-- RLS — polityki otwarte (aplikacja bez logowania, jedno konto)
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'anon_all_subscriptions') THEN
    CREATE POLICY "anon_all_subscriptions" ON public.subscriptions
      FOR ALL TO anon, authenticated, service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Odśwież cache schematu PostgREST (ważne po CREATE TABLE)
NOTIFY pgrst, 'reload schema';
