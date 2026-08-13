-- Tracking / podjazd / etykieta LP (Furgonetka) — kolumny na producer_orders.
-- Bezpieczne do ponownego uruchomienia (IF NOT EXISTS).

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS pickup_date text;

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS pickup_min_time text;

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS pickup_max_time text;

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS courier_name text;

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS parcel_weight_kg numeric(12, 3);

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS shipping_error text;

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS tracking_state text;

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS tracking_synced_at timestamptz;

ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS label_storage_path text;

COMMENT ON COLUMN public.producer_orders.pickup_date IS
  'Data podjazdu kuriera (YYYY-MM-DD) z Furgonetka pickup-date-proposals.';
COMMENT ON COLUMN public.producer_orders.pickup_min_time IS
  'Początek okna podjazdu (HH:MM) — nie obiecujemy dokładnej godziny.';
COMMENT ON COLUMN public.producer_orders.label_storage_path IS
  'Ref Storage etykiety PDF, np. producer-documents:labels/{producer}/{order}.pdf';

NOTIFY pgrst, 'reload schema';
