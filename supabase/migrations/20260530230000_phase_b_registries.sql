-- Phase B (2026-05-30) — Registries + status discovery + cron-tick observability.
-- See docs/superpowers/specs/2026-05-30-phase-b-registries-meta-status-design.md
-- for the full design rationale.

-- ---------------------------------------------------------------------------
-- 1. campaign_registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_registry (
  store_id text NOT NULL,
  platform text NOT NULL,                       -- 'meta' | 'google' | 'tiktok'
  campaign_id text NOT NULL,
  name text,
  configured_status text,                       -- operator-set: ACTIVE | PAUSED | DELETED | ARCHIVED
  effective_status text,                        -- platform-native raw enum
  delivery_status text,                         -- normalized: DELIVERING | PENDING_REVIEW | NOT_DELIVERING | LEARNING | LIMITED | REJECTED | UNKNOWN
  is_enabled boolean,                           -- derived
  is_serving boolean,                           -- derived
  first_seen_at timestamptz NOT NULL,           -- set on INSERT only
  last_seen_at timestamptz NOT NULL,            -- bumped on every observation
  platform_updated_at timestamptz,              -- raw from platform updated_time
  status_changed_at timestamptz,                -- bumped ONLY when configured/effective_status differs
  last_metrics_success_at timestamptz,          -- Phase C hot_metrics
  last_status_success_at timestamptz,           -- bumped by status scope on success
  raw_status_payload jsonb,
  missed_seen_count integer NOT NULL DEFAULT 0,
  is_removed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (store_id, platform, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_registry_serving
  ON campaign_registry (store_id, platform, is_serving)
  WHERE is_serving = true AND is_removed = false;
CREATE INDEX IF NOT EXISTS idx_campaign_registry_recent_status_change
  ON campaign_registry (store_id, platform, status_changed_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 2. adset_registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adset_registry (
  store_id text NOT NULL,
  platform text NOT NULL,
  campaign_id text NOT NULL,
  adset_id text NOT NULL,
  name text,
  configured_status text,
  effective_status text,
  delivery_status text,
  is_enabled boolean,
  is_serving boolean,
  daily_budget_cad numeric(14,4),
  lifetime_budget_cad numeric(14,4),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  platform_updated_at timestamptz,
  status_changed_at timestamptz,
  last_metrics_success_at timestamptz,
  last_status_success_at timestamptz,
  raw_status_payload jsonb,
  missed_seen_count integer NOT NULL DEFAULT 0,
  is_removed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (store_id, platform, adset_id)
);
CREATE INDEX IF NOT EXISTS idx_adset_registry_campaign ON adset_registry (store_id, platform, campaign_id);
CREATE INDEX IF NOT EXISTS idx_adset_registry_serving
  ON adset_registry (store_id, platform, is_serving)
  WHERE is_serving = true AND is_removed = false;
CREATE INDEX IF NOT EXISTS idx_adset_registry_recent_status_change
  ON adset_registry (store_id, platform, status_changed_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 3. ad_registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_registry (
  store_id text NOT NULL,
  platform text NOT NULL,
  campaign_id text NOT NULL,
  adset_id text NOT NULL,
  ad_id text NOT NULL,
  name text,
  configured_status text,
  effective_status text,
  delivery_status text,
  is_enabled boolean,
  is_serving boolean,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  platform_updated_at timestamptz,
  status_changed_at timestamptz,
  last_metrics_success_at timestamptz,
  last_status_success_at timestamptz,
  raw_status_payload jsonb,
  missed_seen_count integer NOT NULL DEFAULT 0,
  is_removed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (store_id, platform, ad_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_registry_adset ON ad_registry (store_id, platform, adset_id);
CREATE INDEX IF NOT EXISTS idx_ad_registry_serving
  ON ad_registry (store_id, platform, is_serving)
  WHERE is_serving = true AND is_removed = false;
CREATE INDEX IF NOT EXISTS idx_ad_registry_recent_status_change
  ON ad_registry (store_id, platform, status_changed_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- Helper: minute-bucket epoch (used by campaign_status_events.dedupe_key).
-- Postgres conservatively marks `extract(epoch from timestamptz)` as STABLE
-- across the board, even though the epoch value is semantically immutable
-- for timestamptz (epoch is UTC-defined; timestamptz is internally UTC).
-- STORED generated columns require IMMUTABLE expressions, so we wrap the
-- expression in a SQL function declared IMMUTABLE. Safe: the function body
-- depends only on the input value, not on any session GUC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.minute_bucket_epoch(ts timestamptz)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (extract(epoch FROM ts)::bigint) / 60
$$;

-- ---------------------------------------------------------------------------
-- 4. campaign_status_events (append-only audit log, deduped)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_status_events (
  id bigserial PRIMARY KEY,
  store_id text NOT NULL,
  platform text NOT NULL,
  entity_type text NOT NULL,                    -- 'campaign' | 'adset' | 'ad'
  entity_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  from_status text,                             -- null if first_seen
  to_status text NOT NULL,
  change_kind text NOT NULL,                    -- 'first_seen' | 'paused' | 'enabled' | 'archived' | 'removed' | 'effective_only' | 'delivery_only'
  raw_event jsonb,
  -- See `minute_bucket_epoch()` above for why we wrap in a SQL function.
  -- Bucket = integer minute-since-UTC-epoch. Collision granularity is
  -- still 1 minute; flapping observations within the same minute coalesce.
  dedupe_key text GENERATED ALWAYS AS (
    store_id || ':' || platform || ':' || entity_type || ':' || entity_id || ':' ||
    COALESCE(from_status, 'NULL') || ':' || to_status || ':' ||
    public.minute_bucket_epoch(occurred_at)::text
  ) STORED,
  UNIQUE (dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_status_events_recent ON campaign_status_events (store_id, platform, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_events_entity ON campaign_status_events (entity_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 5. cron_tick_snapshots (one row per orchestrator run)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cron_tick_snapshots (
  tick_id text PRIMARY KEY,                     -- ISO YYYY-MM-DDTHH:MM, 10-min bucket
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  fan_out_count integer,
  events_completed_count integer,
  events_skipped_count integer,
  events_failed_count integer
);
CREATE INDEX IF NOT EXISTS idx_cron_tick_snapshots_started ON cron_tick_snapshots (started_at DESC);

-- ---------------------------------------------------------------------------
-- Grants — mirror existing pattern from 20260521075741_add_constraints_and_grants.sql.
-- service_role implicit; anon gets SELECT only (URL-obscurity trust model).
-- ---------------------------------------------------------------------------
GRANT SELECT ON campaign_registry, adset_registry, ad_registry,
                 campaign_status_events, cron_tick_snapshots TO anon;
