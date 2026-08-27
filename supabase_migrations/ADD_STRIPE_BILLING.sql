-- =============================================================================
-- Stripe billing + ochrona salda kredytów
-- Idempotentny — uruchom w Supabase SQL Editor.
-- =============================================================================

-- Pola Stripe na subskrypcji
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text;

-- Statusy: active | past_due | canceled | expired (kolumna status już istnieje)
-- Upewnij się, że kredyty nie spadają poniżej 0
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_credits_balance_nonnegative'
  ) THEN
    -- Najpierw napraw ewentualne ujemne salda
    UPDATE public.subscriptions SET credits_balance = 0 WHERE credits_balance < 0;
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_credits_balance_nonnegative
      CHECK (credits_balance >= 0);
  END IF;
END $$;

-- Idempotentność webhooków Stripe (jeden event = jedna zmiana kredytów/tieru)
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id            text PRIMARY KEY,              -- evt_...
  event_type    text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

-- Tylko service_role (backend). Nie dawaj GRANT/polityk anon — wyciek eventów.
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.stripe_webhook_events TO service_role;
DROP POLICY IF EXISTS "anon_all_stripe_webhook_events" ON public.stripe_webhook_events;

NOTIFY pgrst, 'reload schema';
