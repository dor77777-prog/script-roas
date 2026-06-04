/**
 * Audit fix 2026-05-24 (AUDIT insights ALG-01, Phase 12.2.2) — locks the
 * MTD-COGS-preservation contract for forecastMonthEnd's projectedNet.
 *
 * Pre-fix surface (per .planning/AUDIT.md §Phase 12.2 + raw-returns/
 * lib_algorithm_insights.json #ALG-01):
 *   `projectedNet = projectedRev - projectedSpend - projectedRev *
 *   observedCogsRate - projectedRev * observedFeesRate - projectedFixed`.
 *   The `projectedRev * observedCogsRate` and `projectedRev *
 *   observedFeesRate` terms apply the LAST-7 rate to the WHOLE projected
 *   month — including the MTD portion that has ALREADY HAPPENED at a
 *   DIFFERENT rate. So an early-MTD day with high 25% COGS gets rewritten
 *   to the last-7 baseline's 10% rate in the projection, producing a
 *   projectedNet that contradicts what actually happened in the month.
 *
 * Post-fix: `projectedCogs = mtdCogs + dailyAvgCogs * daysRemaining` and
 * `projectedFees = mtdFees + dailyAvgFees * daysRemaining`. The actual
 * MTD costs are preserved exactly; only the REMAINING days are projected
 * via the last-7-window daily-average rate. GoalTracker's projection
 * no longer overwrites realized history with the baseline rate.
 *
 * Evidence pack: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   lib_algorithm_insights.json (ALG-01).
 *
 * Test coverage (3 tests):
 *   1. Heterogeneous MTD bug fixture — 1 early-MTD day at 25% COGS +
 *      7 baseline days at 10% COGS. Pre-fix produces 20040; post-fix
 *      produces 18540 (the correct value that respects historic COGS).
 *   2. Homogeneous regression guard — all MTD rows have the same 25%
 *      rate. Pre-fix and post-fix produce identical results because
 *      the dailyAvgCogs path collapses to the same number.
 *   3. Zero-baseline fallback — last-7 window has 0 revenue; mtdCogs
 *      is still preserved (not zeroed) and the formula doesn't NaN.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { forecastMonthEnd } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';
import type { RecurringCost } from '@/lib/billing';
import type { SalarySettings } from '@/lib/salarySettings';

// Determinism: `forecastMonthEnd` (and this file's local `todayInIsrael()`)
// read the wall clock via `new Date()` and have no explicit `now`/`asOf`
// parameter. Anchoring fixtures to the REAL current date makes these tests
// flaky near month boundaries: on day 1 of a month the MTD window is a single
// day and the baseline `[today-7..today-1]` lands in the PREVIOUS month, so the
// fixtures fall out-of-window and the asserted projected values no longer hold
// (they PASS mid-month, FAIL on 2026-06-01 — the homogeneous-guard MTD totals
// collapse to 0 because no fixture row is in the single-day MTD window). Pin
// "now" to a comfortably mid-month instant (2026-05-15) so the MTD window spans
// 15 days and `[today-7..today-1]` stays in-month — matching the fixtures'
// assumption (and keeping the day>=9 heterogeneous-fixture branches active).
const PINNED_NOW = new Date('2026-05-15T12:00:00+03:00');
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(PINNED_NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Phase 13.1 (2026-05-24) — window stub for the percent-of-revenue test.
// The existing tests don't need this because forecastMonthEnd's billing
// path returns 0 when window is undefined (safeReadArray short-circuits).
// The Phase 13.1 P0-B test below needs to seed an active recurring row.
// Lifted from billing.test.ts's pattern.
// ---------------------------------------------------------------------------
type MinimalWindow = {
  localStorage: Storage;
  dispatchEvent: (ev: Event) => boolean;
};
function installWindow(): { teardown: () => void; mem: Map<string, string> } {
  const mem = new Map<string, string>();
  const localStorage: Storage = {
    length: 0,
    clear: () => mem.clear(),
    getItem: (k: string) => mem.get(k) ?? null,
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    removeItem: (k: string) => mem.delete(k),
    setItem: (k: string, v: string) => mem.set(k, v),
  };
  const g = globalThis as unknown as { window?: MinimalWindow };
  const prior = g.window;
  g.window = { localStorage, dispatchEvent: () => true };
  return { teardown: () => { g.window = prior; }, mem };
}
function seedRecurring(mem: Map<string, string>, items: RecurringCost[]) {
  mem.set('roas-dashboard:billing-recurring', JSON.stringify(items));
}

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function row(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date: todayInIsrael(),
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 0,
    revenue: 0,
    roas: 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: true,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...overrides,
  };
}

describe('forecastMonthEnd projectedNet preserves MTD COGS (insights ALG-01)', () => {
  it('heterogeneous MTD: projection preserves early-MTD 25% COGS history; extrapolates only remaining days', () => {
    // The bug fixture from raw-returns/lib_algorithm_insights.json #ALG-01:
    //   - one early-MTD day with revenue=10000, cogs=2500 (25% rate)
    //   - seven baseline days (today-7 .. today-1) with revenue=1000/day,
    //     cogs=100/day (10% rate)
    // Pre-fix formula: projectedCogs = projectedRev * (last7Cogs/last7Rev)
    //   = projectedRev * 0.10  → REWRITES the early 25%-COGS day at 10%.
    // Post-fix formula: projectedCogs = mtdCogs + dailyAvgCogs * daysRemaining
    //   = 3200 + 100 * daysRemaining  → preserves MTD at 25%, extrapolates
    //   only the remaining days at the baseline rate.
    const today = todayInIsrael();
    const monthStartDay = today.slice(-2);
    const daysElapsed = parseInt(monthStartDay, 10);
    // We need an MTD day that's NOT in the last-7 window. Anchor it to
    // monthStart so the test works regardless of where in the month
    // "today" lands. If "today" is day 1-8 of the month, the last-7
    // window goes back into the previous month and there's no slot for
    // an early-MTD day that's strictly outside both windows — in that
    // case skip the test gracefully (the bug is intractable on the
    // first week of the month anyway).
    if (daysElapsed < 9) {
      // Skip this test on first 8 days of month — the heterogeneity
      // setup requires an early-MTD day BEFORE the baseline window.
      return;
    }
    const monthStart = today.slice(0, 8) + '01';
    void monthStart;

    const rows: DailyRow[] = [];
    // Early MTD day on day 3 of month — 25% COGS rate.
    const earlyDate = today.slice(0, 8) + '03';
    rows.push(
      row({
        date: earlyDate,
        revenue: 10000,
        totalSpend: 0,
        cogs: 2500,
        hasCogs: true,
      }),
    );
    // Baseline window: today-7 .. today-1 inclusive, 7 days × 1000 rev,
    // 100 cogs each (10% rate).
    for (let d = -7; d <= -1; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000,
          totalSpend: 0,
          cogs: 100,
          hasCogs: true,
        }),
      );
    }

    const f = forecastMonthEnd(rows);

    // mtdRev = 10000 + 7000 = 17000
    // mtdCogs = 2500 + 700 = 3200
    // mtdFees = 17000 * 0.065 = 1105
    // last7Rev = 7000; last7Cogs = 700; last7Fees = 7000 * 0.065 = 455
    // dailyAvgRev = 1000; dailyAvgCogs = 100; dailyAvgFees = 65
    // projectedRev = 17000 + 1000 * daysRemaining
    // PRE-FIX  projectedCogs = projectedRev * 0.10  ← BUG (rewrites history)
    // POST-FIX projectedCogs = 3200 + 100 * daysRemaining  ← preserves MTD
    const daysRemaining = f.daysRemainingThisMonth;
    const expectedProjectedCogs = 3200 + 100 * daysRemaining;
    const expectedProjectedFees = 1105 + 65 * daysRemaining;
    const expectedProjectedNet =
      f.projectedRevenue - 0 - expectedProjectedCogs - expectedProjectedFees;

    // Pre-fix would have rewritten history at 10%:
    const preFixWrongProjectedCogs = f.projectedRevenue * 0.1;
    const preFixWrongProjectedFees = f.projectedRevenue * 0.065;
    const preFixWrongProjectedNet =
      f.projectedRevenue -
      0 -
      preFixWrongProjectedCogs -
      preFixWrongProjectedFees;

    expect(f.projectedNet).toBeCloseTo(expectedProjectedNet, 4);
    // Pin: the pre-fix value differs from the correct value, so we MUST
    // be far from it (more than $1 apart guarantees we're not landing
    // on the buggy formula by accident).
    expect(Math.abs(f.projectedNet - preFixWrongProjectedNet)).toBeGreaterThan(
      1,
    );
  });

  it('homogeneous MTD regression guard: same rate across MTD and baseline → no observable change', () => {
    // All MTD rows have the same 25% COGS rate. The split into
    // mtdCogs + dailyAvgCogs * daysRemaining should produce a result
    // VERY close to (but not exactly equal to) the pre-fix formula
    // projectedRev * 0.25 — because the pre-fix formula uses
    // (last7Cogs / last7Rev) as the rate and applies it to the WHOLE
    // projectedRev including the MTD portion. In a homogeneous case
    // those two collapse to the same number.
    const today = todayInIsrael();
    const rows: DailyRow[] = [];
    for (let d = -7; d <= -1; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000,
          totalSpend: 100,
          cogs: 250,
          hasCogs: true,
        }),
      );
    }

    const f = forecastMonthEnd(rows);
    const daysRemaining = f.daysRemainingThisMonth;

    // mtdRev = 7000, mtdCogs = 1750, mtdFees = 455
    // dailyAvg: rev=1000, cogs=250, fees=65
    // projectedRev = 7000 + 1000 * daysRemaining
    // projectedCogs = 1750 + 250 * daysRemaining
    // projectedFees = 455 + 65 * daysRemaining
    const expectedProjectedCogs = 1750 + 250 * daysRemaining;
    const expectedProjectedFees = 455 + 65 * daysRemaining;
    const expectedProjectedNet =
      f.projectedRevenue -
      f.projectedSpend -
      expectedProjectedCogs -
      expectedProjectedFees;

    expect(f.projectedNet).toBeCloseTo(expectedProjectedNet, 4);
  });

  it('zero-baseline fallback: last-7 window empty, MTD COGS still preserved (not zeroed)', () => {
    // Last-7 window has zero revenue → dailyAvgCogs falls back to the
    // global default rate × dailyAvgRev (which is also 0). But mtdCogs
    // from existing MTD rows MUST still be preserved as the projection's
    // baseline. The formula must NOT NaN/Infinity out.
    const today = todayInIsrael();
    const monthDay = parseInt(today.slice(-2), 10);
    if (monthDay < 9) {
      // Skip on first 8 days — no slot for an MTD-only row outside the
      // last-7 window.
      return;
    }
    // One MTD row at day 3 with revenue + cogs; nothing in the last-7
    // window.
    const earlyDate = today.slice(0, 8) + '03';
    const rows: DailyRow[] = [
      row({
        date: earlyDate,
        revenue: 500,
        totalSpend: 100,
        cogs: 90,
        hasCogs: true,
      }),
    ];

    const f = forecastMonthEnd(rows);

    // The projection must be finite — no NaN, no Infinity.
    expect(Number.isFinite(f.projectedNet)).toBe(true);

    // mtdCogs = 90 is preserved as the floor of projectedCogs. With
    // no last-7 baseline, dailyAvgRev = 0 → projectedRev = mtdRev = 500;
    // dailyAvgCogs falls back to dailyAvgRev * COGS_RATE_OF_REVENUE
    // = 0 * 0.25 = 0; projectedCogs = 90 + 0 * daysRemaining = 90.
    // dailyAvgFees similarly = 0; projectedFees = mtdFees + 0 =
    // 500 * 0.065 = 32.5. projectedSpend = 100 + 0 = 100.
    // projectedNet = 500 - 100 - 90 - 32.5 = 277.5.
    expect(f.projectedNet).toBeCloseTo(277.5, 4);
  });
});

describe('forecastMonthEnd includes percent-of-revenue billing in projectedFixedCosts (Phase 13.1 P0-B)', () => {
  let teardown: () => void = () => {};
  let mem: Map<string, string> = new Map();

  beforeEach(() => {
    const w = installWindow();
    teardown = w.teardown;
    mem = w.mem;
  });
  afterEach(() => {
    teardown();
  });

  it('5% All-row contributes 5% × projectedRev to projectedFixedCosts; projectedNet lower by that amount', () => {
    // The bug: forecastMonthEnd's `projectedFixedCosts` call to billingForRange
    // omitted `revenue`, so every active percent-of-revenue row contributed 0
    // (`Math.max(0, 0) × pct / 100 === 0`). projectedNet over-stated take-home
    // by `projectedRev × pct / 100` for any operator with a percent row.
    //
    // Strategy: monthDay-independent comparison. Run forecastMonthEnd twice
    // with identical rows but different billing seeds — once WITH the percent
    // row, once WITHOUT. The delta in projectedNet isolates the bug's effect.
    // Pre-fix: delta = 0 (both runs see projectedFixedCosts = 0 because the
    // revenue arg is missing). Post-fix: delta ≈ 5% × projectedRev.
    const today = todayInIsrael();
    const rows: DailyRow[] = [];
    for (let d = -7; d <= -1; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000,
          totalSpend: 100,
          cogs: 250,
          hasCogs: true,
        }),
      );
    }

    // Run 1: with the 5% All-scoped recurring row.
    seedRecurring(mem, [
      {
        id: 'r1',
        store: 'All',
        name: 'Markets Pro',
        source: 'external-app',
        monthlyCAD: 0,
        percentOfRevenue: 5,
        active: true,
      },
    ]);
    const fWithPercent = forecastMonthEnd(rows);

    // Run 2: same rows, no recurring billing.
    seedRecurring(mem, []);
    const fWithoutPercent = forecastMonthEnd(rows);

    // Sanity: the revenue projections are identical between runs (only the
    // billing seed differs). If this fails, something other than billing is
    // mixing into projectedRevenue.
    expect(fWithPercent.projectedRevenue).toBeCloseTo(
      fWithoutPercent.projectedRevenue,
      6,
    );

    // Core assertion: the only mathematical difference is projectedFixedCosts.
    // Post-fix: fWithPercent.projectedFixedCosts = 5% × projectedRev.
    //           fWithoutPercent.projectedFixedCosts = 0.
    // → fWithoutPercent.projectedNet − fWithPercent.projectedNet
    //   = (proj.. − 0) − (proj.. − 5%×rev) = 5% × projectedRev.
    const projectedRev = fWithPercent.projectedRevenue;
    const expectedDiff = 0.05 * projectedRev;
    const actualDiff =
      fWithoutPercent.projectedNet - fWithPercent.projectedNet;
    expect(actualDiff).toBeCloseTo(expectedDiff, 4);

    // Pre-fix pin: actualDiff would have been 0 (both runs identical because
    // billingForRange got no revenue arg → percent row contributed 0 in both).
    // Requiring >$10 guards against the test silently passing pre-fix even on
    // tiny projections (e.g. a 1-day month).
    expect(actualDiff).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// P1 fix 2026-06-04 — forecastMonthEnd must subtract salaries from BOTH the
// month-to-date net AND the projected month-end net, matching the dashboard
// P&L / Home hero (which thread `salariesForRange(...)` into `aggregate`).
// Pre-fix: forecastMonthEnd took no salary settings, so its `monthToDateNet`
// + `projectedNet` were systematically ~salary-amount (default 7% of revenue)
// too HIGH vs the realized P&L net.
//
// Strategy: run forecastMonthEnd twice on identical rows — once WITH a salary
// settings object, once WITHOUT (legacy call). The delta isolates the salary
// effect. Pre-fix delta = 0 (the param didn't exist / was ignored).
// ---------------------------------------------------------------------------
describe('forecastMonthEnd subtracts salaries from mtd + projected net (P1 2026-06-04)', () => {
  // PINNED_NOW (top of file) = 2026-05-15 → MTD window is 2026-05-01..05-15.
  function buildRows(): DailyRow[] {
    const today = todayInIsrael(); // 2026-05-15 under fake timers
    const rows: DailyRow[] = [];
    // One MTD day at day 3 of month — OUTSIDE the [today-7..today-1] baseline.
    rows.push(
      row({
        date: today.slice(0, 8) + '03',
        revenue: 10000,
        totalSpend: 1000,
        cogs: 2500,
        hasCogs: true,
      }),
    );
    // Baseline window: 7 days × 1000 rev each (also inside the MTD window since
    // today=15, so today-7..today-1 = days 8..14, all in May).
    for (let d = -7; d <= -1; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000,
          totalSpend: 100,
          cogs: 250,
          hasCogs: true,
        }),
      );
    }
    return rows;
  }

  it('percent salary (7%): projectedNet AND monthToDateNet drop by the salary amount', () => {
    const rows = buildRows();

    const salarySettings: SalarySettings = {
      v: 1,
      default: { kind: 'percent', value: 7 },
      byMonth: {},
    };

    const withSalary = forecastMonthEnd(rows, salarySettings);
    const without = forecastMonthEnd(rows); // legacy call — no salaries

    // Revenue projections must be identical (only the salary arg differs).
    expect(withSalary.projectedRevenue).toBeCloseTo(without.projectedRevenue, 6);
    expect(withSalary.monthToDateRevenue).toBeCloseTo(
      without.monthToDateRevenue,
      6,
    );

    // MTD net drops by 7% × MTD revenue.
    const mtdRev = withSalary.monthToDateRevenue; // 10000 + 7×1000 = 17000
    const expectedMtdSalary = 0.07 * mtdRev;
    expect(without.monthToDateNet - withSalary.monthToDateNet).toBeCloseTo(
      expectedMtdSalary,
      4,
    );

    // Projected net drops by 7% × PROJECTED (month-end) revenue — the percent
    // path scales with the extrapolated revenue.
    const projRev = withSalary.projectedRevenue;
    const expectedProjSalary = 0.07 * projRev;
    expect(without.projectedNet - withSalary.projectedNet).toBeCloseTo(
      expectedProjSalary,
      4,
    );

    // Pre-fix pin: the delta would have been 0 (no salary param). Require a
    // meaningful drop so the test can't silently pass pre-fix.
    expect(without.projectedNet - withSalary.projectedNet).toBeGreaterThan(10);
    expect(without.monthToDateNet - withSalary.monthToDateNet).toBeGreaterThan(
      10,
    );
  });

  it('fixed-amount salary: projectedNet drops by the full monthly amount (per-day → whole month)', () => {
    const rows = buildRows();

    const MONTHLY = 3000;
    const salarySettings: SalarySettings = {
      v: 1,
      default: { kind: 'amount', value: MONTHLY },
      byMonth: {},
    };

    const withSalary = forecastMonthEnd(rows, salarySettings);
    const without = forecastMonthEnd(rows);

    // The projection covers the WHOLE current month, so the fixed-amount path
    // bills the full monthly amount.
    expect(without.projectedNet - withSalary.projectedNet).toBeCloseTo(
      MONTHLY,
      4,
    );

    // MTD net drops by the per-day-allocated amount for the elapsed days:
    // value × (daysOfMonthInRange / daysInMonth). MTD range = 05-01..05-15 =
    // 15 days; May has 31 days → 3000 × 15/31.
    const daysElapsed = withSalary.daysElapsedThisMonth; // 15
    const daysInMonth = daysElapsed + withSalary.daysRemainingThisMonth; // 31
    const expectedMtdSalary = (MONTHLY * daysElapsed) / daysInMonth;
    expect(without.monthToDateNet - withSalary.monthToDateNet).toBeCloseTo(
      expectedMtdSalary,
      4,
    );
  });
});
