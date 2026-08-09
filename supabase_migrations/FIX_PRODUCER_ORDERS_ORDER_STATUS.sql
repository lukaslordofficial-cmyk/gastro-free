-- =============================================================================
-- FIX: producer_orders.order_status CHECK — wartości z apki + WWW
-- Uruchom w Supabase SQL Editor (idempotentne).
-- Błąd: violates check constraint "producer_orders_order_status"
-- =============================================================================

DO $$
DECLARE
  cname text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'producer_orders'
  ) THEN
    RAISE NOTICE 'producer_orders missing — skip';
    RETURN;
  END IF;

  -- Dopilnuj kolumny
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'producer_orders'
      AND column_name = 'order_status'
  ) THEN
    ALTER TABLE public.producer_orders
      ADD COLUMN order_status text DEFAULT 'pending';
  END IF;

  -- Usuń wszystkie CHECK dotyczące order_status
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'producer_orders'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%order_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.producer_orders DROP CONSTRAINT IF EXISTS %I', cname);
  END LOOP;

  ALTER TABLE public.producer_orders
    ADD CONSTRAINT producer_orders_order_status_check
    CHECK (
      order_status IS NULL
      OR order_status IN (
        'pending',
        'pending_payment',
        'awaiting_payment',
        'new',
        'confirmed',
        'paid',
        'processing',
        'preparing',
        'shipped',
        'delivered',
        'cancelled',
        'canceled',
        'refunded'
      )
    );

  -- Domyślna wartość bezpieczna dla insertów z apki
  ALTER TABLE public.producer_orders
    ALTER COLUMN order_status SET DEFAULT 'pending';

  -- Znormalizuj stare / błędne wartości
  UPDATE public.producer_orders
  SET order_status = 'pending'
  WHERE order_status IS NULL
     OR order_status NOT IN (
        'pending', 'pending_payment', 'awaiting_payment', 'new',
        'confirmed', 'paid', 'processing', 'preparing',
        'shipped', 'delivered', 'cancelled', 'canceled', 'refunded'
     );
END $$;

NOTIFY pgrst, 'reload schema';
