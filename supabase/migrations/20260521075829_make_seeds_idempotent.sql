-- Phase 05.5 gap-closure — REVIEW.md WR-03
-- ADDITIVE per supabase/MIGRATION-DISCIPLINE.md rule 1.
--
-- Re-apply Phase 05.5-01's seed values with ON CONFLICT DO NOTHING so they
-- can be safely re-applied to dev/branch databases without hitting
-- `stores_pkey` or `notification_config_provider_unique` violations.
--
-- The original seed migration (20260521063301_seed_stores.sql) is locked
-- per MIGRATION-DISCIPLINE rule 3 — can't edit a pushed migration. This
-- migration is the idempotent replacement going forward.
--
-- For the production database (already seeded by the original migration),
-- every INSERT below becomes a no-op (ON CONFLICT DO NOTHING).
-- For a fresh database that runs all migrations in order, this is a
-- duplicate-safe re-INSERT — also a no-op after the original ran.
--
-- Future seed migrations MUST follow this idempotent pattern.

-- 3 stores per Config.gs:STORES (single source of truth)
INSERT INTO stores (id, name, has_google_ads, meta_ad_account_id, google_ads_customer_id) VALUES
  ('uzoshop',   'uzoshop',   TRUE,  '26442930835313109', '4014537400'),
  ('zolplus',   'Zol Plus',  FALSE, '800776975668368',   NULL),
  ('usmile360', '360usmile', FALSE, '981695850074160',   NULL)
ON CONFLICT (id) DO NOTHING;

-- notification_config: relies on the UNIQUE (provider) constraint added in
-- 20260521075741_add_constraints_and_grants.sql (WR-02) — that migration
-- must apply BEFORE this one (ascending timestamp order enforces this).
INSERT INTO notification_config
  (provider, active, template_name, template_lang, dashboard_url, notification_email, phone1, phone2)
VALUES
  ('metacloud', TRUE,  'roas_daily_summary', 'he',
    'https://roas-dashboard-smoky.vercel.app',
    'dor77777@gmail.com', '+972524809540', '+972546100067'),
  ('twilio',    FALSE, NULL, NULL, NULL, NULL, NULL, NULL)
ON CONFLICT (provider) DO NOTHING;
