-- =============================================================================
-- GASTRO MANAGER — Partie magazynowe z datą ważności (Vision AI scanner)
-- Wklej i uruchom w Supabase SQL Editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS warehouse_inventory (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  product_name     text NOT NULL,
  quantity         numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit             text NOT NULL DEFAULT 'szt',
  expiration_date  date NOT NULL,
  status           text NOT NULL DEFAULT 'fresh'
                   CHECK (status IN ('fresh', 'warning', 'expired')),
  confidence_score numeric,
  source           text DEFAULT 'vision_scan',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_exp
  ON warehouse_inventory (expiration_date);

CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_status
  ON warehouse_inventory (status);

CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_restaurant
  ON warehouse_inventory (restaurant_id);

-- Aktualizacja statusu na podstawie daty ważności
CREATE OR REPLACE FUNCTION warehouse_inventory_refresh_status()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE warehouse_inventory
  SET
    status = CASE
      WHEN expiration_date < CURRENT_DATE THEN 'expired'
      WHEN expiration_date <= CURRENT_DATE + 3 THEN 'warning'
      ELSE 'fresh'
    END,
    updated_at = now()
  WHERE status IS DISTINCT FROM CASE
    WHEN expiration_date < CURRENT_DATE THEN 'expired'
    WHEN expiration_date <= CURRENT_DATE + 3 THEN 'warning'
    ELSE 'fresh'
  END;
END;
$$;

-- Trigger: ustaw status przy INSERT/UPDATE
CREATE OR REPLACE FUNCTION warehouse_inventory_set_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.status := CASE
    WHEN NEW.expiration_date < CURRENT_DATE THEN 'expired'
    WHEN NEW.expiration_date <= CURRENT_DATE + 3 THEN 'warning'
    ELSE 'fresh'
  END;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouse_inventory_status ON warehouse_inventory;
CREATE TRIGGER trg_warehouse_inventory_status
  BEFORE INSERT OR UPDATE OF expiration_date
  ON warehouse_inventory
  FOR EACH ROW
  EXECUTE FUNCTION warehouse_inventory_set_status();

-- Log powiadomień / dania dnia (wynik crona)
CREATE TABLE IF NOT EXISTS warehouse_expiry_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid,
  batch_id         uuid REFERENCES warehouse_inventory(id) ON DELETE CASCADE,
  product_name     text NOT NULL,
  days_left        int NOT NULL,
  message          text NOT NULL,
  dish_of_the_day  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE warehouse_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_expiry_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'warehouse_inventory' AND policyname = 'anon_all_warehouse_inventory'
  ) THEN
    CREATE POLICY "anon_all_warehouse_inventory"
      ON warehouse_inventory FOR ALL TO anon, authenticated
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'warehouse_expiry_alerts' AND policyname = 'anon_all_warehouse_expiry_alerts'
  ) THEN
    CREATE POLICY "anon_all_warehouse_expiry_alerts"
      ON warehouse_expiry_alerts FOR ALL TO anon, authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- =============================================================================
-- CRON (opcjonalnie — wymaga rozszerzenia pg_cron + Edge Function URL)
-- =============================================================================
-- 1) Włącz pg_cron w Dashboard → Database → Extensions.
-- 2) Codziennie odśwież statusy:
--
--   SELECT cron.schedule(
--     'warehouse-refresh-status',
--     '0 6 * * *',
--     $$SELECT warehouse_inventory_refresh_status();$$
--   );
--
-- 3) Codziennie wywołaj Edge Function `expiry-daily-cron` (powiadomienia + Danie dnia):
--
--   SELECT cron.schedule(
--     'warehouse-expiry-notify',
--     '5 6 * * *',
--     $$
--     SELECT net.http_post(
--       url := 'https://YOUR_PROJECT.supabase.co/functions/v1/expiry-daily-cron',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
--         'Content-Type', 'application/json'
--       ),
--       body := '{}'::jsonb
--     );
--     $$
--   );
--
-- Alternatywa bez pg_cron: zaplanuj wywołanie FastAPI
--   GET /api/inventory/expiry-daily-job
--   Header: X-Cron-Secret: $CRON_JOB_SECRET
-- przez zewnętrzny scheduler (GitHub Actions / Railway cron).
-- =============================================================================
