// dashboard-web/src/lib/__tests__/kpiCardsSparkDataCogsRate.test.ts
//
// HIGH-7 / O2-HI-04 regression: KpiCards' COGS sparkline was computed as
// `r.revenue * COGS_RATE_OF_REVENUE` (the global 0.25 constant) per day.
// Live rows carry `r.cogs` written by cron-daily / cron-live at the
// per-store ${STORE_UPPERCASE}_COGS_RATE — calibrating Store A at 18% and
// Store B at 30% changes the big-number on the card but the sparkline
// stayed locked at 25%. Result: visual inconsistency between the card's
// own value and its sparkline.
//
// Fix matches the policy in `aggregate()`:
//   - hasCogs:true → use r.cogs verbatim (the writer's per-store value)
//   - hasCogs:false (legacy / pre-migration) → back-fill at the per-store
//     env rate via getCogsRateForStore
//
// vitest runs node so we import the helper directly from KpiCards.tsx.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DailyRow } from '@/lib/types';
import { computeKpiSparkData } from '@/components/KpiCards';

// ---- env-var lifecycle (mirrors analytics.test.ts pattern) ----
const ENV_KEYS_USED = [
  'UZOSHOP_COGS_RATE',
  'ZOLPLUS_COGS_RATE',
  'USMILE360_COGS_RATE',
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
    ...overrides,
  };
}

describe('computeKpiSparkData COGS per-store rate (HIGH-7 / O2-HI-04)', () => {
  it('uses r.cogs verbatim when hasCogs is true (live writer owns the value)', () => {
    // Live row: cron wrote $180 (18% of $1000) using the store's calibrated
    // rate. The sparkline must show 180, NOT 250 (global 0.25 × 1000).
    const series: DailyRow[] = [
      row({ date: '2026-05-15', revenue: 1000, cogs: 180, hasCogs: true }),
    ];
    const spark = computeKpiSparkData(series);
    expect(spark.cogs).toEqual([180]);
    // Pre-fix would have produced 250 (1000 * 0.25). Pin so a refactor
    // can't accidentally regress to the global rate.
    expect(spark.cogs[0]).not.toBe(250);
  });

  it('back-fills at the per-store rate when hasCogs is false (legacy row)', () => {
    process.env.USMILE360_COGS_RATE = '0.18';
    const series: DailyRow[] = [
      row({
        date: '2026-05-15',
        storeId: 'usmile360',
        storeName: '360usmile',
        revenue: 1000,
        cogs: 0,
        hasCogs: false,
      }),
    ];
    const spark = computeKpiSparkData(series);
    // 1000 × 0.18 = 180
    expect(spark.cogs[0]).toBeCloseTo(180, 6);
  });

  it('falls back to the 0.25 default when no env override is set and hasCogs is false', () => {
    // No USMILE360_COGS_RATE in env → getCogsRateForStore returns 0.25.
    const series: DailyRow[] = [
      row({
        date: '2026-05-15',
        storeId: 'usmile360',
        revenue: 1000,
        cogs: 0,
        hasCogs: false,
      }),
    ];
    const spark = computeKpiSparkData(series);
    expect(spark.cogs[0]).toBeCloseTo(250, 6);
  });

  it('mixed series — live row + legacy row + different stores — each uses its own rate', () => {
    process.env.UZOSHOP_COGS_RATE = '0.22';
    process.env.ZOLPLUS_COGS_RATE = '0.30';
    const series: DailyRow[] = [
      // Live uzoshop row: writer-provided cogs (already at 22%).
      row({
        date: '2026-05-15',
        storeId: 'uzoshop',
        storeName: 'uzoshop',
        revenue: 500,
        cogs: 110, // 22%
        hasCogs: true,
      }),
      // Legacy Zol Plus row: back-fill at 30%.
      row({
        date: '2026-05-15',
        storeId: 'zolplus',
        storeName: 'Zol Plus',
        revenue: 1000,
        cogs: 0,
        hasCogs: false,
      }),
    ];
    const spark = computeKpiSparkData(series);
    // Per-day rollup: uzoshop 110 + zolplus (1000*0.30=300) = 410.
    expect(spark.cogs).toEqual([410]);
  });
});
