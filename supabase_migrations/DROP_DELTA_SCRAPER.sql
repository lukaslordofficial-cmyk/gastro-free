-- Drop Delta-Scraper tables (feature removed from Gastro Manager).
-- Idempotent — safe if tables were never created.

DROP TABLE IF EXISTS public.scrape_snapshots CASCADE;
DROP TABLE IF EXISTS public.price_alerts CASCADE;
DROP TABLE IF EXISTS public.scrape_targets CASCADE;
