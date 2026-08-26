-- Łowca Okazji: opcjonalna ODMIANA / WARIANT produktu magazynowego.
-- Kompatybilne wstecz — kolumna opcjonalna (NULL = brak odmiany, zachowanie jak dotychczas).
-- Przykłady wartości: 'Irys', 'Jonagold', 'Premium', 'BIO', 'bezglutenowy'.

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS variant text;

COMMENT ON COLUMN public.inventory_items.variant IS
  'Opcjonalna odmiana / wariant produktu (np. Irys, Jonagold, BIO). '
  'Łowca Okazji najpierw szuka dokładnie tej odmiany, a inne odmiany '
  'tego samego produktu proponuje jako zamiennik za zgodą użytkownika.';
