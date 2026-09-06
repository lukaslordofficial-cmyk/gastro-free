-- =============================================================================
-- GASTRO MANAGER — Feedback testerów (Zgłoś uwagi)
-- Wklej w Supabase SQL Editor. Idempotentne.
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_feedback (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key       text NOT NULL,
  user_id           uuid,
  user_email        text,
  kind              text NOT NULL,
  message           text NOT NULL,
  location          text,
  expected_behavior text,
  attachments       jsonb NOT NULL DEFAULT '[]'::jsonb,
  status            text NOT NULL DEFAULT 'new',
  app_version       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_feedback_kind_check CHECK (
    kind IN ('bug', 'usability', 'improvement', 'feature', 'general')
  ),
  CONSTRAINT app_feedback_status_check CHECK (
    status IN ('new', 'reviewed', 'done', 'ignored')
  )
);

CREATE INDEX IF NOT EXISTS idx_app_feedback_created
  ON app_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_feedback_account
  ON app_feedback (account_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_feedback_status
  ON app_feedback (status, created_at DESC);

ALTER TABLE app_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_account_key'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'app_feedback' AND policyname = 'app_feedback_tenant_select'
    ) THEN
      CREATE POLICY app_feedback_tenant_select ON app_feedback
        FOR SELECT TO authenticated
        USING (account_key = public.current_account_key());
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'app_feedback' AND policyname = 'app_feedback_tenant_insert'
    ) THEN
      CREATE POLICY app_feedback_tenant_insert ON app_feedback
        FOR INSERT TO authenticated
        WITH CHECK (account_key = public.current_account_key());
    END IF;
  END IF;
END $$;

-- Prywatny bucket na załączniki (service_role upload z backendu).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-feedback',
  'app-feedback',
  false,
  15728640,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
