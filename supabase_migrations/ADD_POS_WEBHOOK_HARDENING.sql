-- =============================================================================
-- POS webhook hardening: raw logs, unmapped SKU queue, connection status
-- Uruchom w Supabase SQL Editor (idempotentne).
-- =============================================================================

-- 1) Status połączenia na pos_settings (Realtime / UI)
ALTER TABLE public.pos_settings
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'pending';
  -- pending | connected | disconnected

ALTER TABLE public.pos_settings
  ADD COLUMN IF NOT EXISTS webhook_secret_token text;

COMMENT ON COLUMN public.pos_settings.connection_status IS
  'pending | connected | disconnected — ustawiane przy handshake / pierwszej sprzedaży POS.';
COMMENT ON COLUMN public.pos_settings.webhook_secret_token IS
  'Opcjonalny sekret per-tenant (nagłówek X-Webhook-Secret lub ?token=). Short /w/{slug} nadal działa.';

DO $$
BEGIN
  ALTER TABLE public.pos_settings
    DROP CONSTRAINT IF EXISTS pos_settings_connection_status_chk;
  ALTER TABLE public.pos_settings
    ADD CONSTRAINT pos_settings_connection_status_chk
    CHECK (connection_status IN ('pending', 'connected', 'disconnected'));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'pos_settings.connection_status check: %', SQLERRM;
END $$;

-- 2) Surowy JSON z POS (debug testerów)
CREATE TABLE IF NOT EXISTS public.pos_raw_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key text NOT NULL,
  provider text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  headers jsonb,
  path text,
  http_method text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_raw_logs_account_created_idx
  ON public.pos_raw_logs (account_key, created_at DESC);

COMMENT ON TABLE public.pos_raw_logs IS
  'Surowy payload webhooka POS (JSONB) — diagnostyka bez wywalania aplikacji.';

ALTER TABLE public.pos_raw_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_raw_logs_tenant_select ON public.pos_raw_logs;
CREATE POLICY pos_raw_logs_tenant_select ON public.pos_raw_logs
  FOR SELECT TO authenticated
  USING (account_key = public.current_account_key());

-- service_role omija RLS (backend insert)

-- 3) Niezmapowane SKU — kolejka do przypisania (UPSERT, zawsze ACK 200 do POS)
CREATE TABLE IF NOT EXISTS public.unmapped_pos_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key text NOT NULL,
  pos_sku text NOT NULL,
  dish_name_hint text,
  last_seen timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1,
  last_quantity numeric,
  last_unit_price_pln numeric,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unmapped_pos_items_tenant_sku_uq UNIQUE (account_key, pos_sku)
);

CREATE INDEX IF NOT EXISTS unmapped_pos_items_account_seen_idx
  ON public.unmapped_pos_items (account_key, last_seen DESC);

COMMENT ON TABLE public.unmapped_pos_items IS
  'SKU/ID z POS bez mapowania na menu — UI: kliknij i przypisz do dania.';

ALTER TABLE public.unmapped_pos_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unmapped_pos_items_tenant_select ON public.unmapped_pos_items;
DROP POLICY IF EXISTS unmapped_pos_items_tenant_update ON public.unmapped_pos_items;
DROP POLICY IF EXISTS unmapped_pos_items_tenant_delete ON public.unmapped_pos_items;

CREATE POLICY unmapped_pos_items_tenant_select ON public.unmapped_pos_items
  FOR SELECT TO authenticated
  USING (account_key = public.current_account_key());

CREATE POLICY unmapped_pos_items_tenant_update ON public.unmapped_pos_items
  FOR UPDATE TO authenticated
  USING (account_key = public.current_account_key())
  WITH CHECK (account_key = public.current_account_key());

CREATE POLICY unmapped_pos_items_tenant_delete ON public.unmapped_pos_items
  FOR DELETE TO authenticated
  USING (account_key = public.current_account_key());

-- 4) Idempotencja na poziomie zamówienia w dzienniku (gdy event_id = pos_order_id)
-- Już jest UNIQUE (account_key, event_id) w pos_sync_events.
-- Dodatkowy indeks po external_order_id ułatwia reconciliation.
CREATE INDEX IF NOT EXISTS pos_sync_events_account_order_idx
  ON public.pos_sync_events (account_key, external_order_id)
  WHERE external_order_id IS NOT NULL;

-- Realtime (opcjonalnie — włącz w Dashboard → Replication jeśli potrzeba live UI)
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_settings;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.unmapped_pos_items;
