import { describe, it, expect } from 'vitest';
import { analyzeAttributionForAdSet } from '@/lib/attributionAnalysis';
import { makeOrder, makeAdSet } from './fixtures';

/**
 * `useCampaignAttribution` is a thin `useMemo` wrapper around
 * `analyzeAttributionForAdSet` (see useCampaignAttribution.ts:100-124).
 * The hook contributes two behaviors on top of that pure function:
 *
 *   1. Cross-store isolation: each ad-set entry passes its own
 *      `storeId` to the analyzer, so orders from a different store
 *      must never leak in.
 *   2. Date-range source of truth (FIX-09): the hook receives
 *      `rangeFrom`/`rangeTo` as PROPS (user-selected window) and
 *      forwards them to `analyzeAttributionForAdSet`. The previous
 *      behavior derived the range from active campaign rows, which
 *      truncated the analysis window for paused campaigns.
 *
 * The dashboard codebase intentionally does NOT depend on
 * `@testing-library/react-hooks` (would balloon devDependencies for
 * one hook test). Instead, we directly exercise
 * `analyzeAttributionForAdSet` with the exact orchestration the hook
 * performs — same delegation, same arguments, same contract.
 *
 * Plan: 05.2.1.1-03 TEST-04 (pins AUDIT-P3-04).
 */
describe('useCampaignAttribution — cross-store isolation contract', () => {
  it('isolates orders by storeId — store A orders do not contaminate store B analysis', () => {
    // Store A: uzoshop. Store B: zolplus.
    // Two ad-sets share the same adSetId (would be possible if a Meta
    // account level operator copies an ad-set into a second account).
    const adSetA = makeAdSet({ adSetId: 'as-1', storeId: 'uzoshop', metaClaim: 200, spend: 50 });
    const adSetB = makeAdSet({ adSetId: 'as-1', storeId: 'zolplus', metaClaim: 200, spend: 50 });

    // 3 orders for store A, 5 orders for store B — same adSetId on all,
    // distinguished only by storeId.
    const ordersA = Array.from({ length: 3 }, (_, i) =>
      makeOrder({
        orderId: `A-${i}`,
        storeId: 'uzoshop',
        totalCad: 50,
        utmTerm: 'as-1',
        date: '2026-05-10',
      }),
    );
    const ordersB = Array.from({ length: 5 }, (_, i) =>
      makeOrder({
        orderId: `B-${i}`,
        storeId: 'zolplus',
        totalCad: 50,
        utmTerm: 'as-1',
        date: '2026-05-10',
      }),
    );
    const mixed = [...ordersA, ...ordersB];

    const resultA = analyzeAttributionForAdSet(adSetA, mixed, '2026-05-01', '2026-05-15');
    const resultB = analyzeAttributionForAdSet(adSetB, mixed, '2026-05-01', '2026-05-15');

    expect(resultA).not.toBeNull();
    expect(resultB).not.toBeNull();
    // Store A sees only its 3 orders (3 × 50 = 150). NOT 8 × 50 = 400.
    expect(resultA!.deterministicOrders).toBe(3);
    expect(resultA!.deterministicRevenue).toBeCloseTo(150, 4);
    // Store B sees only its 5 orders (5 × 50 = 250). NOT 8 × 50 = 400.
    expect(resultB!.deterministicOrders).toBe(5);
    expect(resultB!.deterministicRevenue).toBeCloseTo(250, 4);
  });

  it('uses caller-supplied rangeFrom/rangeTo (FIX-09 props as source of truth, not row dates)', () => {
    // Operator selected a 21-day window 2026-05-01..2026-05-21. The
    // ad-set itself only ran (had spend) for 7 days 2026-05-10..2026-05-16,
    // but orders matching the ad-set's utm_term landed throughout the
    // operator-selected window.
    //
    // The post-FIX-09 contract: `analyzeAttributionForAdSet` (and thus
    // the hook that delegates to it) uses the operator's range, NOT a
    // window derived from active campaign rows. An order on 2026-05-03
    // must be included in the analysis even though the ad-set was paused
    // that day.
    const adSet = makeAdSet({ adSetId: 'as-1', storeId: 'uzoshop', metaClaim: 500, spend: 100 });
    const orders = [
      makeOrder({ orderId: 'o-early', totalCad: 75, utmTerm: 'as-1', date: '2026-05-03' }),
      makeOrder({ orderId: 'o-mid',   totalCad: 75, utmTerm: 'as-1', date: '2026-05-12' }),
      makeOrder({ orderId: 'o-late',  totalCad: 75, utmTerm: 'as-1', date: '2026-05-20' }),
    ];

    // Tight window matching only the active period — pre-FIX-09 behavior.
    const tight = analyzeAttributionForAdSet(adSet, orders, '2026-05-10', '2026-05-16');
    // Wide operator window — post-FIX-09 contract.
    const wide = analyzeAttributionForAdSet(adSet, orders, '2026-05-01', '2026-05-21');

    expect(tight).not.toBeNull();
    expect(wide).not.toBeNull();
    expect(tight!.deterministicOrders).toBe(1);                // only o-mid
    expect(wide!.deterministicOrders).toBe(3);                 // all three
    expect(wide!.deterministicRevenue).toBeCloseTo(225, 4);    // 3 × 75 = 225
  });

  it('returns null analysis for non-Meta ad-sets — Google ad-sets in the same store stay isolated', () => {
    // The hook iterates summary.adSets and constructs an analyzer for
    // each. For Google ad-sets `analyzeAttributionForAdSet` short-circuits
    // to null (platform guard), which the hook stores under the ad-set
    // key. Orders for Meta ad-sets in the same store MUST NOT affect
    // the null result.
    const googleAdSet = makeAdSet({
      adSetId: 'as-g',
      storeId: 'uzoshop',
      platform: 'Google',
      metaClaim: 0,
      spend: 30,
    });
    const orders = Array.from({ length: 4 }, (_, i) =>
      makeOrder({ orderId: `o-${i}`, storeId: 'uzoshop', utmTerm: 'as-g', date: '2026-05-10' }),
    );
    const result = analyzeAttributionForAdSet(googleAdSet, orders, '2026-05-01', '2026-05-15');
    expect(result).toBeNull();
  });
});
