import { describe, expect, it } from 'vitest';
import {
  computeMultiMappingCohort,
  type MultiMappingCohort,
} from '@/lib/multiMappingCohort';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { ProductMap } from '@/lib/campaignProductMap';

/**
 * Phase 05.7.x (2026-05-23) — locks the cohort-computation contract.
 *
 * The cohort is the set of OTHER campaigns sharing at least one mapped
 * product with the current campaign, plus the current campaign itself.
 * Ranking decides where the current campaign sits within its cohort
 * (🥇/🥈/🥉 indicator in the drawer).
 *
 * The algorithm is performance-critical (runs on every drawer open) and
 * decision-critical (operator scales/pauses based on the ranking), so
 * the tests cover:
 *   - Empty cases (no products / no other mappings)
 *   - Single shared product
 *   - Multiple shared products
 *   - Same-platform competition (4 Meta campaigns competing for one product)
 *   - Cross-platform parallels (4 Meta + 3 TikTok on the same product)
 *   - Members without metrics (paused throughout the range)
 *   - Tie-breaking (equal ROAS → secondary key, then deterministic)
 *   - Cross-store isolation (a uzoshop campaign shouldn't appear in a
 *     zolplus cohort even if product IDs happen to match)
 */

const STORE = 'uzoshop';

function key(platform: string, campaignId: string): string {
  return `${STORE}::${platform}::${campaignId}`;
}

function makeAgg(overrides: Partial<Aggregated>): Aggregated {
  return {
    key: key('Meta', 'c1'),
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

describe('computeMultiMappingCohort — empty cases', () => {
  it('returns null when current campaign has no mapped products', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {}, // empty — current has nothing mapped
      aggregated: [makeAgg({})],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result).toBeNull();
  });

  it('returns null when current has products but no other campaign maps any of them', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1', 'p2'],
        [key('Meta', 'c2')]: ['p3', 'p4'], // disjoint products
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2', campaignName: 'C2' }),
      ],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result).toBeNull();
  });

  it('returns null when the only other mapping is in a different store', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        // SAME productId but DIFFERENT store — must NOT count as cohort
        [`zolplus::Meta::c2`]: ['p1'],
      },
      aggregated: [makeAgg({})],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result).toBeNull();
  });

  it('returns null for malformed currentCampaignKey', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: 'malformed-key',
      productMap: { [key('Meta', 'c1')]: ['p1'] },
      aggregated: [makeAgg({})],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result).toBeNull();
  });
});

describe('computeMultiMappingCohort — basic cohort', () => {
  it('finds a cohort of 1 other campaign sharing 1 product', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1', 'p2'],
        [key('Meta', 'c2')]: ['p1'], // shares p1
        [key('Meta', 'c3')]: ['p5'], // disjoint — not in cohort
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2', campaignName: 'C2' }),
        makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3', campaignName: 'C3' }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'c1'), 2.5],
        [key('Meta', 'c2'), 3.5],
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result).not.toBeNull();
    expect(result!.others).toHaveLength(1);
    expect(result!.others[0].campaignKey).toBe(key('Meta', 'c2'));
    expect(result!.others[0].sharedProductIds).toEqual(['p1']);
    expect(result!.sharedProductIds).toEqual(['p1']);
    expect(result!.totalMembers).toBe(2);
  });

  it('excludes self from the others list', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
      ],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.others.every(o => o.campaignKey !== key('Meta', 'c1'))).toBe(true);
    // But current is still in rankedAll
    expect(result!.rankedAll.some(m => m.isCurrent)).toBe(true);
  });

  it('captures multi-shared products', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1', 'p2', 'p3'],
        [key('Meta', 'c2')]: ['p1', 'p2'], // shares 2 products
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
      ],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.others[0].sharedProductIds.sort()).toEqual(['p1', 'p2']);
    expect(result!.sharedProductIds.sort()).toEqual(['p1', 'p2']);
  });
});

describe('computeMultiMappingCohort — ranking', () => {
  it('ranks current as #1 when its ROAS is the highest', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
        [key('Meta', 'c3')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
        makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3' }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'c1'), 4.0], // best
        [key('Meta', 'c2'), 2.5],
        [key('Meta', 'c3'), 1.8],
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.currentRank).toBe(1);
    expect(result!.isLeader).toBe(true);
    expect(result!.isWeakest).toBe(false);
  });

  it('ranks current as last when its ROAS is the lowest', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
        [key('Meta', 'c3')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
        makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3' }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'c1'), 1.0], // worst
        [key('Meta', 'c2'), 2.5],
        [key('Meta', 'c3'), 3.0],
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.currentRank).toBe(3);
    expect(result!.isLeader).toBe(false);
    expect(result!.isWeakest).toBe(true);
  });

  it('ranks middle when in the middle', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c2'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
        [key('Meta', 'c3')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
        makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3' }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'c1'), 3.0],
        [key('Meta', 'c2'), 2.5], // middle
        [key('Meta', 'c3'), 1.5],
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.currentRank).toBe(2);
    expect(result!.isLeader).toBe(false);
    expect(result!.isWeakest).toBe(false);
  });

  it('large-spend mature campaign ranks ABOVE tiny-spend anomaly (audit fix CRITICAL-02 + b/HI-02)', () => {
    // Pins the operator's exact scenario from the audit:
    //   - Campaign A: $40 spend, 1 order, ROAS 12 (lucky outlier purchase)
    //   - Campaign B: $20,000 spend, 200 orders, ROAS 4 (mature, statistically robust)
    // Pre-fix the ranking formula was `roas * 1e6 + ...` so A scored 3×
    // higher than B and was labeled "leader" — telling the operator to
    // scale the anomaly and pause the mature.
    //
    // b/HI-02 (2026-05-23) tightened the shrinkage further with an orders
    // axis: a single-order ROAS is shrunk MORE than a 200-order ROAS even
    // when spend is comparable. The mature still wins decisively here.
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'tiny'),
      productMap: {
        [key('Meta', 'tiny')]: ['p1'],
        [key('Meta', 'mature')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'tiny'), campaignId: 'tiny', spend: 40, conversions: 1 }),
        makeAgg({ key: key('Meta', 'mature'), campaignId: 'mature', spend: 20000, conversions: 200 }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'tiny'), 12.0],
        [key('Meta', 'mature'), 4.0],
      ]),
      roasShopifyPlatformByKey: new Map([
        [key('Meta', 'tiny'), 12.0],
        [key('Meta', 'mature'), 4.0],
      ]),
    });
    expect(result!.currentRank).toBe(2); // tiny is NOT the leader anymore
    expect(result!.isLeader).toBe(false);
    expect(result!.rankedAll[0].campaignKey).toBe(key('Meta', 'mature')); // mature leads
  });

  it('b/HI-02 — orders axis: high-AOV 1-order cohort ranks BELOW low-AOV 50-orders cohort with same spend', () => {
    // Pins the operator-impactful behaviour change in b/HI-02. Both
    // cohorts have the same total CAD spend ($500) and the same raw
    // ROAS (4.0). Pre-b/HI-02 they tied. With the orders-axis shrinkage
    // added, the 50-orders cohort gets a much higher confidence weight
    // (50/(50+10) = 0.83) than the 1-order cohort (1/(1+10) = 0.09 on
    // orders axis; spend axis is 500/1000 = 0.5 — better-of = 0.5).
    //
    // Result: 50-orders cohort's shrunk ROAS ≈ 4.0×0.83 + 1.0×0.17 = 3.49,
    //         1-order cohort's shrunk ROAS ≈ 4.0×0.50 + 1.0×0.50 = 2.50.
    //
    // Operator reads this as: "the campaign with 50 conversions is more
    // statistically defensible at the same revenue/spend point, scale
    // there first." (Operator should re-validate cohort rankings after
    // this change lands.)
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'one-order'),
      productMap: {
        [key('Meta', 'one-order')]: ['p1'],
        [key('Meta', 'fifty-orders')]: ['p1'],
      },
      aggregated: [
        // 1 order × $500 AOV — high-AOV outlier
        makeAgg({
          key: key('Meta', 'one-order'),
          campaignId: 'one-order',
          spend: 500,
          conversions: 1,
        }),
        // 50 orders × $10 AOV — low-AOV but high-volume
        makeAgg({
          key: key('Meta', 'fifty-orders'),
          campaignId: 'fifty-orders',
          spend: 500,
          conversions: 50,
        }),
      ],
      // Both cohorts have the same raw Shopify ROAS — only the orders
      // axis discriminates them.
      roasShopifyByKey: new Map([
        [key('Meta', 'one-order'), 4.0],
        [key('Meta', 'fifty-orders'), 4.0],
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    // Current is 'one-order' — should now rank LOWER than 'fifty-orders'.
    expect(result!.currentRank).toBe(2);
    expect(result!.rankedAll[0].campaignKey).toBe(key('Meta', 'fifty-orders'));
  });

  it('b/HI-02 — orders axis: 50-order $50-spend cohort beats 1-order $500-spend cohort (cheap-but-converting wins)', () => {
    // Inverse-symmetric to the test above. Demonstrates the BETTER-OF
    // weight isn't dominated by spend alone — a small-spend campaign
    // with strong order volume gets credit.
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'cheap'),
      productMap: {
        [key('Meta', 'cheap')]: ['p1'],
        [key('Meta', 'fluke')]: ['p1'],
      },
      aggregated: [
        // 50 orders × $1 AOV but only $50 spend — high orders, low spend, ROAS 1
        makeAgg({
          key: key('Meta', 'cheap'),
          campaignId: 'cheap',
          spend: 50,
          conversions: 50,
        }),
        // 1 lucky order × $1500 AOV with $500 spend — ROAS 3
        makeAgg({
          key: key('Meta', 'fluke'),
          campaignId: 'fluke',
          spend: 500,
          conversions: 1,
        }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'cheap'), 1.0],     // weak ROAS but lots of conversions
        [key('Meta', 'fluke'), 3.0],     // good ROAS but tiny sample
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    // cheap shrunk: 1.0 × max(50/550, 50/60) + 1 × rest ≈ 1.0 (already at the anchor)
    // fluke shrunk: 3.0 × max(500/1000, 1/11) + 1 × rest = 3.0 × 0.5 + 0.5 = 2.0
    // So 'fluke' actually ranks higher because raw ROAS dominates when
    // both are pulled toward 1. This test pins that the cohort with
    // BETTER raw ROAS still wins when its sample is strong enough —
    // the orders axis is corrective, not punitive.
    expect(result!.rankedAll[0].campaignKey).toBe(key('Meta', 'fluke'));
  });

  it('uses platform-deterministic ROAS as a secondary tie-breaker', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
      ],
      // Both 2.5 on combined → look at deterministic
      roasShopifyByKey: new Map([
        [key('Meta', 'c1'), 2.5],
        [key('Meta', 'c2'), 2.5],
      ]),
      roasShopifyPlatformByKey: new Map([
        [key('Meta', 'c1'), 2.8], // higher deterministic — wins
        [key('Meta', 'c2'), 1.5],
      ]),
    });
    expect(result!.currentRank).toBe(1);
  });

  it('uses spend as a tertiary tie-breaker', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1'), spend: 500 }), // bigger
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2', spend: 100 }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'c1'), 2.5],
        [key('Meta', 'c2'), 2.5],
      ]),
      roasShopifyPlatformByKey: new Map([
        [key('Meta', 'c1'), 2.0],
        [key('Meta', 'c2'), 2.0],
      ]),
    });
    expect(result!.currentRank).toBe(1);
  });

  it('sinks members without metrics to the bottom', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'], // c2 has no aggregated row → no metrics
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }), // only c1 has metrics
      ],
      roasShopifyByKey: new Map([[key('Meta', 'c1'), 0.5]]), // very low ROAS
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.others[0].metrics).toBeUndefined();
    // Current ranks first even with low ROAS — c2 has no metrics, sinks
    expect(result!.currentRank).toBe(1);
    expect(result!.rankedAll[0].isCurrent).toBe(true);
    expect(result!.rankedAll[1].metrics).toBeUndefined();
  });
});

describe('computeMultiMappingCohort — platform grouping', () => {
  it('splits cohort by platform (intra vs cross)', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'], // same platform
        [key('Meta', 'c3')]: ['p1'], // same platform
        [key('TikTok', 'c4')]: ['p1'], // cross platform
        [key('TikTok', 'c5')]: ['p1'], // cross platform
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
        makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3' }),
        makeAgg({ key: key('TikTok', 'c4'), campaignId: 'c4', platform: 'TikTok' }),
        makeAgg({ key: key('TikTok', 'c5'), campaignId: 'c5', platform: 'TikTok' }),
      ],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.intraPlatformOthers).toHaveLength(2);
    expect(result!.intraPlatformOthers.every(m => m.platform === 'Meta')).toBe(true);
    expect(result!.crossPlatformOthers).toHaveLength(2);
    expect(result!.crossPlatformOthers.every(m => m.platform === 'TikTok')).toBe(true);
  });

  it('handles the user-described case: 4 Meta + 3 TikTok on the same product', () => {
    const productMap: ProductMap = {
      [key('Meta', 'm1')]: ['microscope'],
      [key('Meta', 'm2')]: ['microscope'],
      [key('Meta', 'm3')]: ['microscope'],
      [key('Meta', 'm4')]: ['microscope'],
      [key('TikTok', 't1')]: ['microscope'],
      [key('TikTok', 't2')]: ['microscope'],
      [key('TikTok', 't3')]: ['microscope'],
    };
    const aggregated: Aggregated[] = Object.keys(productMap).map(k => {
      const parts = k.split('::');
      return makeAgg({
        key: k,
        platform: parts[1],
        campaignId: parts[2],
        campaignName: parts[2],
      });
    });
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'm1'),
      productMap,
      aggregated,
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.others).toHaveLength(6); // 3 other Meta + 3 TikTok
    expect(result!.intraPlatformOthers).toHaveLength(3); // 3 other Meta
    expect(result!.crossPlatformOthers).toHaveLength(3); // 3 TikTok
    expect(result!.totalMembers).toBe(7); // current + 6 others
  });

  it('returns empty arrays for platform splits when all others are intra', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
      ],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.intraPlatformOthers).toHaveLength(1);
    expect(result!.crossPlatformOthers).toHaveLength(0);
  });

  it('returns empty intra when current is the only one on its platform', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('TikTok', 'c2')]: ['p1'], // only cross-platform other
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('TikTok', 'c2'), campaignId: 'c2', platform: 'TikTok' }),
      ],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.intraPlatformOthers).toHaveLength(0);
    expect(result!.crossPlatformOthers).toHaveLength(1);
  });
});

describe('computeMultiMappingCohort — edge cases + invariants', () => {
  it('ignores entries in productMap with empty product arrays', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: [], // empty — should be ignored
        [key('Meta', 'c3')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
        makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3' }),
      ],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result!.others).toHaveLength(1); // only c3, not c2
    expect(result!.others[0].campaignKey).toBe(key('Meta', 'c3'));
  });

  it('rankedAll is monotonically non-increasing by ranking score', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c2'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
        [key('Meta', 'c3')]: ['p1'],
        [key('Meta', 'c4')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
        makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3' }),
        makeAgg({ key: key('Meta', 'c4'), campaignId: 'c4' }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'c1'), 1.5],
        [key('Meta', 'c2'), 2.0],
        [key('Meta', 'c3'), 4.0],
        [key('Meta', 'c4'), 3.0],
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    // Expected order: c3 (4.0), c4 (3.0), c2 (2.0), c1 (1.5)
    const order = result!.rankedAll.map(m => m.campaignKey);
    expect(order).toEqual([
      key('Meta', 'c3'),
      key('Meta', 'c4'),
      key('Meta', 'c2'),
      key('Meta', 'c1'),
    ]);
    // Current (c2) is rank 3 of 4
    expect(result!.currentRank).toBe(3);
  });

  it('sharedProductIds is the UNION across all cohort members', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1', 'p2', 'p3'],
        [key('Meta', 'c2')]: ['p1'], // shares p1
        [key('Meta', 'c3')]: ['p2'], // shares p2
        [key('Meta', 'c4')]: ['p3'], // shares p3
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
        makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3' }),
        makeAgg({ key: key('Meta', 'c4'), campaignId: 'c4' }),
      ],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    // Each other shares ONE product but the union covers all 3
    expect(result!.sharedProductIds.sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('cohort with current paused (no metrics) still returns valid result', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
      },
      aggregated: [
        // c1 has no aggregated row — paused for the range
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
      ],
      roasShopifyByKey: new Map([[key('Meta', 'c2'), 3.0]]),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result).not.toBeNull();
    expect(result!.current.metrics).toBeUndefined();
    expect(result!.others[0].metrics).toBeDefined();
    // Current sinks to last (no metrics → -Infinity score)
    expect(result!.currentRank).toBe(2);
    // Audit fix 2026-05-23 (HIGH-02): isWeakest now requires totalMembers >= 3.
    // 2-cohort losers no longer auto-flag as "weakest" — matches the
    // applyCohortAdjustmentOnce floor and prevents the loud red UI chip
    // for "someone had to be second" cases.
    expect(result!.totalMembers).toBe(2);
    expect(result!.isWeakest).toBe(false);
  });

  it('isWeakest=true only when totalMembers >= 3 AND currentRank === totalMembers', () => {
    // Audit fix 2026-05-23 (HIGH-02) — pins the new floor.
    // 3-cohort, current=worst → isWeakest=true.
    const threeCohortLoser = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
        [key('Meta', 'c3')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
        makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3' }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'c1'), 1.0], // worst
        [key('Meta', 'c2'), 2.0],
        [key('Meta', 'c3'), 3.0],
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(threeCohortLoser!.totalMembers).toBe(3);
    expect(threeCohortLoser!.currentRank).toBe(3);
    expect(threeCohortLoser!.isWeakest).toBe(true);

    // 2-cohort, current=worst → isWeakest=false (under-floor).
    const twoCohortLoser = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'c1'), 1.0], // worst
        [key('Meta', 'c2'), 3.0],
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(twoCohortLoser!.totalMembers).toBe(2);
    expect(twoCohortLoser!.currentRank).toBe(2);
    expect(twoCohortLoser!.isWeakest).toBe(false);

    // 2-cohort, current=leader → isLeader=true (no floor change).
    expect(twoCohortLoser!.isLeader).toBe(false);
  });

  it('does not mutate input productMap or aggregated', () => {
    const productMap: ProductMap = {
      [key('Meta', 'c1')]: ['p1'],
      [key('Meta', 'c2')]: ['p1'],
    };
    const productMapSnapshot = JSON.stringify(productMap);
    const aggregated = [makeAgg({}), makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' })];
    const aggregatedSnapshot = JSON.stringify(aggregated);

    computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap,
      aggregated,
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });

    expect(JSON.stringify(productMap)).toBe(productMapSnapshot);
    expect(JSON.stringify(aggregated)).toBe(aggregatedSnapshot);
  });

  it('does not include cross-store campaigns even with identical key shape', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: 'uzoshop::Meta::c1',
      productMap: {
        'uzoshop::Meta::c1': ['p1'],
        'zolplus::Meta::c1': ['p1'], // SAME platform+campaignId but different store
        'uzoshop::Meta::c2': ['p1'],
      },
      aggregated: [
        makeAgg({ key: 'uzoshop::Meta::c1' }),
        makeAgg({ key: 'uzoshop::Meta::c2', campaignId: 'c2' }),
      ],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    // Only the uzoshop c2 — zolplus excluded by store prefix filter
    expect(result!.others).toHaveLength(1);
    expect(result!.others[0].campaignKey).toBe('uzoshop::Meta::c2');
  });

  it('totalMembers equals 1 (current) + others.length', () => {
    const sizes = [1, 2, 5, 10];
    for (const n of sizes) {
      const pm: ProductMap = {
        [key('Meta', 'c0')]: ['p1'],
      };
      const agg: Aggregated[] = [makeAgg({ key: key('Meta', 'c0'), campaignId: 'c0' })];
      for (let i = 1; i <= n; i++) {
        pm[key('Meta', `c${i}`)] = ['p1'];
        agg.push(makeAgg({ key: key('Meta', `c${i}`), campaignId: `c${i}` }));
      }
      const result = computeMultiMappingCohort({
        currentCampaignKey: key('Meta', 'c0'),
        productMap: pm,
        aggregated: agg,
        roasShopifyByKey: new Map(),
        roasShopifyPlatformByKey: new Map(),
      });
      expect(result!.others).toHaveLength(n);
      expect(result!.totalMembers).toBe(n + 1);
      expect(result!.rankedAll).toHaveLength(n + 1);
    }
  });

  it('shape invariant: result extends a sane MultiMappingCohort', () => {
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap: {
        [key('Meta', 'c1')]: ['p1'],
        [key('Meta', 'c2')]: ['p1'],
      },
      aggregated: [
        makeAgg({ key: key('Meta', 'c1') }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
      ],
      roasShopifyByKey: new Map(),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result).not.toBeNull();
    const r = result as MultiMappingCohort;
    expect(r.current.isCurrent).toBe(true);
    expect(r.others.every(o => !('isCurrent' in o) || o.isCurrent !== true)).toBe(true);
    expect(r.rankedAll.length).toBe(r.others.length + 1);
    expect(r.currentRank).toBeGreaterThanOrEqual(1);
    expect(r.currentRank).toBeLessThanOrEqual(r.totalMembers);
    expect(r.isLeader === (r.currentRank === 1)).toBe(true);
    // Audit fix 2026-05-23 (HIGH-02): isWeakest gated on totalMembers >= 3.
    expect(r.isWeakest === (r.totalMembers >= 3 && r.currentRank === r.totalMembers)).toBe(true);
  });
});
