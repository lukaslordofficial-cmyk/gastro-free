-- Próg optymalny zapasu (target stock) dla Łowcy Okazji / zamówień krytycznych.
-- deficit = optimal_quantity - quantity (gdy ustawione), z tolerancją ±10% przy pakowaniu.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS optimal_quantity numeric DEFAULT NULL;

COMMENT ON COLUMN inventory_items.optimal_quantity IS
  'Docelowy poziom zapasu. NULL = wylicz z min_quantity * (1 + safety_buffer_percent/100).';
