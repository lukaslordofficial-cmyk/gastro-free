-- Flagi odbioru dostawy (dedupe magazyn/koszty vs skan faktury)
ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS inventory_applied boolean NOT NULL DEFAULT false;

ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS variable_cost_applied boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.supplier_orders.received_at IS
  'Kiedy oznaczono dostawę jako odebraną (ręcznie lub po skanie faktury).';
COMMENT ON COLUMN public.supplier_orders.inventory_applied IS
  'Czy przy odbiorze dopisano ilości do magazynu.';
COMMENT ON COLUMN public.supplier_orders.variable_cost_applied IS
  'Czy przy odbiorze dopisano koszty zmienne.';
