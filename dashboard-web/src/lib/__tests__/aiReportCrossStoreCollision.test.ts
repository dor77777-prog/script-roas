import { describe, expect, it } from 'vitest';
import { generateAiReport } from '@/lib/aiReport';
import type { DailyRow } from '@/lib/types';
import type { ProductRow } from '@/lib/products';
import type { CampaignRow } from '@/lib/campaigns';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';
import type { AdRow } from '@/lib/ads';

/**
 * AUDIT regression (Phase 12.1.2 / 2026-05-24) — TG-02 golden two-store
 * cross-store collision fixture. Pins three MAJOR findings from
 * .planning/AUDIT.md §Recommended Phase 12.1 Scope:
 *
 *   ALG-04 — aiReport.ts:1299-1303 `statusByCampaign` was keyed by
 *            `${platform}::${campaignId}` (NO storeId). In the operator's
 *            default storeName='All' view, two stores sharing the same
 *            (platform, campaignId) collapsed to a single bucket and the
 *            last-write-wins on effective_status silently mislabeled one
 *            store's campaign with the other store's status.
 *
 *   ALG-05 — aiReport.ts:842-853 (Pixel↔Shopify) AND aiReport.ts:1081-1092
 *            (Health Score deterministic input) — `ordersByCampaignId.set(id,...)`
 *            + `ordersByCampaignName.set(name.toLowerCase(),...)` were keyed
 *            WITHOUT storeId. Two stores sharing utm_id or utm_campaign
 *            (operator-managed UTM templates collide) merged revenue at
 *            the row level, double-counting at lookup and inflating both
 *            Pixel↔Shopify trust scores AND Health Score deterministic
 *            coverage.
 *
 *   ALG-06 — aiReport.ts:1124-1131 + 1492-1494 + 1588-1589 — three
 *            suffix-match lookups (`Array.from(map.keys()).find(k => k.endsWith(...))`)
 *            returned the FIRST match. For cross-store collisions, one
 *            campaign silently received the other's daily series, ad-set
 *            drill-down, and ad creative drill-down.
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/lib_algorithm_aiReport.json
 *     (ALG-04 lines 38-44, ALG-05 lines 47-53, ALG-06 lines 56-63)
 *
 * Cross-ref: .planning/phases/12-codebase-audit-baseline/12-tests-needed.md TG-02
 * Cross-ref: .planning/phases/12-codebase-audit-baseline/12-CHANNELS.md CHN-02
 *
 * Fixture shape — minimum reproduction of the audit's failing_input:
 *   - Two stores (zolplus + uzoshop), both with a Meta campaign whose
 *     campaignId='c1' and campaignName='Brand'.
 *   - Each store's campaign row carries a single effectiveStatus (zol=PAUSED,
 *     uzo=ACTIVE). NOTE: we intentionally do NOT mix in a 2-date /
 *     non-chronological status sequence here — that's the ALG-03
 *     latest-wins concern (separate finding, out of scope for 12.1.2).
 *     A single-status fixture per store keeps this test focused purely
 *     on the cross-store collision (ALG-04 / 05 / 06).
 *   - Each store has ONE order tagged utm_campaign='Brand' + utm_id='c1'
 *     with distinct totalCad values (zol=100, uzo=200) so a merge would
 *     produce a clearly-detectable 300 figure in both rows.
 *   - Each store has TWO adsets under campaignId='c1' so cross-store
 *     drill-down leakage is observable (zol adsets would leak into uzo
 *     section under pre-fix suffix-match).
 *   - ttSpend > 0 on every daily row so the report exercises the
 *     TikTok section as well (anti-regression on the report's other
 *     sections while we're in here).
 *
 * Each test asserts per-store isolation in the operator's default
 * storeName='All' view, which is precisely the view the audit findings
 * fire under.
 */

const ZOL_ORDER_REV = 100;
const UZO_ORDER_REV = 200;

type FixtureOpts = {
  zolplusStatus: string;
  uzoshopStatus: string;
};

function makeDaily(overrides: Partial<DailyRow>): DailyRow {
  return {
    date: '2026-05-20',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 100,
    gaSpend: 50,
    ttSpend: 25,
    totalSpend: 175,
    revenue: 1000,
    roas: 5.71,
    grossProfit: 800,
    cogs: 200,
    netProfit: 625,
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
    date: '2026-05-20',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'Brand',
    adSetId: 'as1',
    adSetName: 'AdSet 1',
    spend: 75,
    impressions: 5000,
    clicks: 200,
    conversions: 10,
    conversionValue: 400,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: 'ACTIVE',
    ...overrides,
  };
}

function makeOrder(overrides: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-05-20',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    orderId: 'o-default',
    totalCad: 100,
    source: 'meta-paid',
    utmSource: 'facebook',
    utmMedium: 'cpc',
    utmCampaign: 'Brand',
    utmContent: '',
    fbclidPresent: true,
    gclidPresent: false,
    referringSite: '',
    utmId: 'c1',
    utmTerm: '',
    lineItems: [],
    ...overrides,
  };
}

function makeAd(overrides: Partial<AdRow>): AdRow {
  return {
    date: '2026-05-20',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'Brand',
    adSetId: 'as1',
    adSetName: 'AdSet 1',
    adId: 'ad-default',
    adName: 'Ad default',
    spend: 35,
    impressions: 2500,
    clicks: 100,
    conversions: 5,
    conversionValue: 200,
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

function makeBrandFixture(opts: FixtureOpts) {
  // Per-store daily rows on 2 dates × 2 stores. ttSpend > 0 so the
  // TikTok-deep-dive section is exercised (regression net on the
  // surrounding code while we're patching aiReport).
  const daily: DailyRow[] = [
    makeDaily({ date: '2026-05-15', storeId: 'zolplus', storeName: 'Zol Plus', revenue: 800 }),
    makeDaily({ date: '2026-05-20', storeId: 'zolplus', storeName: 'Zol Plus', revenue: 900 }),
    makeDaily({ date: '2026-05-15', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 700 }),
    makeDaily({ date: '2026-05-20', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 1000 }),
  ];

  // 2 adsets per store at campaignId='c1' for ONE date. Single
  // effectiveStatus per store (opts.zolplusStatus, opts.uzoshopStatus)
  // so the test surface is purely the cross-store collision, not the
  // ALG-03 latest-wins-needs-sort concern.
  const campaigns: CampaignRow[] = [
    makeCampaign({
      date: '2026-05-20', storeId: 'zolplus', storeName: 'Zol Plus',
      adSetId: 'zol-as1', adSetName: 'Zol AdSet 1',
      effectiveStatus: opts.zolplusStatus, spend: 80, conversionValue: 350,
    }),
    makeCampaign({
      date: '2026-05-20', storeId: 'zolplus', storeName: 'Zol Plus',
      adSetId: 'zol-as2', adSetName: 'Zol AdSet 2',
      effectiveStatus: opts.zolplusStatus, spend: 70, conversionValue: 280,
    }),
    makeCampaign({
      date: '2026-05-20', storeId: 'uzoshop', storeName: 'uzoshop',
      adSetId: 'uzo-as1', adSetName: 'Uzo AdSet 1',
      effectiveStatus: opts.uzoshopStatus, spend: 90, conversionValue: 500,
    }),
    makeCampaign({
      date: '2026-05-20', storeId: 'uzoshop', storeName: 'uzoshop',
      adSetId: 'uzo-as2', adSetName: 'Uzo AdSet 2',
      effectiveStatus: opts.uzoshopStatus, spend: 60, conversionValue: 320,
    }),
  ];

  // One order per store, both tagged utm_campaign='Brand' + utm_id='c1'
  // (the exact pathology from raw-returns/lib_algorithm_aiReport.json
  // ALG-05 failing_input). Distinct totalCad so a merge would produce
  // a detectable 300 (=100+200) in both buckets pre-fix.
  const orders: OrderAttributionRow[] = [
    makeOrder({
      storeId: 'zolplus', storeName: 'Zol Plus', orderId: 'zol-ord-1',
      totalCad: ZOL_ORDER_REV,
    }),
    makeOrder({
      storeId: 'uzoshop', storeName: 'uzoshop', orderId: 'uzo-ord-1',
      totalCad: UZO_ORDER_REV,
    }),
  ];

  // Ads — at least 2 per store under campaignId='c1' so the per-campaign
  // creative drill-down section (Slice 1) is exercised AND cross-store
  // leakage in the slice's suffix-match is observable.
  const ads: AdRow[] = [
    makeAd({
      storeId: 'zolplus', storeName: 'Zol Plus',
      adSetId: 'zol-as1', adSetName: 'Zol AdSet 1',
      adId: 'zol-ad-1', adName: 'Zol Ad 1', spend: 40, conversionValue: 180,
    }),
    makeAd({
      storeId: 'zolplus', storeName: 'Zol Plus',
      adSetId: 'zol-as2', adSetName: 'Zol AdSet 2',
      adId: 'zol-ad-2', adName: 'Zol Ad 2', spend: 35, conversionValue: 140,
    }),
    makeAd({
      storeId: 'uzoshop', storeName: 'uzoshop',
      adSetId: 'uzo-as1', adSetName: 'Uzo AdSet 1',
      adId: 'uzo-ad-1', adName: 'Uzo Ad 1', spend: 45, conversionValue: 250,
    }),
    makeAd({
      storeId: 'uzoshop', storeName: 'uzoshop',
      adSetId: 'uzo-as2', adSetName: 'Uzo AdSet 2',
      adId: 'uzo-ad-2', adName: 'Uzo Ad 2', spend: 30, conversionValue: 160,
    }),
  ];

  // Per-store products so the report's "top products" section doesn't
  // short-circuit (empty products section is benign but a populated
  // section catches any incidental regressions).
  const products: ProductRow[] = [
    makeProduct({ storeId: 'zolplus', storeName: 'Zol Plus', productId: 'zol-p1', productTitle: 'Zol Product 1' }),
    makeProduct({ storeId: 'uzoshop', storeName: 'uzoshop', productId: 'uzo-p1', productTitle: 'Uzo Product 1' }),
  ];

  return {
    daily,
    products,
    campaigns,
    orders,
    ads,
    range: { from: '2026-05-15', to: '2026-05-20' },
  };
}

describe('aiReport cross-store collision (Phase 12.1.2 — TG-02 / ALG-04 + ALG-05 + ALG-06)', () => {
  // ---------- ALG-04 — Currently-Off section per-store isolation ----------
  it('ALG-04: Currently-Off section lists ONLY the store whose Brand campaign is paused (not the active store)', () => {
    // zolplus.Brand ends in PAUSED, uzoshop.Brand ends in ACTIVE. The
    // 'Currently-Off' section should show zolplus.Brand exactly once,
    // and MUST NOT list uzoshop.Brand. Pre-fix (statusByCampaign keyed
    // without storeId), last-write-wins collapsed both stores' status
    // to whichever campaigns-row landed last — silently mislabeling one
    // store with the other's status.
    const f = makeBrandFixture({ zolplusStatus: 'PAUSED', uzoshopStatus: 'ACTIVE' });
    const md = generateAiReport({
      storeName: 'All',
      storeId: null,
      range: f.range,
      dailyRows: f.daily,
      productRows: f.products,
      campaignRows: f.campaigns,
      ordersRows: f.orders,
      adsRows: f.ads,
    });

    // Locate the Currently-Off section by its Hebrew header. The section
    // header at aiReport.ts:1319 is 'קמפיינים כבויים כעת (status אמיתי מהפלטפורמה)'.
    const offIdx = md.indexOf('קמפיינים כבויים כעת');
    expect(offIdx).toBeGreaterThan(-1);
    // Section ends at the next ## heading.
    const afterOff = md.slice(offIdx);
    const nextSectionMatch = afterOff.match(/\n## /);
    const offSection = nextSectionMatch
      ? afterOff.slice(0, nextSectionMatch.index)
      : afterOff;

    // zolplus.Brand SHOULD appear in the Currently-Off section.
    // Both stores share campaignName='Brand', so we MUST also see the
    // store column (which is `Zol Plus` or `uzoshop`). Use a single
    // assertion that the section contains a row mentioning Zol Plus.
    expect(offSection).toMatch(/Zol Plus/);

    // uzoshop.Brand MUST NOT appear in the Currently-Off section because
    // its latest status is ACTIVE. Pre-fix, the cross-store status
    // collision could cause uzoshop to be incorrectly listed.
    expect(offSection).not.toMatch(/uzoshop/);
  });

  // ---------- ALG-04 — Health Score per-store status isolation ----------
  it('ALG-04: Health Score status column reflects each store\'s own effective_status (not the other store\'s)', () => {
    // The Health Score table renders a 'סטטוס' column with the
    // post-trimmed status string. Pre-fix, statusByKey was keyed
    // correctly with storeId BUT the consumer at line 1124 used a
    // suffix-match find() that returned the FIRST match — same
    // cross-store leakage as ALG-06. Combined with the statusByCampaign
    // bug at line 1299, both store rows received the same status.
    //
    // Set up: zol=PAUSED, uzo=ACTIVE. The Health Score table should
    // show two rows for 'Brand' — one with status 'PAUSED' (Zol Plus
    // column), one with status 'ACTIVE' (uzoshop column).
    const f = makeBrandFixture({ zolplusStatus: 'PAUSED', uzoshopStatus: 'ACTIVE' });
    const md = generateAiReport({
      storeName: 'All',
      storeId: null,
      range: f.range,
      dailyRows: f.daily,
      productRows: f.products,
      campaignRows: f.campaigns,
      ordersRows: f.orders,
      adsRows: f.ads,
    });

    // Health Score section starts at 'Campaign Health Score'.
    const hsIdx = md.indexOf('Campaign Health Score');
    expect(hsIdx).toBeGreaterThan(-1);
    const afterHs = md.slice(hsIdx);
    const nextSection = afterHs.indexOf('\n## ', 1);
    const hsSection = nextSection > -1 ? afterHs.slice(0, nextSection) : afterHs;

    // Find the two rows by matching the store-name columns.
    // Each table row contains '| Brand |' plus the store-name column
    // 'Zol Plus' or 'uzoshop'. The status column is the LAST field on
    // the row before the trailing pipe.
    const zolLine = hsSection.split('\n').find(l => l.includes('Brand') && l.includes('Zol Plus'));
    const uzoLine = hsSection.split('\n').find(l => l.includes('Brand') && l.includes('uzoshop'));

    expect(zolLine).toBeDefined();
    expect(uzoLine).toBeDefined();

    // zolplus row must show PAUSED, uzoshop row must show ACTIVE.
    // Pre-fix: both rows would show the same status (last-write-wins
    // across the un-storeId-scoped statusByCampaign map + suffix-match
    // collapse on the dailyByKey side).
    expect(zolLine!).toMatch(/PAUSED/);
    expect(zolLine!).not.toMatch(/ACTIVE/);
    expect(uzoLine!).toMatch(/ACTIVE/);
    expect(uzoLine!).not.toMatch(/PAUSED/);
  });

  // ---------- ALG-05 — Pixel↔Shopify det revenue per-store isolation ----------
  it('ALG-05: Pixel↔Shopify det revenue per store equals its own utm_id+utm_campaign matched orders (not the merged sum)', () => {
    // zolplus order = 100 CAD. uzoshop order = 200 CAD. Both tagged
    // utm_id='c1' + utm_campaign='Brand'. Pre-fix, ordersByCampaignId
    // and ordersByCampaignName were keyed WITHOUT storeId, so both
    // campaigns received 300 CAD (the merged sum) under the 'All' view.
    // Post-fix, zolplus.Brand det = 100 only, uzoshop.Brand det = 200 only.
    const f = makeBrandFixture({ zolplusStatus: 'ACTIVE', uzoshopStatus: 'ACTIVE' });
    const md = generateAiReport({
      storeName: 'All',
      storeId: null,
      range: f.range,
      dailyRows: f.daily,
      productRows: f.products,
      campaignRows: f.campaigns,
      ordersRows: f.orders,
      adsRows: f.ads,
    });

    // Pixel↔Shopify section header at aiReport.ts:904.
    const pxIdx = md.indexOf('השוואת ROAS לקמפיין — Pixel ↔ Shopify');
    expect(pxIdx).toBeGreaterThan(-1);
    const afterPx = md.slice(pxIdx);
    const nextSection = afterPx.indexOf('\n## ', 1);
    const pxSection = nextSection > -1 ? afterPx.slice(0, nextSection) : afterPx;

    // Find each store's row.
    const zolPxLine = pxSection.split('\n').find(l => l.includes('Brand') && l.includes('Zol Plus'));
    const uzoPxLine = pxSection.split('\n').find(l => l.includes('Brand') && l.includes('uzoshop'));
    expect(zolPxLine).toBeDefined();
    expect(uzoPxLine).toBeDefined();

    // Pre-fix, BOTH rows would show 'CAD 300' (the merged sum).
    // Post-fix, zolplus row shows CAD 100 (its own order), uzoshop
    // row shows CAD 200 (its own order). The det column is the 6th
    // field in the row, formatted via fmtCad(det) → 'CAD ${n}'.
    expect(zolPxLine!).toMatch(/CAD 100/);
    expect(zolPxLine!).not.toMatch(/CAD 300/);
    expect(uzoPxLine!).toMatch(/CAD 200/);
    expect(uzoPxLine!).not.toMatch(/CAD 300/);
  });

  // ---------- ALG-05 — Health Score deterministic input per-store isolation ----------
  it('ALG-05: Health Score deterministic revenue input (detById/detByName) is per-store, not cross-store merged', () => {
    // detById + detByName at aiReport.ts:1081-1092 were the parallel
    // pair with the same bug shape. They feed the synthetic
    // trueRevenueInfo passed into computeCampaignHealth (line 1145-1174).
    //
    // The downstream effect: pre-fix, both zolplus.Brand and
    // uzoshop.Brand received det=300 → coverage = min(1, 300/conversionValue).
    // Post-fix, zolplus.Brand uses det=100 and uzoshop.Brand uses
    // det=200, producing DISTINCT coverage values that feed the
    // attributionClarity component of the Health Score.
    //
    // We can't easily intercept the synthetic trueRevenueInfo from the
    // outside, but the attributionClarity column in the Health Score
    // table is computed from coverage. Pre-fix, both rows would share
    // the same attributionClarity value (because they share det=300);
    // post-fix, the per-store coverage values differ enough to be
    // observable in the table.
    //
    // Verification strategy: assert the two rows have DIFFERENT
    // attributionClarity values. Pre-fix invariant: equal (both 300/X);
    // post-fix invariant: distinct (100/X vs 200/Y).
    const f = makeBrandFixture({ zolplusStatus: 'ACTIVE', uzoshopStatus: 'ACTIVE' });
    const md = generateAiReport({
      storeName: 'All',
      storeId: null,
      range: f.range,
      dailyRows: f.daily,
      productRows: f.products,
      campaignRows: f.campaigns,
      ordersRows: f.orders,
      adsRows: f.ads,
    });

    const hsIdx = md.indexOf('Campaign Health Score');
    expect(hsIdx).toBeGreaterThan(-1);
    const afterHs = md.slice(hsIdx);
    const nextSection = afterHs.indexOf('\n## ', 1);
    const hsSection = nextSection > -1 ? afterHs.slice(0, nextSection) : afterHs;

    // Each Health Score row has columns:
    // | קמפיין | פלטפ׳ | חנות | הוצאה | ציון | רווחיות | נפח | מומנטום | Attribution | אופ׳ | סטטוס |
    // We extract column 9 (Attribution) for each row.
    const zolLine = hsSection.split('\n').find(l => l.includes('Brand') && l.includes('Zol Plus'));
    const uzoLine = hsSection.split('\n').find(l => l.includes('Brand') && l.includes('uzoshop'));
    expect(zolLine).toBeDefined();
    expect(uzoLine).toBeDefined();

    // Split each row by '|' and grab the Attribution column.
    // Index 0 is empty (leading pipe), so attribution = column 9 of data
    // = parts[9] when we count from 0 with index 0 being pre-pipe empty.
    const zolParts = zolLine!.split('|').map(s => s.trim());
    const uzoParts = uzoLine!.split('|').map(s => s.trim());
    // 0:"" 1:name 2:platform 3:store 4:spend 5:score 6:profitability
    // 7:volume 8:trajectory 9:attribution 10:operator 11:status 12:""
    const zolAttribution = zolParts[9];
    const uzoAttribution = uzoParts[9];

    // Post-fix the two stores' deterministic revenues differ
    // (zol=100, uzo=200) so their attribution clarity values must
    // also differ. Pre-fix both rows would share the same value
    // because they both received det=300.
    expect(zolAttribution).not.toBe(uzoAttribution);
  });

  // ---------- ALG-06 — Ad-set drill-down per-store isolation ----------
  it('ALG-06: ad-set drill-down per top campaign lists ONLY its own store\'s adsets (not the other store\'s)', () => {
    // The ad-set drill-down at aiReport.ts:1486-1514 iterates
    // topCampaignsForDrill and emits a section per campaign. Pre-fix,
    // the matchingKey lookup used Array.from(adsetsByCampaign.keys()).find(
    //   k => k.endsWith(`::${platform}::${campaignId}`)
    // ) — which returns the FIRST match. For cross-store collisions
    // (zolplus + uzoshop both with campaignId='c1'), both campaigns'
    // drill-down sections received whichever store's adsets were
    // inserted first into the map.
    //
    // Post-fix, each campaign's drill-down section uses direct
    // map.get(`${storeId}::${platform}::${campaignId}`) and only its
    // own adsets appear.
    //
    // Test: zolplus has adsets {zol-as1, zol-as2}, uzoshop has
    // {uzo-as1, uzo-as2}. The drill-down section for the Zol Plus row
    // must contain 'Zol AdSet 1' / 'Zol AdSet 2' and NOT 'Uzo AdSet'.
    // Conversely for uzoshop.
    const f = makeBrandFixture({ zolplusStatus: 'ACTIVE', uzoshopStatus: 'ACTIVE' });
    const md = generateAiReport({
      storeName: 'All',
      storeId: null,
      range: f.range,
      dailyRows: f.daily,
      productRows: f.products,
      campaignRows: f.campaigns,
      ordersRows: f.orders,
      adsRows: f.ads,
    });

    // The drill-down section header at aiReport.ts:1487 is
    // '## אד-סטים בתוך 5 הקמפיינים עם ההוצאה הגבוהה'.
    const drIdx = md.indexOf('אד-סטים בתוך 5 הקמפיינים');
    expect(drIdx).toBeGreaterThan(-1);
    const afterDr = md.slice(drIdx);
    const nextSection = afterDr.indexOf('\n## ', 1);
    const drSection = nextSection > -1 ? afterDr.slice(0, nextSection) : afterDr;

    // Each per-campaign subsection starts with '### Meta — Brand (storeName)'.
    // Locate the Zol Plus subsection and the uzoshop subsection.
    const zolSubsectionStart = drSection.indexOf('### Meta — Brand (Zol Plus)');
    const uzoSubsectionStart = drSection.indexOf('### Meta — Brand (uzoshop)');
    expect(zolSubsectionStart).toBeGreaterThan(-1);
    expect(uzoSubsectionStart).toBeGreaterThan(-1);

    // Extract each subsection between its '###' header and the next
    // '###' (or end of section).
    function extractSubsection(start: number): string {
      const afterStart = drSection.slice(start);
      const next = afterStart.indexOf('\n### ', 1);
      return next > -1 ? afterStart.slice(0, next) : afterStart;
    }
    const zolSubsection = extractSubsection(zolSubsectionStart);
    const uzoSubsection = extractSubsection(uzoSubsectionStart);

    // Zol Plus subsection MUST list Zol AdSets and MUST NOT list Uzo AdSets.
    expect(zolSubsection).toMatch(/Zol AdSet 1/);
    expect(zolSubsection).toMatch(/Zol AdSet 2/);
    expect(zolSubsection).not.toMatch(/Uzo AdSet/);

    // uzoshop subsection MUST list Uzo AdSets and MUST NOT list Zol AdSets.
    expect(uzoSubsection).toMatch(/Uzo AdSet 1/);
    expect(uzoSubsection).toMatch(/Uzo AdSet 2/);
    expect(uzoSubsection).not.toMatch(/Zol AdSet/);
  });
});
