/**
 * aiReportCoverageHalo.test.ts — AUDIT regression (Phase 12.2.1 / 2026-05-24)
 *
 * Pins ALG-07 from `.planning/AUDIT.md` §Phase 12.2 — the Health Score
 * deterministic-coverage feed in `aiReport.ts` clamped coverage to 1:
 *
 *   const coverage = c.value > 0 ? Math.min(1, det / c.value) : det > 0 ? 1 : 0;
 *                                  ^^^^^^^^^^                ^^^^^
 *
 * Effect on halo cases (Shopify deterministic revenue exceeds platform-
 * reported conversion_value — pixel down, ad-blocker storm, ATT opt-out
 * spike):
 *   - The raw ratio (e.g. 2.0 = det 100 / claim 50) was capped to 1.0,
 *     so the trustScore stuck at 100 ceiling, identical to the
 *     "perfect match" det=50/c.value=50 case.
 *   - Operator lost the halo signal — the U-05 halo-warning chip's
 *     input was always clipped to the ceiling and never triggered.
 *
 * Symmetry: per AUDIT U-05, `attributionAnalysis.computeCoverage` (commit
 * b846ae7) already removed the equivalent upper clamp. This test pins
 * aiReport.ts onto the same "halo is operator-visible signal" semantic.
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/lib_algorithm_aiReport.json
 *     (ALG-07 lines 68-75 — failing_input + fix_sketch)
 *
 * Rendering note: aiReport does NOT export the `coverage` variable
 * directly. We assert the differential by reading the rendered Health
 * Score table's `Attribution` column (the 9th cell in the row,
 * `comp.attributionClarity` per aiReport.ts:1314). Pre-fix, both
 * halo (det=100, claim=50) and baseline (det=50, claim=50) campaigns
 * yielded the same attributionClarity value because both coverages
 * were clamped to 1. Post-fix, the halo campaign yields a HIGHER
 * attributionClarity than the baseline because coverage exceeds 1.
 */

import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';
import type { CampaignRow } from '@/lib/campaigns';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

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
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<CampaignRow>): CampaignRow {
  return {
    date: '2026-05-15',
    storeId: STORE_ID,
    storeName: STORE_NAME,
    platform: 'Meta',
    campaignId: 'm-c1',
    campaignName: 'Meta Brand',
    adSetId: 'm-as1',
    adSetName: 'AdSet 1',
    spend: 100,
    impressions: 5000,
    clicks: 200,
    conversions: 5,
    conversionValue: 50, // claim
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: 'ACTIVE',
    ...overrides,
  };
}

function makeOrder(overrides: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-05-15',
    storeId: STORE_ID,
    storeName: STORE_NAME,
    orderId: 'o-default',
    totalCad: 100,
    source: 'meta-paid',
    utmSource: 'facebook',
    utmMedium: 'cpc',
    utmCampaign: 'Meta Brand',
    utmContent: '',
    fbclidPresent: true,
    gclidPresent: false,
    referringSite: '',
    utmId: 'm-c1',
    utmTerm: '',
    lineItems: [],
    ...overrides,
  };
}

/**
 * Extract a Health Score row by campaign name. Returns the raw markdown
 * line; caller can split on `|` to grab the Attribution column (cell 9
 * counting from 1 — after name/platform/store/spend/score/profitability/
 * volume/momentum).
 */
function extractHealthRow(md: string, campaignName: string): string | null {
  const idx = md.indexOf('Campaign Health Score');
  if (idx < 0) return null;
  const after = md.slice(idx);
  const nextSectionMatch = after.match(/\n## /);
  const section = nextSectionMatch
    ? after.slice(0, nextSectionMatch.index)
    : after;
  for (const line of section.split('\n')) {
    if (line.startsWith('| ') && line.includes(campaignName)) {
      return line;
    }
  }
  return null;
}

/**
 * Parse the `attributionClarity` cell from a Health Score row. Columns per
 * aiReport.ts:1297 header:
 *   | קמפיין | פלטפ׳ | חנות | הוצאה | ציון | רווחיות | נפח | מומנטום | Attribution | אופ׳ | סטטוס |
 * Splitting on `|` yields: ['', name, platform, store, spend, score,
 * profitability, volume, momentum, attribution, opAdj, status, ''].
 * Attribution is index 9.
 */
function attributionCell(row: string): number {
  const cells = row.split('|').map(c => c.trim());
  const cell = cells[9];
  return Number(cell);
}

describe('aiReport coverage clamp removal (Phase 12.2.1 — ALG-07)', () => {
  // ---------- Test 1: Halo case — det >> claim — coverage unclamped ----------
  it('halo case (det=100, claim=50) yields HIGHER attributionClarity than baseline (det=50, claim=50)', () => {
    // Two Meta campaigns with the same claim (conversionValue=50) but
    // different deterministic Shopify revenue:
    //   - Halo:    1 order of 100 CAD matched (utmId='m-halo')
    //   - Match:   1 order of 50 CAD matched (utmId='m-match')
    //
    // Pre-fix: both coverages clamped to 1.0 → both trustScores = 100 →
    //   both attributionClarity values IDENTICAL.
    // Post-fix: halo coverage = 2.0 → trustScore = 200 →
    //   attributionClarity feed exceeds the baseline's, surfacing the
    //   halo signal that the U-05 chip needs.
    const daily: DailyRow[] = [makeDaily({})];
    const campaigns: CampaignRow[] = [
      makeCampaign({
        campaignId: 'm-halo', campaignName: 'Meta Halo',
        adSetId: 'as-halo', conversionValue: 50, spend: 100,
      }),
      makeCampaign({
        campaignId: 'm-match', campaignName: 'Meta Match',
        adSetId: 'as-match', conversionValue: 50, spend: 100,
      }),
    ];
    const orders: OrderAttributionRow[] = [
      makeOrder({ orderId: 'o-halo', utmId: 'm-halo', utmCampaign: 'Meta Halo', totalCad: 100 }),
      makeOrder({ orderId: 'o-match', utmId: 'm-match', utmCampaign: 'Meta Match', totalCad: 50 }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
      ordersRows: orders,
      adsRows: [],
    });

    const haloRow = extractHealthRow(md, 'Meta Halo');
    const matchRow = extractHealthRow(md, 'Meta Match');
    expect(haloRow).toBeTruthy();
    expect(matchRow).toBeTruthy();

    const haloAttr = attributionCell(haloRow!);
    const matchAttr = attributionCell(matchRow!);

    // Both must be valid numbers (sanity).
    expect(Number.isFinite(haloAttr)).toBe(true);
    expect(Number.isFinite(matchAttr)).toBe(true);

    // The differential is the pin: pre-fix Math.min(1, det/c.value)
    // clamps the halo to 1.0 → identical attributionClarity values
    // → differential = 0. Post-fix, halo coverage is 2.0 (unclamped)
    // → trustScore=200 → attributionClarity exceeds the match case.
    expect(haloAttr).toBeGreaterThan(matchAttr);
  });

  // ---------- Test 2: Normal case — det < claim — behavior unchanged ----------
  it('normal under-report (det=50, claim=100) — coverage stays <= 1, attributionClarity reflects partial coverage', () => {
    // Meta over-reports (claim 100, det 50). Coverage = 0.5 in both
    // pre-fix and post-fix code paths (the only difference is the
    // clamp; 0.5 was never clamped). Asserts post-fix behavior is
    // unchanged in the non-halo direction.
    const daily: DailyRow[] = [makeDaily({})];
    const campaigns: CampaignRow[] = [
      makeCampaign({
        campaignId: 'm-under', campaignName: 'Meta UnderReport',
        adSetId: 'as-under', conversionValue: 100, spend: 100,
      }),
    ];
    const orders: OrderAttributionRow[] = [
      makeOrder({ orderId: 'o-under', utmId: 'm-under', utmCampaign: 'Meta UnderReport', totalCad: 50 }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
      ordersRows: orders,
      adsRows: [],
    });

    const row = extractHealthRow(md, 'Meta UnderReport');
    expect(row).toBeTruthy();
    const attr = attributionCell(row!);
    expect(Number.isFinite(attr)).toBe(true);

    // Coverage = 0.5 → trustScore = 50 → attributionClarity input
    // is "medium". The exact number depends on computeCampaignHealth's
    // scoring weights for the medium tier, so we just assert it's
    // strictly less than the "perfect" tier (which would be the case
    // for coverage=1.0). A medium-trust campaign should score well
    // below the maximum (100) on this dimension.
    expect(attr).toBeLessThan(100);
  });

  // ---------- Test 3: Edge — c.value = 0, det > 0 — fallback to 1 (no division by zero) ----------
  it('edge case (c.value=0, det=100) — coverage falls back to 1 (no division by zero)', () => {
    // When the platform reports zero conversion_value but Shopify sees
    // orders, the pre-existing fallback `det > 0 ? 1 : 0` kicks in.
    // Post-fix MUST preserve this fallback (only the Math.min clamp is
    // removed) so we don't accidentally introduce a divide-by-zero or
    // produce Infinity.
    const daily: DailyRow[] = [makeDaily({})];
    const campaigns: CampaignRow[] = [
      makeCampaign({
        campaignId: 'm-zero', campaignName: 'Meta ZeroClaim',
        adSetId: 'as-zero', conversionValue: 0, spend: 100,
      }),
    ];
    const orders: OrderAttributionRow[] = [
      makeOrder({ orderId: 'o-zero', utmId: 'm-zero', utmCampaign: 'Meta ZeroClaim', totalCad: 100 }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: campaigns,
      ordersRows: orders,
      adsRows: [],
    });

    const row = extractHealthRow(md, 'Meta ZeroClaim');
    expect(row).toBeTruthy();
    const attr = attributionCell(row!);

    // Must be a finite number (not Infinity, not NaN).
    expect(Number.isFinite(attr)).toBe(true);
    // Coverage fallback = 1 → trustScore = 100 → attributionClarity
    // reflects "high" tier. Just assert it's a positive finite value.
    expect(attr).toBeGreaterThan(0);
  });
});
