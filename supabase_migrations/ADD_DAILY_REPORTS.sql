-- =============================================================================
-- GASTRO MANAGER — Automatyczne raporty dobowe (End-of-Day Reports)
-- Wklej i uruchom w Supabase SQL Editor. Skrypt IDEMPOTENTNY.
-- =============================================================================

CREATE TABLE IF NOT EXISTS daily_reports (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date        NOT NULL UNIQUE,
  total_revenue       numeric(12,2) NOT NULL DEFAULT 0,
  total_waste_cost    numeric(12,2) NOT NULL DEFAULT 0,
  total_invoice_cost  numeric(12,2) NOT NULL DEFAULT 0,
  ai_summary          text,
  year                int         NOT NULL,
  month               int         NOT NULL,
  week_of_month       int         NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_reports_ymw ON daily_reports(year, month, week_of_month);

ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
-- Izolację tenant daje FIX_FINANCE_TENANT_RLS.sql — nie twórz USING(true).
