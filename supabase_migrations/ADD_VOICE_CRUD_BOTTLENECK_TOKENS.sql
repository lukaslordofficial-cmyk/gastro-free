-- =============================================================================
-- GASTRO MANAGER — Voice CRUD + POS Bottleneck Engine + Token Billing
-- Wklej i uruchom w Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Skrypt jest IDEMPOTENTNY — można uruchamiać wielokrotnie bez błędów.
-- =============================================================================

-- 1) menu_items.is_available (POS Bottleneck Engine flag)
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_menu_items_is_available ON menu_items(is_available);

-- 2) inventory_items.synonyms (Fuzzy Matching helper for supplier catalog)
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS synonyms jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3) token_usage — Token-to-Credit billing log for LLM calls.
CREATE TABLE IF NOT EXISTS token_usage (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint           varchar     NOT NULL,
  model              varchar     NOT NULL,
  prompt_tokens      integer     NOT NULL DEFAULT 0,
  completion_tokens  integer     NOT NULL DEFAULT 0,
  total_tokens       integer     NOT NULL DEFAULT 0,
  cost_usd           numeric(12,6) NOT NULL DEFAULT 0,
  cost_pln           numeric(12,6) NOT NULL DEFAULT 0,
  extras             jsonb       DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_endpoint ON token_usage(endpoint);

ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='token_usage' AND policyname='anon_select_token_usage') THEN
    CREATE POLICY "anon_select_token_usage" ON token_usage FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='token_usage' AND policyname='service_insert_token_usage') THEN
    CREATE POLICY "service_insert_token_usage" ON token_usage FOR INSERT TO anon, authenticated, service_role WITH CHECK (true);
  END IF;
END $$;

-- 4) sales_log — POS sales log (source data for predictive_weekend_restock).
-- Jeśli już istnieje w projekcie, ten CREATE zostanie pominięty przez IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS sales_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id  uuid,
  quantity      numeric     NOT NULL DEFAULT 1,
  revenue_pln   numeric     NOT NULL DEFAULT 0,
  sold_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_log_sold_at ON sales_log(sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_log_menu_item ON sales_log(menu_item_id);

ALTER TABLE sales_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sales_log' AND policyname='anon_all_sales_log') THEN
    CREATE POLICY "anon_all_sales_log" ON sales_log FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5) suppliers.min_order_value — logistyczne minimum darmowej dostawy.
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS min_order_value numeric(12,2) DEFAULT 0;
