-- supabase/migrations/20260521063112_initial_schema.sql
-- Phase 05.5 — 10-table schema mirroring Sheets 1:1 (D-A2)
-- RLS deliberately NOT enabled — single-user URL-obscurity (per /gsd-explore 2026-05-21)
-- ADDITIVE
--
-- Migration discipline (see supabase/MIGRATION-DISCIPLINE.md):
--   - Never edit this file after `supabase db push` succeeds.
--   - Write a follow-up migration if changes are needed.
--   - DESTRUCTIVE operations require `-- DESTRUCTIVE: <reason>` as the FIRST line.

-- 1. stores — replaces store-meta + Config.gs:STORES (D-A5 row 1)
CREATE TABLE stores (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL,
  has_google_ads              BOOLEAN NOT NULL DEFAULT FALSE,
  plan_display_name           TEXT,
  shopify_plus                BOOLEAN,
  partner_dev                 BOOLEAN,
  meta_ad_account_id          TEXT,
  google_ads_customer_id      TEXT,
  last_error                  TEXT,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE stores IS 'D-A5 row 1 — replaces store-meta tab + Config.gs:STORES constant';

-- 2. manual_overrides — replaces manual-spend tab (D-A5 row 2)
CREATE TABLE manual_overrides (
  id                          BIGSERIAL PRIMARY KEY,
  date                        DATE NOT NULL,
  store_id                    TEXT NOT NULL,
  platform                    TEXT NOT NULL,
  spend                       NUMERIC(14, 4) NOT NULL,
  currency                    TEXT NOT NULL,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date, store_id, platform)
);
COMMENT ON TABLE manual_overrides IS 'D-A5 row 2 — replaces manual-spend tab; 38 rows to be imported in Phase 05.6';

-- 3. data_daily — replaces data-daily tab (11 cols) (D-A5 row 3)
CREATE TABLE data_daily (
  date                        DATE NOT NULL,
  store_id                    TEXT NOT NULL,
  store_name                  TEXT NOT NULL,
  fb_spend_cad                NUMERIC(14, 4),
  ga_spend_cad                NUMERIC(14, 4),
  total_spend_cad             NUMERIC(14, 4),
  revenue_cad                 NUMERIC(14, 4),
  roas                        NUMERIC(10, 4),
  gross_profit_cad            NUMERIC(14, 4),
  cogs_cad                    NUMERIC(14, 4),
  net_profit_cad              NUMERIC(14, 4),
  PRIMARY KEY (date, store_id)
);
COMMENT ON TABLE data_daily IS 'D-A5 row 3 — replaces data-daily tab; SheetBuilder.gs:816 DAILY_FLAT_HEADERS';

-- 4. products_daily — replaces products-daily (9 cols) (D-A5 row 4)
-- product_id TEXT (not BIGINT) per RESEARCH.md Pitfall 4: 17-19 digit Shopify IDs overflow JS Number
CREATE TABLE products_daily (
  date                        DATE NOT NULL,
  store_id                    TEXT NOT NULL,
  store_name                  TEXT NOT NULL,
  product_id                  TEXT NOT NULL,
  product_title               TEXT,
  units                       INTEGER NOT NULL DEFAULT 0,
  gross_revenue_cad           NUMERIC(14, 4),
  orders                      INTEGER NOT NULL DEFAULT 0,
  net_revenue_cad             NUMERIC(14, 4),
  PRIMARY KEY (date, store_id, product_id)
);
COMMENT ON TABLE products_daily IS 'D-A5 row 4 — replaces products-daily tab; product_id is TEXT (Shopify IDs are 17-19 digits)';

-- 5. campaigns_daily — replaces 3 × {store}-campaigns (15 cols, unified per D-A4) (D-A5 row 5)
CREATE TABLE campaigns_daily (
  date                        DATE NOT NULL,
  store_id                    TEXT NOT NULL,
  platform                    TEXT NOT NULL,
  campaign_id                 TEXT NOT NULL,
  campaign_name               TEXT,
  ad_set_id                   TEXT NOT NULL,
  ad_set_name                 TEXT,
  spend_cad                   NUMERIC(14, 4),
  impressions                 BIGINT,
  clicks                      BIGINT,
  conversions                 BIGINT,
  conversion_value_cad        NUMERIC(14, 4),
  roas                        NUMERIC(10, 4),
  campaign_budget_cad         NUMERIC(14, 4),
  ad_set_budget_cad           NUMERIC(14, 4),
  budget_type                 TEXT,
  PRIMARY KEY (date, store_id, platform, campaign_id, ad_set_id)
);
CREATE INDEX idx_campaigns_daily_store_date ON campaigns_daily (store_id, date);
COMMENT ON TABLE campaigns_daily IS 'D-A5 row 5 — replaces 3 × {store}-campaigns; unified per D-A4; SheetBuilder.gs:647 CAMPAIGN_HEADERS';

-- 6. ads_daily — replaces 3 × {store}-ads (14 cols, unified) (D-A5 row 6)
CREATE TABLE ads_daily (
  date                        DATE NOT NULL,
  store_id                    TEXT NOT NULL,
  platform                    TEXT NOT NULL,
  campaign_id                 TEXT NOT NULL,
  campaign_name               TEXT,
  ad_set_id                   TEXT NOT NULL,
  ad_set_name                 TEXT,
  ad_id                       TEXT NOT NULL,
  ad_name                     TEXT,
  spend_cad                   NUMERIC(14, 4),
  impressions                 BIGINT,
  clicks                      BIGINT,
  conversions                 BIGINT,
  conversion_value_cad        NUMERIC(14, 4),
  roas                        NUMERIC(10, 4),
  PRIMARY KEY (date, store_id, ad_id)
);
CREATE INDEX idx_ads_daily_store_campaign ON ads_daily (store_id, campaign_id);
COMMENT ON TABLE ads_daily IS 'D-A5 row 6 — replaces 3 × {store}-ads; unified per D-A4; SheetBuilder.gs:1184 ADS_HEADERS';

-- 7. orders_attribution — replaces 3 × {store}-orders-attribution (14 cols, unified) (D-A5 row 7)
CREATE TABLE orders_attribution (
  store_id                    TEXT NOT NULL,
  order_id                    TEXT NOT NULL,
  date                        DATE NOT NULL,
  total_cad                   NUMERIC(14, 4),
  source                      TEXT,
  utm_source                  TEXT,
  utm_medium                  TEXT,
  utm_campaign                TEXT,
  utm_content                 TEXT,
  fbclid_present              BOOLEAN,
  gclid_present               BOOLEAN,
  referrer                    TEXT,
  utm_id                      TEXT,
  utm_term                    TEXT,
  line_items                  JSONB,
  PRIMARY KEY (store_id, order_id)
);
CREATE INDEX idx_orders_attribution_store_date ON orders_attribution (store_id, date);
COMMENT ON TABLE orders_attribution IS 'D-A5 row 7 — replaces 3 × {store}-orders-attribution; unified per D-A4; SheetBuilder.gs:1501; line_items is JSONB';

-- 8. product_catalog — replaces 3 × {store}-products-catalog (9 cols + store_id) (D-A5 row 8)
CREATE TABLE product_catalog (
  store_id                    TEXT NOT NULL,
  product_id                  TEXT NOT NULL,
  title                       TEXT,
  handle                      TEXT,
  status                      TEXT,
  price_cad                   NUMERIC(14, 4),
  image_url                   TEXT,
  product_type                TEXT,
  vendor                      TEXT,
  updated_at                  TIMESTAMPTZ,
  PRIMARY KEY (store_id, product_id)
);
COMMENT ON TABLE product_catalog IS 'D-A5 row 8 — replaces 3 × {store}-products-catalog; unified per D-A4; SheetBuilder.gs:1299';

-- 9. dashboard_state — replaces dashboard-state tab (D-A5 row 9)
-- Verified: 7 keys, NOT 8 (per dashboard-web/src/lib/sheets.ts:315 ALLOWED_STATE_KEYS).
CREATE TABLE dashboard_state (
  key                         TEXT PRIMARY KEY,
  value                       JSONB,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE dashboard_state IS 'D-A5 row 9 — replaces dashboard-state tab. 7 ALLOWED_STATE_KEYS from sheets.ts:315 — billing-recurring, billing-onetime, annotations, monthly-revenue-goal, insight-states, campaign-optimized, campaign-product-map. NOT 8 as some CONTEXT.md drafts claimed.';

-- 10. notification_config — extracted from PropertiesService notify.*/metacloud.*/twilio.* (D-A5 row 10)
CREATE TABLE notification_config (
  id                          BIGSERIAL PRIMARY KEY,
  provider                    TEXT NOT NULL,
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  template_name               TEXT,
  template_lang               TEXT,
  dashboard_url               TEXT,
  notification_email          TEXT,
  phone1                      TEXT,
  phone2                      TEXT,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE notification_config IS 'D-A5 row 10 — extracted from PropertiesService notify.*/metacloud.*/twilio.*. Twilio row inserted with active=false per legacy/fallback policy.';
