-- Real-time Shopify activity feed (Task 2).
--
-- ACCESS MODEL (Review #5): both tables are written + read ONLY via the
-- service-role client (getSupabaseAdmin) from server routes — the webhook
-- ingest writes, and the Phase-3 /api/store-events read route (behind the
-- dashboard password gate) reads. So NO `anon` GRANT is issued here.
-- store_webhooks holds signing_secret + cart_public_token and MUST NEVER be
-- anon-readable; store_events is display-only but still service-role-only to
-- keep the surface minimal. (RLS is disabled project-wide per the trust model;
-- the absence of an anon grant is the access boundary.)
--
-- store_webhooks: per-store webhook routing + secrets (no-redeploy connect/disconnect).
CREATE TABLE IF NOT EXISTS store_webhooks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          text NOT NULL REFERENCES stores(id),
  shop_domain       text NOT NULL UNIQUE,         -- xxx.myshopify.com (matches X-Shopify-Shop-Domain)
  signing_secret    text,                          -- server-webhook HMAC secret
  cart_public_token text,                          -- client cart beacon/pixel token
  allowed_origins   text[] NOT NULL DEFAULT '{}',  -- origin allowlist for the cart endpoint
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_webhooks_cart_token ON store_webhooks(cart_public_token);

-- store_events: normalized real-time events. dedupe_key makes inserts idempotent.
CREATE TABLE IF NOT EXISTS store_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        text NOT NULL REFERENCES stores(id),
  type            text NOT NULL CHECK (type IN ('sale','refund','add_to_cart')),
  amount_cad      numeric,
  currency        text,
  amount_original numeric,
  product_title   text,
  quantity        integer,
  customer_label  text,                           -- MASKED only (no raw PII)
  occurred_at     timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  dedupe_key      text NOT NULL UNIQUE,
  raw             jsonb
);
CREATE INDEX IF NOT EXISTS idx_store_events_recent ON store_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_events_store_recent ON store_events(store_id, received_at DESC);

COMMENT ON TABLE store_webhooks IS 'Task 2 — per-store webhook routing + secrets (no-redeploy)';
COMMENT ON TABLE store_events IS 'Task 2 — real-time Shopify activity feed events (display-only)';
