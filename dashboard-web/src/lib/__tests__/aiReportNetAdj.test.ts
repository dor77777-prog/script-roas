/**
 * aiReportNetAdj.test.ts — Wave 1 (Trust & Correctness, 2026-06-03), Task 7.
 *
 * The AI report's "תנועה לפי מקור" (revenue-by-source) table sums
 * `orders_attribution.total_cad`, which is the IMMUTABLE GROSS order value at
 * checkout (P0-2 fix 2026-05-28). The headline MER, by contrast, uses
 * `data_daily.revenue_cad` (NET of refunds). So the per-source absolute $
 * figures read high by the period's refund rate, sitting on a different basis
 * than MER.
 *
 * Wave 1 re-bases the DISPLAYED per-source revenue $ (and the grand-total $) by
 * the period's blended net/gross factor (`netAdjustFactor(net, gross)`), so the
 * report's revenue agrees in scale with MER.
 *
 * INVARIANT: the deterministic **coverage %** is a ratio of two revenues
 * (deterministic ÷ grand-total) → the uniform factor cancels → its math MUST be
 * UNCHANGED. The per-source **%** column is likewise a ratio → unchanged.
 *
 * Fixture:
 *   - daily: net 900, gross 1000 → factor 0.9.
 *   - orders: meta-paid (fbclid → deterministic) gross 600;
 *             direct (no signal → NOT deterministic) gross 400.
 *   - grandTotal gross 1000; deterministic gross 600 → coverage 60% (gross
 *     ratio). After net-adj the displayed $ scale by 0.9 but coverage stays 60%.
 */

import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

const STORE_ID = 'uzoshop';
const STORE_NAME = 'uzoshop';
const RANGE = { from: '2026-06-01', to: '2026-06-03' };

function makeDaily(overrides: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-06-02',
    storeId: STORE_ID,
    storeName: STORE_NAME,
    fbSpend: 100,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 100,
    revenue: 900, // net
    roas: 9,
    grossProfit: 800,
    cogs: 100,
    netProfit: 700,
    hasCogs: true,
    grossRevenue: 1000, // gross > net → refunds happened → factor 0.9
    refundDeduction: 100,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...overrides,
  };
}

function makeOrder(overrides: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-06-02',
    storeId: STORE_ID,
    storeName: STORE_NAME,
    orderId: 'o-default',
    totalCad: 100,
    source: 'meta-paid',
    utmSource: 'facebook',
    utmMedium: 'cpc',
    utmCampaign: '',
    utmContent: '',
    fbclidPresent: true,
    gclidPresent: false,
    referringSite: '',
    utmId: '',
    utmTerm: '',
    lineItems: [],
    customerId: 'cust-default',
    orderCreatedAt: '2026-06-02T12:00:00-04:00',
    isFirstOrder: true,
    firstTouchSource: null,
    firstFbclidPresent: false,
    firstGclidPresent: false,
    firstTtclidPresent: false,
    firstUtmSource: null,
    firstUtmMedium: null,
    firstUtmCampaign: null,
    firstUtmContent: null,
    firstUtmId: null,
    firstUtmTerm: null,
    firstSeenAt: null,
    paymentGateway: null,
    ...overrides,
  };
}

/** Rows of the "תנועה לפי מקור" table (markdown `| ` lines in that section). */
function extractSourceTableRows(md: string): string[] {
  const idx = md.indexOf('## תנועה לפי מקור');
  if (idx < 0) return [];
  const after = md.slice(idx + '## תנועה לפי מקור'.length);
  const nextSectionMatch = after.match(/\n## /);
  const section = nextSectionMatch ? after.slice(0, nextSectionMatch.index) : after;
  return section.split('\n').filter(l => l.startsWith('| '));
}

/** The rendered "% deterministic coverage" integer from the prose line. */
function extractDeterministicCoveragePct(md: string): number | null {
  const m = md.match(/\*\*כיסוי deterministic\*\*: (\d+)%/);
  return m ? Number(m[1]) : null;
}

/** Revenue cell ($) for a labelled source data row. Cells: |1 label|2 count|3 %|4 הכנסות|5 AOV|. */
function sourceRevenueCell(rows: string[], label: string): string | null {
  const row = rows.find(r => r.includes(label) && !r.includes('סה"כ'));
  if (!row) return null;
  const cells = row.split('|').map(c => c.trim());
  return cells[4] ?? null;
}

const buildOrders = (): OrderAttributionRow[] => [
  // Deterministic (fbclid) — gross 600.
  makeOrder({ orderId: 'o-meta', source: 'meta-paid', fbclidPresent: true, totalCad: 600 }),
  // NOT deterministic (pure direct, no signal) — gross 400.
  makeOrder({
    orderId: 'o-direct',
    source: 'direct',
    utmSource: '',
    fbclidPresent: false,
    gclidPresent: false,
    utmId: '',
    utmCampaign: '',
    totalCad: 400,
  }),
];

describe('aiReport revenue-by-source — net-adj $ (coverage % untouched)', () => {
  it('re-bases per-source revenue $ by the net/gross factor (0.9): 600 → 540, 400 → 360, total → 900', () => {
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})], // net 900 / gross 1000 → factor 0.9
      productRows: [],
      campaignRows: [],
      ordersRows: buildOrders(),
      adsRows: [],
    });

    const rows = extractSourceTableRows(md);
    expect(rows.length).toBeGreaterThan(0);

    // meta-paid gross 600 × 0.9 = 540 (net-adj displayed $).
    expect(sourceRevenueCell(rows, 'Meta (paid)')).toBe('CAD 540');
    // direct gross 400 × 0.9 = 360.
    expect(sourceRevenueCell(rows, 'ישיר (no UTM)')).toBe('CAD 360');

    // Grand total row gross 1000 × 0.9 = 900.
    const totalRow = rows.find(r => r.includes('סה"כ'));
    expect(totalRow).toBeTruthy();
    expect(totalRow!).toContain('CAD 900');
    // Gross total must NOT leak into the displayed total.
    expect(totalRow!).not.toContain('CAD 1,000');
  });

  it('leaves the deterministic coverage % UNCHANGED (ratio invariant — factor cancels)', () => {
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})], // factor 0.9
      productRows: [],
      campaignRows: [],
      ordersRows: buildOrders(),
      adsRows: [],
    });

    // deterministic gross 600 / grand-total gross 1000 = 60% — NOT 54%.
    // If the coverage math were (wrongly) net-adjusted on only one side it
    // would skew; the factor must cancel, leaving 60% exactly.
    expect(extractDeterministicCoveragePct(md)).toBe(60);
  });

  it('degrades gracefully (factor 1, gross == net) when grossRevenue is missing', () => {
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      // grossRevenue null → netAdjustFactor degrades to factor 1 (no adjustment).
      dailyRows: [makeDaily({ revenue: 1000, grossRevenue: null })],
      productRows: [],
      campaignRows: [],
      ordersRows: buildOrders(),
      adsRows: [],
    });

    const rows = extractSourceTableRows(md);
    // No adjustment → gross $ passes through unchanged.
    expect(sourceRevenueCell(rows, 'Meta (paid)')).toBe('CAD 600');
    expect(sourceRevenueCell(rows, 'ישיר (no UTM)')).toBe('CAD 400');
    expect(extractDeterministicCoveragePct(md)).toBe(60);
  });
});
