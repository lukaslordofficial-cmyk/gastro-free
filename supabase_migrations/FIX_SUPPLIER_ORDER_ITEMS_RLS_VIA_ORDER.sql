-- Naprawa RLS: pozycje zamówienia widoczne/zapisalne po account_key zamówienia
-- (wcześniej tylko przez suppliers.account_key — puste koszyki w UI mimo zapisu).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'supplier_order_items'
  ) THEN
    ALTER TABLE public.supplier_order_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS supplier_order_items_tenant_all ON public.supplier_order_items;
    CREATE POLICY supplier_order_items_tenant_all ON public.supplier_order_items
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.supplier_orders o
          WHERE o.id = order_id
            AND (
              o.account_key = public.current_account_key()
              OR EXISTS (
                SELECT 1 FROM public.suppliers s
                WHERE s.id = o.supplier_id
                  AND s.account_key = public.current_account_key()
              )
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.supplier_orders o
          WHERE o.id = order_id
            AND (
              o.account_key = public.current_account_key()
              OR EXISTS (
                SELECT 1 FROM public.suppliers s
                WHERE s.id = o.supplier_id
                  AND s.account_key = public.current_account_key()
              )
            )
        )
      );
  END IF;
END $$;
