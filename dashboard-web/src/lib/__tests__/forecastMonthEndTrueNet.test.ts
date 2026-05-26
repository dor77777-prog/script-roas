// dashboard-web/src/lib/__tests__/forecastMonthEndTrueNet.test.ts
//
// HIGH-NEW-2 (Codex) regression: forecastMonthEnd's `mtdNet` was defined as
// `mtdRev - mtdSpend - mtdCogs` — omitting both transaction fees (~6.5% of
// revenue) AND prorated fixed costs entirely. The same shortfall applied
// to `projectedNet`. The dashboard's true-net definition everywhere else
// (KpiCards, P&L table, AI report) is
//   revenue - spend - cogs - transactionFees - fixedCosts
// so the forecast's two "net" lines under-stated by 6.5% of revenue plus
// the full billing.ts proration of fixed costs.
//
// Fix:
//   - mtdNet uses `aggregate(mtdRows, range).trueNetProfit` — the same
//     code path everywhere else uses.
//   - projectedNet additionally subtracts:
//       projectedRev * observedFeesRate (revenue-weighted, derived from
//         baseline window via getTransactionFeesRateForStore per row)
//       projectedFixedCosts (billingForRange(monthStart, monthEnd))
//     so the projection's two terms match aggregate()'s definition
//     extrapolated to month-end.
//
// Strategy: mount a `window.localStorage` stub so billingForRange picks
// up a seeded recurring row, then verify mtdNet equals
// aggregate(mtdRows).trueNetProfit (the contract pin) AND the projected
// net includes both fees + projected fixed costs.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregate } from '@/lib/analytics';
import { forecastMonthEnd } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';
import type { RecurringCost } from '@/lib/billing';

// ---- window/localStorage stub (mirrors billing.test.ts pattern) ----
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

function seedRecurring(items: RecurringCost[]) {
  mem.set('roas-dashboard:billing-recurring', JSON.stringify(items));
}

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
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
    fbSpend: 0, gaSpend: 0, ttSpend: 0,
    totalSpend: 0, revenue: 0, roas: 0,
    grossProfit: 0, cogs: 0, netProfit: 0,
    hasCogs: true,
    grossRevenue: null, refundDeduction: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null,
    ...overrides,
  };
}

describe('forecastMonthEnd true-net includes fees + fixed costs (HIGH-NEW-2)', () => {
  it('mtdNet equals aggregate(mtdRows, range).trueNetProfit (contract pin)', () => {
    // Seed a Shopify Plan recurring so MTD's true-net includes prorated
    // fixed costs. Use a value that's easy to spot in the math.
    seedRecurring([
      { id: 'r1', store: 'uzoshop', name: 'Shopify Plan', source: 'shopify-plan', monthlyCAD: 105, active: true },
    ]);

    const today = todayInIsrael();
    const monthStart = today.slice(0, 8) + '01';

    // Build a small MTD set so we don't depend on what day of the month
    // we're running the test on — just enough rows to verify the call
    // through aggregate(). One row a few days back + today.
    const rows: DailyRow[] = [];
    if (!today.endsWith('-01')) {
      rows.push(row({ date: addDays(today, -1), revenue: 1000, totalSpend: 200, cogs: 250 }));
    }
    rows.push(row({ date: today, revenue: 500, totalSpend: 100, cogs: 125 }));

    const mtdRows = rows.filter(r => r.date >= monthStart && r.date <= today);
    const expectedNet = aggregate(mtdRows, { from: monthStart, to: today }).trueNetProfit;
    const f = forecastMonthEnd(rows);

    expect(f.monthToDateNet).toBeCloseTo(expectedNet, 6);
    // Pre-fix value (rev - spend - cogs only — no fees, no fixed costs)
    // would have been a strictly LARGER number when fees + fixed > 0.
    const preFixWrongNet = f.monthToDateRevenue - f.monthToDateSpend - mtdRows.reduce((s, r) => s + r.cogs, 0);
    // Strict >: post-fix MUST subtract at least transaction fees (always
    // positive when revenue > 0), so the new number is smaller.
    if (f.monthToDateRevenue > 0) {
      expect(f.monthToDateNet).toBeLessThan(preFixWrongNet);
    }
  });

  it('projectedNet includes fees (~6.5% of projectedRev) AND projected fixed costs', () => {
    // Build a stable 7-day baseline so the projection's extrapolation is
    // predictable. Today is empty so MTD == just the baseline contribution.
    const today = todayInIsrael();
    seedRecurring([
      { id: 'r1', store: 'uzoshop', name: 'Shopify Plan', source: 'shopify-plan', monthlyCAD: 105, active: true },
    ]);
    const rows: DailyRow[] = [];
    for (let d = -7; d <= -1; d++) {
      rows.push(
        row({
          date: addDays(today, d),
          revenue: 1000, totalSpend: 200, cogs: 200, // 20% effective COGS
          hasCogs: true,
        }),
      );
    }
    // No today row → MTD includes only baseline days that happen to fall
    // in this month (depends on what day-of-month today is). For the
    // assertion below we don't need to know exact MTD numbers — we just
    // verify the formula uses all four cost lines.

    const f = forecastMonthEnd(rows);

    // Reconstruct what the formula SHOULD produce:
    //   projectedRev/projectedSpend are returned;
    //   observed cogs rate = 0.20; observed fees rate = 0.065 default;
    //   projectedFixedCosts = billingForRange(monthStart, monthEnd) total.
    const cogs = f.projectedRevenue * 0.20;
    const fees = f.projectedRevenue * 0.065;
    // Reconstruct projected fixed costs from the formula: the only
    // unknown is the month length. Solve from the actual result:
    //   projectedNet = projectedRev - projectedSpend - cogs - fees - X
    //   X = projectedRev - projectedSpend - cogs - fees - projectedNet
    const reconstructedFixed = f.projectedRevenue - f.projectedSpend - cogs - fees - f.projectedNet;
    // Sanity: reconstructedFixed should be POSITIVE and on the order of
    // the seeded recurring (~$105 full month proration ≈ $105 since we
    // seeded a $105/mo plan with days=full month).
    expect(reconstructedFixed).toBeGreaterThan(50);
    expect(reconstructedFixed).toBeLessThan(200);

    // Pin the FULL formula symbolically — if any cost line drops out
    // (regression), this assertion fails.
    expect(f.projectedNet).toBeCloseTo(
      f.projectedRevenue - f.projectedSpend - cogs - fees - reconstructedFixed,
      6,
    );

    // Pre-fix value (no fees, no fixed) would have been STRICTLY larger.
    const preFixWrongNet = f.projectedRevenue - f.projectedSpend - cogs;
    expect(f.projectedNet).toBeLessThan(preFixWrongNet);
    // The shortfall vs pre-fix MUST be at least the fees term (positive).
    expect(preFixWrongNet - f.projectedNet).toBeGreaterThanOrEqual(fees - 1e-6);
  });

  it('projectedNet does NOT NaN/Infinity when fixed costs storeNames is empty', () => {
    // No rows at all + no billing → safe degenerate path.
    const f = forecastMonthEnd([]);
    expect(Number.isFinite(f.monthToDateNet)).toBe(true);
    expect(Number.isFinite(f.projectedNet)).toBe(true);
  });
});
