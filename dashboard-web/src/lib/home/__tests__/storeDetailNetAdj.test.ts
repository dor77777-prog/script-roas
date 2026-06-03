/**
 * Task 5 integration test — the per-store drill-down adapter (`toStoreDetail`)
 * must thread the blended net-adjust factor (cur net ÷ gross) into
 * `computeNewCustomerMetrics`, so NC-ROAS revenue sits on the same NET basis as
 * the headline MER instead of gross order value.
 *
 * Mirrors the plan's `buildStoreDetail` assertion against the real codebase API
 * (`toStoreDetail` / `ToStoreDetailArgs`).
 */

import { describe, it, expect } from 'vitest';
import { toStoreDetail } from '@/lib/home/storeDetail';
import type { StoreAgg } from '@/lib/analytics';
import type { FirstOrderInput } from '@/lib/home/newCustomerMetrics';

/** Minimal StoreAgg factory — only the fields the adapter reads matter. */
function makeAgg(over: Partial<StoreAgg> & { store: string }): StoreAgg {
  return {
    revenue: 0,
    grossRevenue: 0,
    spend: 0,
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    roas: 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    transactionFees: 0,
    fixedCosts: 0,
    salaries: 0,
    storeCount: 1,
    daysCovered: 0,
    trueNetProfit: 0,
    trueMargin: 0,
    rowCount: 0,
    ...over,
  };
}

describe('toStoreDetail — passes net-adj factor into NC-ROAS', () => {
  it('NC-ROAS revenue is re-based by cur net/gross', () => {
    // cur: net 900, gross 1000 (refund day) → factor 0.9; spend 100.
    const cur = makeAgg({ store: 'uzoshop', revenue: 900, grossRevenue: 1000, spend: 100, cogs: 250, roas: 9 });
    const firstOrderRows: FirstOrderInput[] = [
      { storeName: 'uzoshop', totalCad: 100, isFirstOrder: true },
    ];
    const d = toStoreDetail({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      cur,
      prev: null,
      series: [],
      campaignRows: [],
      range: { from: '2026-06-01', to: '2026-06-03' },
      orders: 1,
      prevOrders: null,
      updatedAt: null,
      firstOrderRows,
    });
    // gross nc revenue 100 * (900/1000)=0.9 → 90 net; spend 100 → ncRoas 0.9
    expect(d.newCustomer.ncRevenue).toBeCloseTo(90);
    expect(d.newCustomer.ncRoas).toBeCloseTo(0.9);
  });
});
