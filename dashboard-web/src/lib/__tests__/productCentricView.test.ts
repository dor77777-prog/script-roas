import { describe, expect, it } from 'vitest';
import { buildProductCentricView } from '@/lib/productCentricView';
import { allocateProductRevenue } from '@/lib/campaignProductMap';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { ProductMap } from '@/lib/campaignProductMap';

/**
 * Phase 05.7.x (2026-05-23) — Product-centric pivot tests.
 *
 * The pivot drives the new "Products → Campaigns" view operators use
 * to ask "for THIS product, who's promoting it where, and what's
 * winning?" — the inverse of the campaign-centric drawer view.
 *
 * Algorithm invariants tested here:
 *   - Cross-store isolation (zolplus mapping ignored for uzoshop view)
 *   - Sorting (rows by revenue desc; members within a row by spend desc;
 *     platforms by spend desc)
 *   - Share computation (intra-platform vs total)
 *   - Allocated-revenue arithmetic (per-platform × intra share)
 *   - Solo-mapped vs multi-mapped flag
 *   - Stale-mapping suppression (mapping exists but no aggregated row)
 */

const STORE = 'uzoshop';

function k(platform: string, campaignId: string): string {
  return `${STORE}::${platform}::${campaignId}`;
}

function makeAgg(overrides: Partial<Aggregated>): Aggregated {
  return {
    key: k('Meta', 'c1'),
    storeId: STORE,
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'Campaign 1',
    spend: 100,
    impressions: 1000,
    clicks: 50,
    conversions: 5,
    conversionValue: 200,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    lastActiveDate: '2026-05-20',
    effectiveStatus: 'ACTIVE',
    lastLiveTickAt: null,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
    ...overrides,
  };
}

describe('buildProductCentricView — empty + edge', () => {
  it('returns empty when there are no mappings in this store', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {},
      aggregated: [],
      productNetRevenue: new Map(),
    });
    expect(rows).toEqual([]);
  });

  it('excludes cross-store mappings', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [`zolplus::Meta::c1`]: ['p1'], // different store
      },
      aggregated: [makeAgg({ key: 'zolplus::Meta::c1', storeId: 'zolplus' })],
      productNetRevenue: new Map([['p1', 500]]),
    });
    expect(rows).toEqual([]);
  });

  it('drops products where NO cohort campaign has aggregated data', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('Meta', 'c2')]: ['p1'],
      },
      aggregated: [], // both campaigns dormant — no row in range
      productNetRevenue: new Map([['p1', 500]]),
    });
    expect(rows).toEqual([]);
  });

  it('KEEPS products with at least one active cohort campaign + emits dormant members with zero metrics', () => {
    // AUDIT ALG-03 (Phase 12.2.3, Option A): per the JSDoc at
    // lib/productCentricView.ts:178-181 ("Members with no aggregated row
    // (campaign paused throughout the range) are kept with zero metrics"),
    // dormant cohort members MUST appear in the output. Pre-fix the line
    // 311 `.filter(r => r.agg !== undefined)` silently dropped them,
    // contradicting the docstring. Post-fix both members are emitted —
    // dormant one with spend/conversionValue/allocatedRev all 0.
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('Meta', 'c2')]: ['p1'], // c2 has no aggregated row (dormant)
      },
      aggregated: [makeAgg({ key: k('Meta', 'c1') })],
      productNetRevenue: new Map([['p1', 500]]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe('p1');
    // Both members emitted per JSDoc contract (ALG-03 Option A fix).
    expect(rows[0].members).toHaveLength(2);
    const active = rows[0].members.find(m => m.campaignKey === k('Meta', 'c1'));
    const dormant = rows[0].members.find(m => m.campaignKey === k('Meta', 'c2'));
    expect(active).toBeDefined();
    expect(dormant).toBeDefined();
    // Dormant member has zero metrics; active member has the full
    // cohort revenue (sole active on Meta → 100% of platform).
    expect(dormant!.spend).toBe(0);
    expect(dormant!.conversionValue).toBe(0);
    expect(dormant!.allocatedRevenueEstimate).toBe(0);
    expect(active!.spend).toBeGreaterThan(0);
    expect(active!.allocatedRevenueEstimate).toBeCloseTo(500, 1);
  });
});

describe('buildProductCentricView — multi-mapped basics', () => {
  it('returns one row per product with multi-mapped flag', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('Meta', 'c2')]: ['p1'], // p1 multi-mapped
        [k('Meta', 'c3')]: ['p2'], // p2 solo
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1') }),
        makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2' }),
        makeAgg({ key: k('Meta', 'c3'), campaignId: 'c3' }),
      ],
      productNetRevenue: new Map([['p1', 1000], ['p2', 500]]),
    });
    expect(rows).toHaveLength(2);
    const p1 = rows.find(r => r.productId === 'p1')!;
    const p2 = rows.find(r => r.productId === 'p2')!;
    expect(p1.isMultiMapped).toBe(true);
    expect(p2.isMultiMapped).toBe(false);
  });

  it('sorts rows by total net revenue desc', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1', 'p2'],
      },
      aggregated: [makeAgg({ key: k('Meta', 'c1') })],
      productNetRevenue: new Map([['p1', 100], ['p2', 999]]),
    });
    expect(rows[0].productId).toBe('p2'); // higher revenue first
    expect(rows[1].productId).toBe('p1');
  });
});

describe('buildProductCentricView — share computation', () => {
  it('intra-platform spend share sums to 1 within each platform', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('Meta', 'c2')]: ['p1'],
        [k('Meta', 'c3')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1'), spend: 100 }),
        makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2', spend: 200 }),
        makeAgg({ key: k('Meta', 'c3'), campaignId: 'c3', spend: 700 }),
      ],
      productNetRevenue: new Map([['p1', 1000]]),
    });
    const p1 = rows[0];
    const totalIntra = p1.members.reduce((s, m) => s + m.intraPlatformSpendShare, 0);
    expect(totalIntra).toBeCloseTo(1, 5);
    // Members already sorted by spend desc — biggest share first
    expect(p1.members[0].intraPlatformSpendShare).toBeCloseTo(0.7, 5);
    expect(p1.members[1].intraPlatformSpendShare).toBeCloseTo(0.2, 5);
    expect(p1.members[2].intraPlatformSpendShare).toBeCloseTo(0.1, 5);
  });

  it('total spend share sums to 1 across the whole cohort', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('Meta', 'c2')]: ['p1'],
        [k('TikTok', 't1')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1'), spend: 200 }),
        makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2', spend: 300 }),
        makeAgg({ key: k('TikTok', 't1'), campaignId: 't1', platform: 'TikTok', spend: 500 }),
      ],
      productNetRevenue: new Map([['p1', 2000]]),
    });
    const total = rows[0].members.reduce((s, m) => s + m.totalSpendShare, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('intra-platform share is 1.0 when only one campaign on that platform', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('TikTok', 't1')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1'), spend: 200 }),
        makeAgg({ key: k('TikTok', 't1'), campaignId: 't1', platform: 'TikTok', spend: 300 }),
      ],
      productNetRevenue: new Map([['p1', 1000]]),
    });
    expect(rows[0].members.find(m => m.platform === 'Meta')!.intraPlatformSpendShare).toBe(1);
    expect(rows[0].members.find(m => m.platform === 'TikTok')!.intraPlatformSpendShare).toBe(1);
  });

  it('all-zero-spend cohort yields zero shares (no NaN)', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('Meta', 'c2')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1'), spend: 0, impressions: 1 }),
        makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2', spend: 0, impressions: 1 }),
      ],
      productNetRevenue: new Map([['p1', 100]]),
    });
    // The cohort exists (both campaigns have rows due to impressions),
    // but with 0 spend everywhere the shares are 0 (not NaN).
    for (const m of rows[0].members) {
      expect(m.intraPlatformSpendShare).toBe(0);
      expect(m.totalSpendShare).toBe(0);
      expect(m.platformRoas).toBe(0);
    }
    expect(rows[0].blendedRoas).toBe(0);
  });
});

describe('buildProductCentricView — allocated revenue', () => {
  it('allocated revenue across cohort sums to totalNetRevenue (within rounding)', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('Meta', 'c2')]: ['p1'],
        [k('TikTok', 't1')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1'), spend: 100 }),
        makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2', spend: 300 }),
        makeAgg({ key: k('TikTok', 't1'), campaignId: 't1', platform: 'TikTok', spend: 600 }),
      ],
      productNetRevenue: new Map([['p1', 2000]]),
    });
    const totalAllocated = rows[0].members.reduce(
      (s, m) => s + m.allocatedRevenueEstimate,
      0,
    );
    expect(totalAllocated).toBeCloseTo(2000, 1);
  });

  it('per-platform allocated revenue reflects total spend share', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('TikTok', 't1')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1'), spend: 100 }), // 25% of total
        makeAgg({ key: k('TikTok', 't1'), campaignId: 't1', platform: 'TikTok', spend: 300 }), // 75%
      ],
      productNetRevenue: new Map([['p1', 1000]]),
    });
    const metaGroup = rows[0].byPlatform.find(p => p.platform === 'Meta')!;
    const tiktokGroup = rows[0].byPlatform.find(p => p.platform === 'TikTok')!;
    expect(metaGroup.intraAllocatedRevenue).toBeCloseTo(250, 1);
    expect(tiktokGroup.intraAllocatedRevenue).toBeCloseTo(750, 1);
  });

  it('blended ROAS = totalNetRevenue / totalCohortSpend', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('Meta', 'c2')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1'), spend: 100 }),
        makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2', spend: 400 }),
      ],
      productNetRevenue: new Map([['p1', 1500]]),
    });
    expect(rows[0].totalCohortSpend).toBe(500);
    expect(rows[0].totalNetRevenue).toBe(1500);
    expect(rows[0].blendedRoas).toBe(3); // 1500/500
  });
});

describe('buildProductCentricView — platform grouping + sort', () => {
  it('groups members by platform with biggest-spend-platform first', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('TikTok', 't1')]: ['p1'],
        [k('Google', 'g1')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1'), spend: 100 }),
        makeAgg({ key: k('TikTok', 't1'), campaignId: 't1', platform: 'TikTok', spend: 500 }),
        makeAgg({ key: k('Google', 'g1'), campaignId: 'g1', platform: 'Google', spend: 250 }),
      ],
      productNetRevenue: new Map([['p1', 850]]),
    });
    expect(rows[0].byPlatform.map(p => p.platform)).toEqual([
      'TikTok', // 500 — biggest
      'Google', // 250
      'Meta', // 100 — smallest
    ]);
  });

  it('handles the user-described 4 Meta + 3 TikTok cohort', () => {
    const productMap: ProductMap = {};
    const aggregated: Aggregated[] = [];
    for (let i = 1; i <= 4; i++) {
      productMap[k('Meta', `m${i}`)] = ['microscope'];
      aggregated.push(
        makeAgg({ key: k('Meta', `m${i}`), campaignId: `m${i}`, spend: 100 + i * 10 }),
      );
    }
    for (let i = 1; i <= 3; i++) {
      productMap[k('TikTok', `t${i}`)] = ['microscope'];
      aggregated.push(
        makeAgg({
          key: k('TikTok', `t${i}`),
          campaignId: `t${i}`,
          platform: 'TikTok',
          spend: 50 + i * 5,
        }),
      );
    }
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap,
      aggregated,
      productNetRevenue: new Map([['microscope', 3000]]),
      productTitles: new Map([['microscope', 'מיקרוסקופ לילדים']]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].productTitle).toBe('מיקרוסקופ לילדים');
    expect(rows[0].members).toHaveLength(7);
    expect(rows[0].byPlatform).toHaveLength(2);
    const meta = rows[0].byPlatform.find(p => p.platform === 'Meta')!;
    const tiktok = rows[0].byPlatform.find(p => p.platform === 'TikTok')!;
    expect(meta.members).toHaveLength(4);
    expect(tiktok.members).toHaveLength(3);
    // Within each platform members sorted by spend desc.
    for (let i = 1; i < meta.members.length; i++) {
      expect(meta.members[i - 1].spend).toBeGreaterThanOrEqual(meta.members[i].spend);
    }
  });

  it('uses productTitles when provided, falls back to productId', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1', 'p2'],
      },
      aggregated: [makeAgg({ key: k('Meta', 'c1') })],
      productNetRevenue: new Map([['p1', 100], ['p2', 200]]),
      productTitles: new Map([['p1', 'Cute Hat']]), // only p1 has a title
    });
    // sorted by revenue desc → p2 first
    expect(rows[0].productId).toBe('p2');
    expect(rows[0].productTitle).toBe('p2'); // no title → id
    expect(rows[1].productId).toBe('p1');
    expect(rows[1].productTitle).toBe('Cute Hat');
  });
});

describe('buildProductCentricView — b/HI-05 zero-spend cohort fallback', () => {
  it('zero-spend cohort with positive revenue → revenue split equally across platforms (not zeroed)', () => {
    // Audit fix 2026-05-23 (b/HI-05): when totalCohortSpend === 0 the
    // previous fallback emitted 0 for every per-platform allocated
    // revenue — silently dropping 100% of the product's Shopify
    // revenue from the per-platform breakdown. Operator saw a product
    // worth $1000 displayed as "Meta: $0 / TikTok: $0" even though
    // the product had real sales.
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('TikTok', 't1')]: ['p1'],
      },
      aggregated: [
        // Both campaigns have a row (so the cohort exists) but ZERO spend
        // in the visible range (impressions/conversions populated by some
        // other path). Operator pattern: backfilled product but campaign
        // paused mid-range.
        makeAgg({ key: k('Meta', 'c1'), spend: 0, impressions: 1, conversions: 0, conversionValue: 0 }),
        makeAgg({ key: k('TikTok', 't1'), campaignId: 't1', platform: 'TikTok', spend: 0, impressions: 1, conversions: 0, conversionValue: 0 }),
      ],
      productNetRevenue: new Map([['p1', 1000]]),
    });
    expect(rows).toHaveLength(1);
    const platformGroups = rows[0].byPlatform;
    expect(platformGroups).toHaveLength(2);
    // 1000 / 2 platforms = 500 each (equal-share fallback).
    for (const g of platformGroups) {
      expect(g.intraAllocatedRevenue).toBe(500);
    }
    // Sum still equals total revenue (no leakage).
    const totalAlloc = platformGroups.reduce((s, g) => s + g.intraAllocatedRevenue, 0);
    expect(totalAlloc).toBe(1000);
  });

  it('zero-spend cohort with positive revenue on a single platform → all revenue allocated', () => {
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1'), spend: 0, impressions: 1, conversions: 0, conversionValue: 0 }),
      ],
      productNetRevenue: new Map([['p1', 500]]),
    });
    expect(rows[0].byPlatform[0].intraAllocatedRevenue).toBe(500);
  });
});

describe('buildProductCentricView — b/HI-03 allocator parity with campaign-centric drawer', () => {
  it('with orders threaded, per-campaign revenue matches allocateProductRevenue output exactly', () => {
    // Audit fix 2026-05-23 (b/HI-03): the product-centric view used a
    // simplified per-platform × intra-share split that ignored the
    // deterministic per-platform attribution the campaign-centric drawer
    // performs via allocateProductRevenue. Same product + same campaign
    // would show DIFFERENT revenue numbers in the two views.
    //
    // Now the view delegates to allocateProductRevenue when orders are
    // provided, so the two views agree on every (product, campaign) tuple.
    const productMap: ProductMap = {
      [k('Meta', 'm1')]: ['p1'],
      [k('TikTok', 't1')]: ['p1'],
    };
    const aggregated = [
      makeAgg({ key: k('Meta', 'm1'), spend: 200 }),
      makeAgg({ key: k('TikTok', 't1'), campaignId: 't1', platform: 'TikTok', spend: 300 }),
    ];
    // Construct an order set where 2 of 3 orders carry a deterministic
    // TikTok signal — TikTok should get the deterministic revenue
    // credited explicitly (not just by spend share).
    const orders = [
      {
        storeId: STORE,
        source: 'tiktok-paid',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: 'p1', units: 1, revenueCad: 100 }],
      },
      {
        storeId: STORE,
        source: 'tiktok-paid',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: 'p1', units: 1, revenueCad: 100 }],
      },
      {
        storeId: STORE,
        source: 'direct',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: 'p1', units: 1, revenueCad: 100 }],
      },
    ];
    const productNetRevenue = new Map([['p1', 300]]);
    const productUnits = new Map([['p1', 3]]);

    const rows = buildProductCentricView({
      storeId: STORE,
      productMap,
      aggregated,
      productNetRevenue,
      productUnits,
      orders,
    });

    // Compute the canonical answer directly via allocateProductRevenue.
    const campaignSpend = new Map<string, number>();
    for (const a of aggregated) campaignSpend.set(a.key, a.spend);
    const canonical = allocateProductRevenue({
      storeId: STORE,
      map: productMap,
      productRevenue: [{ productId: 'p1', netRevenueCad: 300, units: 3 }],
      campaignSpend,
      orders,
    });

    // Each member's allocatedRevenueEstimate must equal the allocator's
    // output for the same campaignKey.
    expect(rows).toHaveLength(1);
    for (const m of rows[0].members) {
      const canonicalRev = canonical.get(m.campaignKey)?.revenue ?? 0;
      expect(m.allocatedRevenueEstimate).toBeCloseTo(canonicalRev, 5);
    }
  });

  it('without orders, falls back to simplified split (backwards compat)', () => {
    // No `orders` provided → uses the pre-fix spend-proportional split.
    // Tests + tools that don't have orders still work.
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [k('Meta', 'c2')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: k('Meta', 'c1'), spend: 100 }),
        makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2', spend: 300 }),
      ],
      productNetRevenue: new Map([['p1', 400]]),
    });
    const sumAlloc = rows[0].members.reduce(
      (s, m) => s + m.allocatedRevenueEstimate,
      0,
    );
    expect(sumAlloc).toBeCloseTo(400, 1);
  });
});
