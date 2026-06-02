-- Phase 3 (2026-06-02) — new-vs-returning support on orders_attribution.
--
-- Additive + idempotent. Three nullable columns + one index. No backfill
-- here (the one-time Bulk-Operations job + the recompute RPC own the
-- is_first_order values). Existing rows get NULLs until the next cron tick
-- writes customer_id / order_created_at and the RPC sets is_first_order.
--
--   customer_id       — Shopify opaque numeric id as TEXT (privacy: no PII).
--                       NULL on guest checkout → unclassifiable share.
--   order_created_at  — Shopify created_at (immutable), used by the
--                       first-order-EVER MIN() window.
--   is_first_order    — set by recompute_first_order_flags(); NULL where
--                       customer_id is NULL (unclassifiable).
--
-- Index (store_id, customer_id) backs the per-(store,customer) MIN() window
-- and per-store reader scans. Per-store identity only — no cross-store key.

ALTER TABLE orders_attribution
  ADD COLUMN IF NOT EXISTS customer_id      TEXT,
  ADD COLUMN IF NOT EXISTS order_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_first_order   BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_orders_attribution_store_customer
  ON orders_attribution (store_id, customer_id);

COMMENT ON COLUMN orders_attribution.customer_id IS
  'Phase 3 — Shopify opaque numeric customer id (TEXT). NULL on guest checkout. Privacy: no PII.';
COMMENT ON COLUMN orders_attribution.order_created_at IS
  'Phase 3 — Shopify created_at (immutable); drives first-order-EVER MIN() window.';
COMMENT ON COLUMN orders_attribution.is_first_order IS
  'Phase 3 — TRUE when this is the customer''s first order EVER for the store; NULL when customer_id NULL. Set by recompute_first_order_flags().';
