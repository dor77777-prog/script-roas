/**
 * aiReportTodayPending.test.ts — 2026-06-09 (Task 13)
 *
 * A TODAY row with spend but revenue=0 is the intraday reporting lag — the
 * report must label it "מתעדכן", not the alarming "0 (FAILED)" (reserved for a
 * genuinely failed PAST day).
 */
import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import { getTodayInIsraelTz } from '@/lib/dateRange';
import type { DailyRow } from '@/lib/types';

const STORE_ID = 'uzoshop';
const STORE_NAME = 'uzoshop';

function dailyRow(date: string): DailyRow {
  return {
    date, storeId: STORE_ID, storeName: STORE_NAME,
    fbSpend: 80, gaSpend: 0, ttSpend: 0, totalSpend: 80,
    revenue: 0, roas: 0, grossProfit: -80, cogs: 0, netProfit: -80,
    hasCogs: true, grossRevenue: 0, refundDeduction: null,
    fbImpressions: null, gaImpressions: null, ttImpressions: null,
  };
}

describe('aiReport daily breakdown — today spend>0/revenue=0', () => {
  it('labels a TODAY row "מתעדכן" (not "0 (FAILED)")', () => {
    const today = getTodayInIsraelTz();
    const md = generateAiReport({
      storeName: STORE_NAME, storeId: STORE_ID,
      range: { from: today, to: today },
      dailyRows: [dailyRow(today)],
      productRows: [], campaignRows: [], ordersRows: [], adsRows: [],
    });
    // The sole (today) row renders "מתעדכן" and is NOT tagged as a failure.
    expect(md).toContain('מתעדכן');
    expect(md).not.toContain('0 (FAILED)');
  });

  it('still labels a PAST spend>0/revenue=0 row "0 (FAILED)" (not "מתעדכן")', () => {
    const past = '2026-05-01';
    const md = generateAiReport({
      storeName: STORE_NAME, storeId: STORE_ID,
      range: { from: past, to: past },
      dailyRows: [dailyRow(past)],
      productRows: [], campaignRows: [], ordersRows: [], adsRows: [],
    });
    expect(md).toContain('0 (FAILED)');
    expect(md).not.toContain('מתעדכן');
  });
});
