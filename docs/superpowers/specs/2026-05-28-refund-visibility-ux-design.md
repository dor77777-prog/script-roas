# Refund-Visibility UX — Design Spec

**Date:** 2026-05-28
**Status:** Approved (pending user review of this file)
**Branch (when execution begins):** `refund-visibility-ux-2026-05-28`

## Goal

Surface refund activity in three dashboard surfaces so an operator can tell at a glance whether a period's apparent revenue dip is a refund event or a genuine performance drop — **without changing any underlying number**. All math stays exactly as today (`computeRevenueWithCrossDayRefunds` invariants intact). Only new presentation of fields already exposed on `DailyRow` (`refundDeduction`, `grossRevenue`).

## The defect being addressed

Today the cross-day-refund algorithm is correct (refunds deduct on `processed_at`, gross revenue stays immutable per Shopify `total_price`), but the operator can ONLY see this on the Detail and Monthly tables (via the existing `RefundIndicator` chip). The Home/Hero, ROAS trend chart, and P&L all surface NET only — so a refund-heavy day inside the selected range shows up as a generic "-54% revenue" with no signal that the cause is refunds processed that day, not weak campaign performance.

Concrete example (live data 2026-05-20, uzoshop): `grossRevenue=$2,000.09`, `refundDeduction=$1,014.02`, `revenue (net)=$986.07`, `netProfit=-$219.51`. Without refund visibility a viewer reading only Home/Hero sees a net-loss day and may attribute it to ad spend or low traffic.

## Locked decisions

- **"Heavy refund day" threshold:** `refundDeduction ≥ 20% × grossRevenue` **OR** `refundDeduction ≥ $500`. Single shared helper drives all three surfaces — no per-surface drift.
- **Color:** amber/gold (the existing `RefundIndicator` palette in the codebase). NOT red — red is reserved for errors and ROAS < 2.
- **Math is not touched.** All aggregation in `aggregate()` / `aggregateByStore()` / `dailySeries()` remains identical. Refund visibility is rendered from `DailyRow.refundDeduction` directly in the three target components.

## Architecture

Two pure helpers in a new module + three component touch-ups.

### New module: `dashboard-web/src/lib/refundDayHeuristic.ts`

```ts
import type { DailyRow } from './types';

/** Threshold constants — single source of truth for all 3 visualisations. */
export const HEAVY_REFUND_PCT_THRESHOLD = 0.20; // 20% of grossRevenue
export const HEAVY_REFUND_ABS_THRESHOLD = 500;  // $500 CAD

/**
 * True iff the daily row is a "heavy refund day" worth surfacing in Hero / ROAS chart.
 * - row.refundDeduction must be > 0.
 * - row.grossRevenue may be null (legacy rows pre-Phase 05.7.3) — fall back to (revenue + refundDeduction).
 * Returns false on null/missing fields so the heuristic is safe for any row shape.
 */
export function isHeavyRefundDay(row: DailyRow): boolean { ... }

/**
 * Sum of refundDeduction across the rows for the selected store filter.
 * Used by the Hero story sentence and the P&L summary line.
 */
export function sumRefundsInRange(rows: DailyRow[]): number { ... }

/**
 * Returns the date(s) flagged as heavy refund within the rows. Used by Hero
 * chip text ("יום רפאנד כבד (20/5)" vs "3 ימי רפאנד כבדים").
 */
export function heavyRefundDates(rows: DailyRow[]): string[] { ... }
```

Both functions have golden + edge-case tests. No dependencies on other UI modules.

### Component changes

| File | Change | Reads from |
|------|--------|-----------|
| `HeroOverview.tsx` | New amber chip below the revenue tile; new story sentence clause when `sumRefundsInRange(rows) > 0`. | `isHeavyRefundDay`, `sumRefundsInRange`, `heavyRefundDates` |
| `RoasChart.tsx` | Custom `Dot` renderer (Recharts API) draws an amber ring around the standard dot when `isHeavyRefundDay(row)`. Tooltip body gains a "↩ refunds: -$X.YY" line on those dates. | `isHeavyRefundDay` |
| `PnLBreakdown.tsx` | New row "החזרים בתקופה" between revenue and ad-spend, value `-Σ refundDeduction`, amber colour, helper note "כבר מנוכים מההכנסות למעלה — מוצג להבהרה." | `sumRefundsInRange` |

No new API routes. No DB migration. No env vars.

## UX details

### Hero chip
- Compact pill, amber-on-amber-tinted background. Icon: `↩` (Hebrew RTL — appears on the right side of the text). Text:
  - 1 heavy day: `↩ יום רפאנד כבד (20/5)`
  - >1 heavy day: `↩ 3 ימי רפאנד כבדים`
- Placement: directly under the "הכנסות" KPI tile heading, before the delta% chip. So the operator sees the number → "refund day caveat" → the delta. The delta wording itself is unchanged.
- The chip is interactive only as a hover-tooltip target — listing the heavy dates with their refund amounts.

### Hero story sentence
- Appended ONLY when `sumRefundsInRange(rows) > 0`, regardless of whether any day is "heavy". Example: `מתוך הירידה, כ-$1,014 הם החזרים שעובדו ב-20/5`. When ≥2 days contributed: `מתוך הירידה, $X בהחזרים מעובדים על פני 3 ימים בתקופה`.
- Comes after the current "story" sentence (which is unchanged).

### ROAS chart marker
- Recharts `Line` accepts a `dot` prop that can be a function. Replace the default with a function that renders the existing colored circle PLUS an outer amber stroke ring when `isHeavyRefundDay(row)` — `r=8`, `stroke=amber-500`, `strokeWidth=2`, `fill=transparent`.
- Tooltip body appends one line: `↩ יום רפאנד כבד — החזרים: -$1,014.02. ה-ROAS משקף את הנטו.`
- No second "ROAS-by-gross" line. Documented decision: adding it would imply a "what ROAS would have been without refunds" reading that is misleading (refunds are real cash events and must be reflected somewhere).

### P&L line
- Inside the cascade in `PnLBreakdown.tsx`, after the "הכנסות" row and before "ad spend":
  - Label: `החזרים בתקופה` (amber).
  - Value: `-$X.YY` (negative, amber).
  - Sub-line in smaller grey text: `כבר מנוכים מההכנסות מעל — מוצג להבהרה`.
- The "הכנסות" row gets a clarifying suffix `(נטו)` so an operator reading top-to-bottom understands: net revenue here → minus refund-deduction line below → already-baked-in (this line is presentational, not arithmetical).
- All downstream P&L math (gross profit, fees, fixed costs, true net) is **unchanged** — the new line is presentational only.

## Anti-misleading guarantees

1. **No double-counting.** The new P&L line is a *display* of `refundDeduction`, which is already inside `revenue (net)`. Helper note + label make this explicit.
2. **No re-derivation of net.** Hero/ROAS/P&L never recompute revenue from gross − refund; they consume the already-derived `revenue` field from `/api/data`.
3. **Threshold is one constant in one file.** Future changes to "heavy" definition propagate to all three surfaces simultaneously.
4. **Empty-period handling.** When no day in the selected range has `refundDeduction > 0`, none of the three surfaces show ANY new UI — chip absent, story sentence absent, P&L line absent. Zero clutter for normal days.

## Testing

### Unit (TDD)
- `refundDayHeuristic.test.ts`:
  - `isHeavyRefundDay`: at threshold (exact 20%, exact $500), just below threshold, both conditions met, refundDeduction=0, missing grossRevenue (legacy null falls back), missing refundDeduction.
  - `sumRefundsInRange`: empty rows → 0; multiple rows → exact sum; null refundDeduction treated as 0.
  - `heavyRefundDates`: returns sorted unique dates of heavy rows.

### Component
- The project has limited render-test infrastructure. Use the same lightweight test pattern as in `aiReportProfitLabel.test.ts`: import the component module and assert via source-string scan that the new strings ("החזרים בתקופה", "יום רפאנד כבד", "↩") are present — locks against accidental string drift. Heavy render tests deferred unless the project adds `@testing-library/react`.

### Live verification (post-deploy)
- Open `/` → Hero → confirm a date range that includes 2026-05-20 (heavy refund day for uzoshop) shows the amber chip + story sentence + ROAS-chart amber ring on the 20/5 dot.
- Open P&L tab with the same range → confirm "החזרים בתקופה" line appears with the correct sum, P&L net unchanged.
- Open a date range with NO refund days (e.g. last 3 days uzoshop) → confirm none of the new UI appears.

## Out of scope

- Hourly-resolution refund attribution (existing daily attribution stays).
- "Phantom revenue" indicator if refunds exceed gross on a day (already legitimately shows as negative revenue per the un-clamped invariant).
- KPI-card per-tile refund indicator (deferred — Hero chip + P&L line is the primary surface; KPI cards would clutter).
- Changing the cross-day-refund algorithm itself (locked invariants per `shopifyRevenueRefunds.ts`).

## Effort estimate

~2–3 hours including TDD. 7 files touched, zero math changes, zero new API surface, zero new env vars.
