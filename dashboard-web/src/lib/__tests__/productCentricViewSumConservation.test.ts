import { describe, expect, it } from 'vitest';
import { buildProductCentricView } from '@/lib/productCentricView';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { ProductMap } from '@/lib/campaignProductMap';

/**
 * Audit fix 2026-05-24 (AUDIT ALG-01 in lib/productCentricView.ts,
 * Phase 12.1.3) — locks the sum-conservation invariant for the
 * product-centric per-platform allocation.
 *
 * Pre-fix: in the no-allocator (simplified-split) branch at lines
 * 289-301, when a cohort has zero total spend but positive net
 * revenue (b/HI-05 fix correctly sets byPlatform.intraAllocatedRevenue
 * = totalNetRevenue / platformCount), the per-member
 * allocatedRevenueEstimate stays at 0 because intraShare = a.spend /
 * intraTotal = 0/0 = 0. So platformRev * intraShare = 500 * 0 = 0.
 * Operator sees CAD 0 rows under a CAD 500 platform header.
 *
 * Fix: SEPARATE the UI-spend-share (still 0 when spend=0, operator-
 * correct) from the revenue-allocation-share (falls back to
 * 1/platformMembers.length when intraTotal === 0). Conserves the
 * platform sum and aligns with the b/HI-05 equal-platform semantic.
 *
 * Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   lib_algorithm_productCentricView.json (ALG-01).
 * Cross-ref: 12-tests-needed.md HP-21.
 *
 * SCOPE NOTE (per CONTEXT.md D-05): ALG-02 (stale-mapped revenue leak),
 * ALG-04 (productUnits silent corruption), ALG-05 (zero-spend + non-empty
 * orders divergence), ALG-06 (isMultiMapped semantic), ALG-07 (cross-
 * product correctness hypothesis), ALG-08 (O(n²) perf) deferred to
 * Phase 12.2. Test cases 2-4 below use minimum-invariant assertions
 * (sum-conservation only) so they pass with the current 12.1 minimal
 * ALG-01 fix without locking decisions for the deferred findings.
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

describe('productCentricView sum-conservation — ALG-01 regression suite (HP-21)', () => {
  it('ALG-01: zero-spend cohort sum-conservation (member.allocatedRevenueEstimate sums to totalNetRevenue)', () => {
    // Pre-fix: byPlatform.intraAllocatedRevenue=500/500 (b/HI-05 fix correct)
    // but each member's allocatedRevenueEstimate=0 because:
    //   intraTotal = platformSpend.get(a.platform) = 0
    //   intraShare = a.spend / intraTotal = 0/0 = 0
    //   allocatedRev = platformRev * intraShare = 500 * 0 = 0
    // Operator saw CAD 0 rows under a CAD 500 platform header.
    //
    // Post-fix: when intraTotal === 0, intraRevShare falls back to
    // 1/platformMembers.length so per-member allocated = platformRev/N.
    const metaAgg = makeAgg({
      key: k('Meta', 'c1'),
      campaignId: 'c1',
      campaignName: 'Meta C1',
      platform: 'Meta',
      spend: 0,
      impressions: 1,
      conversions: 0,
      conversionValue: 0,
    });
    const tiktokAgg = makeAgg({
      key: k('TikTok', 't1'),
      campaignId: 't1',
      campaignName: 'TikTok T1',
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
    expect(row.totalNetRevenue).toBe(1000);

    // Sum-conservation across members — the core ALG-01 invariant.
    const memberSum = row.members.reduce(
      (s, m) => s + m.allocatedRevenueEstimate,
      0,
    );
    expect(Math.abs(memberSum - 1000)).toBeLessThan(1e-9);

    // Each single-member platform's member receives exactly that platform's
    // allocation (500 + 500 = 1000).
    const metaMember = row.members.find(m => m.platform === 'Meta');
    const tiktokMember = row.members.find(m => m.platform === 'TikTok');
    expect(metaMember).toBeDefined();
    expect(tiktokMember).toBeDefined();
    expect(metaMember!.allocatedRevenueEstimate).toBeCloseTo(500, 9);
    expect(tiktokMember!.allocatedRevenueEstimate).toBeCloseTo(500, 9);

    // UI-spend-share remains 0 (operator-correct: spend share IS zero).
    // The fix SEPARATES revenue allocation from spend-share UI rendering.
    expect(metaMember!.intraPlatformSpendShare).toBe(0);
    expect(tiktokMember!.intraPlatformSpendShare).toBe(0);
  });

  it('ALG-01 (variant): zero-spend cohort with 2 members on SAME platform — both share platform revenue equally', () => {
    // Multi-member-per-platform variant: 2 Meta campaigns, both zero-spend.
    // Platform Meta gets all of totalNetRevenue (single platform), and the
    // two members must split it equally (500 each).
    const a = makeAgg({
      key: k('Meta', 'a'),
      campaignId: 'a',
      campaignName: 'A',
      spend: 0,
      impressions: 1,
      conversions: 0,
      conversionValue: 0,
    });
    const b = makeAgg({
      key: k('Meta', 'b'),
      campaignId: 'b',
      campaignName: 'B',
      spend: 0,
      impressions: 1,
      conversions: 0,
      conversionValue: 0,
    });
    const productMap: ProductMap = {
      [k('Meta', 'a')]: ['p1'],
      [k('Meta', 'b')]: ['p1'],
    };
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap,
      aggregated: [a, b],
      productNetRevenue: new Map([['p1', 1000]]),
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.byPlatform).toHaveLength(1);
    expect(row.byPlatform[0].intraAllocatedRevenue).toBe(1000);

    // Sum-conservation: 500 + 500 = 1000.
    const memberSum = row.members.reduce(
      (s, m) => s + m.allocatedRevenueEstimate,
      0,
    );
    expect(memberSum).toBeCloseTo(1000, 9);
    for (const m of row.members) {
      expect(m.allocatedRevenueEstimate).toBeCloseTo(500, 9);
    }
  });

  it('stale-mapped cohort: allocator branch still produces sum-conservation among ACTIVE members', () => {
    // HP-21 Test 2 — stale-mapped scenario. Allocator branch taken (orders
    // provided). Per ALG-02 (DEFERRED to Phase 12.2 per CONTEXT.md D-05),
    // the stale member is currently dropped from members[]. For this 12.1
    // scope we assert only the sum-conservation invariant across the
    // SURVIVING (post-filter) members + the platform totals stay consistent
    // with each other — NOT a fix for ALG-02 itself.
    //
    // Setup: 2 active Meta campaigns (c1, c2) + 1 stale TikTok (t_stale,
    // mapped but no agg). Orders include direct-source order on p1 — no
    // deterministic TikTok signal, so allocator does spend-proportional
    // across Meta only.
    const productMap: ProductMap = {
      [k('Meta', 'c1')]: ['p1'],
      [k('Meta', 'c2')]: ['p1'],
      [k('TikTok', 't_stale')]: ['p1'], // mapped, but no aggregated row
    };
    const aggregated = [
      makeAgg({ key: k('Meta', 'c1'), campaignId: 'c1', spend: 100 }),
      makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2', spend: 200 }),
      // t_stale missing intentionally
    ];
    const orders = [
      {
        storeId: STORE,
        source: 'direct',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: 'p1', units: 1, revenueCad: 300 }],
      },
    ];
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap,
      aggregated,
      productNetRevenue: new Map([['p1', 300]]),
      productUnits: new Map([['p1', 1]]),
      orders,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];

    // No NaN/Infinity in any member's allocation.
    for (const m of row.members) {
      expect(Number.isFinite(m.allocatedRevenueEstimate)).toBe(true);
      expect(m.allocatedRevenueEstimate).toBeGreaterThanOrEqual(0);
    }

    // Among the SURVIVING members + platforms, the per-member sum equals
    // the per-platform sum. ALG-02 (stale revenue leak vs totalNetRevenue)
    // is deferred — we only pin internal consistency here.
    const memberSumByPlatform = new Map<string, number>();
    for (const m of row.members) {
      memberSumByPlatform.set(
        m.platform,
        (memberSumByPlatform.get(m.platform) ?? 0) + m.allocatedRevenueEstimate,
      );
    }
    for (const platformGroup of row.byPlatform) {
      const memberSum = memberSumByPlatform.get(platformGroup.platform) ?? 0;
      expect(Math.abs(memberSum - platformGroup.intraAllocatedRevenue)).toBeLessThan(
        1e-6,
      );
    }
  });

  it('productUnits omitted: allocator-branch input survives without producing NaN', () => {
    // HP-21 Test 3 — minimum-invariant ALG-04 guard. ALG-04 (silent units=0
    // corruption) is DEFERRED to Phase 12.2 per CONTEXT.md D-05. For 12.1
    // scope the only assertion is: result is non-null AND no member's
    // allocatedRevenueEstimate is NaN. The deeper fix (warning + simplified-
    // split fallback) lands in 12.2.
    const productMap: ProductMap = {
      [k('Meta', 'c1')]: ['p1'],
      [k('Meta', 'c2')]: ['p1'],
    };
    const aggregated = [
      makeAgg({ key: k('Meta', 'c1'), campaignId: 'c1', spend: 100 }),
      makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2', spend: 300 }),
    ];
    // productUnits intentionally OMITTED — orders provided so allocator
    // branch is taken with units=0 fallback.
    const orders = [
      {
        storeId: STORE,
        source: 'direct',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [{ productId: 'p1', units: 2, revenueCad: 400 }],
      },
    ];
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap,
      aggregated,
      productNetRevenue: new Map([['p1', 400]]),
      // productUnits omitted
      orders,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // No member allocation is NaN/Infinity — the minimal correctness gate.
    for (const m of row.members) {
      expect(Number.isFinite(m.allocatedRevenueEstimate)).toBe(true);
      expect(m.allocatedRevenueEstimate).toBeGreaterThanOrEqual(0);
    }
  });

  it('cross-product independence: same campaign mapped to two products yields per-product allocations summing correctly', () => {
    // HP-21 Test 4 — minimum-invariant ALG-07 guard. ALG-07 (cross-product
    // correctness hypothesis) is DEFERRED to Phase 12.2 per CONTEXT.md D-05.
    // For 12.1 scope we assert only that per-product allocator runs are
    // INTERNALLY consistent (each product's sum matches its totalNetRevenue
    // when in the simplified-split branch with spend>0).
    //
    // Setup: ONE shared Meta campaign c1 mapped to BOTH p1 and p2 +
    // dedicated Meta campaigns m1 (only p1) and m2 (only p2). No orders.
    // Each product's blended cohort sum should equal its totalNetRevenue.
    const productMap: ProductMap = {
      [k('Meta', 'c1')]: ['p1', 'p2'], // shared across two products
      [k('Meta', 'm1')]: ['p1'],
      [k('Meta', 'm2')]: ['p2'],
    };
    const aggregated = [
      makeAgg({ key: k('Meta', 'c1'), campaignId: 'c1', spend: 100 }),
      makeAgg({ key: k('Meta', 'm1'), campaignId: 'm1', spend: 200 }),
      makeAgg({ key: k('Meta', 'm2'), campaignId: 'm2', spend: 300 }),
    ];
    const rows = buildProductCentricView({
      storeId: STORE,
      productMap,
      aggregated,
      productNetRevenue: new Map([['p1', 600], ['p2', 900]]),
    });
    expect(rows).toHaveLength(2);

    // Per-product sum-conservation: each product's member sum equals its
    // totalNetRevenue (simplified-split branch with spend>0 — pre-existing
    // invariant, but pinned here too to catch cross-product regression).
    for (const row of rows) {
      const memberSum = row.members.reduce(
        (s, m) => s + m.allocatedRevenueEstimate,
        0,
      );
      expect(Math.abs(memberSum - row.totalNetRevenue)).toBeLessThan(1e-6);

      // No NaN/Infinity from cross-product accounting.
      for (const m of row.members) {
        expect(Number.isFinite(m.allocatedRevenueEstimate)).toBe(true);
      }
    }
  });
});
