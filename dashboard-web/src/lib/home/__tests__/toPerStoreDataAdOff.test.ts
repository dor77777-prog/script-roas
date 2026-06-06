// dashboard-web/src/lib/home/__tests__/toPerStoreDataAdOff.test.ts
//
// Task 4 — ads-off Phase 2: toPerStoreData computes per-store adOff boolean.
//
// Guards the contract: when ALL of a store's applicable platforms are toggled
// off in adStateMap, the returned PerStoreData carries `adOff === true`.
// Empty/partial maps ⇒ adOff false (default ON semantics, back-compat).

import { describe, expect, it } from 'vitest';
import { toPerStoreData } from '../adapters';
import type { Aggregate, StoreAgg } from '@/lib/analytics';
import type { AdStateMap, AdPlatform } from '@/lib/adState';

const EMPTY_AGG: Aggregate = {
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
  storeCount: 0,
  daysCovered: 0,
  trueNetProfit: 0,
  trueMargin: 0,
  rowCount: 0,
};

function storeAgg(store: string, overrides: Partial<Aggregate> = {}): StoreAgg {
  return { ...EMPTY_AGG, ...overrides, store };
}

const RANGE = { from: '2026-06-01', to: '2026-06-06' };

describe('toPerStoreData — adOff (ads-off Phase 2)', () => {
  it('sets adOff=true when ALL applicable platforms are explicitly false in adStateMap', () => {
    const storeAggs: StoreAgg[] = [storeAgg('uzoshop', { revenue: 5000, spend: 0, roas: 0 })];
    const adStateMap: AdStateMap = {
      'uzoshop:meta': false,
      'uzoshop:google': false,
    };
    const storeApplicablePlatforms: Record<string, AdPlatform[]> = {
      uzoshop: ['meta', 'google'],
    };

    const result = toPerStoreData(
      storeAggs,
      [],
      RANGE,
      {},
      {},
      null,
      undefined,
      undefined,
      adStateMap,
      storeApplicablePlatforms,
    );

    expect(result).toHaveLength(1);
    expect(result[0].adOff).toBe(true);
  });

  it('sets adOff=false when adStateMap is empty (default ON — missing key ⇒ enabled)', () => {
    const storeAggs: StoreAgg[] = [storeAgg('uzoshop', { revenue: 5000, spend: 1500, roas: 3.3 })];
    const adStateMap: AdStateMap = {};
    const storeApplicablePlatforms: Record<string, AdPlatform[]> = {
      uzoshop: ['meta', 'google'],
    };

    const result = toPerStoreData(
      storeAggs,
      [],
      RANGE,
      {},
      {},
      null,
      undefined,
      undefined,
      adStateMap,
      storeApplicablePlatforms,
    );

    expect(result[0].adOff).toBe(false);
  });

  it('sets adOff=false when only ONE of two platforms is off (partial off = still advertising)', () => {
    const storeAggs: StoreAgg[] = [storeAgg('uzoshop', { revenue: 2500, spend: 750, roas: 3.3 })];
    const adStateMap: AdStateMap = {
      'uzoshop:meta': false,
      // google not present ⇒ ON
    };
    const storeApplicablePlatforms: Record<string, AdPlatform[]> = {
      uzoshop: ['meta', 'google'],
    };

    const result = toPerStoreData(
      storeAggs,
      [],
      RANGE,
      {},
      {},
      null,
      undefined,
      undefined,
      adStateMap,
      storeApplicablePlatforms,
    );

    expect(result[0].adOff).toBe(false);
  });

  it('sets adOff=false when both args are omitted (back-compat: no behavior change)', () => {
    const storeAggs: StoreAgg[] = [storeAgg('uzoshop', { revenue: 5000, spend: 1500, roas: 3.3 })];

    // Call WITHOUT the two new trailing args — must still compile + return false
    const result = toPerStoreData(
      storeAggs,
      [],
      RANGE,
      {},
      {},
    );

    expect(result[0].adOff).toBe(false);
  });
});
