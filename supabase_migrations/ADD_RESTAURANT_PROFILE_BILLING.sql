-- =============================================================================
-- restaurant_profile: dane firmy / przelewu / dostaw (Opłać zamówienie)
-- Idempotentne — uruchom w Supabase SQL Editor.
-- =============================================================================

ALTER TABLE public.restaurant_profile
  ADD COLUMN IF NOT EXISTS company_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_address text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_account text DEFAULT '',
  ADD COLUMN IF NOT EXISTS nip text DEFAULT '',
  ADD COLUMN IF NOT EXISTS regon text DEFAULT '';

NOTIFY pgrst, 'reload schema';
