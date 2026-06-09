/**
 * aiReportTruePnlMer.test.ts — 2026-06-09
 *
 * Pins two AI-report fidelity fixes from the 2026-06-09 audit:
 *   (B) the store-level ROAS is labeled as MER (blended, includes organic) so
 *       the AI never reads it as a pure ad-ROAS.
 *   (C) when the caller threads the cost breakdown, the summary renders the
 *       true net profit (operating profit MINUS transaction fees, fixed
 *       costs, salaries) — not just `revenue − spend − cogs`.
 */

import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';

const STORE_ID = 'uzoshop';
const STORE_NAME = 'uzoshop';
const RANGE = { from: '2026-05-01', to: '2026-05-31' };

function makeDaily(overrides: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-05-15',
    storeId: STORE_ID,
    storeName: STORE_NAME,
    fbSpend: 100,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 100,
    revenue: 500,
    roas: 5,
    grossProfit: 400,
    cogs: 100,
    netProfit: 300,
    hasCogs: true,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...overrides,
  };
}

/** Grab the summary KPI table block (between '## תקציר ביצועים' and next '##'). */
function summaryBlock(md: string): string {
  const idx = md.indexOf('## תקציר ביצועים');
  if (idx < 0) return '';
  const after = md.slice(idx);
  const next = after.indexOf('\n## ', 1);
  return next > -1 ? after.slice(0, next) : after;
}

describe('aiReport — MER label (Fix B)', () => {
  it('labels the store-level ROAS row as MER (כולל אורגני), never a bare "ROAS משוקלל"', () => {
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [],
      ordersRows: [],
      adsRows: [],
    });
    const block = summaryBlock(md);
    // The KPI row must carry the MER qualifier.
    expect(block).toMatch(/ROAS משוקלל \(MER — כולל אורגני\)/);
    // The top disclaimer must explain MER overstates ad efficiency.
    expect(md).toMatch(/MER/);
    expect(md).toMatch(/מעריך ביתר/);
  });
});

describe('aiReport — true net profit P&L (Fix C)', () => {
  it('renders true-net-profit rows when costs are supplied', () => {
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [],
      ordersRows: [],
      adsRows: [],
      costs: {
        transactionFees: 15,
        fixedCosts: 40,
        salaries: 35,
        trueNetProfit: 210, // operating profit 300 − 15 − 40 − 35
      },
    });
    const block = summaryBlock(md);
    expect(block).toMatch(/עמלות סליקה/);
    expect(block).toMatch(/עלויות קבועות/);
    expect(block).toMatch(/שכר/);
    expect(block).toMatch(/רווח נקי אמיתי/);
    // The bottom-line figure must be the threaded trueNetProfit (CAD 210).
    expect(block).toMatch(/CAD 210/);
    // The operating-profit row must still be present (we ADD, never replace).
    expect(block).toMatch(/רווח תפעולי/);
  });

  it('omits true-net-profit rows entirely when costs are NOT supplied (legacy callers unchanged)', () => {
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [],
      ordersRows: [],
      adsRows: [],
    });
    const block = summaryBlock(md);
    expect(block).not.toMatch(/רווח נקי אמיתי/);
    expect(block).not.toMatch(/עמלות סליקה/);
    // Operating profit still there.
    expect(block).toMatch(/רווח תפעולי/);
  });
});
