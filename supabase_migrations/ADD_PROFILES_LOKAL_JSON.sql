-- =============================================================================
-- profiles: trwałe dane lokalu (gdy restaurant_profile bez kolumn billing)
-- Idempotentne — uruchom w Supabase SQL Editor.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lokal_profile_json jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.lokal_profile_json IS
  'Pełne dane lokalu z Ustawień (company_name, delivery_address, bank_account, …).';

NOTIFY pgrst, 'reload schema';
