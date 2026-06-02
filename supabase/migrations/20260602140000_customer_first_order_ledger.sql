-- Phase 3 (2026-06-02) — durable per-customer first-order LEDGER.
--
-- Additive + idempotent. Creates one table; no backfill here.
--
-- WHY: orders_attribution is a ROLLING WINDOW (only the recent ~weeks of
-- orders are retained). Deriving is_first_order via a window-MIN over that
-- table is WRONG for any customer whose true first order predates the
-- window — it mislabels a returning customer's recent order as "first".
--
-- FIX: a durable per-(store, customer) ledger that remembers the EARLIEST
-- order ever seen for each customer. It is:
--   • SEEDED once from FULL Shopify history (Bulk Operations backfill), and
--   • MAINTAINED additively by recompute_first_order_flags() on every cron
--     tick — the ledger min only ever LOWERS, never raises, so the
--     full-history seed can never be clobbered by the narrow window.
--
-- is_first_order on orders_attribution is then DERIVED from this ledger
-- (an order is "first" iff its order_id == the ledger's first_order_id for
-- that store+customer), instead of from a window-local MIN.
--
-- Columns:
--   store_id         — per-store identity scope (TEXT). No cross-store key.
--   customer_id      — Shopify opaque numeric id as TEXT. Privacy: no PII.
--                      Guests (customer_id NULL) are NEVER ledgered — they
--                      stay unclassifiable (is_first_order NULL).
--   first_order_id   — order_id of the customer's earliest-known order.
--   first_created_at — that order's created_at; the value we compare to
--                      decide whether an incoming window candidate is older
--                      (and should LOWER the ledger min).
--
-- PRIMARY KEY (store_id, customer_id) → exactly one ledger row per customer
-- per store, and backs the ON CONFLICT upsert in the recompute RPC.

CREATE TABLE IF NOT EXISTS customer_first_order (
  store_id         TEXT        NOT NULL,
  customer_id      TEXT        NOT NULL,
  first_order_id   TEXT        NOT NULL,
  first_created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (store_id, customer_id)
);

COMMENT ON TABLE customer_first_order IS
  'Phase 3 — durable per-(store,customer) first-order ledger. Seeded from FULL Shopify history (Bulk Operations); maintained additively (min-only-lowers) by recompute_first_order_flags(). orders_attribution.is_first_order is DERIVED from this, not from the rolling-window MIN. Guests (NULL customer_id) are never ledgered.';
COMMENT ON COLUMN customer_first_order.store_id IS
  'Phase 3 — per-store identity scope (TEXT). No cross-store key.';
COMMENT ON COLUMN customer_first_order.customer_id IS
  'Phase 3 — Shopify opaque numeric customer id (TEXT). Privacy: no PII. Guests are never ledgered.';
COMMENT ON COLUMN customer_first_order.first_order_id IS
  'Phase 3 — order_id of the customer''s earliest-known order for this store; orders_attribution.is_first_order = (order_id = this).';
COMMENT ON COLUMN customer_first_order.first_created_at IS
  'Phase 3 — created_at of the earliest-known order; the recompute RPC only LOWERS this (older candidate wins), never raises it, protecting the full-history seed.';

-- URL-obscurity trust model (no RLS): the dashboard reaches Supabase via the
-- anon role, the cron/backfill writers via service_role. Grant both so the
-- recompute RPC (granted to anon, service_role) can upsert the ledger.
GRANT ALL ON customer_first_order TO anon, service_role;
