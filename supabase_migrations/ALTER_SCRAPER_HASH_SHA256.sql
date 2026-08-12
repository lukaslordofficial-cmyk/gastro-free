-- Widen content_hash columns for SHA-256 hex (64 chars; was MD5 32).
-- Idempotent. Existing MD5 values remain until next scrape (one-time full rehash).

ALTER TABLE IF EXISTS public.scrape_targets
  ALTER COLUMN content_hash TYPE varchar(64);

ALTER TABLE IF EXISTS public.scrape_snapshots
  ALTER COLUMN content_hash TYPE varchar(64);

COMMENT ON COLUMN public.scrape_targets.content_hash IS 'SHA-256 hex fingerprint of page content';
COMMENT ON COLUMN public.scrape_snapshots.content_hash IS 'SHA-256 hex fingerprint of snapshot content';
