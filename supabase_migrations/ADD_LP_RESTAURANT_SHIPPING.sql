-- =============================================================================
-- Adres dostawy restauracji (kurier LP) — zapis w profiles.
-- Po pierwszym zamówieniu pola podstawiają się przy kolejnych przesyłkach.
-- Wklej w Supabase SQL Editor (ten sam projekt co apka).
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shipping_phone text,
  ADD COLUMN IF NOT EXISTS shipping_street text,
  ADD COLUMN IF NOT EXISTS shipping_building text,
  ADD COLUMN IF NOT EXISTS shipping_city text,
  ADD COLUMN IF NOT EXISTS shipping_post_code text;

COMMENT ON COLUMN public.profiles.shipping_street IS 'Ulica dostawy paczki LP (restauracja).';
COMMENT ON COLUMN public.profiles.shipping_post_code IS 'Kod pocztowy dostawy paczki LP.';
