-- supabase/migrations/20260521063301_seed_stores.sql
-- Phase 05.5 — seed stores + notification_config (D-A5 rows 1 + 10)
-- ADDITIVE

-- 3 stores per Config.gs:STORES (single source of truth)
INSERT INTO stores (id, name, has_google_ads, meta_ad_account_id, google_ads_customer_id) VALUES
  ('uzoshop',   'uzoshop',   TRUE,  '26442930835313109', '4014537400'),
  ('zolplus',   'Zol Plus',  FALSE, '800776975668368',   NULL),
  ('usmile360', '360usmile', FALSE, '981695850074160',   NULL);

-- notification_config: metacloud (active) + twilio (legacy/fallback, active=false)
-- Phone numbers + email pulled from operator's confirmed values in RESEARCH.md §Pattern 7 seed
INSERT INTO notification_config
  (provider, active, template_name, template_lang, dashboard_url, notification_email, phone1, phone2)
VALUES
  ('metacloud', TRUE,  'roas_daily_summary', 'he',
    'https://roas-dashboard-smoky.vercel.app',
    'dor77777@gmail.com', '+972524809540', '+972546100067'),
  ('twilio',    FALSE, NULL, NULL, NULL, NULL, NULL, NULL);
