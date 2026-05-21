-- Phase 05.7.3 — Add gross_revenue_cad + refund_deduction_cad to data_daily
--
-- 2026-05-21: Dashboard tables (per-store P&L, summary, analysis tab) need
-- to surface the BEFORE-refund and AFTER-refund amounts side-by-side so days
-- with material refunds get a visible chip + tooltip ("מחיר לפני החזרים: X").
--
-- Today the writer (cronDaily.ts) stores ONLY `revenue_cad` which is already
-- net of refund_line_items.subtotal. The gross amount and the refund
-- deduction get computed inside the fetcher but are then dropped on the
-- floor before the row is upserted. With these two new columns the dashboard
-- can render the indicator natively from `data_daily` without re-deriving.
--
-- Invariant (enforced by the writer, not a CHECK constraint to avoid
-- blocking legacy rows): `revenue_cad = gross_revenue_cad − refund_deduction_cad`.
--
-- Both columns are nullable so historical rows (where the new fields weren't
-- computed) don't break — the UI degrades gracefully when null.

ALTER TABLE data_daily
  ADD COLUMN IF NOT EXISTS gross_revenue_cad    NUMERIC(14, 4),
  ADD COLUMN IF NOT EXISTS refund_deduction_cad NUMERIC(14, 4);

COMMENT ON COLUMN data_daily.gross_revenue_cad IS
  'Σ total_price for orders created on date (BEFORE refund subtraction). Phase 05.7.3 2026-05-21.';
COMMENT ON COLUMN data_daily.refund_deduction_cad IS
  'Σ refund_line_items[].subtotal for refunds processed on date. POSITIVE value. Phase 05.7.3 2026-05-21.';
