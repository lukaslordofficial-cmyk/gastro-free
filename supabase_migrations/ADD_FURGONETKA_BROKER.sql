-- =============================================================================
-- Kurier przez brokera Furgonetka.pl (InPost Kurier) — działalność nierejestrowana
-- Identyfikator paczki z API brokera (prepaid / skarbonka).
-- Tabela zamówień LP w apce = public.producer_orders (alias „orders” w panelu WWW).
-- =============================================================================

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS furgonetka_package_id text;

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS broker_package_id text;

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS broker_name text;

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS broker_label_ready boolean NOT NULL DEFAULT false;

-- Sync aliasów (stary kod pisał broker_package_id)
UPDATE public.producer_orders
SET furgonetka_package_id = broker_package_id
WHERE (furgonetka_package_id IS NULL OR btrim(furgonetka_package_id) = '')
  AND broker_package_id IS NOT NULL
  AND btrim(broker_package_id) <> '';

UPDATE public.producer_orders
SET broker_package_id = furgonetka_package_id
WHERE (broker_package_id IS NULL OR btrim(broker_package_id) = '')
  AND furgonetka_package_id IS NOT NULL
  AND btrim(furgonetka_package_id) <> '';

-- Opcjonalny alias widoku dla paneli, które mówią „orders”
-- (tylko kolumny bazowe + broker — bez zależności od opcjonalnych kolumn WWW)
DROP VIEW IF EXISTS public.orders;
CREATE VIEW public.orders AS
  SELECT
    id,
    producer_id,
    restaurant_id,
    restaurant_account_key,
    total_price,
    shipping_cost,
    platform_fee,
    payment_status,
    shipment_status,
    notes,
    furgonetka_package_id,
    broker_package_id,
    broker_name,
    broker_label_ready,
    created_at
  FROM public.producer_orders;

COMMENT ON COLUMN public.producer_orders.furgonetka_package_id IS
  'ID paczki z API Furgonetka.pl (package_id) — InPost Kurier, prepaid.';

COMMENT ON COLUMN public.producer_orders.broker_package_id IS
  'Alias furgonetka_package_id (kompatybilność wsteczna).';

COMMENT ON COLUMN public.producer_orders.broker_name IS
  'Nazwa brokera, np. furgonetka.';

CREATE INDEX IF NOT EXISTS producer_orders_furgonetka_package_id_idx
  ON public.producer_orders (furgonetka_package_id)
  WHERE furgonetka_package_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS producer_orders_broker_package_id_idx
  ON public.producer_orders (broker_package_id)
  WHERE broker_package_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
