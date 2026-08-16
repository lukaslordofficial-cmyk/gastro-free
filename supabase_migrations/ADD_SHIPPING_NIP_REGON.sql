-- NIP / REGON firmy restauracji przy dostawach LP (opcjonalne, do faktury).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shipping_nip text,
  ADD COLUMN IF NOT EXISTS shipping_regon text;

COMMENT ON COLUMN public.profiles.shipping_nip IS 'NIP firmy restauracji (dostawy LP)';
COMMENT ON COLUMN public.profiles.shipping_regon IS 'REGON firmy restauracji (dostawy LP)';
