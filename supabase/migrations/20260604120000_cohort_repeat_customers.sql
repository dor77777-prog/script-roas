-- A6 (2026-06-04) — distinct in-window repeat-customer count per cohort.
--
-- Additive + idempotent. Populated by aggregateCohortCells (cron-cohort-refresh
-- full replace + scripts/backfillCohortMonthly) ONLY on the M0 row of each
-- cohort (NULL on month_since>0). The reader (fetchCohortMonthlyFromPostgres)
-- sums it once per cohort.
--
-- WHY: the old "% who reorder" metric was Σ active(month_since≥1) ÷ M0 — an
-- OCCURRENCE sum that double-counts a customer active in multiple post-M0
-- months, overstating the repeat rate. This column is the HONEST numerator:
-- distinct customers with ≥1 repeat order within the 12-month window, counted
-- once per cohort. Nullable (no default) so computeCustomerValue can detect
-- not-yet-backfilled rows and fall back to the old proxy until the re-backfill
-- lands — no transient 0% regression.
--
-- NOTE: shipped together with the month_since cap removal (B2 — true 12-month
-- window; orders past month 11 are now dropped rather than folded into an M11
-- catch-all). Both require ONE re-backfill of the cohort table.

ALTER TABLE public.customer_cohort_monthly
  ADD COLUMN IF NOT EXISTS repeat_customers INT;

COMMENT ON COLUMN public.customer_cohort_monthly.repeat_customers IS
  'A6 (2026-06-04) — distinct customers of the cohort with ≥1 repeat order within the 12-month window (month_since 1..11), counted once per cohort and stored ONLY on the M0 row (NULL elsewhere, and NULL on rows written before the backfill). The honest "% who reorder" numerator.';
