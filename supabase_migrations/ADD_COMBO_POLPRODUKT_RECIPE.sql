-- =============================================================================
-- Półprodukt / Combo: receptura składników + trwałość chłodnicza
-- Soft-dedupe kategorii (to samo account_key + nazwa) przed unique index.
-- =============================================================================

-- Trwałość w dniach (idealne warunki chłodnicze)
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS shelf_life_days integer;

COMMENT ON COLUMN public.inventory_items.shelf_life_days IS
  'Ile dni półprodukt utrzymuje jakość w idealnych warunkach chłodniczych.';

-- Receptura półproduktu (analogiczna do recipe_ingredients dla dań)
CREATE TABLE IF NOT EXISTS public.inventory_combo_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  ingredient_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'g',
  warehouse_product_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  account_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_combo_ingredients_item
  ON public.inventory_combo_ingredients(inventory_item_id);

CREATE INDEX IF NOT EXISTS idx_combo_ingredients_account
  ON public.inventory_combo_ingredients(account_key);

COMMENT ON TABLE public.inventory_combo_ingredients IS
  'Składniki półproduktu/combo (gramatura) — produkty z magazynu używane do przygotowania.';

ALTER TABLE public.inventory_combo_ingredients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_combo_ingredients_tenant_all ON public.inventory_combo_ingredients;
CREATE POLICY inventory_combo_ingredients_tenant_all ON public.inventory_combo_ingredients
  FOR ALL TO authenticated
  USING (
    inventory_item_id IN (
      SELECT i.id FROM public.inventory_items i
      WHERE i.account_key = public.current_account_key()
    )
  )
  WITH CHECK (
    inventory_item_id IN (
      SELECT i.id FROM public.inventory_items i
      WHERE i.account_key = public.current_account_key()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_combo_ingredients TO authenticated;

-- ── Soft-dedupe kategorii (nie kasuje unikalnych nazw użytkownika) ────────────
DO $$
DECLARE
  r RECORD;
  keep_id uuid;
  dup_id uuid;
BEGIN
  FOR r IN
    SELECT account_key, lower(btrim(name)) AS nkey
    FROM public.inventory_categories
    WHERE account_key IS NOT NULL AND btrim(account_key) <> ''
    GROUP BY account_key, lower(btrim(name))
    HAVING count(*) > 1
  LOOP
    -- keeper = kategoria z największą liczbą produktów, potem najstarsza
    SELECT ic.id INTO keep_id
    FROM public.inventory_categories ic
    LEFT JOIN public.inventory_items ii ON ii.category_id = ic.id
    WHERE ic.account_key = r.account_key
      AND lower(btrim(ic.name)) = r.nkey
    GROUP BY ic.id
    ORDER BY count(ii.id) DESC, ic.id ASC
    LIMIT 1;

    FOR dup_id IN
      SELECT ic.id
      FROM public.inventory_categories ic
      WHERE ic.account_key = r.account_key
        AND lower(btrim(ic.name)) = r.nkey
        AND ic.id <> keep_id
    LOOP
      UPDATE public.inventory_items
      SET category_id = keep_id
      WHERE category_id = dup_id;

      DELETE FROM public.inventory_categories WHERE id = dup_id;
    END LOOP;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_categories_account_name_uidx
  ON public.inventory_categories (account_key, lower(btrim(name)))
  WHERE account_key IS NOT NULL AND btrim(account_key) <> '';
