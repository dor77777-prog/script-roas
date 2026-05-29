-- Phase A: Meta BUC usage tracker.
-- Composite PK (store_id, ad_account_id) — today 1:1, tomorrow potentially N:1.
-- See: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md

CREATE TABLE IF NOT EXISTS meta_buc_usage (
  store_id text NOT NULL,
  ad_account_id text NOT NULL,
  ads_insights_call_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_insights_cputime_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_insights_time_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_insights_eta_minutes integer DEFAULT 0,
  ads_management_call_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_management_cputime_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_management_time_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_management_eta_minutes integer DEFAULT 0,
  last_url text,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, ad_account_id)
);

CREATE INDEX idx_meta_buc_usage_store ON meta_buc_usage (store_id);

COMMENT ON TABLE meta_buc_usage IS 'Latest x-business-use-case-usage snapshot per (store, ad_account_id). Read by getMetaBucUsageForStore which aggregates MAX across rows for a store.';
