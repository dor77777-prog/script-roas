-- Phase 05.7.x (2026-05-23) — token_failures: log of OAuth/API-token failures
-- across all upstream platforms (Meta / Google / TikTok / WhatsApp). Drives the
-- operator's WhatsApp alert pipeline + the operator-console history view.
--
-- Throttle key is the composite (provider, store_id, operation). The
-- notifier upserts on this key: it sends a WhatsApp alert the first time a
-- failure is seen, then suppresses further alerts for the same key until
-- 6 hours have passed since `last_alert_sent_at`. `seen_count` is bumped on
-- every detected failure (independent of whether an alert was actually sent).
--
-- We use a 3-column PK rather than (provider, operation) alone so a TikTok
-- failure on uzoshop doesn't suppress an alert for the same failure on
-- zolplus (relevant once TikTok rolls out to more stores).
--
-- `store_id` of 'global' is reserved for platform-wide failures that aren't
-- tied to a specific store (e.g. WhatsApp Cloud token, OXR FX provider).
--
-- ROW SECURITY: RLS stays disabled in line with the URL-obscurity trust
-- model documented in docs/ARCHITECTURE.md §3. Only the service_role key
-- writes; the dashboard reads via the anon role's SELECT grant inherited
-- from the schema-wide grants migration.

CREATE TABLE IF NOT EXISTS token_failures (
  provider TEXT NOT NULL,
  store_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_alert_sent_at TIMESTAMPTZ,
  seen_count INTEGER NOT NULL DEFAULT 1,
  alerts_sent_count INTEGER NOT NULL DEFAULT 0,
  last_error_msg TEXT NOT NULL,
  -- Free-text hint the notifier composes for the operator
  -- (e.g. "Run OAuth Playground flow + update GOOGLEADS_REFRESH_TOKEN").
  last_advice TEXT,
  -- Once the operator confirms the issue is fixed, they can clear the row
  -- (DELETE) or set `resolved_at` so the next failure starts a fresh
  -- alert cycle. NULL = unresolved / not yet fixed.
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY (provider, store_id, operation),
  CHECK (provider IN ('meta', 'google', 'tiktok', 'whatsapp', 'shopify', 'fx')),
  CHECK (store_id IN ('uzoshop', 'zolplus', 'usmile360', 'global'))
);

-- Index for the operator console "latest unresolved failures" query.
CREATE INDEX IF NOT EXISTS idx_token_failures_unresolved
  ON token_failures (last_seen_at DESC)
  WHERE resolved_at IS NULL;

-- Grant SELECT to anon so the dashboard can read; INSERT/UPDATE only via
-- service_role (matches the pattern used for manual_overrides etc.).
GRANT SELECT ON token_failures TO anon;
GRANT ALL ON token_failures TO service_role;
