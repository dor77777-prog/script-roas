-- Payment-method breakdown — additive, nullable column on orders_attribution.
-- Stores the order's RAW primary Shopify payment gateway name (kept raw, not a
-- pre-bucketed category, so categorization stays adjustable + future per-gateway
-- fee work is possible). Categorized to credit/paypal/other in code.
-- READ-ONLY toward Shopify (read_orders only; NOT blocked by the read_customers
-- gap) — nothing is ever sent to any pixel/CAPI.

ALTER TABLE orders_attribution ADD COLUMN IF NOT EXISTS payment_gateway TEXT;

COMMENT ON COLUMN orders_attribution.payment_gateway IS 'Raw primary Shopify payment gateway name (shopify_payments/paypal/gift_card/manual/…); categorized to credit/paypal/other in code. NULL = not yet backfilled.';
