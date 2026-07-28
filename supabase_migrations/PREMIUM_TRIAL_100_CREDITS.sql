-- =============================================================================
-- Premium trial (30 dni) + startowe 100 kredytów AI
-- Projekt: tucmmrcwwcltkqwyvzxa
--
-- Semantyka:
--   • Nowy user: Free (tier_level=0) + credits_balance=100 + trial_ends_at=now()+30d
--   • W trakcie trialu: entitlement jak Premium / Profesjonalny (m.in. Łowca Okazji)
--   • Po trial_ends_at: zostaje Free; kredyty NIE są zerowane (zostaje saldo)
--   • Nie obniżamy istniejących wysokich sald kredytów
-- =============================================================================

-- Kolumna trialu (idempotent)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

COMMENT ON COLUMN public.subscriptions.trial_ends_at IS
  'Koniec 30-dniowego trialu Premium (tier-2 features). NULL = brak trialu. Po dacie: Free, kredyty zostają.';

-- Domyślne saldo dla NOWYCH wierszy = 100 (nie zmienia istniejących wartości)
ALTER TABLE public.subscriptions
  ALTER COLUMN credits_balance SET DEFAULT 100;

-- Trigger signup: 100 kredytów + 30-dniowy trial Premium
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

  -- Free plan identity + trial Premium features for 30 days + 100 AI credits.
  -- After trial_ends_at the app treats the account as Free; remaining credits are kept.
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

-- Backfill: istniejące konta bez trial_ends_at — ustaw od created_at (+30d).
-- Stare konta (>30d) mają trial już wygasły → bez nagłego odblokowania Premium.
-- Nie ruszamy credits_balance (nie obniżamy wysokich sald beta).
UPDATE public.subscriptions
SET trial_ends_at = COALESCE(created_at, now()) + interval '30 days',
    updated_at = now()
WHERE trial_ends_at IS NULL
  AND account_key IS DISTINCT FROM 'default';

-- Konta bez wiersza subskrypcji (profil istnieje) — seed 100 + trial
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
