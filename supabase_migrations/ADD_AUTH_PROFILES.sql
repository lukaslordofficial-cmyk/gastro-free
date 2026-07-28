-- =============================================================================
-- GASTRO MANAGER — Auth profiles (Supabase Auth → account_key + 100 kredytów
-- + 30-dniowy trial Premium / Profesjonalny)
-- Uruchom w Supabase SQL Editor PO ADD_SUBSCRIPTIONS.sql / FIX_SUBSCRIPTIONS_RLS.sql.
-- Wymaga włączonego Email Auth w Authentication → Providers.
-- Preferuj też PREMIUM_TRIAL_100_CREDITS.sql (kolumna trial_ends_at + backfill).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email            text,
  account_key      text UNIQUE NOT NULL,
  restaurant_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_account_key_idx ON public.profiles (account_key);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY "profiles_select_own" ON public.profiles
      FOR SELECT TO authenticated
      USING (id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY "profiles_update_own" ON public.profiles
      FOR UPDATE TO authenticated
      USING (id = auth.uid())
      WITH CHECK (id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'profiles_insert_own'
  ) THEN
    CREATE POLICY "profiles_insert_own" ON public.profiles
      FOR INSERT TO authenticated
      WITH CHECK (id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'service_all_profiles'
  ) THEN
    CREATE POLICY "service_all_profiles" ON public.profiles
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Portfel subskrypcji: zalogowany user widzi tylko swój account_key
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'subscriptions' AND policyname = 'subscriptions_own_account'
  ) THEN
    CREATE POLICY "subscriptions_own_account" ON public.subscriptions
      FOR ALL TO authenticated
      USING (
        account_key IN (SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid())
      )
      WITH CHECK (
        account_key IN (SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid())
      );
  END IF;
END $$;

-- trial_ends_at: 30-dniowy trial Premium (features jak tier 2); po dacie → Free, kredyty zostają
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

ALTER TABLE public.subscriptions
  ALTER COLUMN credits_balance SET DEFAULT 100;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_email text;
BEGIN
  v_email := COALESCE(NEW.email, '');
  v_key := 'ak_' || replace(NEW.id::text, '-', '');

  INSERT INTO public.profiles (id, email, account_key, restaurant_name)
  VALUES (
    NEW.id,
    v_email,
    v_key,
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'restaurant_name', '')), '')
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        updated_at = now();

  INSERT INTO public.subscriptions (
    account_key, tier_level, credits_balance, status, free_starter_claimed, trial_ends_at
  )
  VALUES (v_key, 0, 100, 'active', true, now() + interval '30 days')
  ON CONFLICT (account_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();

-- Backfill: istniejący użytkownicy auth bez profilu
INSERT INTO public.profiles (id, email, account_key)
SELECT
  u.id,
  COALESCE(u.email, ''),
  'ak_' || replace(u.id::text, '-', '')
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscriptions (
  account_key, tier_level, credits_balance, status, free_starter_claimed, trial_ends_at
)
SELECT p.account_key, 0, 100, 'active', true, now() + interval '30 days'
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions s WHERE s.account_key = p.account_key
)
ON CONFLICT (account_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
