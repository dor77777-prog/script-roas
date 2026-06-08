-- Per-store toggle for the Shopify customerJourneySummary gap-fill (default OFF).
-- Replaces the global ENABLE_SHOPIFY_CUSTOMER_JOURNEY env flag with a per-store DB flag,
-- so each store can be enabled independently from /operator once its Shopify custom app
-- has Protected Customer Data access. Default false = no behavior change on existing stores.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS enable_customer_journey boolean NOT NULL DEFAULT false;
