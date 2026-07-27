-- =============================================================================
-- DROP: resztki minigry „Boska Waga w Ręku” / divine weight (xianxia)
-- Idempotentne — bezpieczne nawet gdy tabele nigdy nie powstały.
-- Project: tucmmrcwwcltkqwyvzxa
-- =============================================================================

DROP POLICY IF EXISTS divine_weight_attempts_tenant_select ON public.divine_weight_attempts;
DROP POLICY IF EXISTS divine_weight_attempts_tenant_insert ON public.divine_weight_attempts;
DROP POLICY IF EXISTS divine_weight_attempts_tenant_update ON public.divine_weight_attempts;
DROP POLICY IF EXISTS divine_weight_attempts_tenant_delete ON public.divine_weight_attempts;
DROP POLICY IF EXISTS divine_weight_attempts_tenant_all ON public.divine_weight_attempts;

DROP POLICY IF EXISTS divine_weight_stats_tenant_select ON public.divine_weight_stats;
DROP POLICY IF EXISTS divine_weight_stats_tenant_insert ON public.divine_weight_stats;
DROP POLICY IF EXISTS divine_weight_stats_tenant_update ON public.divine_weight_stats;
DROP POLICY IF EXISTS divine_weight_stats_tenant_delete ON public.divine_weight_stats;
DROP POLICY IF EXISTS divine_weight_stats_tenant_all ON public.divine_weight_stats;

DROP TABLE IF EXISTS public.divine_weight_attempts CASCADE;
DROP TABLE IF EXISTS public.divine_weight_stats CASCADE;

NOTIFY pgrst, 'reload schema';
