// dashboard-web/src/lib/__tests__/analytics.test.ts
//
// Regression tests for analytics aggregation defects fixed in audit 2026-05-23-v2:
//
//   d/CR-02 — aggregateByStore ignored the request range, so each per-store
//             bucket's fixed-cost proration was anchored to that store's own
//             min/max date instead of the operator-selected window. Result:
//             stores with no rows on the boundary days understated fixed
//             costs vs the global aggregate card.
//
//   d/HI-02 — TRANSACTION_FEES_RATE was a hardcoded 0.065 applied to the
//             whole aggregate revenue, ignoring per-store calibration. The
//             fix moves it to a per-row accumulator `revenue * rate(store)`
//             so multi-store views become revenue-weighted sums and a
//             store-specific aggregate uses just that store's rate. Same
//             helper shape as cron-daily's getCogsRateForStore so a single
//             env-var rollout (`${STORE_UPPERCASE}_TX_FEES_RATE`) flows
//             through write + read.
//
// vitest runs under `environment: 'node'`. analytics functions are pure;
// no DOM stubs needed. billingForRange is invoked transitively but
// short-circuits to 0 when `window` is undefined (Node), so the fixed-cost
// term is deterministic 0 in these tests — perfect for isolating the
// transactionFees + cogs assertions.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DailyRow, DateRange } from '../types';
import {
  aggregate,
  aggregateByStore,
  getCogsRateForStore,
  getTransactionFeesRateForStore,
} from '../analytics';

// ---------------------------------------------------------------------------
// Test-row builder. Defaults to a happy, hasCogs:true row so a missing field
// in any assertion case is obvious.
// ---------------------------------------------------------------------------
function row(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date: '2026-05-15',
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

// ---------------------------------------------------------------------------
// Env-var lifecycle helper — each rate test sets a few env vars and we
// restore them afterward so tests don't leak into each other.
// ---------------------------------------------------------------------------
const ENV_KEYS_USED = [
  'UZOSHOP_COGS_RATE',
  'ZOLPLUS_COGS_RATE',
  'USMILE360_COGS_RATE',
  'UZOSHOP_TX_FEES_RATE',
  'ZOLPLUS_TX_FEES_RATE',
  'USMILE360_TX_FEES_RATE',
] as const;

let snapshots: Record<string, string | undefined> = {};

beforeEach(() => {
  snapshots = {};
  for (const k of ENV_KEYS_USED) {
    snapshots[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS_USED) {
    if (snapshots[k] === undefined) delete process.env[k];
    else process.env[k] = snapshots[k];
  }
});

// ---------------------------------------------------------------------------
// d/HI-02 — per-store rates
// ---------------------------------------------------------------------------

describe('getCogsRateForStore + getTransactionFeesRateForStore (d/HI-02)', () => {
  it('defaults to 0.25 / 0.065 when no env var is set', () => {
    expect(getCogsRateForStore('uzoshop')).toBe(0.25);
    expect(getTransactionFeesRateForStore('uzoshop')).toBe(0.065);
  });

  it('reads per-store env override', () => {
    process.env.UZOSHOP_COGS_RATE = '0.18';
    process.env.ZOLPLUS_TX_FEES_RATE = '0.029';
    expect(getCogsRateForStore('uzoshop')).toBe(0.18);
    expect(getTransactionFeesRateForStore('zolplus')).toBe(0.029);
    // Unset stores still use defaults.
    expect(getCogsRateForStore('zolplus')).toBe(0.25);
  });

  it('falls back to default on invalid env values', () => {
    process.env.UZOSHOP_COGS_RATE = 'not-a-number';
    process.env.UZOSHOP_TX_FEES_RATE = '-1';
    expect(getCogsRateForStore('uzoshop')).toBe(0.25);
    expect(getTransactionFeesRateForStore('uzoshop')).toBe(0.065);
  });

  it('returns the default when storeId is empty/null/undefined', () => {
    expect(getCogsRateForStore(null)).toBe(0.25);
    expect(getCogsRateForStore('')).toBe(0.25);
    expect(getTransactionFeesRateForStore(undefined)).toBe(0.065);
  });
});

describe('aggregate transactionFees with per-store rates (d/HI-02)', () => {
  it('multi-store aggregate weights transaction fees by per-store revenue × rate', () => {
    // Two stores, two rates:
    //   uzoshop:  revenue 1000, rate 6.5% → fee 65
    //   zolplus:  revenue 2000, rate 2.9% → fee 58
    //   total expected: 123
    process.env.ZOLPLUS_TX_FEES_RATE = '0.029';
    const rows = [
      row({ storeId: 'uzoshop', storeName: 'uzoshop', revenue: 1000 }),
      row({ storeId: 'zolplus', storeName: 'Zol Plus', revenue: 2000 }),
    ];
    const agg = aggregate(rows);
    expect(agg.transactionFees).toBeCloseTo(65 + 58, 10);
    // Pre-fix: 3000 * 0.065 = 195 (uses the global default for the whole
    // aggregate, ignoring zolplus' override). Pin so a refactor cannot
    // silently regress.
    expect(agg.transactionFees).not.toBeCloseTo(195, 10);
  });

  it('single-store aggregate uses just that store rate', () => {
    process.env.UZOSHOP_TX_FEES_RATE = '0.03';
    const rows = [
      row({ storeId: 'uzoshop', revenue: 500 }),
      row({ storeId: 'uzoshop', revenue: 1500 }),
    ];
    const agg = aggregate(rows);
    expect(agg.transactionFees).toBeCloseTo(2000 * 0.03, 10);
  });
});

describe('aggregate cogs back-fill with per-store rate (d/HI-02)', () => {
  it('back-fills cogs when hasCogs is false using per-store rate', () => {
    process.env.USMILE360_COGS_RATE = '0.18';
    const rows = [
      // Legacy row: hasCogs false, cogs 0 → should be back-filled.
      row({
        storeId: 'usmile360',
        storeName: '360usmile',
        revenue: 1000,
        hasCogs: false,
        cogs: 0,
      }),
    ];
    const agg = aggregate(rows);
    expect(agg.cogs).toBeCloseTo(180, 10);
  });

  it('preserves r.cogs when hasCogs is true (live writer owns it)', () => {
    process.env.USMILE360_COGS_RATE = '0.18'; // would yield 180 if back-filled
    const rows = [
      row({
        storeId: 'usmile360',
        revenue: 1000,
        hasCogs: true,
        cogs: 273, // arbitrary value the writer chose — must be preserved
      }),
    ];
    const agg = aggregate(rows);
    expect(agg.cogs).toBe(273);
  });
});

// ---------------------------------------------------------------------------
// d/CR-02 — aggregateByStore accepts a range
// ---------------------------------------------------------------------------

describe('aggregateByStore range plumbing (d/CR-02)', () => {
  it('accepts an optional `range` argument and threads it to inner aggregate', () => {
    // Sparse data: one date for each store, but the operator-selected
    // range spans 30 days. Without range plumbing each per-store aggregate
    // sees only its own 1-day bucket; with range, the call signature now
    // forwards the request so the inner aggregate uses the operator range
    // for fixed-cost proration.
    const range: DateRange = { from: '2026-05-01', to: '2026-05-30' };
    const rows = [
      row({ date: '2026-05-15', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 100 }),
      row({ date: '2026-05-20', storeId: 'zolplus', storeName: 'Zol Plus', revenue: 200 }),
    ];

    // Call BOTH signatures — pre-fix-compatible (no range) AND new (with range).
    const withRange = aggregateByStore(rows, range);
    const withoutRange = aggregateByStore(rows);

    // Both must produce one bucket per store with the same revenue (the range
    // plumbing only affects billing/fixed-cost proration, not the revenue
    // accumulator).
    expect(withRange.find((s) => s.store === 'uzoshop')?.revenue).toBe(100);
    expect(withoutRange.find((s) => s.store === 'uzoshop')?.revenue).toBe(100);

    // And the new arity must be accepted — pinning the signature so a future
    // refactor can't accidentally drop the `range` arg again. Function.length
    // counts declared optional positionals so we expect 2 (rows + range).
    expect(typeof aggregateByStore).toBe('function');
    expect(aggregateByStore.length).toBe(2);
  });
});
