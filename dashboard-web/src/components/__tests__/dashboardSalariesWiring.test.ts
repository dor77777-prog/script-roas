// dashboard-web/src/components/__tests__/dashboardSalariesWiring.test.ts
//
// T7 wiring guard (2026-06-02 — dynamic salaries %).
//
// The editable-salaries deduction is computed business-level via
// `salariesForRange(salarySettings, rows, range)` and threaded into the SAME
// `filtered` memo that already applies COGS, so the hero net card, P&L
// synthesis, insights, and PnLBreakdown all pick it up from
// `aggregate().trueNetProfit`. salaries default to 7% of revenue, so a regress
// that drops the wiring (or only threads one of cur/prev) would silently
// over-state true net profit.
//
// This source-file guard asserts:
//   1. Dashboard imports the salary hook + the salariesForRange helper.
//   2. The main Dashboard component subscribes the salaryTick to
//      'roas-salary-changed' (mirror of billingTick) so salary edits
//      re-aggregate immediately.
//   3. BOTH aggregate(cur, ...) and aggregate(prev, ...) in the `filtered`
//      memo receive salariesForRange(...) as the 5th positional arg.
//   4. The `filtered` memo deps include salarySettings + salaryTick.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DASHBOARD_SRC = resolve(__dirname, '..', 'Dashboard.tsx');

describe('Dashboard salaries wiring (T7 — dynamic salaries %)', () => {
  const src = readFileSync(DASHBOARD_SRC, 'utf8');

  it('imports the useSalarySettings hook and the salariesForRange helper', () => {
    expect(src).toMatch(/import\s*\{\s*useSalarySettings\s*\}\s*from\s*['"]@\/lib\/hooks\/useSalarySettings['"]/);
    expect(src).toMatch(/import\s*\{\s*salariesForRange\s*\}\s*from\s*['"]@\/lib\/salarySettings['"]/);
  });

  it('reads the salary settings via the hook in the Dashboard component', () => {
    expect(src).toMatch(/const\s*\[\s*salarySettings\s*\]\s*=\s*useSalarySettings\(\)/);
  });

  it('mirrors billingTick with a salaryTick that listens for roas-salary-changed', () => {
    expect(src).toMatch(/const\s*\[\s*salaryTick\s*,\s*setSalaryTick\s*\]\s*=\s*useState\(/);
    expect(src).toMatch(/addEventListener\(\s*['"]roas-salary-changed['"]/);
    expect(src).toMatch(/removeEventListener\(\s*['"]roas-salary-changed['"]/);
  });

  it('threads salariesForRange into the current-range aggregate as the 5th arg', () => {
    // P1-31b (2026-06-10, D4): args 3+4 are now the store-scope threading
    // (scopedStoreNames + revenueByStoreFor(...)) so a store-filtered view
    // carries only its fair share of All-scoped fixed costs. The guard pins
    // the 5th arg (salaries) and the scope args by NAME, not `undefined`.
    expect(src).toMatch(
      /aggregate\(\s*cur\s*,\s*filters\.range\s*,\s*scopedStoreNames\s*,\s*revenueByStoreFor\(\s*filters\.range\s*\)\s*,\s*salariesForRange\(\s*salarySettings\s*,\s*cur\s*,\s*filters\.range\s*\)\s*\)/,
    );
  });

  it('threads salariesForRange into the previous-range aggregate as the 5th arg', () => {
    expect(src).toMatch(
      /aggregate\(\s*prev\s*,\s*prevR\s*,\s*scopedStoreNames\s*,\s*revenueByStoreFor\(\s*prevR\s*\)\s*,\s*salariesForRange\(\s*salarySettings\s*,\s*prev\s*,\s*prevR\s*\)\s*\)/,
    );
  });

  it('threads the SAME D4 store-scope into the hero prev baseline (prevAggFromPrevData) — cur/prev parity', () => {
    // 2026-06-11 adversarial review (D4 threading missed prevAggFromPrevData):
    // `filtered.curAgg` carries the fair-share fixed-cost convention
    // (scopedStoreNames + unfiltered revenue split), so the hero delta's prev
    // baseline MUST use the same convention — args 3+4 pinned by NAME, never
    // `undefined`. A mixed pair makes toHeroDelta's netProfit
    // (cur.trueNetProfit − prev.trueNetProfit) systematically overstated in
    // store-filtered views whenever All-scoped fixed costs exist.
    expect(src).toMatch(
      // `,?` — the call is multi-line at the call site, so a trailing comma
      // after the salariesForRange arg is allowed.
      /aggregate\(\s*prevCur\s*,\s*prevRange\s*,\s*scopedStoreNames\s*,\s*revenueByStorePrev\s*,\s*salariesForRange\(\s*salarySettings\s*,\s*prevCur\s*,\s*prevRange\s*\)\s*,?\s*\)/,
    );
    // The prev revenue split must come from the UNFILTERED dataPrev rows for
    // prevRange (mirror of revenueByStoreFor in the `filtered` memo) — NOT
    // from data.rows (those only span filters.range).
    expect(src).toMatch(
      /filterRows\(\s*dataPrev\.rows\s*,\s*prevRange\s*,\s*['"]All['"]\s*\)/,
    );
  });

  it('adds salarySettings + salaryTick to the filtered memo dependency array', () => {
    expect(src).toMatch(/\}\s*,\s*\[\s*data\s*,\s*filters\s*,\s*billingTick\s*,\s*salarySettings\s*,\s*salaryTick\s*\]\)/);
  });
});
