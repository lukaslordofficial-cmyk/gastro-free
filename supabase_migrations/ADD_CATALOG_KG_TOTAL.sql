-- ADD_CATALOG_KG_TOTAL.sql
-- Dodaje kolumnę wagową do supplier_catalog, aby porównywarka ofert liczyła
-- cenę za kg także dla produktów sztukowych/opakowaniowych zdefiniowanych w g/kg
-- (analogicznie do liters_total dla produktów płynnych).
--
-- Uruchom w Supabase → SQL Editor. Jest idempotentne (IF NOT EXISTS).

ALTER TABLE supplier_catalog
  ADD COLUMN IF NOT EXISTS kg_total numeric NOT NULL DEFAULT 0;

-- (Opcjonalnie) Backfill z etykiety variant/volume_label typu "400 g" / "2,5 kg":
-- UPDATE supplier_catalog
-- SET kg_total = CASE
--     WHEN variant ~* '([0-9]+([.,][0-9]+)?)\s*kg' THEN
--       replace((regexp_match(variant, '([0-9]+([.,][0-9]+)?)\s*kg', 'i'))[1], ',', '.')::numeric
--     WHEN variant ~* '([0-9]+([.,][0-9]+)?)\s*g'  THEN
--       replace((regexp_match(variant, '([0-9]+([.,][0-9]+)?)\s*g',  'i'))[1], ',', '.')::numeric / 1000
--     ELSE kg_total
--   END
-- WHERE kg_total = 0;
