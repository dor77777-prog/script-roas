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
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
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
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
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
    customerId: 'cust-default',
    orderCreatedAt: '2026-05-15T12:00:00-04:00',
    isFirstOrder: true,
    // Phase 4 — first-click lens defaults (no first-click signal).
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
    //
    // 2026-06-11 adversarial review: this signature is now ALSO the P1-8a
    // tracking-outage verdict ('הפלטפורמה מדווחת 0', unknown-40) — the
    // synthetic ladder mirrors the dashboard, so the clarity cell is the
    // verdict's 40, no longer the coverage-fallback 'high'/100 tier. The
    // exact pin lives in the parity suite below; here we keep the original
    // no-division-by-zero guarantee.
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
    // Positive finite value (post-2026-06-11 it is the unknown-40 verdict's
    // 40, pinned exactly in the parity suite below).
    expect(attr).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2026-06-11 adversarial review — P1-8a/P1-8b parity for the SYNTHETIC trust
// ladder. The wave-4 batch (commits 7518423/e290dc4/c39fcc8) changed
// analyzeAttribution + campaignHealthScore but missed aiReport's synthetic
// coverage→trust mirror, so the report's Health Score contradicted the
// dashboard for the exact outage signatures the wave targeted. These tests
// pin the report-side clarity cell to the dashboard verdict's score.
// ─────────────────────────────────────────────────────────────────────────

describe('aiReport synthetic trust ladder — P1-8a/P1-8b parity (2026-06-11 review)', () => {
  it('claim=0/det>0 → clarity cell carries the unknown-40 verdict (NOT the coverage-fallback 100)', () => {
    // Platform reports ZERO conversion_value while Shopify has a tagged
    // order — the TikTok conversions=0 outage signature. Dashboard verdict:
    // unknown-40 'הפלטפורמה מדווחת 0'. Pre-fix the synthetic ladder scored
    // it high/100 via the claim=0→coverage=1 fallback.
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [
        makeCampaign({
          campaignId: 'm-pz', campaignName: 'Meta PlatformZero',
          adSetId: 'as-pz', conversionValue: 0, spend: 150, conversions: 0,
        }),
      ],
      ordersRows: [
        makeOrder({ orderId: 'o-pz', utmId: 'm-pz', utmCampaign: 'Meta PlatformZero', totalCad: 100 }),
      ],
      adsRows: [],
    });

    const row = extractHealthRow(md, 'Meta PlatformZero');
    expect(row).toBeTruthy();
    // Same score the dashboard's scoreAttributionClarity emits for the
    // unknown-40 verdict (Math.max(30, 40) = 40).
    expect(attributionCell(row!)).toBe(40);
  });

  it('coverage 2.5 → clarity cell capped at the P1-8b medium 65 (NOT an uncapped 250)', () => {
    // Claim $100, deterministic $250 → coverage 2.5 > COVERAGE_WARNING_THRESHOLD.
    // Dashboard caps trust at medium/65; the synthetic ladder must match.
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [
        makeCampaign({
          campaignId: 'm-bh', campaignName: 'Meta BigHalo',
          adSetId: 'as-bh', conversionValue: 100, spend: 150, conversions: 3,
        }),
      ],
      ordersRows: [
        makeOrder({ orderId: 'o-bh1', utmId: 'm-bh', utmCampaign: 'Meta BigHalo', totalCad: 120 }),
        makeOrder({ orderId: 'o-bh2', utmId: 'm-bh', utmCampaign: 'Meta BigHalo', totalCad: 130 }),
      ],
      adsRows: [],
    });

    const row = extractHealthRow(md, 'Meta BigHalo');
    expect(row).toBeTruthy();
    expect(attributionCell(row!)).toBe(65);
  });

  it('coverage 2.0 exactly (test-1 halo fixture) stays UNcapped — strict > threshold', () => {
    // Symmetry guard mirroring the dashboard's boundary semantics: the cap
    // fires only ABOVE 2, so the original ALG-07 halo differential (test 1)
    // keeps holding at exactly 2.0.
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [
        makeCampaign({
          campaignId: 'm-h2', campaignName: 'Meta HaloTwo',
          adSetId: 'as-h2', conversionValue: 50, spend: 100, conversions: 2,
        }),
      ],
      ordersRows: [
        makeOrder({ orderId: 'o-h2', utmId: 'm-h2', utmCampaign: 'Meta HaloTwo', totalCad: 100 }),
      ],
      adsRows: [],
    });

    const row = extractHealthRow(md, 'Meta HaloTwo');
    expect(row).toBeTruthy();
    // coverage = 100/50 = 2.0 → trustScore 200, level high, no cap.
    expect(attributionCell(row!)).toBe(200);
  });
});

/**
 * Extract the rendered "% deterministic coverage" integer from the Traffic
 * Source Breakdown prose line (`**כיסוי deterministic**: NN% מההכנסות ...`).
 * Returns null if the line is absent.
 */
function extractDeterministicCoveragePct(md: string): number | null {
  const m = md.match(/\*\*כיסוי deterministic\*\*: (\d+)%/);
  return m ? Number(m[1]) : null;
}

/**
 * Extract the rendered Traffic Source Breakdown table rows (between the
 * `## תנועה לפי מקור` header and the next `##` section). Returns the raw
 * markdown lines that start with `| ` (header + separator + data + total).
 */
function extractSourceTableRows(md: string): string[] {
  const idx = md.indexOf('## תנועה לפי מקור');
  if (idx < 0) return [];
  const after = md.slice(idx + '## תנועה לפי מקור'.length);
  const nextSectionMatch = after.match(/\n## /);
  const section = nextSectionMatch
    ? after.slice(0, nextSectionMatch.index)
    : after;
  return section.split('\n').filter(l => l.startsWith('| '));
}

describe("aiReport — fold '' source into 'direct' bucket (Fix #1)", () => {
  // A defensively-empty source ('') and an explicit 'direct' order must
  // land in the SAME 'ישיר (no UTM)' bucket — never a separate 'לא ידוע'
  // row — matching attributionAnalysis.ts:1205 (`o.source || 'direct'`).
  it("source:'' and source:'direct' both render under the single 'ישיר (no UTM)' row", () => {
    const daily: DailyRow[] = [makeDaily({})];
    const orders: OrderAttributionRow[] = [
      // Defensive empty source — should never occur in prod, but must fold.
      makeOrder({
        orderId: 'o-empty',
        source: '',
        utmSource: '',
        fbclidPresent: false,
        gclidPresent: false,
        utmId: '',
        utmCampaign: '',
        totalCad: 30,
      }),
      // Explicit direct order.
      makeOrder({
        orderId: 'o-direct',
        source: 'direct',
        utmSource: '',
        fbclidPresent: false,
        gclidPresent: false,
        utmId: '',
        utmCampaign: '',
        totalCad: 70,
      }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: daily,
      productRows: [],
      campaignRows: [],
      ordersRows: orders,
      adsRows: [],
    });

    const rows = extractSourceTableRows(md);
    expect(rows.length).toBeGreaterThan(0);

    // No dead 'לא ידוע' bucket row may appear.
    const unknownRows = rows.filter(r => r.includes('לא ידוע'));
    expect(unknownRows).toHaveLength(0);

    // Exactly one 'ישיר (no UTM)' data row, and it carries BOTH orders
    // (count = 2, revenue = 100 CAD = 30 + 70).
    const directRows = rows.filter(
      r => r.includes('ישיר (no UTM)') && !r.includes('סה"כ'),
    );
    expect(directRows).toHaveLength(1);
    const cells = directRows[0].split('|').map(c => c.trim());
    // | מקור | הזמנות | % | הכנסות | AOV |
    // index:  1        2       3      4       5
    expect(cells[2]).toBe('2'); // both orders folded into one bucket
  });
});

describe('aiReport — deterministic coverage aligns with its comment (Fix #2)', () => {
  // Fixture set (each order 100 CAD → grandTotal 400):
  //   1. fbclid present, source meta-paid                → deterministic
  //   2. ONLY utmSource set (other-paid, no click-id)    → deterministic (NEW)
  //   3. pure direct, no utm/no click-id                 → NOT deterministic
  //   4. pure direct, no utm/no click-id                 → NOT deterministic
  // Expected coverage = 200 / 400 = 50%.
  function buildOrders(): OrderAttributionRow[] {
    return [
      makeOrder({
        orderId: 'o-fbclid',
        source: 'meta-paid',
        utmSource: 'facebook',
        fbclidPresent: true,
        gclidPresent: false,
        totalCad: 100,
      }),
      makeOrder({
        orderId: 'o-utmonly',
        source: 'other-paid',
        utmSource: 'newsletter',
        fbclidPresent: false,
        gclidPresent: false,
        utmId: '',
        utmCampaign: '',
        totalCad: 100,
      }),
      makeOrder({
        orderId: 'o-direct-1',
        source: 'direct',
        utmSource: '',
        fbclidPresent: false,
        gclidPresent: false,
        utmId: '',
        utmCampaign: '',
        totalCad: 100,
      }),
      makeOrder({
        orderId: 'o-direct-2',
        source: 'direct',
        utmSource: '',
        fbclidPresent: false,
        gclidPresent: false,
        utmId: '',
        utmCampaign: '',
        totalCad: 100,
      }),
    ];
  }

  it('an order with ONLY utmSource set counts toward deterministic coverage; pure direct does not', () => {
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [],
      ordersRows: buildOrders(),
      adsRows: [],
    });

    // 2 of 4 orders (fbclid + utm-only) are deterministic → 50%.
    const pct = extractDeterministicCoveragePct(md);
    expect(pct).toBe(50);
  });

  it('whitespace-only utmSource does NOT count (uses .trim())', () => {
    const orders: OrderAttributionRow[] = [
      makeOrder({
        orderId: 'o-ws',
        source: 'direct',
        utmSource: '   ',
        fbclidPresent: false,
        gclidPresent: false,
        utmId: '',
        utmCampaign: '',
        totalCad: 100,
      }),
      makeOrder({
        orderId: 'o-real',
        source: 'other-paid',
        utmSource: 'tiktok',
        fbclidPresent: false,
        gclidPresent: false,
        utmId: '',
        utmCampaign: '',
        totalCad: 100,
      }),
    ];
    const md = generateAiReport({
      storeName: STORE_NAME,
      storeId: STORE_ID,
      range: RANGE,
      dailyRows: [makeDaily({})],
      productRows: [],
      campaignRows: [],
      ordersRows: orders,
      adsRows: [],
    });

    // Only the real utmSource order counts → 1 of 2 → 50%.
    const pct = extractDeterministicCoveragePct(md);
    expect(pct).toBe(50);
  });
});
