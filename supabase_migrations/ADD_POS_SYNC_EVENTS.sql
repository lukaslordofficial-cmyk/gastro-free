-- POS sync — trwały dziennik zdarzeń sprzedaży + idempotencja + reconciliation.
-- Cel: brak utraty sprzedaży i brak podwójnego księgowania przy retry/offline.

CREATE TABLE IF NOT EXISTS public.pos_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key text NOT NULL,
  event_id text NOT NULL,
  provider text,
  external_order_id text,
  payload_hash text,
  status text NOT NULL DEFAULT 'processing',   -- processing | processed | error
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT pos_sync_events_tenant_event_uq UNIQUE (account_key, event_id)
);

CREATE INDEX IF NOT EXISTS pos_sync_events_account_created_idx
  ON public.pos_sync_events (account_key, created_at DESC);

CREATE INDEX IF NOT EXISTS pos_sync_events_account_status_idx
  ON public.pos_sync_events (account_key, status);

COMMENT ON TABLE public.pos_sync_events IS
  'Dziennik zdarzeń POS: idempotencja (UNIQUE account_key,event_id), ACK i reconciliation.';
