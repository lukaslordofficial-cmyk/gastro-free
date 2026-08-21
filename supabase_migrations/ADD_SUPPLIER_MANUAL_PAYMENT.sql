-- =============================================================================
-- Dostawcy (hurt): dane do przelewu manualnego z Łowcy Okazji
-- Idempotentne.
-- =============================================================================

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS bank_account text;

COMMENT ON COLUMN public.suppliers.address IS
  'Adres siedziby / magazynu dostawcy (do przelewu / dokumentów).';

COMMENT ON COLUMN public.suppliers.bank_account IS
  'Numer konta bankowego (IBAN / NRB) do ręcznego przelewu z Łowcy Okazji.';
