import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';
import type { ProductRow } from '@/lib/products';
import type { CampaignRow } from '@/lib/campaigns';

/**
 * Audit fix 2026-05-23 (a/WARN-4) — locks the storeId-based filter.
 *
 * Pre-fix the report used `storeName` for row filtering. The storeName
 * is a DISPLAY string (e.g. "Zol Plus") while every row also carries a
 * canonical storeId (e.g. "zolplus"). If the operator-visible display
 * name ever diverged from the storeName the data was being filtered on,
 * the report would silently exclude rows that belonged to the chosen
 * store. The fix threads storeId through `generateAiReport` so the
 * filter uses the stable internal id.
 *
 * These tests pin:
 *   - When storeId is provided, rows are filtered by storeId (not name).
 *   - When storeId is not provided, the legacy storeName filter still
 *     works (back-compat).
 *   - 'All' bypasses both filters.
 */

function makeDaily(overrides: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-05-20',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 100,
    gaSpend: 50,
    ttSpend: 0,
    totalSpend: 150,
    revenue: 600,
    roas: 4,
    grossProfit: 450,
    cogs: 150,
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

function makeProduct(overrides: Partial<ProductRow>): ProductRow {
  return {
    date: '2026-05-20',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    productId: 'p1',
    productTitle: 'Product 1',
    units: 1,
    orders: 1,
    revenue: 100,
    netRevenue: 80,
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<CampaignRow>): CampaignRow {
  return {
    date: '2026-05-20',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'Campaign 1',
    adSetId: 'as1',
    adSetName: 'AdSet 1',
    spend: 50,
    impressions: 1000,
    clicks: 50,
    conversions: 5,
    conversionValue: 200,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: 'ACTIVE',
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
    ...overrides,
  };
}

describe('generateAiReport — a/WARN-4 storeId vs storeName', () => {
  const range = { from: '2026-05-01', to: '2026-05-31' };

  // Use distinctive revenue values that won't collide with the report's
  // other KPI numbers (impressions, clicks, CPM, etc.). 7,777 and 3,333
  // are large enough they could only come from the daily revenue path.
  const ZOL_REVENUE = 7777;
  const UZO_REVENUE = 3333;
  const TOTAL_REVENUE = ZOL_REVENUE + UZO_REVENUE; // 11110

  it('uses storeId for filtering when provided (rows with mismatched storeName still match)', () => {
    // Build rows where storeName is "zol-display-renamed" but storeId
    // remains "zolplus" — simulates the operator renaming the display.
    const daily = [
      makeDaily({ storeId: 'zolplus', storeName: 'zol-display-renamed', revenue: ZOL_REVENUE }),
      makeDaily({ storeId: 'uzoshop', storeName: 'uzoshop', revenue: UZO_REVENUE }),
    ];
    const products = [
      makeProduct({ storeId: 'zolplus', storeName: 'zol-display-renamed', productId: 'zolp1' }),
    ];
    const campaigns = [
      makeCampaign({ storeId: 'zolplus', storeName: 'zol-display-renamed', campaignId: 'zol-c1' }),
    ];
    const md = generateAiReport({
      storeName: 'Zol Plus', // the legacy/expected display name
      storeId: 'zolplus',    // the stable canonical id
      range,
      dailyRows: daily,
      productRows: products,
      campaignRows: campaigns,
    });
    // The report should include the zolplus revenue 7777 because the
    // filter uses storeId, not storeName.
    expect(md).toMatch(/7,777/);
    // The uzoshop revenue should be excluded — 3333 not present.
    expect(md).not.toMatch(/3,333/);
  });

  it('falls back to storeName filtering when storeId is null (back-compat)', () => {
    const daily = [
      makeDaily({ storeId: 'zolplus', storeName: 'Zol Plus', revenue: ZOL_REVENUE }),
      makeDaily({ storeId: 'uzoshop', storeName: 'uzoshop', revenue: UZO_REVENUE }),
    ];
    const md = generateAiReport({
      storeName: 'Zol Plus',
      // storeId omitted intentionally
      range,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });
    // Filter by storeName works → zolplus included, uzoshop excluded.
    expect(md).toMatch(/7,777/);
    expect(md).not.toMatch(/3,333/);
  });

  it("'All' bypasses both filters", () => {
    const daily = [
      makeDaily({ storeId: 'zolplus', storeName: 'Zol Plus', revenue: ZOL_REVENUE }),
      makeDaily({ storeId: 'uzoshop', storeName: 'uzoshop', revenue: UZO_REVENUE }),
    ];
    const md = generateAiReport({
      storeName: 'All',
      storeId: null,
      range,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
    });
    // Both stores included — combined total 11,110.
    expect(md).toMatch(new RegExp(TOTAL_REVENUE.toLocaleString('en-US')));
  });
});
