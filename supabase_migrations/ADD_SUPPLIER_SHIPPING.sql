-- =============================================================================
-- Smart Basket Optimizer — koszty dostawy przy dostawcach
-- Idempotentny.
-- =============================================================================

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS shipping_cost numeric NOT NULL DEFAULT 0;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS free_shipping_threshold numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.suppliers.shipping_cost IS
  'Stała opłata za dostawę (PLN). 0 = darmowa / wliczona w min. logistyczne.';
COMMENT ON COLUMN public.suppliers.free_shipping_threshold IS
  'Po przekroczeniu tej wartości koszyka (PLN) shipping_cost = 0. 0 = brak progu.';

NOTIFY pgrst, 'reload schema';
