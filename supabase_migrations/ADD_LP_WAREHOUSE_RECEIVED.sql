-- Idempotencja przyjęcia paczki LP do magazynu restauracji.
ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS warehouse_received_at timestamptz;

COMMENT ON COLUMN public.producer_orders.warehouse_received_at IS
  'Kiedy produkty z dostawy LP trafiły do magazynu restauracji (auto Furgonetka delivered lub przycisk Odebrałem).';
