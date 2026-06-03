-- Wave 2 (2026-06-03) — per-cohort monthly aggregate
-- (store × first-order-month × months-since).
--
-- Additive + idempotent. Seeded from full Shopify history (Bulk Operations)
-- joined to the customer_first_order ledger, and refreshed weekly by the
-- cron-cohort-refresh Inngest function (full replace per store).
--
-- WHY: answers "how much is a customer worth, and are we acquiring
-- profitably?" — retention + LTV + LTV:nCAC + payback. The orders history is
-- full (Bulk), so retention/LTV can go back the entire history even though
-- ad-spend history (data_daily) only starts May 2026.
--
-- Columns:
--   store_id           — per-store identity scope (TEXT). No cross-store key.
--   first_order_month  — 'YYYY-MM' of the customer's earliest order (from the
--                        customer_first_order ledger).
--   month_since        — whole calendar months between an order's month and
--                        the cohort's first_order_month, capped at 11
--                        (0..11 → a 12-month horizon).
--   active_customers   — distinct customers of the cohort who ordered in that
--                        month_since (drives retention).
--   orders             — Σ orders in that cell.
--   gross_cad          — Σ order gross (total_price) in CAD.
--   net_cad            — Σ order net (gross − refunds) in CAD.
--   updated_at         — last write time (full-replace per store).
--
-- PRIMARY KEY (store_id, first_order_month, month_since) → exactly one row per
-- cohort-cell. Guests (NULL customer_id) are never aggregated here — they have
-- no ledger entry, so they stay unclassifiable.

CREATE TABLE IF NOT EXISTS public.customer_cohort_monthly (
  store_id           TEXT    NOT NULL,
  first_order_month  TEXT    NOT NULL,            -- 'YYYY-MM'
  month_since        INT     NOT NULL,            -- 0..11
  active_customers   INT     NOT NULL DEFAULT 0,
  orders             INT     NOT NULL DEFAULT 0,
  gross_cad          NUMERIC NOT NULL DEFAULT 0,
  net_cad            NUMERIC NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, first_order_month, month_since)
);
CREATE INDEX IF NOT EXISTS idx_cohort_store_month
  ON public.customer_cohort_monthly (store_id, first_order_month);

COMMENT ON TABLE public.customer_cohort_monthly IS
  'Wave 2 — per-cohort monthly aggregate (store × first_order_month × month_since 0..11). Seeded from full Shopify Bulk history joined to customer_first_order; refreshed weekly (full replace per store) by cron-cohort-refresh. Backs the customer-value (cohorts/LTV) tab. Guests are never aggregated.';
COMMENT ON COLUMN public.customer_cohort_monthly.store_id IS
  'Wave 2 — per-store identity scope (TEXT). No cross-store key.';
COMMENT ON COLUMN public.customer_cohort_monthly.first_order_month IS
  'Wave 2 — ''YYYY-MM'' of the cohort''s first order, from the customer_first_order ledger.';
COMMENT ON COLUMN public.customer_cohort_monthly.month_since IS
  'Wave 2 — whole calendar months between an order month and first_order_month, capped at 11 (0..11 = 12-month horizon).';
COMMENT ON COLUMN public.customer_cohort_monthly.active_customers IS
  'Wave 2 — distinct customers of the cohort who ordered in that month_since (drives retention).';
COMMENT ON COLUMN public.customer_cohort_monthly.gross_cad IS
  'Wave 2 — Σ order gross (total_price) in CAD for the cell.';
COMMENT ON COLUMN public.customer_cohort_monthly.net_cad IS
  'Wave 2 — Σ order net (gross − refunds) in CAD for the cell.';

-- URL-obscurity trust model (no RLS): the dashboard reads via the anon role
-- (the /api/cohorts reader), the cron/backfill writers via service_role.
-- Grant both — mirrors the customer_first_order ledger this table joins.
GRANT ALL ON public.customer_cohort_monthly TO anon, service_role;
