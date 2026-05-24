import { describe, expect, it } from 'vitest';
import { buildProductCentricView } from '@/lib/productCentricView';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { ProductMap } from '@/lib/campaignProductMap';

/**
 * Audit fix 2026-05-24 (AUDIT ALG-02 + ALG-03 in lib/productCentricView.ts,
 * Phase 12.2.3) — locks the stale-mapped revenue retention + dormant member
 * emission invariants.
 *
 * Pre-fix:
 *   - ALG-02 (line ~272 `if (!member?.agg) continue;`): when the allocator
 *     branch is taken and `allocByCampaign` contains a key whose raw member
 *     has no agg (stale-mapped paused campaign), the allocator-assigned
 *     revenue was silently dropped from `platformAllocatedRevenue`.
 *     Operator saw e.g. $1200 visible vs $1500 totalNetRevenue (300 leak).
 *   - ALG-03 (line ~311 `.filter(r => r.agg !== undefined)`): dormant
 *     cohort members were silently filtered out, contradicting the JSDoc at
 *     lines 178-181 which promises they are kept with zero metrics.
 *
 * Fix (Option A per evidence pack preference): remove both filters. Build
 * raw members with per-key platform/storeId/storeName/campaignId metadata
 * derived from the campaignKey (`${storeId}::${platform}::${campaignId}`),
 * then emit dormant members with zero metrics in the final array. The
 * allocator-assigned revenue for a dormant campaign flows through
 * allocByCampaign.get(key) so sum-conservation is preserved.
 *
 * Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   lib_algorithm_productCentricView.json (ALG-02 + ALG-03).
 * Cross-ref: 12-tests-needed.md HP-21.
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
    ...overrides,
  };
}

describe('productCentricView — ALG-02 + ALG-03 stale + dormant cohort (HP-21)', () => {
  it('ALG-02: stale-mapped TikTok campaign with deterministic order — allocator revenue preserved (sum = totalNetRevenue)', () => {
    // Fixture from raw-returns regression_test_idea for ALG-02:
    //   Cohort: p1 mapped to 3 campaigns:
    //     - uzoshop::Meta::c1 (active, spend=100)
    //     - uzoshop::Meta::c2 (active, spend=200)
    //     - uzoshop::TikTok::t_stale (paused — NOT in aggregated[])
    //   productNetRevenue p1 = 1500.
    //   Orders: 1 tiktok-paid order on p1 with revenueCad=300.
    //
    // Pre-fix: sum(member.allocatedRevenueEstimate) = 1200 (TikTok 300 dropped
    //           via line 272 `if (!member?.agg) continue;` AND line 311
    //           `.filter(r => r.agg !== undefined)`).
    // Post-fix: sum(member.allocatedRevenueEstimate) === 1500 (TikTok 300
    //           preserved as a zero-spend dormant member with allocator-
    //           assigned revenue).
    const productMap: ProductMap = {
      [k('Meta', 'c1')]: ['p1'],
      [k('Meta', 'c2')]: ['p1'],
      [k('TikTok', 't_stale')]: ['p1'], // mapped, but no aggregated row
    };
    const aggregated = [
      makeAgg({ key: k('Meta', 'c1'), campaignId: 'c1', spend: 100 }),
      makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2', spend: 200 }),
      // t_stale missing intentionally — campaign paused throughout the range
    ];
    const orders = [
      {
        storeId: STORE,
        source: 'tiktok-paid', // deterministic TikTok signal
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: 'p1', units: 1, revenueCad: 300 }],
      },
      // Two more orders for spend-proportional remainder (1200 total)
      {
        storeId: STORE,
        source: 'direct',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: 'p1', units: 1, revenueCad: 600 }],
      },
      {
        storeId: STORE,
        source: 'direct',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: 'p1', units: 1, revenueCad: 600 }],
      },
    ];
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap,
      aggregated,
      productNetRevenue: new Map([['p1', 1500]]),
      productUnits: new Map([['p1', 3]]),
      orders,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.totalNetRevenue).toBe(1500);

    // ALG-02 core invariant: member sum equals totalNetRevenue.
    const memberSum = row.members.reduce(
      (s, m) => s + m.allocatedRevenueEstimate,
      0,
    );
    expect(Math.abs(memberSum - 1500)).toBeLessThan(1e-6);

    // Platform sum equals totalNetRevenue too (the stale TikTok platform
    // is now in byPlatform with its allocator-assigned revenue).
    const platformSum = row.byPlatform.reduce(
      (s, p) => s + p.intraAllocatedRevenue,
      0,
    );
    expect(Math.abs(platformSum - 1500)).toBeLessThan(1e-6);

    // TikTok must appear (it was mapped, even though dormant).
    const tiktokGroup = row.byPlatform.find(p => p.platform === 'TikTok');
    expect(tiktokGroup).toBeDefined();
    expect(tiktokGroup!.intraAllocatedRevenue).toBeGreaterThan(0);
  });

  it('ALG-03: dormant cohort member is emitted with zero metrics (matches JSDoc lines 178-181)', () => {
    // Pre-fix: line 311 `.filter(r => r.agg !== undefined)` silently drops
    //          the dormant member. members.length === 1 even though 2
    //          campaigns are mapped in the cohort.
    // Post-fix (Option A): both members emitted; dormant member has
    //          spend=0, conversionValue=0, allocatedRevenueEstimate=0
    //          (no orders → no allocator path → no revenue to credit).
    //          The JSDoc at lines 178-181 promises this behaviour.
    const productMap: ProductMap = {
      [k('Meta', 'c1')]: ['p1'],
      [k('Meta', 'c2_dormant')]: ['p1'], // mapped but no aggregated row
    };
    const aggregated = [
      makeAgg({ key: k('Meta', 'c1'), campaignId: 'c1', spend: 100 }),
      // c2_dormant intentionally missing
    ];
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap,
      aggregated,
      productNetRevenue: new Map([['p1', 500]]),
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.members).toHaveLength(2); // both members present per JSDoc

    const dormant = row.members.find(m => m.campaignKey === k('Meta', 'c2_dormant'));
    expect(dormant).toBeDefined();
    // Zero metrics for dormant member.
    expect(dormant!.spend).toBe(0);
    expect(dormant!.conversionValue).toBe(0);
    expect(dormant!.allocatedRevenueEstimate).toBe(0);
    expect(dormant!.platformRoas).toBe(0);
    // Platform/storeId derived from the campaignKey itself.
    expect(dormant!.platform).toBe('Meta');
    expect(dormant!.storeId).toBe(STORE);
    expect(dormant!.campaignId).toBe('c2_dormant');
  });

  it('ALG-03 (variant): dormant member with allocator branch — allocator-assigned revenue is credited', () => {
    // Same shape as ALG-02 but explicit ALG-03 assertion: when orders
    // thread the allocator branch AND a dormant member is the only
    // campaign on its platform, the deterministic platform revenue is
    // credited to the dormant member (it would otherwise be a residual).
    const productMap: ProductMap = {
      [k('Meta', 'c1')]: ['p1'],
      [k('TikTok', 't_dormant')]: ['p1'], // mapped but no agg
    };
    const aggregated = [
      makeAgg({ key: k('Meta', 'c1'), campaignId: 'c1', spend: 100 }),
    ];
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
        source: 'direct',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: 'p1', units: 1, revenueCad: 100 }],
      },
    ];
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap,
      aggregated,
      productNetRevenue: new Map([['p1', 200]]),
      productUnits: new Map([['p1', 2]]),
      orders,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.members).toHaveLength(2);
    const dormant = row.members.find(m => m.campaignKey === k('TikTok', 't_dormant'));
    expect(dormant).toBeDefined();
    expect(dormant!.spend).toBe(0);
    // The deterministic tiktok-paid order ($100) flows through allocator
    // to t_dormant (sole TikTok mapped key). Without ALG-02/03 fix this
    // would be 0; with the fix it's 100.
    expect(dormant!.allocatedRevenueEstimate).toBeGreaterThan(0);
  });

  it('ALG-01 regression guard: zero-spend cohort sum-conservation invariant still holds (no regression from 12.1.3)', () => {
    // Reuse the productCentricViewSumConservation.test.ts fixture shape
    // for the ALG-01 invariant. The Option A fix must not break the 12.1.3
    // intraRevShare separation.
    const metaAgg = makeAgg({
      key: k('Meta', 'c1'),
      campaignId: 'c1',
      platform: 'Meta',
      spend: 0,
      impressions: 1,
      conversions: 0,
      conversionValue: 0,
    });
    const tiktokAgg = makeAgg({
      key: k('TikTok', 't1'),
      campaignId: 't1',
      platform: 'TikTok',
      spend: 0,
      impressions: 1,
      conversions: 0,
      conversionValue: 0,
    });
    const productMap: ProductMap = {
      [k('Meta', 'c1')]: ['p1'],
      [k('TikTok', 't1')]: ['p1'],
    };
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap,
      aggregated: [metaAgg, tiktokAgg],
      productNetRevenue: new Map([['p1', 1000]]),
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];

    // Sum-conservation: 500 + 500 = 1000.
    const memberSum = row.members.reduce(
      (s, m) => s + m.allocatedRevenueEstimate,
      0,
    );
    expect(Math.abs(memberSum - 1000)).toBeLessThan(1e-9);
  });
});
