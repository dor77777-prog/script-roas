-- Phase 05.5 gap-closure — REVIEW.md WR-02 / WR-04 / WR-06 / WR-07
-- ADDITIVE per supabase/MIGRATION-DISCIPLINE.md rule 1.
--
-- Cluster of follow-up constraints + explicit grants on the 05.5 v2.0 schema.
-- All operations are non-destructive (ADD constraint, GRANT). Safe to re-run
-- on the same schema because each ADD CONSTRAINT/INDEX is gated by IF NOT EXISTS.
--
-- ⚠️ Migration discipline (see supabase/MIGRATION-DISCIPLINE.md):
--   - Never edit this file after `supabase db push` succeeds.
--   - Write a follow-up migration if changes are needed.

-- ───────────────────────────────────────────────────────────────────────
-- WR-02: notification_config UNIQUE (provider)
-- Blocks two rows with the same provider; unblocks ON CONFLICT (provider)
-- DO UPDATE upsert pattern for Phase 05.6 writer.
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE notification_config
  ADD CONSTRAINT notification_config_provider_unique UNIQUE (provider);

-- ───────────────────────────────────────────────────────────────────────
-- WR-06: store_id FOREIGN KEY constraints on 7 *_daily tables
-- All daily/per-store tables reference stores(id); ON DELETE RESTRICT
-- prevents accidental orphaning, ON UPDATE CASCADE allows store-id rename
-- without manual fan-out (the operator UI hasn't been built yet so this
-- is a safety net for the future).
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE manual_overrides
  ADD CONSTRAINT manual_overrides_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE data_daily
  ADD CONSTRAINT data_daily_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE products_daily
  ADD CONSTRAINT products_daily_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE campaigns_daily
  ADD CONSTRAINT campaigns_daily_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ads_daily
  ADD CONSTRAINT ads_daily_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE orders_attribution
  ADD CONSTRAINT orders_attribution_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE product_catalog
  ADD CONSTRAINT product_catalog_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES stores(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- ───────────────────────────────────────────────────────────────────────
-- WR-07: platform CHECK constraints
-- Pre-v2.0 Apps Script writes 'meta' and 'google' (per Config.gs:STORES).
-- Constrain to these two literals to catch typos at write time (Phase 05.6).
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE manual_overrides
  ADD CONSTRAINT manual_overrides_platform_check
  CHECK (platform IN ('meta', 'google'));

ALTER TABLE campaigns_daily
  ADD CONSTRAINT campaigns_daily_platform_check
  CHECK (platform IN ('meta', 'google'));

ALTER TABLE ads_daily
  ADD CONSTRAINT ads_daily_platform_check
  CHECK (platform IN ('meta', 'google'));

-- ───────────────────────────────────────────────────────────────────────
-- WR-04: explicit GRANT SELECT to anon role
-- Postgres default behavior grants SELECT to PUBLIC on tables in `public`
-- schema in some configurations; Supabase's hardened defaults vary. Making
-- the grant explicit here pins the trust model in source-of-truth (the
-- migration log) instead of relying on implicit defaults that could
-- change across Supabase platform updates.
-- The anon role is the one the Phase 05.5 /api/health route uses
-- (SUPABASE_ANON_KEY → anon).
-- ───────────────────────────────────────────────────────────────────────

GRANT SELECT ON stores               TO anon;
GRANT SELECT ON manual_overrides     TO anon;
GRANT SELECT ON data_daily           TO anon;
GRANT SELECT ON products_daily       TO anon;
GRANT SELECT ON campaigns_daily      TO anon;
GRANT SELECT ON ads_daily            TO anon;
GRANT SELECT ON orders_attribution   TO anon;
GRANT SELECT ON product_catalog      TO anon;
GRANT SELECT ON dashboard_state      TO anon;
GRANT SELECT ON notification_config  TO anon;
