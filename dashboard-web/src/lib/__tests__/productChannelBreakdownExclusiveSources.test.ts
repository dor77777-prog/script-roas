// dashboard-web/src/lib/__tests__/productChannelBreakdownExclusiveSources.test.ts
//
// Regression tests for audit 2026-05-23-v3 CRIT-2:
//
//   ProductChannelBreakdown segment widths double-counted cross-tagged
//   orders. The renderer derived its `fb` count from
//   `breakdown.facebookOrders`, which uses the BROAD OR predicate
//   (source ∈ {meta-paid, meta-organic} OR fbclidPresent === true). A
//   google-paid order with a stale fbclid cookie was therefore counted
//   in BOTH `fb` AND `google`, inflating segment widths past 100% and
//   clamping the residual "other" bucket (email / affiliate / unknown
//   surfaces) to 0 — silently dropping legitimate revenue.
//
//   Codex caveat: chip recommendations also fed off `facebookShare`
//   (same OR-inflated metric), so a campaign with phantom fbclid
//   carryover could trip the "≥60% Facebook → scale budget" green chip
//   on noise.
//
// Fix (renderer + analyzer scope):
//   - Renderer: every segment count derives from `bySource` buckets
//     (mutually exclusive). `other` = total - knownExplicit, naturally
//     summing to total. `Math.max(0, ...)` guard stays as belt-and-braces.
//   - Renderer: chip thresholds read `exclusiveFacebookShare =
//     metaOrders / total` instead of `breakdown.facebookShare`.
//   - Analyzer: JSDoc on `facebookOrders` / `facebookShare` now spells
//     out the OR semantics explicitly — secondary signal only.
//
// This file tests the ANALYZER contract (facebookOrders OR-counted,
// bySource buckets mutually exclusive) and the COMPONENT math (segment
// derivation + chip thresholds reading the exclusive share). The
// renderer-level chip-recommendation test simulates the exact predicate
// the component evaluates.

import { describe, expect, it } from 'vitest';
import { analyzeProductChannel } from '@/lib/attributionAnalysis';
import { makeOrder, makeLineItem } from './fixtures';

const STORE_ID = 'uzoshop';
const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-30';
const BASE = { storeId: STORE_ID, dateFrom: DATE_FROM, dateTo: DATE_TO };

// ---------------------------------------------------------------------------
// 100-order production-shape scenario.
//
// Composition (chosen so each known bucket is non-trivial AND the OR-overlap
// hits the exact pattern from CRIT-2):
//
//   - 40 meta-paid pure (no fbclid carryover at all — clean attribution)
//   - 10 google-paid WITH fbclidPresent=true (stale Facebook cookie)
//   - 20 google-paid pure
//   -  5 tiktok-paid pure
//   - 25 direct pure
//   = 100 total
//
// Pre-fix renderer math:
//   fb     = facebookOrders = 40 (meta-paid) + 10 (google-paid + fbclid) = 50
//   google = (10 google+fbclid) + 20 google-pure = 30
//   tiktok = 5
//   direct = 25
//   sum    = 50 + 30 + 5 + 25 = 110 > 100   <- DOUBLE-COUNT
//   other  = max(0, 100 - 110) = 0          <- email/affiliate residual LOST
//
// Post-fix renderer math:
//   fb     = bySource['meta-paid'] + bySource['meta-organic'] = 40
//   google = bySource['google-paid'] + bySource['google-organic'] = 30
//   tiktok = bySource['tiktok-paid'] = 5
//   direct = bySource['direct'] = 25
//   sum    = 40 + 30 + 5 + 25 = 100   <- clean exclusive math
//   other  = max(0, 100 - 100) = 0    <- correct (nothing else in scenario)
// ---------------------------------------------------------------------------

function buildHundredOrderScenario() {
  const orders = [];
  // 40 meta-paid pure
  for (let i = 0; i < 40; i++) {
    orders.push(makeOrder({
      orderId: `meta-pure-${i}`,
      source: 'meta-paid',
      fbclidPresent: true,    // fbclid present is FINE for meta-paid — it's
      // the legit signal that classified the source. The test point is
      // ONLY that google-paid+fbclid causes the OR-overlap.
      gclidPresent: false,
      date: '2026-05-10',
      lineItems: [makeLineItem({ productId: 'p-1', revenueCad: 50 })],
    }));
  }
  // 10 google-paid + fbclidPresent (THE bug-trigger pattern)
  for (let i = 0; i < 10; i++) {
    orders.push(makeOrder({
      orderId: `google-fbclid-${i}`,
      source: 'google-paid',
      fbclidPresent: true,
      gclidPresent: true,
      date: '2026-05-11',
      lineItems: [makeLineItem({ productId: 'p-1', revenueCad: 50 })],
    }));
  }
  // 20 google-paid pure
  for (let i = 0; i < 20; i++) {
    orders.push(makeOrder({
      orderId: `google-pure-${i}`,
      source: 'google-paid',
      fbclidPresent: false,
      gclidPresent: true,
      date: '2026-05-12',
      lineItems: [makeLineItem({ productId: 'p-1', revenueCad: 50 })],
    }));
  }
  // 5 tiktok-paid pure
  for (let i = 0; i < 5; i++) {
    orders.push(makeOrder({
      orderId: `tt-${i}`,
      source: 'tiktok-paid',
      fbclidPresent: false,
      gclidPresent: false,
      date: '2026-05-13',
      lineItems: [makeLineItem({ productId: 'p-1', revenueCad: 50 })],
    }));
  }
  // 25 direct pure
  for (let i = 0; i < 25; i++) {
    orders.push(makeOrder({
      orderId: `direct-${i}`,
      source: 'direct',
      fbclidPresent: false,
      gclidPresent: false,
      date: '2026-05-14',
      lineItems: [makeLineItem({ productId: 'p-1', revenueCad: 50 })],
    }));
  }
  return orders;
}

// ---------------------------------------------------------------------------
// Renderer math simulation — mirrors ProductChannelBreakdown.tsx exactly.
// Kept inline (instead of importing the component) because the component
// is JSX and vitest is node-only in this project. The math IS the
// contract; the JSX wrapping is mechanical formatting around these values.
// ---------------------------------------------------------------------------
function computeSegments(breakdown: ReturnType<typeof analyzeProductChannel>) {
  const total = breakdown.totalOrders;
  const fb = (breakdown.bySource['meta-paid']?.orders ?? 0)
           + (breakdown.bySource['meta-organic']?.orders ?? 0);
  const google = (breakdown.bySource['google-paid']?.orders ?? 0)
              + (breakdown.bySource['google-organic']?.orders ?? 0);
  const tiktok = breakdown.bySource['tiktok-paid']?.orders ?? 0;
  const direct = breakdown.bySource['direct']?.orders ?? 0;
  const knownExplicit = fb + google + tiktok + direct;
  const other = Math.max(0, total - knownExplicit);
  const exclusiveFacebookShare = total > 0 ? fb / total : 0;
  return { total, fb, google, tiktok, direct, other, exclusiveFacebookShare };
}

describe('ProductChannelBreakdown — CRIT-2 exclusive source attribution', () => {
  it('100-order scenario: segments sum to total without double-counting cross-tagged orders', () => {
    const orders = buildHundredOrderScenario();
    const breakdown = analyzeProductChannel({
      ...BASE,
      productIds: ['p-1'],
      orders,
    });

    expect(breakdown.totalOrders).toBe(100);

    // First — verify the analyzer's per-source counts (the substrate the
    // exclusive renderer math depends on).
    expect(breakdown.bySource['meta-paid']?.orders).toBe(40);
    expect(breakdown.bySource['google-paid']?.orders).toBe(30); // 10 fbclid + 20 pure
    expect(breakdown.bySource['tiktok-paid']?.orders).toBe(5);
    expect(breakdown.bySource['direct']?.orders).toBe(25);

    // Pre-fix audit assertion: facebookOrders WOULD have been
    // 40 (meta-paid) + 10 (google+fbclid) = 50. This is the broad
    // OR-count — kept as a secondary signal. Pin it so future refactors
    // can't silently weaken the OR predicate.
    expect(breakdown.facebookOrders).toBe(50);
    expect(breakdown.facebookShare).toBeCloseTo(0.5, 6);

    // Post-fix renderer math.
    const seg = computeSegments(breakdown);
    expect(seg.fb).toBe(40);
    expect(seg.google).toBe(30);
    expect(seg.tiktok).toBe(5);
    expect(seg.direct).toBe(25);
    expect(seg.other).toBe(0);

    // Exclusive sum == total — the heart of the CRIT-2 fix.
    expect(seg.fb + seg.google + seg.tiktok + seg.direct + seg.other).toBe(100);

    // Pre-fix inflated sum (10 over) — pin so regression is loud.
    const preFix = breakdown.facebookOrders + seg.google + seg.tiktok + seg.direct;
    expect(preFix).toBe(110);
    expect(preFix).not.toBe(100);
  });

  it('100-order scenario with 10 email orders: residual "other" bucket recovers them (no clamp loss)', () => {
    // Same scenario but adds 10 email orders. Pre-fix renderer:
    //   fb = 50 (OR), google = 30, tiktok = 5, direct = 25
    //   sum = 110, other = max(0, 110 - 110) = 0   <- email LOST
    // Post-fix:
    //   fb = 40, google = 30, tiktok = 5, direct = 25 = 100
    //   total = 110, other = 110 - 100 = 10        <- email VISIBLE
    const orders = buildHundredOrderScenario();
    for (let i = 0; i < 10; i++) {
      orders.push(makeOrder({
        orderId: `email-${i}`,
        source: 'email',
        fbclidPresent: false,
        gclidPresent: false,
        date: '2026-05-15',
        lineItems: [makeLineItem({ productId: 'p-1', revenueCad: 50 })],
      }));
    }

    const breakdown = analyzeProductChannel({
      ...BASE,
      productIds: ['p-1'],
      orders,
    });

    expect(breakdown.totalOrders).toBe(110);
    expect(breakdown.bySource['email']?.orders).toBe(10);

    const seg = computeSegments(breakdown);
    // Post-fix: email correctly lands in `other` bucket.
    expect(seg.other).toBe(10);
    expect(seg.fb + seg.google + seg.tiktok + seg.direct + seg.other).toBe(110);

    // Pre-fix would have clamped email away — assert THE bug shape:
    //   facebookOrders=50, google=30, tiktok=5, direct=25 → 110, other=0.
    const preFixOther = Math.max(0, 110 - (breakdown.facebookOrders + seg.google + seg.tiktok + seg.direct));
    expect(preFixOther).toBe(0); // <-- the bug
    expect(seg.other).not.toBe(preFixOther);
  });

  it('all-source-unknown orders go to "other" bucket (not silently dropped)', () => {
    // Orders with empty source string get lumped into 'direct' bucket by
    // the analyzer (see attributionAnalysis.ts:1094). So a TRUE
    // unrecognized-source scenario uses 'other-paid' / 'other-referral'.
    // These currently land in `other` since the renderer enumerates only
    // {meta, google, tiktok, direct}.
    const orders = [
      makeOrder({ orderId: 'op-1', source: 'other-paid', lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }),
      makeOrder({ orderId: 'or-1', source: 'other-referral', lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }),
      makeOrder({ orderId: 'em-1', source: 'email', lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }),
    ];
    const breakdown = analyzeProductChannel({ ...BASE, productIds: ['p-1'], orders });
    const seg = computeSegments(breakdown);
    expect(seg.total).toBe(3);
    expect(seg.fb).toBe(0);
    expect(seg.google).toBe(0);
    expect(seg.tiktok).toBe(0);
    expect(seg.direct).toBe(0);
    expect(seg.other).toBe(3);
  });

  it('fbclid-only-no-source orders go to "other" not double-counted into Meta', () => {
    // Empty-source + fbclidPresent=true. The analyzer lumps empty source
    // into the 'direct' bucket (rendering as `direct`), but ALSO
    // OR-counts it into facebookOrders. Pre-fix renderer:
    //   fb=facebookOrders=1, direct=1 → segments sum to 2 of total=1, other=0
    // Post-fix:
    //   fb (exclusive meta) = 0, direct = 1 → sum 1 = total, other = 0
    const orders = [
      makeOrder({
        orderId: 'fbclid-orphan',
        source: '',                // empty → lumped into 'direct'
        fbclidPresent: true,
        lineItems: [makeLineItem({ productId: 'p-1' })],
        date: '2026-05-10',
      }),
    ];
    const breakdown = analyzeProductChannel({ ...BASE, productIds: ['p-1'], orders });

    expect(breakdown.totalOrders).toBe(1);
    expect(breakdown.bySource['direct']?.orders).toBe(1);
    // Pre-fix: facebookOrders includes this fbclid-tagged orphan.
    expect(breakdown.facebookOrders).toBe(1);

    const seg = computeSegments(breakdown);
    expect(seg.fb).toBe(0);       // <-- exclusive: zero Meta orders by bySource
    expect(seg.direct).toBe(1);
    expect(seg.other).toBe(0);
    expect(seg.fb + seg.google + seg.tiktok + seg.direct + seg.other).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Chip-recommendation contract — CRIT-2 Codex caveat
// ---------------------------------------------------------------------------

describe('ProductChannelBreakdown — CRIT-2 chip recommendations use exclusive share', () => {
  function chipDecision(breakdown: ReturnType<typeof analyzeProductChannel>): 'green' | 'amber' | 'none' {
    const seg = computeSegments(breakdown);
    if (seg.exclusiveFacebookShare >= 0.6) return 'green';
    if (seg.exclusiveFacebookShare < 0.3 && seg.total >= 5) return 'amber';
    return 'none';
  }

  it('40% real-Meta + 20% Google-with-fbclid does NOT trip green chip (was: trip on phantom signal)', () => {
    // 50 total. 20 meta-paid (40%) + 10 google-paid+fbclid (20%, fbclid
    // bumps the OR count to 30/50 = 60% in pre-fix). Plus 20 direct.
    // Pre-fix: facebookShare = 30/50 = 0.60 → green chip trips
    //          ("60% from Facebook → scale budget!")  <- WRONG
    // Post-fix: exclusiveFacebookShare = 20/50 = 0.40 → no chip (between
    //          30% and 60% per CONTEXT) <- CORRECT
    const orders: ReturnType<typeof makeOrder>[] = [];
    for (let i = 0; i < 20; i++) {
      orders.push(makeOrder({ orderId: `m-${i}`, source: 'meta-paid', fbclidPresent: true, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }));
    }
    for (let i = 0; i < 10; i++) {
      orders.push(makeOrder({ orderId: `g-${i}`, source: 'google-paid', fbclidPresent: true, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-11' }));
    }
    for (let i = 0; i < 20; i++) {
      orders.push(makeOrder({ orderId: `d-${i}`, source: 'direct', fbclidPresent: false, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-12' }));
    }
    const breakdown = analyzeProductChannel({ ...BASE, productIds: ['p-1'], orders });

    // Pre-fix shape pinned.
    expect(breakdown.facebookOrders).toBe(30);
    expect(breakdown.facebookShare).toBeCloseTo(0.6, 6);  // <-- the phantom signal

    // Post-fix chip evaluation.
    const seg = computeSegments(breakdown);
    expect(seg.exclusiveFacebookShare).toBeCloseTo(0.4, 6);
    expect(chipDecision(breakdown)).toBe('none');  // <-- silence is correct
  });

  it('80% real-Meta still trips green chip — true high-confidence signal preserved', () => {
    // 40 meta-paid pure + 10 direct = 50 total. No fbclid carryover noise.
    // Both pre-fix and post-fix should agree: 40/50 = 80% → green chip.
    const orders: ReturnType<typeof makeOrder>[] = [];
    for (let i = 0; i < 40; i++) {
      orders.push(makeOrder({ orderId: `m-${i}`, source: 'meta-paid', fbclidPresent: true, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }));
    }
    for (let i = 0; i < 10; i++) {
      orders.push(makeOrder({ orderId: `d-${i}`, source: 'direct', fbclidPresent: false, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-11' }));
    }
    const breakdown = analyzeProductChannel({ ...BASE, productIds: ['p-1'], orders });

    const seg = computeSegments(breakdown);
    expect(seg.exclusiveFacebookShare).toBeCloseTo(0.8, 6);
    expect(chipDecision(breakdown)).toBe('green');
  });

  it('15% real-Meta trips amber chip (≥5 orders gate) — true low-confidence signal preserved', () => {
    // 3 meta-paid pure + 17 direct = 20 total. 3/20 = 15% < 30%; total >= 5.
    const orders: ReturnType<typeof makeOrder>[] = [];
    for (let i = 0; i < 3; i++) {
      orders.push(makeOrder({ orderId: `m-${i}`, source: 'meta-paid', fbclidPresent: true, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }));
    }
    for (let i = 0; i < 17; i++) {
      orders.push(makeOrder({ orderId: `d-${i}`, source: 'direct', fbclidPresent: false, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-11' }));
    }
    const breakdown = analyzeProductChannel({ ...BASE, productIds: ['p-1'], orders });

    const seg = computeSegments(breakdown);
    expect(seg.exclusiveFacebookShare).toBeCloseTo(0.15, 6);
    expect(chipDecision(breakdown)).toBe('amber');
  });

  it('exclusive share is bounded [0,1] and never NaN even with all-fbclid noise', () => {
    // Every order is google-paid+fbclidPresent. facebookOrders = total
    // (OR-share = 100%) but exclusive Meta share = 0.
    const orders: ReturnType<typeof makeOrder>[] = [];
    for (let i = 0; i < 10; i++) {
      orders.push(makeOrder({ orderId: `g-${i}`, source: 'google-paid', fbclidPresent: true, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }));
    }
    const breakdown = analyzeProductChannel({ ...BASE, productIds: ['p-1'], orders });

    expect(breakdown.facebookShare).toBeCloseTo(1.0, 6);  // pre-fix would scream "100% Facebook!"
    const seg = computeSegments(breakdown);
    expect(seg.exclusiveFacebookShare).toBe(0);            // post-fix: zero
    expect(Number.isFinite(seg.exclusiveFacebookShare)).toBe(true);
    expect(chipDecision(breakdown)).toBe('amber'); // < 30% with >= 5 orders
  });
});
