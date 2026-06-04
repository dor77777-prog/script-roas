# Profit Truth & Run-Rate Implementation Plan
> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Make the dashboard tell the operator the *truth about profit* — not just revenue. Surface the net-profit / spend / ROAS run-rate that `forecastMonthEnd()` already computes (and currently throws away), add a discount/promo-code leakage P&L line + rate trend, turn refunds into a tracked rate-over-time KPI (not just a per-period deduction), and add budget-pacing + marginal-spend signals to the campaigns view.

Architecture: Next.js 15 App Router + TypeScript, Hebrew RTL, single operator, 3 Shopify stores (uzoshop, zolplus/"Zol Plus", usmile360/"360usmile") × Meta/Google/TikTok, everything in CAD. Pipeline: Inngest crons (`cronDaily` nightly reconcile, `cronLive` Shopify-only intraday) → Supabase `data_daily` (PK `date,store_id`) → `postgresReaders.fetchDailyDataFromPostgres` → `DailyRow[]` → `lib/analytics.aggregate()` P&L cascade → React components. Mapping-aware aggregation only (data_daily is already store-scoped via the campaign↔store map at write time; never raw account totals). Deploy = `git push origin main` (Vercel Git integration), NEVER `vercel deploy --prod`.

Tech Stack: React 19 + Tailwind (token-driven: `text-ink`, `text-ink-muted`, `bg-glass-1`, `border-glass-edge`, `bg-status-*Bg`/`text-status-*Fg`, `bg-accent-bg`/`text-accent`), Recharts, SWR, lucide-react icons, shared UI primitives (`Money`, `Card`, `Heading`, `HelpTooltip`, `Button`, `TableBase`, `Sparkline`/`RoasChart`). Tests: vitest node config (`npm test`) for `src/lib/**`, vitest dom config (`npx vitest run --config vitest.config.dom.ts`) for `*.dom.test.tsx`. Migrations live at **repo-root** `supabase/migrations/`.

### Pre-push gates (ALL must pass before any `git push origin main`)
Run from `dashboard-web/` unless noted:
- `npx tsc --noEmit`
- `npm test` (vitest node)
- `npx vitest run --config vitest.config.dom.ts` (vitest dom)
- `npm run lint` (eslint, incl. local guards: `local/no-physical-direction-in-components`, `local/no-native-title-tooltip`, `local/no-hex-color-in-components` = the "design-color green-ratchet" token-only guard)
- `node scripts/docs-currency.mjs` (from repo root) — **UX rule**: any change to `dashboard-web/src/components/**.tsx` (outside `__tests__`) requires `docs/ROAS-Dashboard-User-Manual.md` in the same diff. **Arch rule**: any change to `dashboard-web/src/inngest/**.ts`, `dashboard-web/src/lib/fetchers/**.ts`, `dashboard-web/src/lib/postgresReaders.ts`, or `supabase/migrations/**.sql` requires `docs/ARCHITECTURE.md` in the same diff.

### Hard constraints (never violate)
- **CAPI-safe / READ-ONLY.** Reporting only. NEVER send events to pixels/CAPI. No Triple-Pixel/Sonar/multi-touch/first-touch-via-pixel. (Nothing in this workstream emits — all four features are pure reads/derivations. The only first-party demand signal allowed anywhere is the post-purchase survey via `note_attributes`, which this workstream does not touch.)
- **UI = token-driven, light AND dark, RTL/logical.** No raw hex/oklch/px colors in components (use `text-ink*`, `bg-status-*`, `bg-accent*`, `bg-glass-*`). Logical props only (`ms-*`/`me-*`/`ps-*`/`pe-*`, `insetInlineStart`, `text-start`/`text-end`). WCAG-AA in both themes (on-band/scrim foreground tokens, never text-color-from-brand). Numbers ALWAYS through `<Money>` (tabular-nums, overflow-safe, exact value in `title`/`sr-only`) — never `truncate` a number.
- **Mockup-first for non-trivial UI.** The first task of any feature that adds a non-trivial visual element produces a static HTML mockup, delivered as an `open <abs-path>` link, and PAUSES for operator approval before building.
- **Mapping-aware aggregates only.** Read store-scoped `data_daily` via `fetchDailyDataFromPostgres` → `aggregate()` / `aggregateByStore()`; never raw account totals.
- **DB columns**: nullable, `ADD COLUMN IF NOT EXISTS`, at repo-root `supabase/migrations/`, applied via the documented procedure (below) + a re-backfill note.

### Supabase migration apply procedure (SUPERVISED — operator "go" required)
1. `mv .env .env.bak` (root `.env` uses dotted keys that trip the CLI parser).
2. Move OUT of `supabase/migrations/`: `20260530300000_phase_d_soak_cleanup*.sql` AND `20260530310000_*.sql`. KEEP `20260530300000_recompute_data_daily_derived.sql`.
3. `echo y | supabase db push --linked`.
4. Move the 2 files BACK + `mv .env.bak .env`.

---

## File Structure

| File | Created/Modified | Responsibility (one each) |
|---|---|---|
| `dashboard-web/src/components/GoalTracker.tsx` | Modified | Add a net-profit / spend / ROAS run-rate sub-panel that consumes the already-computed `forecast.projectedNet` / `projectedSpend` / `projectedRoas` (currently discarded). |
| `docs/superpowers/mockups/2026-06-04-runrate/runrate-panel.html` | Created | Static light+dark RTL mockup of the run-rate sub-panel for operator approval. |
| `dashboard-web/src/lib/discountLeakage.ts` | Created | Pure helpers: `sumDiscountsInRange(rows)` and `discountRateTrend(rows, range)` (discount $ ÷ gross). |
| `dashboard-web/src/lib/shopifyRevenueRefunds.ts` | Modified | Accumulate `storeDiscountCad` (Σ line-level `total_discount`) into `CrossDayRefundResult`. |
| `dashboard-web/src/lib/fetchers/shopify.ts` | Modified | Add `total_discounts`/`discount_codes`-derived field to the order field allowlists + thread `discountCad` through `ShopifyDayRows`. |
| `dashboard-web/src/lib/postgresReaders.ts` | Modified | Read the new `discount_cad` column into `DailyRow.discount`. |
| `dashboard-web/src/lib/types.ts` | Modified | Add `discount: number | null` to `DailyRow`. |
| `dashboard-web/src/inngest/functions/cronDaily.ts` | Modified | Dual-write `discount_cad` to `data_daily` (parity with cronLive). |
| `dashboard-web/src/inngest/functions/cronLive.ts` | Modified | Dual-write `discount_cad` to `data_daily` (parity with cronDaily). |
| `supabase/migrations/20260604130000_add_discount_cad_to_data_daily.sql` | Created | `ADD COLUMN IF NOT EXISTS discount_cad` (nullable) on `data_daily`. |
| `dashboard-web/src/components/PnLBreakdown.tsx` | Modified | Add a "הנחות/קודי קופון" presentational P&L line (after refunds line). |
| `dashboard-web/src/lib/refundRateTrend.ts` | Created | Pure helper: `refundRateTrend(rows, range)` + `aovTrend` + `unitsContext` series for the Trends tab. |
| `dashboard-web/src/components/KpiTrendChart.tsx` | Created | Reusable token-driven, RTL, AA line chart for a single rate KPI (refund-rate / discount-rate) — wraps Recharts on a neutral plot scrim. |
| `dashboard-web/src/components/AnalysisTrendsTab.tsx` | Modified | Render the refund-rate (+ discount-rate) trend chart under the ROAS trend. |
| `dashboard-web/src/lib/budgetPacing.ts` | Created | Pure helpers: `computeBudgetPacing(spendToday, dailyBudget, fractionOfDayElapsed)` + `detectMarginalDecay(dailyRoasSeries)`. |
| `dashboard-web/src/components/BudgetPacingCell.tsx` | Created | Token-driven over/under-pacing chip + tooltip for the campaigns budget column. |
| `dashboard-web/src/components/CampaignsTable.tsx` | Modified | Render `BudgetPacingCell` in the budget data cell; surface marginal-decay flag. |
| `docs/superpowers/mockups/2026-06-04-budget-pacing/pacing-chip.html` | Created | Static light+dark RTL mockup of the pacing chip states. |
| `docs/ROAS-Dashboard-User-Manual.md` | Modified | Document each new operator-facing surface (gate requirement). |
| `docs/ARCHITECTURE.md` | Modified | Document the `discount_cad` column + cron dual-write + reader (gate requirement). |

---

## Feature: profit-net-runrate-surfaced
**Net-profit (not revenue) run-rate to month-end — surface the math that already exists.**
Impact: HIGH · Effort: S · CAPI-safe: YES (pure read of an existing pure function) · Kind: deepen
Dependencies: none. Independent of the other three features in this workstream.

**Grounding (real code).** `lib/insights.ts:495-673` `forecastMonthEnd()` already returns `projectedRevenue`, `projectedSpend`, `projectedNet`, `projectedRoas`, `monthToDateNet`, `monthToDateSpend` — all computed with MTD-actual COGS + tx fees + percent-of-revenue billing + fixed costs (and salaries via `aggregate`). `GoalTracker.tsx:159` calls `forecastMonthEnd(monthRows)` but lines 481-589 read ONLY `forecast.monthToDateRevenue` + `forecast.projectedRevenue`. `projectedNet`/`projectedSpend`/`projectedRoas`/`monthToDateNet`/`monthToDateSpend` are returned and discarded. The fix is UI-only: render a sub-panel reading the existing fields. No `lib` change, no migration.

The run-rate sub-panel is a non-trivial UI element → mockup-first.

### Task 1 — Static mockup of the run-rate sub-panel (mockup-first gate)
- [ ] Create `docs/superpowers/mockups/2026-06-04-runrate/runrate-panel.html`: a standalone HTML page (inline `<style>` with a `:root`/`[data-theme="dark"]` token block mirroring the app tokens — `--ink`, `--ink-muted`, `--glass-1`, `--glass-edge`, `--status-green-fg`, `--status-red-fg`, `--accent`) showing a 3-metric run-rate strip ("רווח נטו צפוי", "הוצאה צפויה", "ROAS צפוי") that sits BELOW the existing revenue numbers row in the CURRENT-month GoalTracker card. Include a light/dark toggle button, RTL (`dir="rtl"`), and 3 example states: profit-positive (green net), loss (red net), and FUTURE-month ("—"). All money rendered with `font-variant-numeric: tabular-nums`. Add a "CAD" superscript before each money value (mirroring the existing card).
- [ ] Deliver to operator: print the exact command `open /Users/dorperetz/script-roas/docs/superpowers/mockups/2026-06-04-runrate/runrate-panel.html` and PAUSE for approval. Do NOT proceed to Task 2 until the operator approves (or requests edits, which you apply then re-deliver).
- [ ] Commit: `git add docs/superpowers/mockups/2026-06-04-runrate && git commit -m "docs(ws1): run-rate sub-panel mockup for operator approval"`

### Task 2 — Failing test: GoalTracker renders the projected-net run-rate (current month)
- [ ] Create `dashboard-web/src/components/__tests__/goalTrackerRunRate.dom.test.tsx`. Mirror the existing dom-test setup in `src/components/__tests__/goalTrackerPerMonth.dom.test.tsx` (same render harness, SWR/cogs/goal hook mocks). Build a current-month `DashboardData` with rows that produce a clearly profitable forecast, render `<GoalTracker data={...} range={currentMonthRange} />`, then:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
// ... reuse the mock scaffold from goalTrackerPerMonth.dom.test.tsx (goal hook, cogs hook, SWR) ...

describe('GoalTracker — net-profit run-rate sub-panel (profit-net-runrate-surfaced)', () => {
  it('renders projected net, projected spend, and projected ROAS for the current month', () => {
    renderGoalTrackerForCurrentMonth({ rows: profitableCurrentMonthRows, goal: 50_000 });
    // labels exist
    expect(screen.getByText('רווח נטו צפוי')).toBeInTheDocument();
    expect(screen.getByText('הוצאה צפויה')).toBeInTheDocument();
    expect(screen.getByText('ROAS צפוי')).toBeInTheDocument();
    // projected-net testid carries the exact projectedNet value via Money's title/sr-only
    const net = screen.getByTestId('runrate-projected-net');
    expect(net).toBeInTheDocument();
    // projectedNet must NOT equal projectedRevenue (i.e. costs are subtracted)
    expect(net.textContent).not.toMatch(/^\s*CAD\s*0\s*$/);
  });

  it('shows "—" for projected net/spend/roas in a FUTURE month (no data)', () => {
    renderGoalTrackerForFutureMonth({ goal: 50_000 });
    expect(screen.getByTestId('runrate-projected-net')).toHaveTextContent('—');
  });
});
```
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/goalTrackerRunRate.dom.test.tsx` — EXPECT FAIL (labels/testids do not exist yet).

### Task 3 — Implement: add the run-rate sub-panel to GoalTracker (current + future month)
- [ ] In `dashboard-web/src/components/GoalTracker.tsx`, in the CURRENT/FUTURE-month render branch (after the existing "Numbers row" grid that ends at line ~590, before the progress bar at ~592), add a second grid that reads the already-returned fields. Derive future-safe values mirroring the existing pattern (`const isFuture = ...` at line 480):
```tsx
{/* Net-profit run-rate — surfaces forecast.projectedNet/Spend/Roas that
    forecastMonthEnd already computes (profit-net-runrate-surfaced). */}
<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-3 pt-3 border-t border-glass-edge">
  <div>
    <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide">רווח נטו צפוי</div>
    {isFuture ? (
      <div data-testid="runrate-projected-net" className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">—</div>
    ) : (
      <div
        data-testid="runrate-projected-net"
        className={cn('text-base sm:text-lg font-bold tabular-nums mt-0.5',
          forecast.projectedNet >= 0 ? 'text-status-greenFg' : 'text-status-redFg')}
      >
        <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
        <Money value={forecast.projectedNet} prefix="none" locale="he-IL" compactAbove={1_000_000} />
      </div>
    )}
    <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums mt-0.5">
      {isFuture ? 'אין עדיין מספיק נתונים' : 'בקצב הנוכחי — אחרי כל העלויות'}
    </div>
  </div>
  <div>
    <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide">הוצאה צפויה</div>
    {isFuture ? (
      <div data-testid="runrate-projected-spend" className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">—</div>
    ) : (
      <div data-testid="runrate-projected-spend" className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
        <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
        <Money value={forecast.projectedSpend} prefix="none" locale="he-IL" compactAbove={1_000_000} />
      </div>
    )}
    <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums mt-0.5">פרסום בכל הפלטפורמות</div>
  </div>
  <div className="col-span-2 sm:col-span-1">
    <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide">ROAS צפוי</div>
    <div data-testid="runrate-projected-roas" className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
      {isFuture || forecast.projectedRoas <= 0 ? '—' : forecast.projectedRoas.toFixed(2)}
    </div>
    <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums mt-0.5">הכנסה ÷ הוצאה</div>
  </div>
</div>
```
  Notes: `cn`, `Money`, `forecast` are already imported/in-scope; `isFuture` already exists (line 480). Use `me-1`/logical classes only; status tokens only (no hex). Money carries the exact value in its `title`/`sr-only` (overflow-safe).
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/goalTrackerRunRate.dom.test.tsx` — EXPECT PASS.
- [ ] Run: `npx tsc --noEmit && npm run lint` — EXPECT PASS (verifies token-only + logical-direction guards).

### Task 4 — Docs + commit
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md`: under the GoalTracker / "יעד חודשי" section, document the new run-rate strip ("בקצב הנוכחי תסיים את החודש עם רווח נטו אמיתי X, הוצאה Y, ROAS Z"), and that "net" here is the SAME true-net (after COGS, fees, fixed costs, salaries) shown in the P&L — not gross. Bump the manual's version line.
- [ ] Commit: `git add dashboard-web/src/components/GoalTracker.tsx dashboard-web/src/components/__tests__/goalTrackerRunRate.dom.test.tsx docs/ROAS-Dashboard-User-Manual.md && git commit -m "feat(goal): surface net-profit/spend/ROAS month-end run-rate (profit-net-runrate-surfaced)"`

---

## Feature: discount-promo-leakage
**Discount / promo-code leakage P&L line + discount-rate trend.**
Impact: MEDIUM · Effort: M · CAPI-safe: YES (read-only) · Kind: net-new
Dependencies: none for the helper + UI; the DB column write benefits from a re-backfill (note below). The PnL UI line and the discount-rate trend can read the new `DailyRow.discount` field, degrading to `null`/hidden on historical rows.

**Grounding (real code).** `total_discount` is NOT captured. `shopifyRevenueRefunds.ts:304` notes "no total_discount visible in TS shape" — the line item type at `shopifyRevenueRefunds.ts:50-57` has only `product_id`, `price`, `quantity`, `title`, `name`. The order field allowlists `fetchers/shopify.ts:431` (`id,created_at,total_price,current_total_price,test,financial_status,line_items,refunds`) and `:1133` (attribution) omit any discount field. So promo/coupon discounts are silently absorbed into `revenue` (gross via `total_price` already nets nothing — discounts come out at the line/order level). We capture order-level `total_discounts` (Shopify Admin REST: `Order.total_discounts`, a string CAD value already in store currency for these stores — same currency handling as `total_price` which is read directly), accumulate per day, persist to a new nullable `discount_cad`, read it into `DailyRow.discount`, and surface it.

### Task 1 — Migration: add `discount_cad` to `data_daily` (nullable)
- [ ] Create `supabase/migrations/20260604130000_add_discount_cad_to_data_daily.sql`:
```sql
-- ws1 discount-promo-leakage: capture order-level total_discounts per day.
-- Nullable: historical rows (pre-backfill) stay NULL; the reader maps NULL →
-- DailyRow.discount=null and the UI degrades (hides the discount P&L line +
-- discount-rate trend point) rather than showing a false 0.
ALTER TABLE public.data_daily
  ADD COLUMN IF NOT EXISTS discount_cad numeric;

COMMENT ON COLUMN public.data_daily.discount_cad IS
  'Sum of Order.total_discounts (CAD) for orders created on this date for this store. NULL for rows written before ws1 discount-promo-leakage. Reporting-only; NOT deducted from revenue_cad (revenue already nets discounts at checkout).';
```
- [ ] Do NOT apply yet — applying is the SUPERVISED step in Task 7. tsc/tests do not depend on it.
- [ ] Commit: `git add supabase/migrations/20260604130000_add_discount_cad_to_data_daily.sql && git commit -m "feat(db): add nullable discount_cad to data_daily (discount-promo-leakage)"` (note: this commit also requires `docs/ARCHITECTURE.md`; batch with Task 7's doc edit OR push with `--no-verify` only if pushing this commit in isolation — preferred: do not push until Task 7 has the ARCHITECTURE.md edit staged).

### Task 2 — Failing test: revenue/refunds algorithm accumulates `storeDiscountCad`
- [ ] In `dashboard-web/src/lib/__tests__/shopifyRevenueRefunds.test.ts` (existing — imports `computeRevenueWithCrossDayRefunds`, `ShopifyOrderInput` at line 31), add a describe block:
```ts
describe('storeDiscountCad — discount-promo-leakage', () => {
  it('sums Order.total_discounts for same-day orders, excluding test/voided', () => {
    const today = '2026-06-04';
    const orders: ShopifyOrderInput[] = [
      { id: 1, created_at: `${today}T08:00:00Z`, total_price: '100', current_total_price: '100', total_discounts: '15', line_items: [] },
      { id: 2, created_at: `${today}T09:00:00Z`, total_price: '50', current_total_price: '50', total_discounts: '0', line_items: [] },
      { id: 3, created_at: `${today}T10:00:00Z`, total_price: '80', current_total_price: '80', total_discounts: '20', test: true, line_items: [] },
      { id: 4, created_at: `${today}T11:00:00Z`, total_price: '40', current_total_price: '0', total_discounts: '5', financial_status: 'voided', line_items: [] },
    ];
    const r = computeRevenueWithCrossDayRefunds(orders, today, 'Asia/Jerusalem');
    expect(r.storeDiscountCad).toBeCloseTo(15, 6); // order 1 only (2 has 0; 3 test; 4 voided)
  });

  it('storeDiscountCad is 0 when no order carries total_discounts', () => {
    const today = '2026-06-04';
    const orders: ShopifyOrderInput[] = [
      { id: 1, created_at: `${today}T08:00:00Z`, total_price: '100', current_total_price: '100', line_items: [] },
    ];
    expect(computeRevenueWithCrossDayRefunds(orders, today, 'Asia/Jerusalem').storeDiscountCad).toBe(0);
  });
});
```
- [ ] Run: `npm test src/lib/__tests__/shopifyRevenueRefunds.test.ts` — EXPECT FAIL (`storeDiscountCad` undefined; `total_discounts` not on type).

### Task 3 — Implement: accumulate `storeDiscountCad` in the algorithm
- [ ] In `dashboard-web/src/lib/shopifyRevenueRefunds.ts`, add `total_discounts` to the `ShopifyOrderInput` type (after `current_total_price` at line 117):
```ts
  /** Order-level total discounts (promo/coupon) in store currency = CAD for
   *  these stores. Optional — absent on legacy fixtures / pre-allowlist rows. */
  total_discounts?: string | number;
```
- [ ] Add to `CrossDayRefundResult` (after `storeRefundDeductionCad` at ~line 194):
```ts
  /**
   * Σ Order.total_discounts for orders created on D (excl test/voided).
   * POSITIVE value. Reporting-only — NOT subtracted from storeNetCad (the
   * checkout already netted the discount). Surfaced so the P&L can show a
   * discount-leakage line + the Trends tab a discount-rate series.
   */
  storeDiscountCad: number;
```
- [ ] In `computeRevenueWithCrossDayRefunds` (line 231), add `let storeDiscount = 0;` next to `sameDayGross` (line 236), and inside the `isSameDayOrder` branch (after `sameDayGross += parseNum(o.total_price);` at line 298) add `storeDiscount += parseNum(o.total_discounts);`. The existing `test`/`voided` guards at lines 287-288 run before this branch, so excluded orders never reach it. Add `storeDiscountCad: storeDiscount,` to the returned object.
- [ ] Run: `npm test src/lib/__tests__/shopifyRevenueRefunds.test.ts` — EXPECT PASS.
- [ ] Commit: `git add dashboard-web/src/lib/shopifyRevenueRefunds.ts dashboard-web/src/lib/__tests__/shopifyRevenueRefunds.test.ts && git commit -m "feat(revenue): accumulate storeDiscountCad in cross-day-refunds algorithm (discount-promo-leakage)"`

### Task 4 — Implement: thread discount through the fetcher + allowlists
- [ ] In `dashboard-web/src/lib/fetchers/shopify.ts`, add `total_discounts` to the revenue/refund order allowlist at line 431:
```ts
  const fields =
    'id,created_at,total_price,current_total_price,total_discounts,test,financial_status,line_items,refunds';
```
  And to the attribution allowlist at line 1133 (so a future per-order discount surface is unblocked; harmless extra field now):
```ts
    'id,total_price,total_discounts,financial_status,test,landing_site,referring_site,' +
```
- [ ] Add `discountCad: number;` to the `ShopifyDayRows` type (after `refundDeductionCad` in the type block near line 147) with a JSDoc mirroring the algorithm field.
- [ ] In `fetchShopifyDayRows` (line 600), destructure `storeDiscountCad` from `computeRevenueWithCrossDayRefunds(...)` (line 624-630) and add `discountCad: storeDiscountCad,` to the returned object (line 639-655).
- [ ] No test file for the fetcher I/O wrapper (network-bound); type-check covers it. Run: `npx tsc --noEmit` — EXPECT PASS.
- [ ] Commit: `git add dashboard-web/src/lib/fetchers/shopify.ts && git commit -m "feat(fetch): request total_discounts + thread discountCad through ShopifyDayRows (discount-promo-leakage)"` (note: `fetchers/*` triggers the ARCH docs rule — stage `docs/ARCHITECTURE.md` here or batch into Task 7; prefer batching: defer push of this commit until Task 7).

### Task 5 — Implement: dual-write `discount_cad` (cronDaily + cronLive parity) + reader + type
- [ ] In `dashboard-web/src/lib/types.ts`, add to `DailyRow` (after `refundDeduction` at line 33):
```ts
  /**
   * Σ Order.total_discounts (CAD) for orders created on this date. POSITIVE.
   * `null` for rows written before ws1 (the discount P&L line + discount-rate
   * trend hide the point rather than show a false 0). Reporting-only — NOT
   * subtracted from `revenue` (checkout already netted it).
   */
  discount: number | null;
```
- [ ] In `dashboard-web/src/lib/postgresReaders.ts`: add `discount_cad` to the `select` string at line 293 (e.g. `'gross_revenue_cad, refund_deduction_cad, discount_cad, '`). After the refund block (line 344-345) add:
```ts
    const discountRaw = r.discount_cad;
    const discount =
      discountRaw === null || discountRaw === undefined ? null : toNumber(discountRaw);
```
  Add `discount,` to the pushed row object (line 361+). The `DbRow` type at top of file must include `discount_cad?: number | string | null` — add it where `gross_revenue_cad` is declared.
- [ ] In `dashboard-web/src/inngest/functions/cronDaily.ts`: add `discount_cad: number;` to the `DataDailyRow` type (after `refund_deduction_cad` at line 979) and `discount_cad: shopify.discountCad,` to the `dataDailyRow` object (after `refund_deduction_cad: shopify.refundDeductionCad,` at line 1005). It's a function of revenue/orders only (no FX), so it stays in the always-written group (alongside `cogs_cad`).
- [ ] In `dashboard-web/src/inngest/functions/cronLive.ts`: locate the `data_daily` upsert payload (the shared UPSERT column shape referenced at cronDaily.ts:86 — find the symmetric block in cronLive) and add `discount_cad: shopify.discountCad,` to it, matching the cronDaily group exactly so the **dual-write parity guard** holds. (Search: `grep -n "refund_deduction_cad" src/inngest/functions/cronLive.ts`.)
- [ ] Failing test FIRST — create `dashboard-web/src/inngest/__tests__/dataDailyDiscountParity.test.ts` asserting both writers include `discount_cad` in their upsert column set (mirror any existing cron upsert-shape test; if none, assert via a shared constant). Minimal approach: extract the two payload key-lists are equal by reading both modules' exported row builders if they exist; otherwise assert the literal presence:
```ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('data_daily discount_cad dual-write parity (discount-promo-leakage)', () => {
  it('both cronDaily and cronLive write discount_cad', () => {
    const daily = readFileSync('src/inngest/functions/cronDaily.ts', 'utf8');
    const live = readFileSync('src/inngest/functions/cronLive.ts', 'utf8');
    expect(daily).toContain('discount_cad: shopify.discountCad');
    expect(live).toContain('discount_cad: shopify.discountCad');
  });
});
```
- [ ] Run: `npm test src/inngest/__tests__/dataDailyDiscountParity.test.ts` — EXPECT FAIL first (before the cron edits), then EXPECT PASS after. Also run `npx tsc --noEmit` — EXPECT PASS.
- [ ] Commit: `git add dashboard-web/src/lib/types.ts dashboard-web/src/lib/postgresReaders.ts dashboard-web/src/inngest/functions/cronDaily.ts dashboard-web/src/inngest/functions/cronLive.ts dashboard-web/src/inngest/__tests__/dataDailyDiscountParity.test.ts && git commit -m "feat(pipeline): dual-write + read discount_cad on data_daily (discount-promo-leakage)"` (touches `inngest/*`, `postgresReaders.ts`, `fetchers/*` → ARCH docs rule; batch with Task 7).

### Task 6 — Failing test + impl: discount helpers + PnL leakage line
- [ ] Create `dashboard-web/src/lib/__tests__/discountLeakage.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sumDiscountsInRange, discountRateTrend } from '@/lib/discountLeakage';
import type { DailyRow } from '@/lib/types';

function row(o: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-06-01', storeId: 'uzoshop', storeName: 'uzoshop',
    fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue: 0, roas: 0,
    grossProfit: 0, cogs: 0, netProfit: 0, hasCogs: true,
    grossRevenue: null, refundDeduction: null, discount: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null, ...o,
  };
}

describe('discountLeakage', () => {
  it('sumDiscountsInRange sums non-null discount, ignores nulls', () => {
    const rows = [row({ discount: 10 }), row({ discount: null }), row({ discount: 5 })];
    expect(sumDiscountsInRange(rows)).toBe(15);
  });
  it('discountRateTrend = discount / gross per day, null gross/0 → null point', () => {
    const series = discountRateTrend([
      row({ date: '2026-06-01', discount: 20, grossRevenue: 200 }),
      row({ date: '2026-06-02', discount: 0, grossRevenue: 100 }),
      row({ date: '2026-06-03', discount: 5, grossRevenue: null }),
    ], { from: '2026-06-01', to: '2026-06-03' });
    expect(series.find(p => p.date === '2026-06-01')!.rate).toBeCloseTo(0.10, 6);
    expect(series.find(p => p.date === '2026-06-02')!.rate).toBe(0);
    expect(series.find(p => p.date === '2026-06-03')!.rate).toBeNull();
  });
});
```
- [ ] Run: `npm test src/lib/__tests__/discountLeakage.test.ts` — EXPECT FAIL (module missing).
- [ ] Create `dashboard-web/src/lib/discountLeakage.ts`:
```ts
import type { DailyRow, DateRange } from './types';
import { enumerateDateRange } from './dateRange';

/** Σ discount (CAD) for rows whose discount column is populated. Null → skipped. */
export function sumDiscountsInRange(rows: readonly DailyRow[]): number {
  let total = 0;
  for (const r of rows) if (typeof r.discount === 'number') total += r.discount;
  return total;
}

export type DiscountRatePoint = { date: string; rate: number | null };

/**
 * Per-day discount rate = discount ÷ grossRevenue. `null` rate when the day
 * has no gross (no data / legacy) — distinct from 0 (real "no discounts").
 * Walks EVERY calendar day in range (mirrors analytics.dailySeries gap policy).
 */
export function discountRateTrend(rows: readonly DailyRow[], range: DateRange): DiscountRatePoint[] {
  const byDate = new Map<string, { discount: number; gross: number | null }>();
  for (const r of rows) {
    if (r.date < range.from || r.date > range.to) continue;
    const e = byDate.get(r.date) ?? { discount: 0, gross: null };
    if (typeof r.discount === 'number') e.discount += r.discount;
    if (typeof r.grossRevenue === 'number') e.gross = (e.gross ?? 0) + r.grossRevenue;
    byDate.set(r.date, e);
  }
  return enumerateDateRange(range.from, range.to).map(date => {
    const e = byDate.get(date);
    if (!e || e.gross === null || e.gross <= 0) return { date, rate: null };
    return { date, rate: e.discount / e.gross };
  });
}
```
- [ ] Run: `npm test src/lib/__tests__/discountLeakage.test.ts` — EXPECT PASS.
- [ ] Failing UI test — create `dashboard-web/src/components/__tests__/pnlDiscountLine.dom.test.tsx`: render `<PnLBreakdown current={agg} storeNames={['uzoshop']} rangeFrom rangeTo rows={rowsWithDiscount} />` and assert a line with `data-testid="pnl-line-discount"` shows when `sumDiscountsInRange(rows) > 0`, and is ABSENT when discounts are 0/null. Pin that it renders through `<Money>` (exact value present) and does NOT advance the running total (`running={null}`, mirroring the refund line at PnLBreakdown.tsx:254-263).
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/pnlDiscountLine.dom.test.tsx` — EXPECT FAIL.
- [ ] Implement in `dashboard-web/src/components/PnLBreakdown.tsx`: import `sumDiscountsInRange` from `@/lib/discountLeakage`; compute `const discountTotalInPeriod = sumDiscountsInRange(rows);` next to `refundTotalInPeriod` (line 146). After the refunds `<PnLLine>` block (line 263) add a presentational line (same `running={null}` pattern, `tone="cost"`):
```tsx
{discountTotalInPeriod > 0 && (
  <PnLLine
    testid="pnl-line-discount"
    label="הנחות / קודי קופון"
    amount={-discountTotalInPeriod}
    pct={revenue > 0 ? -(discountTotalInPeriod / revenue) * 100 : 0}
    tone="cost"
    note="כבר מנוכות בצ׳קאאוט — מוצג להבהרת דליפת מרווח"
    running={null}
  />
)}
```
  (`PnLLine` already accepts `testid` — line 472/483.) Tokens only; logical classes inherited from `PnLLine`.
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/pnlDiscountLine.dom.test.tsx && npx tsc --noEmit && npm run lint` — EXPECT PASS.
- [ ] Commit: `git add dashboard-web/src/lib/discountLeakage.ts dashboard-web/src/lib/__tests__/discountLeakage.test.ts dashboard-web/src/components/PnLBreakdown.tsx dashboard-web/src/components/__tests__/pnlDiscountLine.dom.test.tsx docs/ROAS-Dashboard-User-Manual.md && git commit -m "feat(pnl): discount/promo leakage line + discount helpers (discount-promo-leakage)"` (touches a component → UM rule; stage UM here).

### Task 7 — Docs (ARCHITECTURE) + supervised migration apply + re-backfill note
- [ ] Update `docs/ARCHITECTURE.md`: document the `data_daily.discount_cad` column (nullable, reporting-only, NOT deducted from `revenue_cad`), the cronDaily/cronLive dual-write, the reader mapping (`discount_cad → DailyRow.discount`), and the new order allowlist field `total_discounts`. Note the discount-rate trend reads `discount / gross_revenue_cad`.
- [ ] Ensure ALL ARCH-rule-triggering commits from Tasks 1/4/5 are pushed in a batch that ALSO contains this `docs/ARCHITECTURE.md` edit (so `node scripts/docs-currency.mjs` passes for the push). Run the full gate suite, then push.
- [ ] SUPERVISED: ask the operator for "go", then apply the migration via the documented procedure (hide root `.env`; move out the two `20260530300000_phase_d_soak_cleanup*.sql` + `20260530310000_*.sql` gap files, KEEP `20260530300000_recompute_data_daily_derived.sql`; `echo y | supabase db push --linked`; move files back; restore `.env`).
- [ ] Re-backfill note (record in the commit body / handoff, do NOT auto-run): historical `data_daily` rows have `discount_cad = NULL` and the UI degrades. To populate recent history, re-run the existing recent-attribution/day-rows backfill path the same way prior column additions were backfilled (see `scripts/backfillRecentAttribution.ts` for the established pattern; a discount backfill re-fetches `fetchShopifyDayRows` per (store, day) and re-upserts — only the new column changes because all other values are recomputed identically). Keep it operator-supervised.

---

## Feature: refund-return-rate-trend
**Refund / return-rate as a tracked KPI trend, not just a per-period deduction.**
Impact: MEDIUM · Effort: S · CAPI-safe: YES (read-only) · Kind: deepen
Dependencies: none. Reads existing `DailyRow.refundDeduction` + `grossRevenue` (already populated). The chart component (`KpiTrendChart`) is shared with discount-rate (this workstream) — build it here.

**Grounding (real code).** Refunds exist as money (`refund_deduction_cad`, `RefundIndicator.tsx`, the PnL line at `PnLBreakdown.tsx:254`, the products refund ratio) and gross-vs-net is tracked (`grossRevenue` in `DailyRow`, summed in `analytics.aggregate` line 181). But `AnalysisTrendsTab.tsx` (the whole file is 62 lines) renders ONLY the ROAS `RoasChart` — there is no refund-rate / AOV / units series. We add a refund-rate (refund $ ÷ gross) time series + a reusable AA chart and render it under the ROAS trend.

The chart is a non-trivial visual element → mockup-first (reuse the run-rate mockup gate cadence). Since `KpiTrendChart` is generic and small, a lightweight mockup of the chart-in-context suffices.

### Task 1 — Failing test: `refundRateTrend` helper
- [ ] Create `dashboard-web/src/lib/__tests__/refundRateTrend.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { refundRateTrend } from '@/lib/refundRateTrend';
import type { DailyRow } from '@/lib/types';

function row(o: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-06-01', storeId: 'uzoshop', storeName: 'uzoshop',
    fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue: 0, roas: 0,
    grossProfit: 0, cogs: 0, netProfit: 0, hasCogs: true,
    grossRevenue: null, refundDeduction: null, discount: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null, ...o,
  };
}

describe('refundRateTrend', () => {
  it('rate = refundDeduction / grossRevenue per day', () => {
    const s = refundRateTrend([
      row({ date: '2026-06-01', refundDeduction: 30, grossRevenue: 300 }),
      row({ date: '2026-06-02', refundDeduction: 0, grossRevenue: 100 }),
    ], { from: '2026-06-01', to: '2026-06-02' });
    expect(s.find(p => p.date === '2026-06-01')!.rate).toBeCloseTo(0.10, 6);
    expect(s.find(p => p.date === '2026-06-02')!.rate).toBe(0);
  });
  it('null gross → null point (no false 0); aggregates multi-store per day', () => {
    const s = refundRateTrend([
      row({ date: '2026-06-01', storeName: 'uzoshop', refundDeduction: 10, grossRevenue: 100 }),
      row({ date: '2026-06-01', storeName: 'zolplus', refundDeduction: 20, grossRevenue: 100 }),
      row({ date: '2026-06-03', refundDeduction: 5, grossRevenue: null }),
    ], { from: '2026-06-01', to: '2026-06-03' });
    expect(s.find(p => p.date === '2026-06-01')!.rate).toBeCloseTo(30 / 200, 6);
    expect(s.find(p => p.date === '2026-06-02')!.rate).toBeNull(); // gap day, no data
    expect(s.find(p => p.date === '2026-06-03')!.rate).toBeNull(); // gross null
  });
});
```
- [ ] Run: `npm test src/lib/__tests__/refundRateTrend.test.ts` — EXPECT FAIL.

### Task 2 — Implement: `refundRateTrend` helper
- [ ] Create `dashboard-web/src/lib/refundRateTrend.ts` (mirror `discountLeakage.ts` shape + the `analytics.dailySeries` gap policy: every calendar day, `null` for "no data", `0` for "real zero"):
```ts
import type { DailyRow, DateRange } from './types';
import { enumerateDateRange } from './dateRange';

export type RefundRatePoint = { date: string; rate: number | null };

/** Per-day refund rate = Σ refundDeduction ÷ Σ grossRevenue across stores.
 *  null rate when the day has no populated gross (no data / legacy). */
export function refundRateTrend(rows: readonly DailyRow[], range: DateRange): RefundRatePoint[] {
  const byDate = new Map<string, { refund: number; gross: number | null }>();
  for (const r of rows) {
    if (r.date < range.from || r.date > range.to) continue;
    const e = byDate.get(r.date) ?? { refund: 0, gross: null };
    if (typeof r.refundDeduction === 'number') e.refund += r.refundDeduction;
    if (typeof r.grossRevenue === 'number') e.gross = (e.gross ?? 0) + r.grossRevenue;
    byDate.set(r.date, e);
  }
  return enumerateDateRange(range.from, range.to).map(date => {
    const e = byDate.get(date);
    if (!e || e.gross === null || e.gross <= 0) return { date, rate: null };
    return { date, rate: e.refund / e.gross };
  });
}
```
- [ ] Run: `npm test src/lib/__tests__/refundRateTrend.test.ts` — EXPECT PASS.
- [ ] Commit: `git add dashboard-web/src/lib/refundRateTrend.ts dashboard-web/src/lib/__tests__/refundRateTrend.test.ts && git commit -m "feat(trends): refundRateTrend helper — refund$ / gross per day (refund-return-rate-trend)"`

### Task 3 — Static mockup of the rate-trend chart in context (mockup-first gate)
- [ ] Create `docs/superpowers/mockups/2026-06-04-runrate/rate-trend-chart.html` (reuse the runrate mockup folder): a standalone RTL page (light/dark toggle) showing the refund-rate line + an optional discount-rate line on a NEUTRAL plot scrim (`--surface-sunken`/`--glass-2`) with a casing/halo so the series ink stays AA-legible on the card background, a Hebrew y-axis label ("% החזרים מהברוטו"), a dashed gap where data is missing (null points NOT connected), and a hover tooltip. Show it sitting under a placeholder "מגמת ROAS" block to convey placement in `AnalysisTrendsTab`.
- [ ] Deliver: print `open /Users/dorperetz/script-roas/docs/superpowers/mockups/2026-06-04-runrate/rate-trend-chart.html` and PAUSE for operator approval. Do not proceed until approved.
- [ ] Commit: `git add docs/superpowers/mockups/2026-06-04-runrate/rate-trend-chart.html && git commit -m "docs(ws1): refund/discount rate-trend chart mockup for approval"`

### Task 4 — Failing test + impl: `KpiTrendChart` reusable component
- [ ] Create `dashboard-web/src/components/__tests__/kpiTrendChart.dom.test.tsx`: render `<KpiTrendChart series={[{date,rate}...]} label="% החזרים" />`; assert the label renders, that a null-rate day does NOT produce a 0 data point (gap honesty — assert via the number of plotted points or a `connectNulls={false}` prop wiring through a test seam), and that the y-axis tick formatter renders percent (e.g. "10%"). Mock Recharts ResponsiveContainer if the existing chart dom tests do (check `RoasChart` dom test for the pattern).
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/kpiTrendChart.dom.test.tsx` — EXPECT FAIL.
- [ ] Create `dashboard-web/src/components/KpiTrendChart.tsx`: a token-driven Recharts `LineChart` for one (or two) rate series. Requirements baked in from the start: draw on a neutral plot scrim (`bg-glass-2`/`var(--surface-sunken)`), series stroke via chart palette tokens (NO hex — use the canonical `--chart-*`/`stroke-[color:var(--accent)]` tokens already used by `RoasChart`), `connectNulls={false}` so null points show as gaps, RTL-aware (`reversed` x-axis or `dir="rtl"` wrapper consistent with `RoasChart`), percent y-axis tick formatter, AA tooltip on a neutral surface, numbers through the percent formatter. Light+dark both first-class (tokens re-skin automatically). Accept props `{ series: {date:string; rate:number|null}[]; secondary?: {date; rate}[]; label: string; secondaryLabel?: string }`.
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/kpiTrendChart.dom.test.tsx && npm run lint` — EXPECT PASS (lint verifies token-only + logical-direction).
- [ ] Commit: `git add dashboard-web/src/components/KpiTrendChart.tsx dashboard-web/src/components/__tests__/kpiTrendChart.dom.test.tsx docs/ROAS-Dashboard-User-Manual.md && git commit -m "feat(trends): reusable AA KpiTrendChart for rate KPIs (refund-return-rate-trend)"`

### Task 5 — Failing test + impl: wire refund-rate (+ discount-rate) into AnalysisTrendsTab
- [ ] Failing test — create `dashboard-web/src/components/__tests__/analysisTrendsRefundRate.dom.test.tsx`: render `<AnalysisTrendsTab data filtered filters setFilters />` with `filtered.cur` rows that carry refunds, assert a section titled "מגמת החזרים" (or similar) is present and the `KpiTrendChart` renders. Mirror the prop shape from the existing `AnalysisTrendsTab` usage in `Dashboard.tsx` (Props type at AnalysisTrendsTab.tsx:15-24).
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/analysisTrendsRefundRate.dom.test.tsx` — EXPECT FAIL.
- [ ] Implement in `dashboard-web/src/components/AnalysisTrendsTab.tsx`: import `refundRateTrend` + `discountRateTrend` + `KpiTrendChart`; compute `const refundRate = refundRateTrend(filtered.cur, filters.range);` and `const discountRate = discountRateTrend(filtered.cur, filters.range);`. After the ROAS chart block (line 55-57), add a new `SectionIntro` ("מגמת החזרים והנחות", description in Hebrew: refund/discount rate over time, what drives it) + a `<div className="rounded-xl bg-glass-1 border border-glass-edge shadow-glass overflow-hidden">` wrapping `<KpiTrendChart series={refundRate} secondary={discountRate} label="% החזרים מהברוטו" secondaryLabel="% הנחות מהברוטו" />`. Tokens + logical classes only (match the existing wrapper at line 55).
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/analysisTrendsRefundRate.dom.test.tsx && npx tsc --noEmit && npm run lint` — EXPECT PASS.
- [ ] Commit: `git add dashboard-web/src/components/AnalysisTrendsTab.tsx dashboard-web/src/components/__tests__/analysisTrendsRefundRate.dom.test.tsx docs/ROAS-Dashboard-User-Manual.md && git commit -m "feat(trends): refund-rate + discount-rate trend in Analysis/Trends tab (refund-return-rate-trend)"`

---

## Feature: budget-pacing-marginal
**Budget pacing / marginal-spend view: over/under-spending vs budget today, and where returns are flattening.**
Impact: LOW · Effort: M · CAPI-safe: YES (read-only) · Kind: net-new
Dependencies: none. Reads existing `Aggregated.campaignBudgetCad`/`adSetBudgetCad`/`budgetType` (campaignsAggregator.ts:86-88) + per-day spend already in the campaigns rows. Marginal-decay reads the per-day spend/ROAS trajectory the table already builds for the CPM/ROAS overlay (`analyzeCpmVsRoas` inputs).

**Grounding (real code).** `CampaignsTable.tsx:1940-1953` renders the budget column header; budget is display/sort only (sort case at lines 183-189 reads `campaignBudgetCad`/`adSetBudgetCad`). `campaignsIntelligence.ts` + `cpmRoasAnalysis.ts` have zero pacing/marginal/saturation logic. `insights.ts:321-415` has SCALE/PAUSE/REBALANCE rules but nothing for "this scaling campaign's ROAS is decaying as spend rises" or "pacing to blow today's budget". We add pure helpers + a token-driven pacing chip in the existing budget cell, plus a marginal-decay flag.

The pacing chip is a non-trivial visual element → mockup-first.

### Task 1 — Static mockup of pacing chip states (mockup-first gate)
- [ ] Create `docs/superpowers/mockups/2026-06-04-budget-pacing/pacing-chip.html`: standalone RTL page (light/dark toggle) showing the budget cell with the chip in each state: on-pace (neutral/accent), over-pacing ("צפוי לחרוג ~$X", warning band), under-pacing ("מתחת לקצב", info/blue), no-budget ("—"), and a marginal-decay marker ("ROAS יורד ככל שההוצאה עולה ↓"). All money via tabular-nums; AA foreground on each band (on-band/scrim token, never text-from-band-color).
- [ ] Deliver: print `open /Users/dorperetz/script-roas/docs/superpowers/mockups/2026-06-04-budget-pacing/pacing-chip.html` and PAUSE for operator approval.
- [ ] Commit: `git add docs/superpowers/mockups/2026-06-04-budget-pacing && git commit -m "docs(ws1): budget-pacing chip mockup for approval"`

### Task 2 — Failing test: `computeBudgetPacing` + `detectMarginalDecay`
- [ ] Create `dashboard-web/src/lib/__tests__/budgetPacing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeBudgetPacing, detectMarginalDecay } from '@/lib/budgetPacing';

describe('computeBudgetPacing', () => {
  it('flags over-pacing: spend already past the day-fraction share of budget', () => {
    // 50% of day elapsed, daily budget 100, already spent 80 → projected 160 → over.
    const p = computeBudgetPacing({ spendToday: 80, dailyBudget: 100, fractionOfDayElapsed: 0.5 });
    expect(p.status).toBe('over');
    expect(p.projectedDaySpend).toBeCloseTo(160, 6);
    expect(p.projectedOverspend).toBeCloseTo(60, 6);
  });
  it('flags under-pacing when projected day spend is well below budget', () => {
    const p = computeBudgetPacing({ spendToday: 20, dailyBudget: 100, fractionOfDayElapsed: 0.5 });
    expect(p.status).toBe('under');
    expect(p.projectedDaySpend).toBeCloseTo(40, 6);
  });
  it('on-pace when projected ≈ budget within tolerance', () => {
    expect(computeBudgetPacing({ spendToday: 48, dailyBudget: 100, fractionOfDayElapsed: 0.5 }).status).toBe('on');
  });
  it('returns "unknown" when no daily budget (lifetime/null) or day not started', () => {
    expect(computeBudgetPacing({ spendToday: 10, dailyBudget: null, fractionOfDayElapsed: 0.5 }).status).toBe('unknown');
    expect(computeBudgetPacing({ spendToday: 10, dailyBudget: 100, fractionOfDayElapsed: 0 }).status).toBe('unknown');
  });
});

describe('detectMarginalDecay', () => {
  it('flags decay when later-half spend rises but ROAS falls vs early half (min 6 days)', () => {
    const series = [
      { date: '2026-06-01', spend: 50, roas: 4.0 }, { date: '2026-06-02', spend: 55, roas: 3.9 },
      { date: '2026-06-03', spend: 60, roas: 3.8 }, { date: '2026-06-04', spend: 120, roas: 2.2 },
      { date: '2026-06-05', spend: 130, roas: 2.0 }, { date: '2026-06-06', spend: 140, roas: 1.9 },
    ];
    const d = detectMarginalDecay(series);
    expect(d.decaying).toBe(true);
  });
  it('no decay verdict below the min-days threshold', () => {
    expect(detectMarginalDecay([{ date: 'a', spend: 1, roas: 1 }]).decaying).toBe(false);
  });
  it('no decay when ROAS holds as spend rises', () => {
    const series = Array.from({ length: 6 }, (_, i) => ({ date: `d${i}`, spend: 50 + i * 20, roas: 3.5 }));
    expect(detectMarginalDecay(series).decaying).toBe(false);
  });
});
```
- [ ] Run: `npm test src/lib/__tests__/budgetPacing.test.ts` — EXPECT FAIL.

### Task 3 — Implement: `budgetPacing.ts`
- [ ] Create `dashboard-web/src/lib/budgetPacing.ts` (conservative thresholds mirroring `cpmRoasAnalysis.ts`'s min-N guard style):
```ts
/** Spend-vs-budget pacing for a single campaign/ad-set for TODAY. */
export type BudgetPacingInput = {
  spendToday: number;
  dailyBudget: number | null;
  /** 0..1 fraction of the Israel-day elapsed at read time. */
  fractionOfDayElapsed: number;
};
export type BudgetPacing = {
  status: 'over' | 'under' | 'on' | 'unknown';
  projectedDaySpend: number;
  /** Positive when projected day spend exceeds budget; else 0. */
  projectedOverspend: number;
};

const PACE_TOLERANCE = 0.15; // ±15% of budget = "on pace"

export function computeBudgetPacing({ spendToday, dailyBudget, fractionOfDayElapsed }: BudgetPacingInput): BudgetPacing {
  if (!dailyBudget || dailyBudget <= 0 || fractionOfDayElapsed <= 0) {
    return { status: 'unknown', projectedDaySpend: 0, projectedOverspend: 0 };
  }
  const projectedDaySpend = spendToday / fractionOfDayElapsed;
  const projectedOverspend = Math.max(0, projectedDaySpend - dailyBudget);
  const ratio = projectedDaySpend / dailyBudget;
  const status = ratio > 1 + PACE_TOLERANCE ? 'over' : ratio < 1 - PACE_TOLERANCE ? 'under' : 'on';
  return { status, projectedDaySpend, projectedOverspend };
}

export type MarginalPoint = { date: string; spend: number; roas: number };
export type MarginalDecay = { decaying: boolean; earlyRoas: number; lateRoas: number; spendRose: boolean };

const MARGINAL_MIN_DAYS = 6;
const ROAS_DECAY_FACTOR = 0.85; // late ROAS < 85% of early ROAS = material decay
const SPEND_RISE_FACTOR = 1.20; // late spend > 120% of early spend = scaling

/** Half-over-half test (same shape as cpmRoasAnalysis): later-half spend up
 *  AND later-half ROAS materially down → diminishing returns. Needs >= 6 days. */
export function detectMarginalDecay(series: readonly MarginalPoint[]): MarginalDecay {
  if (series.length < MARGINAL_MIN_DAYS) return { decaying: false, earlyRoas: 0, lateRoas: 0, spendRose: false };
  const mid = Math.floor(series.length / 2);
  const early = series.slice(0, mid);
  const late = series.slice(mid);
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const earlySpend = mean(early.map(p => p.spend));
  const lateSpend = mean(late.map(p => p.spend));
  const earlyRoas = mean(early.map(p => p.roas));
  const lateRoas = mean(late.map(p => p.roas));
  const spendRose = lateSpend > earlySpend * SPEND_RISE_FACTOR;
  const roasFell = earlyRoas > 0 && lateRoas < earlyRoas * ROAS_DECAY_FACTOR;
  return { decaying: spendRose && roasFell, earlyRoas, lateRoas, spendRose };
}
```
- [ ] Run: `npm test src/lib/__tests__/budgetPacing.test.ts` — EXPECT PASS.
- [ ] Commit: `git add dashboard-web/src/lib/budgetPacing.ts dashboard-web/src/lib/__tests__/budgetPacing.test.ts && git commit -m "feat(campaigns): budget-pacing + marginal-decay pure helpers (budget-pacing-marginal)"`

### Task 4 — Failing test + impl: `BudgetPacingCell` component
- [ ] Failing test — create `dashboard-web/src/components/__tests__/budgetPacingCell.dom.test.tsx`: render `<BudgetPacingCell budget={100} pacing={overPacing} />` and assert the over-pacing copy ("צפוי לחרוג") shows with a warning band, that the budget value renders through `<Money>` (exact value present), that the `unknown` state renders "—", and that the `decaying` flag (when passed) renders the marginal-decay marker. Assert NO native `title=` (the `local/no-native-title-tooltip` guard) — use `HelpTooltip`.
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/budgetPacingCell.dom.test.tsx` — EXPECT FAIL.
- [ ] Create `dashboard-web/src/components/BudgetPacingCell.tsx`: render the daily budget via `<Money>` (CAD, tabular-nums) + a status chip. Bands via status tokens (on → `bg-accent-bg text-accent`; over → `bg-status-warningBg text-status-warningFg`; under → `bg-status-blueBg text-status-blueFg`; unknown → render only "—"). Over-pacing chip text: `צפוי לחרוג ~` + `<Money value={pacing.projectedOverspend} prefix="none" />`. Use `HelpTooltip` (NOT native title) for the full explanation (projected day spend vs budget; how pacing is computed). Marginal-decay marker: a small `↓` + "ROAS יורד עם ההוצאה" with its own `HelpTooltip`. AA foreground on every band (paired on-band tokens, never text-from-band). Logical classes only (`ms-*`/`me-*`). Props: `{ budget: number | null; pacing: BudgetPacing; decay?: MarginalDecay }`.
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/budgetPacingCell.dom.test.tsx && npm run lint` — EXPECT PASS.
- [ ] Commit: `git add dashboard-web/src/components/BudgetPacingCell.tsx dashboard-web/src/components/__tests__/budgetPacingCell.dom.test.tsx docs/ROAS-Dashboard-User-Manual.md && git commit -m "feat(campaigns): BudgetPacingCell chip + marginal-decay marker (budget-pacing-marginal)"`

### Task 5 — Wire into CampaignsTable budget data cell
- [ ] In `dashboard-web/src/components/CampaignsTable.tsx`, find the budget DATA cell renderer (the cell that renders `campaignBudgetCad`/`adSetBudgetCad` for each row — search `grep -n "campaignBudgetCad\|adSetBudgetCad\|dataColId=\"budget\"" src/components/CampaignsTable.tsx`; the data cell is the row-level counterpart to the header at lines 1940-1953). Replace the raw budget render with `<BudgetPacingCell budget={...} pacing={pacing} decay={decay} />` where:
  - `budget` = `mode === 'campaign' ? a.campaignBudgetCad : a.adSetBudgetCad` (mirror the sort case at lines 183-189).
  - `pacing` = `computeBudgetPacing({ spendToday: <today's spend for this aggregate>, dailyBudget: budget, fractionOfDayElapsed: <Israel day fraction> })`. Compute `fractionOfDayElapsed` once at the table level from the Israel clock (mirror `getTodayInIsraelTz` usage already imported elsewhere; `fraction = (minutes since IL-midnight) / 1440`). Today's spend per aggregate: derive from the per-day campaign rows the table already holds for the CPM/ROAS overlay, summing only the rows whose `date === getTodayInIsraelTz()`. Pacing is meaningful ONLY when the selected range includes today AND the campaign is active — otherwise pass `dailyBudget: null` so `status='unknown'` (renders just the budget number, current behavior preserved).
  - `decay` = `detectMarginalDecay(<per-day {date,spend,roas} for this aggregate>)` built from the same per-day series.
- [ ] Failing test — create `dashboard-web/src/components/__tests__/campaignsTableBudgetPacing.dom.test.tsx`: render `CampaignsTable` with a fixture where the range is today and one campaign is over-pacing; assert the over-pacing chip appears in that row; assert a past-range render shows only the budget number (no chip). Mirror the harness in the existing `CampaignsTableFirstClick.dom.test.tsx`.
- [ ] Run: `npx vitest run --config vitest.config.dom.ts src/components/__tests__/campaignsTableBudgetPacing.dom.test.tsx && npx tsc --noEmit && npm run lint` — EXPECT PASS (regression: existing CampaignsTable dom tests must still pass — run `npx vitest run --config vitest.config.dom.ts src/components/__tests__/CampaignsTable*.dom.test.tsx`).
- [ ] Commit: `git add dashboard-web/src/components/CampaignsTable.tsx dashboard-web/src/components/__tests__/campaignsTableBudgetPacing.dom.test.tsx docs/ROAS-Dashboard-User-Manual.md && git commit -m "feat(campaigns): spend-vs-budget pacing + decay in budget column (budget-pacing-marginal)"`

### Task 6 — Final gate + docs sweep + push
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` (if not already covered per-task): document the budget-pacing chip states and the marginal-decay marker, including the "pacing only shows for today + active campaigns" caveat and that pacing is directional (platform-reported spend vs configured daily budget).
- [ ] Run the FULL pre-push gate from `dashboard-web/`: `npx tsc --noEmit && npm test && npx vitest run --config vitest.config.dom.ts && npm run lint`, then from repo root `node scripts/docs-currency.mjs`. All EXPECT PASS.
- [ ] Push: `git push origin main` (single deploy trigger; never `vercel deploy --prod`).

---

## Self-Review

**Spec coverage — every listed gap id has its own Feature with full TDD tasks:**
- `profit-net-runrate-surfaced` — Feature 1 (Tasks 1-4): mockup → failing dom test → GoalTracker sub-panel reading the already-computed `forecast.projectedNet/projectedSpend/projectedRoas` → docs. UI-only, no lib/migration. ✓
- `discount-promo-leakage` — Feature 2 (Tasks 1-7): migration → algorithm `storeDiscountCad` (failing test first) → fetcher allowlists + `ShopifyDayRows.discountCad` → `DailyRow.discount` + reader + cron dual-write (parity test) → `discountLeakage.ts` helpers + PnL line → ARCH docs + supervised apply + re-backfill note. ✓
- `refund-return-rate-trend` — Feature 3 (Tasks 1-5): `refundRateTrend` helper (failing test) → mockup → reusable `KpiTrendChart` (AA, neutral scrim, gap-honest) → AnalysisTrendsTab wiring. ✓
- `budget-pacing-marginal` — Feature 4 (Tasks 1-6): mockup → `computeBudgetPacing` + `detectMarginalDecay` helpers (failing test) → `BudgetPacingCell` → CampaignsTable wiring → gate + push. ✓

**Placeholder scan:** No "TODO", no "similar to Task N", no pseudo-code. Every task cites real files with real line numbers (verified by reading: `insights.ts:495-673`, `GoalTracker.tsx:159/480-590`, `analytics.ts:181-262`, `PnLBreakdown.tsx:146/254-263/472-483`, `shopifyRevenueRefunds.ts:50-57/113-122/231-298`, `fetchers/shopify.ts:431/1133/600-655`, `postgresReaders.ts:293-361`, `cronDaily.ts:956-1039`, `types.ts:1-45`, `campaignsAggregator.ts:86-88/183-189`, `CampaignsTable.tsx:1940-1953`, `AnalysisTrendsTab.tsx:1-62`, `cpmRoasAnalysis.ts:33`), real test code, real exact run/commit commands.

**Type consistency:** New `DailyRow.discount: number | null` matches the existing `grossRevenue`/`refundDeduction` nullable convention and is added to every `row()` test factory in the new tests. `storeDiscountCad`/`discountCad`/`discount_cad`/`discount` form one consistent chain (algorithm → fetcher → DB → reader → type). Helper return types (`DiscountRatePoint`, `RefundRatePoint`, `BudgetPacing`, `MarginalDecay`) are exported and used by their consumers. `forecastMonthEnd`'s return type already includes the projected fields the GoalTracker now reads (no signature change).

**Guard/standards compliance:** All new components use status/accent/glass/ink tokens (no hex → passes `local/no-hex-color-in-components`), logical direction props (passes `local/no-physical-direction-in-components`), `HelpTooltip` not native `title=` (passes `local/no-native-title-tooltip`), `<Money>` for every number (overflow-safe, exact value preserved), light+dark first-class, RTL, gap-honest charts on a neutral scrim. CAPI-safe: zero event emission anywhere. Mapping-aware: all reads go through `data_daily`/`aggregate`. docs-currency: every component-touching commit stages `docs/ROAS-Dashboard-User-Manual.md`; every inngest/fetcher/reader/migration-touching commit batches `docs/ARCHITECTURE.md` before push.

## Open questions for the operator
1. **Discount semantics:** capture is order-level `Order.total_discounts` (CAD). Is that the right denominator for "discount rate" (discount ÷ gross), or do you want discount ÷ (gross + discount) = "list-price-off rate"? Default chosen: discount ÷ gross.
2. **Discount backfill depth:** how far back should we re-fetch to populate `discount_cad` for historical days (e.g. 30 / 90 days / all)? Until backfilled, historical days hide the discount line + show null trend points.
3. **Budget-pacing day fraction:** acceptable to use a simple linear "fraction of IL-day elapsed" baseline (assumes even intraday delivery)? Real ad delivery front/back-loads; a linear baseline can over-warn early-morning. Alternative: use the trailing-N-day intraday curve. Default chosen: linear (simplest, conservative ±15% tolerance).
4. **Run-rate panel placement:** put the net/spend/ROAS strip INSIDE the existing GoalTracker card (chosen), or as a separate card next to it? It currently extends the revenue-goal card downward.
5. **Marginal-decay thresholds:** late ROAS < 85% of early ROAS AND late spend > 120% of early spend, min 6 days. Tune these, or surface as a stronger/weaker signal?
6. **Should the discount line and refund line in the P&L roll up into a single "leakage" group** in a future pass, or stay as two distinct presentational lines (chosen)?
