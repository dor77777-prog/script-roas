import { describe, expect, it } from 'vitest';
import { aggregate, type AggregateMode } from '@/lib/campaignsAggregator';
import type { CampaignRow } from '@/lib/campaigns';

const RANGE = { from: '2026-05-01', to: '2026-05-31' };

function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  const base: CampaignRow = {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'camp-1',
    campaignName: 'Campaign 1',
    adSetId: 'adset-1',
    adSetName: 'Ad Set 1',
    date: '2026-05-15',
    spend: 100,
    conversionValue: 0,
    impressions: 1000,
    clicks: 25,
    conversions: 1,
    campaignBudgetCad: 50,
    adSetBudgetCad: 25,
    budgetType: 'CBO',
    effectiveStatus: null,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
  };
  return { ...base, ...overrides };
}

function aggregateSingle(rows: CampaignRow[], mode: AggregateMode): ReturnType<typeof aggregate>[number] {
  const out = aggregate(rows, mode, 'All', 'all', RANGE);
  expect(out).toHaveLength(1);
  return out[0];
}

describe('aggregate() — locks FIX-05, FIX-06, FIX-13', () => {
  it('FIX-05: latest-date budget wins; backfilled day appended late does not revert', () => {
    const row = aggregateSingle([
      makeRow({ date: '2026-05-15', campaignBudgetCad: 50 }),
      makeRow({ date: '2026-05-16', campaignBudgetCad: 60 }),
      makeRow({ date: '2026-05-14', campaignBudgetCad: 40 }),
    ], 'campaign');

    expect(row.campaignBudgetCad).toBe(60);
  });

  it('FIX-13: strict > keeps first-observed budget for duplicate dates', () => {
    const row = aggregateSingle([
      makeRow({ date: '2026-05-15', campaignBudgetCad: 50 }),
      makeRow({ date: '2026-05-15', campaignBudgetCad: 70 }),
    ], 'campaign');

    expect(row.campaignBudgetCad).toBe(50);
  });

  it('FIX-06: CBO -> ABO switch clears campaignBudgetCad on output', () => {
    const row = aggregateSingle([
      makeRow({ date: '2026-05-14', budgetType: 'CBO', campaignBudgetCad: 50, adSetBudgetCad: null }),
      makeRow({ date: '2026-05-15', budgetType: 'ABO', campaignBudgetCad: 50, adSetBudgetCad: 30 }),
    ], 'adset');

    expect(row.budgetType).toBe('ABO');
    expect(row.campaignBudgetCad).toBeNull();
    expect(row.adSetBudgetCad).toBe(30);
  });

  it('FIX-06: ABO -> CBO switch clears adSetBudgetCad on output', () => {
    const row = aggregateSingle([
      makeRow({ date: '2026-05-14', budgetType: 'ABO', campaignBudgetCad: null, adSetBudgetCad: 30 }),
      makeRow({ date: '2026-05-15', budgetType: 'CBO', campaignBudgetCad: 50, adSetBudgetCad: 30 }),
    ], 'adset');

    expect(row.budgetType).toBe('CBO');
    expect(row.campaignBudgetCad).toBe(50);
    expect(row.adSetBudgetCad).toBeNull();
  });

  it('FIX-26: lastActiveDate tracks the latest day with spend>0', () => {
    const row = aggregateSingle([
      makeRow({ date: '2026-05-10', spend: 100 }),
      makeRow({ date: '2026-05-15', spend: 50 }),
      makeRow({ date: '2026-05-12', spend: 200 }),
    ], 'campaign');

    expect(row.lastActiveDate).toBe('2026-05-15');
  });

  it('FIX-26: lastActiveDate ignores days with spend=0 even if they have impressions/conversions', () => {
    // Real-world case: campaign paused on 12th but refund/late-conversion
    // rows on 14th show with impressions but zero spend.
    const row = aggregateSingle([
      makeRow({ date: '2026-05-10', spend: 100 }),
      makeRow({ date: '2026-05-12', spend: 80 }),
      makeRow({ date: '2026-05-14', spend: 0, impressions: 500, conversionValue: 25 }),
    ], 'campaign');

    expect(row.lastActiveDate).toBe('2026-05-12');
  });

  it('FIX-26: lastActiveDate is null when no day in range had spend>0', () => {
    // A row that only ever appears via refund/impression data without any
    // actual spend should not falsely register as "active".
    const row = aggregateSingle([
      makeRow({ date: '2026-05-10', spend: 0, impressions: 100 }),
      makeRow({ date: '2026-05-11', spend: 0, conversionValue: 15 }),
    ], 'campaign');

    expect(row.lastActiveDate).toBeNull();
  });
});

describe('aggregate() — Phase A.5 v2 evening hotfix #7: effective-store collapse', () => {
  // Bug scenario: operator maps a TikTok campaign from uzoshop to 360usmile
  // mid-month. campaigns_daily holds historical rows under store_id='uzoshop'
  // (from before the mapping) AND fresh rows under store_id='360usmile' (from
  // after the per-tick DELETE-then-UPSERT in persistCampaignsLive). Before the
  // fix, the aggregator grouped by storeId → two visible rows for the same
  // campaign; the table's effective-store overlay then badged both as
  // 360usmile, producing the operator-reported "4 rows where 2 are expected"
  // pattern. Fix: pass an `effectiveStoreByCampaignId` map so the aggregator
  // collapses historical + new rows into ONE entry under the effective store.

  it('collapses historical (uzoshop) + new (360usmile) TikTok rows for the same campaign into ONE aggregate under 360usmile', () => {
    const rows = [
      makeRow({
        storeId: 'uzoshop',
        storeName: 'uzoshop',
        platform: 'TikTok',
        campaignId: 'tt-camp-1',
        campaignName: 'usmile360 - קרוסלות',
        date: '2026-05-10',
        spend: 48,
        impressions: 2000,
        clicks: 30,
        conversions: 1,
        conversionValue: 50,
      }),
      makeRow({
        storeId: '360usmile',
        storeName: '360usmile',
        platform: 'TikTok',
        campaignId: 'tt-camp-1',
        campaignName: 'usmile360 - קרוסלות',
        date: '2026-05-29',
        spend: 26,
        impressions: 1500,
        clicks: 20,
        conversions: 0,
        conversionValue: 0,
      }),
    ];

    const effectiveStoreByCampaignId = new Map<string, string>([
      ['tiktok::tt-camp-1', '360usmile'],
    ]);
    const storeDisplayNames: Record<string, string> = {
      '360usmile': '360usmile',
      uzoshop: 'uzoshop',
    };

    const out = aggregate(
      rows,
      'campaign',
      'All',
      'all',
      RANGE,
      undefined,
      effectiveStoreByCampaignId,
      storeDisplayNames,
    );

    expect(out).toHaveLength(1);
    expect(out[0].storeId).toBe('360usmile');
    expect(out[0].storeName).toBe('360usmile');
    expect(out[0].spend).toBe(74);
    expect(out[0].impressions).toBe(3500);
    expect(out[0].clicks).toBe(50);
    expect(out[0].key).toBe('360usmile::TikTok::tt-camp-1');
  });

  it('omitted effectiveStoreByCampaignId param → behaviour is unchanged (back-compat)', () => {
    const rows = [
      makeRow({
        storeId: 'uzoshop',
        storeName: 'uzoshop',
        platform: 'TikTok',
        campaignId: 'tt-camp-2',
        date: '2026-05-10',
        spend: 10,
      }),
      makeRow({
        storeId: '360usmile',
        storeName: '360usmile',
        platform: 'TikTok',
        campaignId: 'tt-camp-2',
        date: '2026-05-29',
        spend: 20,
      }),
    ];

    const out = aggregate(rows, 'campaign', 'All', 'all', RANGE);

    expect(out).toHaveLength(2);
  });

  it('Bug fix (2026-05-31): storeFilter="All" aggregates ALL stores into the result (user-reported Campaigns-tab-empty regression)', () => {
    // User report: "בטאב קמפיינים הם לא מוצגים הקמפיינים אם מסתכלים על כל החנויות"
    // (Campaigns aren't shown in the Campaigns tab when looking at all stores.)
    // This guards the basic "All-stores" path against any future refactor
    // that re-introduces a hard-coded `=== 'All'` check.
    const rows = [
      makeRow({ storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta', campaignId: 'c1', date: '2026-05-15', spend: 100 }),
      makeRow({ storeId: '360usmile', storeName: '360usmile', platform: 'Google', campaignId: 'c2', date: '2026-05-15', spend: 50 }),
      makeRow({ storeId: 'zolplus', storeName: 'Zol Plus', platform: 'TikTok', campaignId: 'c3', date: '2026-05-15', spend: 25 }),
    ];
    const out = aggregate(rows, 'campaign', 'All', 'all', RANGE);
    expect(out).toHaveLength(3);
    const stores = new Set(out.map(a => a.storeName));
    expect(stores).toEqual(new Set(['uzoshop', '360usmile', 'Zol Plus']));
  });

  it('Bug fix (2026-05-31): storeFilter sentinels "all" / "__all__" / "" all collapse to the wildcard', () => {
    // URL-restored / cloud-synced / drill-through paths can produce lower-
    // case 'all' or '__all__' or '' instead of 'All'. The aggregator must
    // treat ALL of these as "no store filter" so the Campaigns tab is not
    // surprise-empty just because one upstream forgot the capital A.
    const rows = [
      makeRow({ storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta', campaignId: 'c1', date: '2026-05-15', spend: 100 }),
      makeRow({ storeId: '360usmile', storeName: '360usmile', platform: 'Google', campaignId: 'c2', date: '2026-05-15', spend: 50 }),
    ];
    for (const sentinel of ['all', '__all__', ''] as const) {
      const out = aggregate(rows, 'campaign', sentinel, 'all', RANGE);
      expect(out, `sentinel='${sentinel}' should aggregate ALL stores`).toHaveLength(2);
    }
  });

  it('Bug fix (2026-05-31): platformFilter sentinels "All" / "__all__" / "" all collapse to the wildcard', () => {
    // Symmetric to the store sentinel test above. Per the user report the
    // platform filter sometimes arrives as 'All' (capital) from drill-
    // through, and the column-order parser writes '__all__' when an
    // operator clears the filter via the URL.
    const rows = [
      makeRow({ storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta', campaignId: 'c1', date: '2026-05-15', spend: 100 }),
      makeRow({ storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Google', campaignId: 'c2', date: '2026-05-15', spend: 50 }),
      makeRow({ storeId: 'uzoshop', storeName: 'uzoshop', platform: 'TikTok', campaignId: 'c3', date: '2026-05-15', spend: 25 }),
    ];
    // Cast through `unknown` because the type only admits 'all' | 'Meta'
    // | 'Google' | 'TikTok' but the bug specifically targets stringly-
    // typed inputs that bypass the compiler (URL params / cloud-sync
    // payloads).  AggregatePlatformFilter is widened on purpose here.
    type Loose = Parameters<typeof aggregate>[3];
    for (const sentinel of ['All', '__all__', ''] as const) {
      const out = aggregate(rows, 'campaign', 'All', sentinel as unknown as Loose, RANGE);
      expect(out, `platform sentinel='${sentinel}' should aggregate ALL platforms`).toHaveLength(3);
    }
  });

  it('Bug fix (2026-05-31): a specific store filter is still honored (no over-broadening regression)', () => {
    // Defensive: the new sentinel normalization must NOT match legitimate
    // store names. If it accidentally did, picking 'uzoshop' would also
    // surface '360usmile' rows — silently merging stores.
    const rows = [
      makeRow({ storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta', campaignId: 'c1', date: '2026-05-15', spend: 100 }),
      makeRow({ storeId: '360usmile', storeName: '360usmile', platform: 'Google', campaignId: 'c2', date: '2026-05-15', spend: 50 }),
    ];
    const out = aggregate(rows, 'campaign', 'uzoshop', 'all', RANGE);
    expect(out).toHaveLength(1);
    expect(out[0].storeName).toBe('uzoshop');
  });

  it('rows whose campaignId has no mapping entry keep their original storeId', () => {
    const rows = [
      makeRow({
        storeId: 'uzoshop',
        storeName: 'uzoshop',
        platform: 'TikTok',
        campaignId: 'tt-unmapped',
        date: '2026-05-10',
        spend: 5,
      }),
    ];

    const effectiveStoreByCampaignId = new Map<string, string>([
      ['tiktok::tt-other', '360usmile'],
    ]);

    const out = aggregate(
      rows,
      'campaign',
      'All',
      'all',
      RANGE,
      undefined,
      effectiveStoreByCampaignId,
      { '360usmile': '360usmile', uzoshop: 'uzoshop' },
    );

    expect(out).toHaveLength(1);
    expect(out[0].storeId).toBe('uzoshop');
    expect(out[0].storeName).toBe('uzoshop');
  });
});
