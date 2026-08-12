-- =============================================================================
-- Delta-Scraper — monitorowanie zmian na stronach hurtowni / producentów
-- Idempotentny — można uruchamiać wielokrotnie.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.scrape_targets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url                 text NOT NULL,
  supplier_id         uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  label               text,
  fetch_mode          text NOT NULL DEFAULT 'auto',  -- auto | httpx | playwright
  css_selector        text,                            -- opcjonalny kontener produktów
  check_interval_hours integer NOT NULL DEFAULT 24,
  is_active           boolean NOT NULL DEFAULT true,
  content_hash        varchar(64),                   -- SHA-256 hex
  last_checked_at     timestamptz,
  last_changed_at     timestamptz,
  product_count       integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(url)
);

CREATE TABLE IF NOT EXISTS public.scrape_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id           uuid NOT NULL REFERENCES public.scrape_targets(id) ON DELETE CASCADE,
  content_hash        varchar(64) NOT NULL,
  products_json       jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_count       integer NOT NULL DEFAULT 0,
  text_length         integer NOT NULL DEFAULT 0,
  captured_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scrape_snapshots_target ON public.scrape_snapshots(target_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.price_alerts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id           uuid REFERENCES public.scrape_targets(id) ON DELETE SET NULL,
  supplier_id         uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  url                 text NOT NULL,
  change_type         text NOT NULL,  -- price_drop | price_rise | new_items | status_change | no_change
  product_name        text,
  details             jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_alerts_detected ON public.price_alerts(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_alerts_supplier ON public.price_alerts(supplier_id);

GRANT ALL ON public.scrape_targets TO anon, authenticated, service_role;
GRANT ALL ON public.scrape_snapshots TO anon, authenticated, service_role;
GRANT ALL ON public.price_alerts TO anon, authenticated, service_role;

ALTER TABLE public.scrape_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrape_targets' AND policyname = 'anon_all_scrape_targets') THEN
    CREATE POLICY "anon_all_scrape_targets" ON public.scrape_targets
      FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrape_snapshots' AND policyname = 'anon_all_scrape_snapshots') THEN
    CREATE POLICY "anon_all_scrape_snapshots" ON public.scrape_snapshots
      FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'price_alerts' AND policyname = 'anon_all_price_alerts') THEN
    CREATE POLICY "anon_all_price_alerts" ON public.price_alerts
      FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
