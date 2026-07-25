-- ============================================================================
-- Closed beta: ustaw limit / saldo startowe kredytów AI na 1000.
-- Uruchom w Supabase → SQL Editor (idempotentny dla konta default).
-- Nie obniża salda, jeśli konto ma już więcej niż 1000.
-- ============================================================================

-- Domyślna wartość kolumny dla nowych wierszy
ALTER TABLE public.subscriptions
  ALTER COLUMN credits_balance SET DEFAULT 1000;

-- Konto default (i inne Free ze zużytym starterem / niskim saldem): dopełnij do 1000
UPDATE public.subscriptions
SET
  credits_balance = GREATEST(credits_balance, 1000),
  free_starter_claimed = true,
  updated_at = now()
WHERE account_key = 'default'
   OR (tier_level = 0 AND COALESCE(credits_balance, 0) < 1000);

NOTIFY pgrst, 'reload schema';
