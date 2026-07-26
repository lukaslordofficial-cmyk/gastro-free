-- Wzorcowa waga 1 sztuki składnika w recepturze (g) — gdy unit = szt / sztuka.
-- Używane do przeliczeń magazyn / koszt / yield gdy receptura liczy w sztukach.

ALTER TABLE recipe_ingredients
  ADD COLUMN IF NOT EXISTS piece_weight_g numeric;

COMMENT ON COLUMN recipe_ingredients.piece_weight_g IS
  'Wzorcowa waga 1 sztuki składnika w gramach (gdy unit=szt). NULL gdy nie dotyczy.';
