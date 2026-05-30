// dashboard-web/src/lib/__tests__/cohortComparisonSortKey.test.ts
//
// HIGH-6 audit fix (2026-05-23): pin the explicit lexicographic
// comparator for CohortComparisonPanel's intra-platform ranking. The
// pre-fix composite key (`roasShopify * 1e6 + roasShopifyPlatform *
// 1e3 + spend`) silently overflowed the 1e6/1e3 weight bands when
// `roasShopifyPlatform` reached extreme values (micro-spend cohorts
// where a tiny denominator inflated the platform-deterministic ROAS
// to four-digit values). In that regime the secondary key overruled
// the primary — the panel showed a noise-driven winner.
//
// Operator scenario from the audit:
//   Cohort A: roasShopify=2 + roasShopifyPlatform=5000 + spend=10
//             (composite = 2*1e6 + 5000*1e3 + 10 = 7,000,010)
//   Cohort B: roasShopify=3 + roasShopifyPlatform=4 + spend=10
//             (composite = 3*1e6 + 4*1e3 + 10 = 3,004,010)
//   Pre-fix: A wins despite worse primary ROAS.
//   Post-fix: B wins on the primary key, as the operator expects.

import { describe, expect, it } from 'vitest';
import { compareIntraSectionMembers } from '@/components/CohortComparisonPanel';
import type { CohortMember } from '@/lib/multiMappingCohort';

function makeMember(opts: {
  campaignKey?: string;
  roasShopify?: number;
  roasShopifyPlatform?: number;
  spend?: number;
  metrics?: 'missing';
}): CohortMember {
  if (opts.metrics === 'missing') {
    return {
      campaignKey: opts.campaignKey ?? 'k',
      campaignId: 'c',
      campaignName: 'name',
      platform: 'meta',
      sharedProductIds: [],
      allProductIds: [],
      metrics: undefined,
    };
  }
  return {
    campaignKey: opts.campaignKey ?? 'k',
    campaignId: 'c',
    campaignName: 'name',
    platform: 'meta',
    sharedProductIds: [],
    allProductIds: [],
    metrics: {
      spend: opts.spend ?? 100,
      roasShopify: opts.roasShopify ?? 0,
      roasShopifyPlatform: opts.roasShopifyPlatform ?? 0,
      conversions: 1,
      effectiveStatus: null,
      regEffectiveStatus: null,
    },
  };
}

describe('compareIntraSectionMembers — lexicographic order (HIGH-6)', () => {
  it('operator scenario: micro-spend ROAS noise does NOT outrank a better primary roasShopify', () => {
    // The exact audit scenario.
    const a = makeMember({
      campaignKey: 'micro-spend-noise',
      roasShopify: 2,
      roasShopifyPlatform: 5000,
      spend: 10,
    });
    const b = makeMember({
      campaignKey: 'better-primary',
      roasShopify: 3,
      roasShopifyPlatform: 4,
      spend: 10,
    });
    // b should come BEFORE a in the sorted list — its roasShopify wins.
    expect(compareIntraSectionMembers(a, b)).toBeGreaterThan(0);
    expect(compareIntraSectionMembers(b, a)).toBeLessThan(0);

    // End-to-end pin via Array.sort.
    const sorted = [a, b].sort(compareIntraSectionMembers);
    expect(sorted[0].campaignKey).toBe('better-primary');
    expect(sorted[1].campaignKey).toBe('micro-spend-noise');
  });

  it('primary tie → roasShopifyPlatform breaks the tie (descending)', () => {
    const a = makeMember({
      campaignKey: 'platform-lower',
      roasShopify: 3,
      roasShopifyPlatform: 2,
      spend: 100,
    });
    const b = makeMember({
      campaignKey: 'platform-higher',
      roasShopify: 3,
      roasShopifyPlatform: 5,
      spend: 100,
    });
    const sorted = [a, b].sort(compareIntraSectionMembers);
    expect(sorted[0].campaignKey).toBe('platform-higher');
    expect(sorted[1].campaignKey).toBe('platform-lower');
  });

  it('primary + secondary tie → spend breaks the tie (descending — bigger spender first)', () => {
    const a = makeMember({
      campaignKey: 'small-spender',
      roasShopify: 3,
      roasShopifyPlatform: 2,
      spend: 100,
    });
    const b = makeMember({
      campaignKey: 'big-spender',
      roasShopify: 3,
      roasShopifyPlatform: 2,
      spend: 1000,
    });
    const sorted = [a, b].sort(compareIntraSectionMembers);
    expect(sorted[0].campaignKey).toBe('big-spender');
    expect(sorted[1].campaignKey).toBe('small-spender');
  });

  it('all three keys tie → comparator returns 0 (stable order preserved)', () => {
    const a = makeMember({ campaignKey: 'a', roasShopify: 3, roasShopifyPlatform: 2, spend: 100 });
    const b = makeMember({ campaignKey: 'b', roasShopify: 3, roasShopifyPlatform: 2, spend: 100 });
    expect(compareIntraSectionMembers(a, b)).toBe(0);
  });

  it('missing metrics sinks to the bottom (was -Infinity in the composite)', () => {
    const valid = makeMember({ roasShopify: 1, roasShopifyPlatform: 1, spend: 1 });
    const missing = makeMember({ metrics: 'missing', campaignKey: 'no-metrics' });
    const sorted = [missing, valid].sort(compareIntraSectionMembers);
    expect(sorted[0]).toBe(valid);
    expect(sorted[1].campaignKey).toBe('no-metrics');
  });

  it('two missing metrics tie (no ordering between them)', () => {
    const a = makeMember({ metrics: 'missing', campaignKey: 'a' });
    const b = makeMember({ metrics: 'missing', campaignKey: 'b' });
    expect(compareIntraSectionMembers(a, b)).toBe(0);
  });

  it('larger cohort (5 members) sorts correctly across all tie levels', () => {
    // Construct a deliberately mixed cohort that exercises every tier:
    //   #1 (primary unique): high roasShopify
    //   #2 + #3 tie on primary, break on secondary
    //   #4 + #5 tie on primary AND secondary, break on spend
    //   Missing-metrics #6 always last
    const members: CohortMember[] = [
      makeMember({ campaignKey: 'm1', roasShopify: 5, roasShopifyPlatform: 1, spend: 100 }),
      makeMember({ campaignKey: 'm2-platform-low', roasShopify: 3, roasShopifyPlatform: 2, spend: 100 }),
      makeMember({ campaignKey: 'm3-platform-high', roasShopify: 3, roasShopifyPlatform: 10, spend: 100 }),
      makeMember({ campaignKey: 'm4-spend-low', roasShopify: 2, roasShopifyPlatform: 1, spend: 50 }),
      makeMember({ campaignKey: 'm5-spend-high', roasShopify: 2, roasShopifyPlatform: 1, spend: 500 }),
      makeMember({ campaignKey: 'm6-missing', metrics: 'missing' }),
    ];
    const sorted = [...members].sort(compareIntraSectionMembers);
    expect(sorted.map(m => m.campaignKey)).toEqual([
      'm1',                  // highest roasShopify (5)
      'm3-platform-high',    // tied roasShopify=3, higher platform (10)
      'm2-platform-low',     // tied roasShopify=3, lower platform (2)
      'm5-spend-high',       // tied roasShopify=2 + platform=1, higher spend (500)
      'm4-spend-low',        // tied roasShopify=2 + platform=1, lower spend (50)
      'm6-missing',          // always last
    ]);
  });

  it('comparator is anti-symmetric: compare(a, b) === -compare(b, a) (sort sanity)', () => {
    const a = makeMember({ roasShopify: 3, roasShopifyPlatform: 2, spend: 100 });
    const b = makeMember({ roasShopify: 4, roasShopifyPlatform: 1, spend: 50 });
    expect(compareIntraSectionMembers(a, b)).toBe(-compareIntraSectionMembers(b, a));
  });

  it('comparator is transitive on disjoint primary values', () => {
    const a = makeMember({ roasShopify: 5, roasShopifyPlatform: 1, spend: 1 });
    const b = makeMember({ roasShopify: 3, roasShopifyPlatform: 1, spend: 1 });
    const c = makeMember({ roasShopify: 1, roasShopifyPlatform: 1, spend: 1 });
    // a < b in sort order, b < c → a < c.
    expect(compareIntraSectionMembers(a, b)).toBeLessThan(0);
    expect(compareIntraSectionMembers(b, c)).toBeLessThan(0);
    expect(compareIntraSectionMembers(a, c)).toBeLessThan(0);
  });
});
