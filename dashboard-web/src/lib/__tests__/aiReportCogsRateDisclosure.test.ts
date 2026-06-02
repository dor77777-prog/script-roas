/**
 * aiReportCogsRateDisclosure.test.ts — Phase 1 (2026-06-02).
 *
 * The AI report must DISCLOSE the actual per-store COGS rate (via
 * getCogsRateForStore), not just say "per store" generically. With no
 * env override, the default is 25% → the disclosure names "25%".
 *
 * Additive prose; no math change. Minimal DailyRow fixture (cloned from
 * aiReportProfitLabel.test.ts) so the per-store section renders for one
 * in-scope store ('uzoshop').
 */

import { describe, it, expect } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';

const STORE_ID = 'uzoshop';
const STORE_NAME = 'uzoshop';
const RANGE = { from: '2026-05-01', to: '2026-05-07' };

function makeDaily(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date: '2026-05-01',
    storeId: STORE_ID,
    storeName: STORE_NAME,
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 0,
    revenue: 0,
    roas: 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...overrides,
  };
}

describe('aiReport per-store COGS disclosure (2026-06-02)', () => {
  it('names the actual COGS rate for an in-scope store', () => {
    const daily = [
      makeDaily({
        date: '2026-05-01',
        fbSpend: 1000,
        totalSpend: 1000,
        revenue: 5000,
        roas: 5,
        cogs: 1250,
        hasCogs: true,
        grossProfit: 4000,
      }),
    ];

    const report = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });

    // The default rate (no *_COGS_RATE env) is 0.25 → "25".
    expect(report).toMatch(/COGS[^|]*25%/);
  });
});
