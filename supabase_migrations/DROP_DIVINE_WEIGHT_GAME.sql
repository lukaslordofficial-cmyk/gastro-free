-- =============================================================================
-- DROP resztek divine weight — IDEMPOTENTNE (OK gdy tabele nigdy nie powstały)
-- PostgreSQL: DROP POLICY IF EXISTS wymaga istnienia TABELI → nie używamy go.
-- DROP TABLE IF EXISTS … CASCADE usuwa też polityki.
-- =============================================================================

DROP TABLE IF EXISTS public.divine_weight_attempts CASCADE;
DROP TABLE IF EXISTS public.divine_weight_stats CASCADE;

NOTIFY pgrst, 'reload schema';
