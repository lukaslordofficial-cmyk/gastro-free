-- =============================================================================
-- Deal Hunter Phase 4 foundation — delivery feedback / Reliability Score
-- Idempotent. FE rating UI will write these fields later (TODO).
-- =============================================================================

-- Lekkie kolumny na zamówieniach (post-delivery check)
ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS received_ok boolean NULL;

ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS missing_count integer NULL DEFAULT 0;

ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS delivery_notes text NULL;

COMMENT ON COLUMN public.supplier_orders.received_ok IS
  'Czy dostawa była kompletna / OK. NULL = brak oceny (nie wpływa na Reliability Score).';
COMMENT ON COLUMN public.supplier_orders.missing_count IS
  'Liczba brakujących / uszkodzonych pozycji przy odbiorze.';
COMMENT ON COLUMN public.supplier_orders.delivery_notes IS
  'Opcjonalne notatki z odbioru (FE rating form — Phase 4 UI).';

-- Opcjonalna tabela szczegółowych recenzji (gdy FE zacznie zbierać więcej sygnałów)
CREATE TABLE IF NOT EXISTS public.supplier_delivery_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  order_id uuid NULL REFERENCES public.supplier_orders(id) ON DELETE SET NULL,
  received_ok boolean NOT NULL DEFAULT true,
  missing_count integer NOT NULL DEFAULT 0,
  on_time boolean NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_delivery_reviews_supplier
  ON public.supplier_delivery_reviews (supplier_id, created_at DESC);

ALTER TABLE public.supplier_delivery_reviews ENABLE ROW LEVEL SECURITY;

-- Podstawowe polityki (jak inne tabele app — authenticated full access)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'supplier_delivery_reviews'
      AND policyname = 'supplier_delivery_reviews_authenticated_all'
  ) THEN
    CREATE POLICY supplier_delivery_reviews_authenticated_all
      ON public.supplier_delivery_reviews
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
