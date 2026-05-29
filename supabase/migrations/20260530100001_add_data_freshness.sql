-- Phase A: per-scope data freshness tracker.
-- See: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md

CREATE TABLE IF NOT EXISTS data_freshness (
  store_id text NOT NULL,
  platform text NOT NULL,
  scope text NOT NULL,
  table_name text NOT NULL,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  status text NOT NULL,
  lag_minutes integer,
  error_code text,
  error_message text,
  budget_skip boolean DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, platform, scope, table_name)
);

CREATE INDEX idx_data_freshness_stale ON data_freshness (lag_minutes DESC NULLS LAST)
  WHERE status != 'success';

CREATE INDEX idx_data_freshness_budget_skip ON data_freshness (updated_at DESC)
  WHERE budget_skip = true;

COMMENT ON COLUMN data_freshness.scope IS 'kpi_daily | campaign_status | campaign_metrics | adset_status | adset_metrics | ad_status | ad_metrics | product_live | product_daily | daily_reconcile | weekly_reconcile';
