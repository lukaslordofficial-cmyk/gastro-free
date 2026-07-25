-- =============================================================================
-- Faktury + partie dat ważności (alerty 7/3/1) + domyślne przypomnienia produktu
-- Uruchom w Supabase SQL Editor.
-- Wymaga tabeli warehouse_inventory (ADD_WAREHOUSE_INVENTORY_EXPIRY.sql) —
-- poniżej jest CREATE IF NOT EXISTS jako zabezpieczenie.
-- =============================================================================

CREATE TABLE IF NOT EXISTS warehouse_inventory (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid,
  inventory_item_id uuid,
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

CREATE TABLE IF NOT EXISTS warehouse_expiry_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid,
  batch_id         uuid,
  product_name     text NOT NULL,
  days_left        int NOT NULL,
  message          text NOT NULL,
  dish_of_the_day  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 1) Faktury zakupowe (nagłówek)
CREATE TABLE IF NOT EXISTS invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid,
  supplier_id     uuid,
  supplier_name   text,
  total_cost      numeric NOT NULL DEFAULT 0,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices (created_at DESC);

-- 2) Domyślne dni przypomnień na produkcie magazynowym
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS default_alert_days integer[] NOT NULL DEFAULT '{7,3,1}';

-- 3) Rozszerzenie partii (warehouse_inventory)
ALTER TABLE warehouse_inventory
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE warehouse_inventory
  ADD COLUMN IF NOT EXISTS alert_triggers integer[] NOT NULL DEFAULT '{7,3,1}';

-- Status: warning gdy ≤ 7 dni (spójne z domyślnymi alertami)
CREATE OR REPLACE FUNCTION warehouse_inventory_set_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.status := CASE
    WHEN NEW.expiration_date < CURRENT_DATE THEN 'expired'
    WHEN NEW.expiration_date <= CURRENT_DATE + 7 THEN 'warning'
    ELSE 'fresh'
  END;
  NEW.updated_at := now();
  IF NEW.alert_triggers IS NULL OR array_length(NEW.alert_triggers, 1) IS NULL THEN
    NEW.alert_triggers := '{7,3,1}';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION warehouse_inventory_refresh_status()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE warehouse_inventory
  SET
    status = CASE
      WHEN expiration_date < CURRENT_DATE THEN 'expired'
      WHEN expiration_date <= CURRENT_DATE + 7 THEN 'warning'
      ELSE 'fresh'
    END,
    updated_at = now()
  WHERE status IS DISTINCT FROM CASE
    WHEN expiration_date < CURRENT_DATE THEN 'expired'
    WHEN expiration_date <= CURRENT_DATE + 7 THEN 'warning'
    ELSE 'fresh'
  END;
END;
$$;

-- Deduplikacja alertów: nie spamuj tym samym dniem dla tej samej partii
ALTER TABLE warehouse_expiry_alerts
  ADD COLUMN IF NOT EXISTS alert_day int;

CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_expiry_alert_batch_day
  ON warehouse_expiry_alerts (batch_id, alert_day)
  WHERE batch_id IS NOT NULL AND alert_day IS NOT NULL;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'invoices' AND policyname = 'anon_all_invoices'
  ) THEN
    CREATE POLICY "anon_all_invoices"
      ON invoices FOR ALL TO anon, authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Widok pomocniczy (nazwa jak w specyfikacji)
CREATE OR REPLACE VIEW inventory_batches AS
SELECT
  wi.id,
  wi.inventory_item_id AS product_id,
  wi.invoice_id,
  wi.product_name,
  wi.quantity,
  wi.unit,
  wi.expiration_date,
  wi.alert_triggers,
  wi.status,
  wi.created_at
FROM warehouse_inventory wi;
