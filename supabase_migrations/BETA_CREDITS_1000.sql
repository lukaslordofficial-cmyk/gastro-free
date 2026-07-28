-- ============================================================================
-- LEGACY / SUPERSEDED — użyj PREMIUM_TRIAL_100_CREDITS.sql
-- Dawniej: closed beta = 1000 kredytów startowych.
-- Aktualnie: 100 kredytów + 30-dniowy trial Premium (trial_ends_at).
-- Ten plik NIE podnosi sald do 1000 i NIE obniża istniejących sald.
-- ============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

ALTER TABLE public.subscriptions
  ALTER COLUMN credits_balance SET DEFAULT 100;

-- Tylko konto default bez salda — nie tykaj wysokich sald użytkowników
UPDATE public.subscriptions
SET
  credits_balance = GREATEST(credits_balance, 0),
  free_starter_claimed = true,
  updated_at = now()
WHERE account_key = 'default'
  AND COALESCE(credits_balance, 0) < 0;

NOTIFY pgrst, 'reload schema';
