import { describe, expect, it } from 'vitest';
import {
  computeMultiMappingCohort,
  type MultiMappingCohort,
} from '@/lib/multiMappingCohort';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { ProductMap } from '@/lib/campaignProductMap';

/**
 * Audit fix 2026-05-24 (AUDIT MMC-BLOCKER-01, Phase 12.1.3) — locks
 * the cohort ranking contract per TG-05.
 *
 * Pre-fix: rankingScore at lines 194-205 used a composite-key formula
 * (shrunk * 1_000_000 + shrunkPlat * 1_000 + spend). For tiny-spend
 * deterministic ROAS scenarios (roasShopifyPlatform > ~2500), the
 * secondary tier overflowed past the primary's magnitude and FLIPPED
 * the winner. Operator-visible: rank chip 🥇/🥈/🥉 inverted in the
 * cohort comparison panel, and applyCohortAdjustmentOnce applied the
 * wrong cohort health bonus.
 *
 * Fix: replace rankingScore with a tuple-lexicographic
 * compareCohortMembers(a, b) — primary roasShopify desc, secondary
 * roasShopifyPlatform desc, tertiary spend desc, terminal campaignKey
 * lex asc for deterministic stability. Add Number.isFinite guard on
 * inputs so NaN/Infinity sink to 0 (preventing non-deterministic sort).
 *
 * The fix aligns the cohort SOURCE ranking with the
 * CohortComparisonPanel.compareIntraSectionMembers HIGH-6 fix already
 * shipped (the panel re-sorts each section for DISPLAY, but
 * currentRank/isLeader/isWeakest still come from this source ranking).
 *
 * Folded-in fixes (same file, naturally addressed by BLOCKER-01 fix):
 * - MMC-WARN-01: others array sorted (was insertion-order)
 * - MMC-WARN-03: NaN/Infinity guard on roasShopify inputs
 * - MMC-WARN-04: result.current shares JS reference with rankedAll[currentRank-1]
 * - MMC-WARN-05: terminal lex tiebreaker on campaignKey
 *
 * Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   lib_algorithm_multiMappingCohort.json (MMC-BLOCKER-01 + WARN-01,
 *   WARN-03, WARN-04, WARN-05).
 * Cross-ref: 12-tests-needed.md TG-05.
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
    lastLiveTickAt: null,
    ...overrides,
  };
}

describe('multiMappingCohort ranking — MMC-BLOCKER-01 regression suite (TG-05)', () => {
  it('MMC-BLOCKER-01: tiny-spend extreme roasShopifyPlatform does not overflow primary tier', () => {
    // Pins the exact pathology from raw-returns evidence:
    //   Campaign A {raw roasShopify=2, raw roasShopifyPlatform=5000, spend=10, conversions=10}
    //   Campaign B {raw roasShopify=3, raw roasShopifyPlatform=4,    spend=10, conversions=10}
    // Pre-fix composite key (shrunk*1e6 + shrunkPlat*1e3 + spend):
    //   shrunkA_roas ≈ 1.5, shrunkA_plat ≈ 2500.5 → scoreA ≈ 4,000,510
    //   shrunkB_roas ≈ 2.0, shrunkB_plat ≈ 2.5    → scoreB ≈ 2,002,510
    // A "wins" — secondary tier overflowed past primary. Post-fix tuple-lex:
    // primary roasShopify (B=3 > A=2) wins decisively.
    const a = makeAgg({
      key: key('Meta', 'A'),
      campaignId: 'A',
      campaignName: 'A',
      spend: 10,
      conversions: 10,
      conversionValue: 20,
    });
    const b = makeAgg({
      key: key('Meta', 'B'),
      campaignId: 'B',
      campaignName: 'B',
      spend: 10,
      conversions: 10,
      conversionValue: 30,
    });
    const productMap: ProductMap = {
      [key('Meta', 'A')]: ['p1'],
      [key('Meta', 'B')]: ['p1'],
    };
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'B'),
      productMap,
      aggregated: [a, b],
      roasShopifyByKey: new Map([
        [key('Meta', 'A'), 2],
        [key('Meta', 'B'), 3],
      ]),
      roasShopifyPlatformByKey: new Map([
        [key('Meta', 'A'), 5000],
        [key('Meta', 'B'), 4],
      ]),
    });
    expect(result).not.toBeNull();
    // Primary roasShopify (B=3) wins over A's inflated secondary.
    expect(result!.rankedAll[0].campaignKey).toBe(key('Meta', 'B'));
    expect(result!.isLeader).toBe(true);
    expect(result!.currentRank).toBe(1);
  });

  it('MMC-WARN-04: result.current === result.rankedAll[currentRank - 1] (reference identity)', () => {
    // Pre-fix: rankedAll spread at line 309 and result.current spread at line 328
    // produced TWO separate object copies. Consumer mutation pattern silently failed.
    // Post-fix: single reference shared. Downstream consumers can rely on identity.
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
        [key('Meta', 'c1'), 2.5],
        [key('Meta', 'c2'), 4.0],
        [key('Meta', 'c3'), 1.5],
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result).not.toBeNull();
    // Same JS reference — not just structural equality.
    expect(result!.current).toBe(result!.rankedAll[result!.currentRank - 1]);
  });

  it('MMC-WARN-01: others array is sorted by ranking desc (not productMap insertion order)', () => {
    // Pre-fix: `others` was pushed in `Object.entries(productMap)` iteration order
    // and never sorted. JSDoc on line 73 claimed "sorted by ranking desc" — doc-vs-impl drift.
    // Post-fix: others sorted by the same comparator as rankedAll.
    //
    // Insertion order: c2, c3, c1. ROAS rank order: c1 > c2 > c3.
    // Expected others order (rank desc, excluding current): c1, c2, c3
    // — wait, current IS c0 in this test (separate from c1/c2/c3) so others = [c1, c2, c3]
    // in rank-desc order, NOT insertion order [c2, c3, c1].
    const productMap: ProductMap = {
      [key('Meta', 'c0')]: ['p1'], // current
      [key('Meta', 'c2')]: ['p1'], // inserted SECOND
      [key('Meta', 'c3')]: ['p1'], // inserted THIRD
      [key('Meta', 'c1')]: ['p1'], // inserted LAST but should be rank #1 among others
    };
    const result = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c0'),
      productMap,
      aggregated: [
        makeAgg({ key: key('Meta', 'c0'), campaignId: 'c0' }),
        makeAgg({ key: key('Meta', 'c1'), campaignId: 'c1' }),
        makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
        makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3' }),
      ],
      roasShopifyByKey: new Map([
        [key('Meta', 'c0'), 1.0], // worst — current ranks last among 4
        [key('Meta', 'c1'), 4.0], // best other
        [key('Meta', 'c2'), 3.0], // middle other
        [key('Meta', 'c3'), 2.0], // weakest other
      ]),
      roasShopifyPlatformByKey: new Map(),
    });
    expect(result).not.toBeNull();
    // Others sorted by ranking desc — NOT productMap iteration order.
    const othersKeys = result!.others.map(o => o.campaignKey);
    expect(othersKeys).toEqual([
      key('Meta', 'c1'), // rank 1 of others (ROAS 4.0)
      key('Meta', 'c2'), // rank 2 of others (ROAS 3.0)
      key('Meta', 'c3'), // rank 3 of others (ROAS 2.0)
    ]);
  });

  it('MMC-WARN-03: NaN/Infinity ROAS inputs do not produce non-deterministic sort', () => {
    // Pre-fix: `?? 0` on lines 358-359 catches null/undefined but NOT NaN.
    // NaN flows into shrinkRoas → rankingScore returns NaN. Array.sort with
    // NaN comparator output is implementation-defined → non-deterministic order.
    // Post-fix: safeFinite guard sinks non-finite to 0.
    const productMap: ProductMap = {
      [key('Meta', 'c1')]: ['p1'],
      [key('Meta', 'c2')]: ['p1'],
      [key('Meta', 'c3')]: ['p1'],
    };
    const aggregated = [
      makeAgg({ key: key('Meta', 'c1') }),
      makeAgg({ key: key('Meta', 'c2'), campaignId: 'c2' }),
      makeAgg({ key: key('Meta', 'c3'), campaignId: 'c3' }),
    ];
    const roasShopifyByKey = new Map([
      [key('Meta', 'c1'), 3.0],
      [key('Meta', 'c2'), Number.NaN], // toxic input
      [key('Meta', 'c3'), Number.POSITIVE_INFINITY], // also toxic
    ]);
    const roasShopifyPlatformByKey = new Map();

    const result1 = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap,
      aggregated,
      roasShopifyByKey,
      roasShopifyPlatformByKey,
    });
    const result2 = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'c1'),
      productMap,
      aggregated,
      roasShopifyByKey,
      roasShopifyPlatformByKey,
    });

    // Result must be non-null (no crash).
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    // Deterministic across consecutive calls — no NaN-driven flicker.
    expect(result1!.currentRank).toBe(result2!.currentRank);
    expect(result1!.isLeader).toBe(result2!.isLeader);
    expect(result1!.isWeakest).toBe(result2!.isWeakest);
    expect(result1!.rankedAll.map(m => m.campaignKey)).toEqual(
      result2!.rankedAll.map(m => m.campaignKey),
    );
    // Every metrics.roasShopify field must be finite — NaN/Infinity sunk to 0.
    for (const m of result1!.rankedAll) {
      if (m.metrics) {
        expect(Number.isFinite(m.metrics.roasShopify)).toBe(true);
        expect(Number.isFinite(m.metrics.roasShopifyPlatform)).toBe(true);
      }
    }
  });

  it('MMC-WARN-05: identical-metrics members rank deterministically across productMap insertion orders', () => {
    // Pre-fix: Array.sort is spec-stable on ties → preserves INSERTION order.
    // But insertion order itself comes from Object.entries(productMap) which
    // depends on key-insertion sequence. Cloud-sync rehydration can flip it.
    // Post-fix: terminal campaignKey lex tiebreaker guarantees identical order
    // regardless of insertion sequence.
    //
    // Both members have identical metrics. Without lex tiebreaker, their
    // relative order varies with productMap key insertion order.
    const aggA = makeAgg({
      key: key('Meta', 'a'),
      campaignId: 'a',
      spend: 100,
      conversions: 10,
      conversionValue: 200,
    });
    const aggB = makeAgg({
      key: key('Meta', 'b'),
      campaignId: 'b',
      spend: 100,
      conversions: 10,
      conversionValue: 200,
    });
    const roasShopifyByKey = new Map([
      [key('Meta', 'a'), 2.0],
      [key('Meta', 'b'), 2.0],
    ]);
    const roasShopifyPlatformByKey = new Map([
      [key('Meta', 'a'), 1.5],
      [key('Meta', 'b'), 1.5],
    ]);

    // Call 1: productMap inserts 'a' first, then 'b'.
    const productMap1: ProductMap = {
      [key('Meta', 'current')]: ['p1'],
      [key('Meta', 'a')]: ['p1'],
      [key('Meta', 'b')]: ['p1'],
    };
    // Call 2: productMap inserts 'b' first, then 'a' — flipped.
    const productMap2: ProductMap = {
      [key('Meta', 'current')]: ['p1'],
      [key('Meta', 'b')]: ['p1'],
      [key('Meta', 'a')]: ['p1'],
    };
    const aggregated = [
      makeAgg({ key: key('Meta', 'current'), campaignId: 'current', spend: 50, conversions: 5 }),
      aggA,
      aggB,
    ];

    const r1 = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'current'),
      productMap: productMap1,
      aggregated,
      roasShopifyByKey,
      roasShopifyPlatformByKey,
    });
    const r2 = computeMultiMappingCohort({
      currentCampaignKey: key('Meta', 'current'),
      productMap: productMap2,
      aggregated,
      roasShopifyByKey,
      roasShopifyPlatformByKey,
    });

    // Identical rankedAll order regardless of productMap insertion sequence.
    expect(r1!.rankedAll.map(m => m.campaignKey)).toEqual(
      r2!.rankedAll.map(m => m.campaignKey),
    );
    // With lex tiebreaker (asc by campaignKey), among the two tied members
    // ('a' and 'b'), 'a' comes first deterministically.
    const aIdx = r1!.rankedAll.findIndex(m => m.campaignKey === key('Meta', 'a'));
    const bIdx = r1!.rankedAll.findIndex(m => m.campaignKey === key('Meta', 'b'));
    expect(aIdx).toBeLessThan(bIdx);
  });

  it('shape invariant: result satisfies MultiMappingCohort contract', () => {
    // Sanity check the type contract still holds with the new comparator.
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
    expect(r.rankedAll.length).toBe(r.others.length + 1);
    expect(r.currentRank).toBeGreaterThanOrEqual(1);
    expect(r.currentRank).toBeLessThanOrEqual(r.totalMembers);
  });
});
