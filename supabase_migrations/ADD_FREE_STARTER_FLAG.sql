-- Flaga: czy konto już odebrało jednorazowy pakiet 100 kredytów startowych.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS free_starter_claimed boolean NOT NULL DEFAULT false;

-- Istniejące konta z kredytami lub płatnym tierem — uznaj pakiet startowy za wykorzystany.
UPDATE public.subscriptions
SET free_starter_claimed = true
WHERE tier_level > 0 OR credits_balance <> 100 OR free_starter_claimed = true;

NOTIFY pgrst, 'reload schema';
