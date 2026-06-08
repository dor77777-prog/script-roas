/**
 * aiReportSourceLabels.test.ts — classify-v2 T2.
 *
 * The "תנועה לפי מקור" (Traffic Source Breakdown) table renders each order
 * `source` via a SOURCE_LABEL Hebrew map. After the attribution-classifier
 * v2 expansion (tiktok-organic / search-organic / app-referral, plus
 * email / *-organic), the map must carry a friendly Hebrew label for every
 * new value — otherwise the raw machine string ('tiktok-organic') leaks into
 * the operator-facing report. These tests pin the labels.
 */

import { describe, it, expect } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';
import { makeOrder, makeLineItem } from './fixtures';

const STORE_ID = 'uzoshop';
const STORE_NAME = 'uzoshop';
const RANGE = { from: '2026-05-01', to: '2026-05-31' };

function makeDaily(overrides: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-05-15',
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

function reportWithSources(sources: string[]): string {
  const ordersRows = sources.map((source, i) =>
    makeOrder({
      orderId: `o-${source}-${i}`,
      storeId: STORE_ID,
      storeName: STORE_NAME,
      source: source as never,
      totalCad: 100,
      date: '2026-05-15',
      lineItems: [makeLineItem({ productId: 'p-1', revenueCad: 100 })],
    }),
  );
  return generateAiReport({
    storeName: STORE_NAME,
    storeId: STORE_ID,
    range: RANGE,
    dailyRows: [makeDaily({ revenue: 100, totalSpend: 0 })],
    productRows: [],
    campaignRows: [],
    ordersRows,
  });
}

describe('aiReport SOURCE_LABEL — classify-v2 new source values', () => {
  it('renders the Traffic Source Breakdown section', () => {
    const md = reportWithSources(['tiktok-organic']);
    expect(md).toMatch(/תנועה לפי מקור/);
  });

  it('tiktok-organic → "טיקטוק אורגני" (not the raw label)', () => {
    const md = reportWithSources(['tiktok-organic']);
    expect(md).toMatch(/טיקטוק אורגני/);
    // The raw machine label must not appear as a table cell on its own.
    expect(md).not.toMatch(/\| tiktok-organic \|/);
  });

  it('search-organic → "חיפוש אורגני"', () => {
    const md = reportWithSources(['search-organic']);
    expect(md).toMatch(/חיפוש אורגני/);
    expect(md).not.toMatch(/\| search-organic \|/);
  });

  it('app-referral → "הפניה מאפליקציה"', () => {
    const md = reportWithSources(['app-referral']);
    expect(md).toMatch(/הפניה מאפליקציה/);
    expect(md).not.toMatch(/\| app-referral \|/);
  });

  it('email has a Hebrew label (not the raw "email" cell)', () => {
    const md = reportWithSources(['email']);
    expect(md).not.toMatch(/\| email \|/);
  });

  it('tiktok-paid keeps its existing label', () => {
    const md = reportWithSources(['tiktok-paid']);
    expect(md).toMatch(/TikTok \(paid\)/);
  });

  it('all classify-v2 sources together each get a friendly label (no raw leak)', () => {
    const md = reportWithSources([
      'tiktok-organic',
      'search-organic',
      'app-referral',
      'email',
      'meta-organic',
      'google-organic',
    ]);
    for (const raw of ['tiktok-organic', 'search-organic', 'app-referral']) {
      expect(md).not.toMatch(new RegExp(`\\| ${raw} \\|`));
    }
    expect(md).toMatch(/טיקטוק אורגני/);
    expect(md).toMatch(/חיפוש אורגני/);
    expect(md).toMatch(/הפניה מאפליקציה/);
  });
});
