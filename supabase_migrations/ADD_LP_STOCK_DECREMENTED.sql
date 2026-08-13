-- Idempotencja zejścia stanu produktów LP po wysyłce paczki.
ALTER TABLE public.producer_orders
  ADD COLUMN IF NOT EXISTS stock_decremented_at timestamptz;
