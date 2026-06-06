/**
 * aiReportAdState.test.ts — Phase 4 (Ads-off) regression
 *
 * Pins that `generateAiReport` honours `adStateMap` / `storeApplicablePlatforms`:
 *
 *   1. Fully-off store  → ad-performance sections skip / reframe; revenue/
 *      product sections still present.
 *   2. Partially-off store (Meta OFF, Google ON) → off-platform (Meta) campaigns
 *      excluded; on-platform (Google) campaigns and overall ROAS still present.
 *   3. Default (no adStateMap / empty) → identical report to omitting the params
 *      entirely (no regression).
 */

import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';
import type { CampaignRow } from '@/lib/campaigns';
import type { ProductRow } from '@/lib/products';
import type { AdRow } from '@/lib/ads';
import type { AdStateMap, AdPlatform } from '@/lib/adState';

const RANGE = { from: '2026-05-01', to: '2026-05-31' };

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDaily(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 200,
    gaSpend: 100,
    ttSpend: 0,
    totalSpend: 300,
    revenue: 900,
    roas: 3,
    grossProfit: 600,
    cogs: 200,
    netProfit: 400,
    hasCogs: true,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    productId: 'prod-1',
    productTitle: 'Awesome Product',
    units: 10,
    orders: 10,
    revenue: 500,
    netRevenue: 400,
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'camp-meta-1',
    campaignName: 'Meta Campaign Alpha',
    adSetId: 'as-1',
    adSetName: 'AdSet 1',
    spend: 200,
    impressions: 10000,
    clicks: 300,
    conversions: 10,
    conversionValue: 600,
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
    lastLiveTickAt: null,
    ...overrides,
  };
}

function makeAd(overrides: Partial<AdRow> = {}): AdRow {
  return {
    date: '2026-05-15',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'camp-meta-1',
    campaignName: 'Meta Campaign Alpha',
    adSetId: 'as-1',
    adSetName: 'AdSet 1',
    adId: 'ad-1',
    adName: 'Meta Ad Creative One',
    spend: 200,
    impressions: 10000,
    clicks: 300,
    conversions: 10,
    conversionValue: 600,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
    ...overrides,
  };
}

// ── Test 1: Fully-off store ───────────────────────────────────────────────────

describe('aiReport — adStateMap: fully-off store', () => {
  const adStateMap: AdStateMap = {
    'uzoshop:meta': false,
    'uzoshop:google': false,
  };
  const storeApplicablePlatforms: Record<string, AdPlatform[]> = {
    uzoshop: ['meta', 'google'],
  };

  it('omits Meta campaign name from ad-performance sections', () => {
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [makeDaily()],
      productRows: [makeProduct()],
      campaignRows: [makeCampaign({ campaignName: 'Meta Campaign Alpha' })],
      ordersRows: [],
      adsRows: [],
      adStateMap,
      storeApplicablePlatforms,
    });

    // Campaign should NOT appear in top-campaigns table
    expect(md).not.toMatch(/Meta Campaign Alpha/);
  });

  it('still includes revenue/product sections', () => {
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [makeDaily({ revenue: 88888 })],
      productRows: [makeProduct({ productTitle: 'Organic Widget', revenue: 88888 })],
      campaignRows: [makeCampaign()],
      ordersRows: [],
      adsRows: [],
      adStateMap,
      storeApplicablePlatforms,
    });

    // Revenue present (in the summary KPI table)
    expect(md).toMatch(/88,888/);
    // Product section present
    expect(md).toMatch(/Organic Widget/);
  });

  it('omits health-score section when all campaigns are off', () => {
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [makeDaily()],
      productRows: [],
      campaignRows: [makeCampaign({ campaignName: 'Meta Campaign Alpha' })],
      ordersRows: [],
      adsRows: [],
      adStateMap,
      storeApplicablePlatforms,
    });

    // Health-score SECTION HEADER (## prefix) should not appear.
    // NOTE: the AI-prompt section at the bottom references "Campaign Health
    // Score" in prose; test for the markdown section header specifically.
    expect(md).not.toMatch(/^## Campaign Health Score/m);
    // Budget drainers section should not appear
    expect(md).not.toMatch(/^## .*קמפיינים שמבזבזים/m);
  });

  it('omits ad creative drill-down for off campaigns', () => {
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [makeDaily()],
      productRows: [],
      campaignRows: [makeCampaign()],
      ordersRows: [],
      adsRows: [makeAd({ adName: 'Meta Ad Creative One' })],
      adStateMap,
      storeApplicablePlatforms,
    });

    // Ad name should be excluded from creative drill-down
    expect(md).not.toMatch(/Meta Ad Creative One/);
  });
});

// ── Test 2: Partially-off store (Meta OFF, Google ON) ─────────────────────────

describe('aiReport — adStateMap: partially-off store (Meta off, Google on)', () => {
  const adStateMap: AdStateMap = {
    'uzoshop:meta': false,
    // google key absent → defaults ON
  };
  const storeApplicablePlatforms: Record<string, AdPlatform[]> = {
    uzoshop: ['meta', 'google'],
  };

  it('excludes off-platform (Meta) campaigns from campaign sections', () => {
    const campaigns = [
      makeCampaign({
        platform: 'Meta',
        campaignId: 'camp-meta-off',
        campaignName: 'Meta Campaign Off',
        spend: 200,
      }),
      makeCampaign({
        platform: 'Google',
        campaignId: 'camp-google-on',
        campaignName: 'Google Campaign On',
        spend: 150,
      }),
    ];
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [makeDaily()],
      productRows: [],
      campaignRows: campaigns,
      ordersRows: [],
      adsRows: [],
      adStateMap,
      storeApplicablePlatforms,
    });

    // Off-platform campaign must not appear
    expect(md).not.toMatch(/Meta Campaign Off/);
    // On-platform campaign must appear
    expect(md).toMatch(/Google Campaign On/);
  });

  it('still reports the store\'s overall ROAS (daily section untouched)', () => {
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [makeDaily({ revenue: 77777 })],
      productRows: [],
      campaignRows: [
        makeCampaign({ platform: 'Meta', campaignId: 'cm', campaignName: 'Meta Off C', spend: 200 }),
        makeCampaign({ platform: 'Google', campaignId: 'cg', campaignName: 'Google On C', spend: 100 }),
      ],
      ordersRows: [],
      adsRows: [],
      adStateMap,
      storeApplicablePlatforms,
    });

    // Revenue figure should still be present
    expect(md).toMatch(/77,777/);
  });

  it('excludes Meta ad from creative section but keeps Google ad', () => {
    const campaigns = [
      makeCampaign({
        platform: 'Meta',
        campaignId: 'camp-meta-off',
        campaignName: 'Meta Campaign Off',
        spend: 500,
      }),
      makeCampaign({
        platform: 'Google',
        campaignId: 'camp-google-on',
        campaignName: 'Google Campaign On',
        spend: 400,
      }),
    ];
    // For ads, platform is title-case in AdRow
    const ads = [
      makeAd({
        platform: 'Meta',
        campaignId: 'camp-meta-off',
        campaignName: 'Meta Campaign Off',
        adId: 'ad-meta-1',
        adName: 'Meta Creative Off',
        spend: 500,
        impressions: 20000,
        conversions: 12,
        conversionValue: 1000,
      }),
      makeAd({
        platform: 'Google',
        campaignId: 'camp-google-on',
        campaignName: 'Google Campaign On',
        adId: 'ad-google-1',
        adName: 'Google Creative On',
        spend: 400,
        impressions: 15000,
        conversions: 10,
        conversionValue: 800,
      }),
    ];
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [makeDaily()],
      productRows: [],
      campaignRows: campaigns,
      ordersRows: [],
      adsRows: ads,
      adStateMap,
      storeApplicablePlatforms,
    });

    // Meta ad excluded
    expect(md).not.toMatch(/Meta Creative Off/);
    // Google ad included (cross-campaign winners/losers section)
    expect(md).toMatch(/Google Creative On/);
  });
});

// ── Test 3: Default (no adStateMap) → report unchanged ────────────────────────

describe('aiReport — adStateMap: default (no params) keeps all campaigns', () => {
  it('includes all campaigns when adStateMap is not provided', () => {
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [makeDaily()],
      productRows: [],
      campaignRows: [
        makeCampaign({ campaignName: 'Meta Campaign Alpha', platform: 'Meta' }),
        makeCampaign({
          campaignName: 'Google Campaign Beta',
          platform: 'Google',
          campaignId: 'camp-g1',
        }),
      ],
      ordersRows: [],
      adsRows: [],
      // adStateMap intentionally omitted
    });

    expect(md).toMatch(/Meta Campaign Alpha/);
    expect(md).toMatch(/Google Campaign Beta/);
  });

  it('empty adStateMap produces same campaign presence as no adStateMap', () => {
    const withoutMap = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [makeDaily()],
      productRows: [],
      campaignRows: [makeCampaign({ campaignName: 'Campaign ZZZ' })],
      ordersRows: [],
      adsRows: [],
    });

    const withEmptyMap = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [makeDaily()],
      productRows: [],
      campaignRows: [makeCampaign({ campaignName: 'Campaign ZZZ' })],
      ordersRows: [],
      adsRows: [],
      adStateMap: {},
      storeApplicablePlatforms: {},
    });

    // Both should include the campaign
    expect(withoutMap).toMatch(/Campaign ZZZ/);
    expect(withEmptyMap).toMatch(/Campaign ZZZ/);
  });
});

// ── Test 4: Fully-off store WITH historical spend + impressions ───────────────
// Pins the two defects found in Phase 4 review:
//   DEFECT 1 (P1): TikTok deep-dive section leaks when ttSpend>0 but TikTok is OFF.
//   DEFECT 2 (P2): Per-platform CPM section renders header+column-headers (zero
//                  data rows) when historical impressions>0 but all platforms are OFF.

describe('aiReport — adStateMap: fully-off store WITH historical spend+impressions', () => {
  // All 3 platforms are OFF for uzoshop
  const adStateMap: AdStateMap = {
    'uzoshop:meta': false,
    'uzoshop:google': false,
    'uzoshop:tiktok': false,
  };
  const storeApplicablePlatforms: Record<string, AdPlatform[]> = {
    uzoshop: ['meta', 'google', 'tiktok'],
  };

  // daily rows carry real historical spend + impressions
  const historicalDaily = makeDaily({
    fbSpend: 500,
    gaSpend: 300,
    ttSpend: 400,
    totalSpend: 1200,
    revenue: 5000,
    roas: 4.17,
    fbImpressions: 50000,
    gaImpressions: 30000,
    ttImpressions: 20000,
  });

  // campaign rows carry real impressions (so totalImpressions > 0 from raw loop)
  const historicalCampaigns = [
    makeCampaign({
      platform: 'Meta',
      campaignId: 'camp-fb-hist',
      campaignName: 'Meta Historical',
      spend: 500,
      impressions: 50000,
      clicks: 1500,
      conversions: 40,
      conversionValue: 2000,
    }),
    makeCampaign({
      platform: 'Google',
      campaignId: 'camp-ga-hist',
      campaignName: 'Google Historical',
      spend: 300,
      impressions: 30000,
      clicks: 900,
      conversions: 25,
      conversionValue: 1200,
    }),
    makeCampaign({
      platform: 'TikTok',
      campaignId: 'camp-tt-hist',
      campaignName: 'TikTok Historical',
      spend: 400,
      impressions: 20000,
      clicks: 600,
      conversions: 15,
      conversionValue: 800,
    }),
  ];

  it('DEFECT 1 (P1): TikTok deep-dive header is ABSENT when TikTok is off (even with historical ttSpend)', () => {
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [historicalDaily],
      productRows: [makeProduct()],
      campaignRows: historicalCampaigns,
      ordersRows: [],
      adsRows: [],
      adStateMap,
      storeApplicablePlatforms,
    });

    // The TikTok deep-dive section header must NOT appear.
    // Use anchored markdown-header form to avoid matching prose in the AI prompt.
    expect(md).not.toMatch(/^## TikTok — צלילה/m);
    // Also ensure the section content markers are absent
    expect(md).not.toMatch(/^## TikTok\b/m);
  });

  it('DEFECT 2 (P2): per-platform CPM section header is ABSENT when all platforms are off (even with historical impressions)', () => {
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [historicalDaily],
      productRows: [makeProduct()],
      campaignRows: historicalCampaigns,
      ordersRows: [],
      adsRows: [],
      adStateMap,
      storeApplicablePlatforms,
    });

    // The per-platform CPM section header must NOT appear
    expect(md).not.toMatch(/CPM ו-CTR לפי ערוץ/);
    // Neither should the column-header row for that table
    expect(md).not.toMatch(/CPM.*CTR.*הוצאה/);
  });

  it('SANITY: revenue and product sections still present even when all platforms are off', () => {
    const md = generateAiReport({
      storeName: 'uzoshop',
      storeId: 'uzoshop',
      range: RANGE,
      dailyRows: [historicalDaily],
      productRows: [makeProduct({ productTitle: 'Sanity Widget', revenue: 5000 })],
      campaignRows: historicalCampaigns,
      ordersRows: [],
      adsRows: [],
      adStateMap,
      storeApplicablePlatforms,
    });

    // Revenue summary section must still appear
    expect(md).toMatch(/תקציר ביצועים/);
    // Product name must still appear
    expect(md).toMatch(/Sanity Widget/);
  });
});
