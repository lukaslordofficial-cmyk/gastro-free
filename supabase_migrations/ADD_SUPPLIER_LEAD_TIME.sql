-- =============================================================================
-- Deal Hunter Phase 3 — lead_time_days on suppliers
-- Idempotent. Safe if column already exists.
-- =============================================================================

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS lead_time_days numeric NULL;

COMMENT ON COLUMN public.suppliers.lead_time_days IS
  'Szacowany czas realizacji dostawy (dni). NULL = nieznany (Deal Hunter pomija karę lead-time).';

NOTIFY pgrst, 'reload schema';
