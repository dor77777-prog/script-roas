/**
 * Phase 05.2.3.0 — D-C3 invariant tests for cross-day refund attribution.
 *
 * Fixtures derive from .planning/phases/05.2.3.0-shopify-revenue-refunds-bug-fix/
 * 05.2.3.0-PROBE-EVIDENCE.md (D-C4). Each fixture numeric value is annotated
 * with its source (// Fixture from PROBE-EVIDENCE.md ## {store}) so the
 * binding is grep-checkable. NO fictional fixtures.
 *
 * === CONTRACT REVISION (2026-05-21) ===
 *
 * The original plan body referenced `transactions[].amount` as the store-level
 * deduction. The 2026-05-21 empirical probe (PROBE-EVIDENCE.md §Finding 1)
 * falsified that hypothesis on 3/3 stores: `transactions[].amount` ran
 * 2–4× the order total because it is denominated in payout/transaction
 * currency and includes duplicate-refund/void artifacts.
 *
 * The correct deduction field is `refund_line_items[].subtotal` (matched
 * 3/3 stores exactly: `total_price − Σ refund_line_items[].subtotal ==
 * current_total_price`). The 4 invariants below test the REVISED algorithm
 * (CONTEXT.md D-C3 REVISED). Both store-level and per-product paths use the
 * SAME field — refund_line_items[].subtotal. The store-level path sums across
 * ALL refund_line_items (including null product_id); the per-product path
 * groups by product_id, skipping null/missing product_id and surfacing those
 * amounts in `customItemRefundCad`. No tax/shipping gap to document.
 *
 * Return type: { storeNetCad, byProduct, customItemRefundCad }.
 */
import { describe, it, expect } from 'vitest';
import { computeRevenueWithCrossDayRefunds } from '../shopifyRevenueRefunds';

// ---------------------------------------------------------------------------
// Type aliases mirroring the narrowed Shopify Admin REST payload shape
// (CONTEXT.md D-B2 REVISED — only the fields the algorithm reads).
// ---------------------------------------------------------------------------

type LineItem = {
  product_id: string | number | null;
  price: string;
  quantity: number;
};
type RefundLineItem = {
  product_id: string | number | null;
  subtotal: string | number;
  total?: string | number;
};
type RefundTx = { amount: string };
type Refund = {
  processed_at: string;
  transactions?: RefundTx[];
  refund_line_items?: RefundLineItem[];
};
type Order = {
  id: string | number;
  created_at: string;
  total_price: string;
  current_total_price: string;
  test?: boolean;
  financial_status?: string;
  line_items?: LineItem[];
  refunds?: Refund[];
};

// ===========================================================================
// REAL fixtures from 05.2.3.0-PROBE-EVIDENCE.md.
//
// Day D under test is 2026-05-20 (Asia/Jerusalem). All 3 probe refunds were
// processed at 15:24..15:27+03:00 on that date — same calendar day in IL TZ.
// The orders are from earlier calendar days, so they qualify as CROSS-DAY
// refunds (D-A2: refund.processed_at on D AND order.created_at != D).
// ===========================================================================

// Day under test — Fixture from PROBE-EVIDENCE.md (all 3 refunds processed_at
// resolve to 2026-05-20 in Asia/Jerusalem).
const DAY_D = '2026-05-20';
const PROBE_TZ = 'Asia/Jerusalem';

// ---------------------------------------------------------------------------
// uzoshop — order 10803404276006, single refund_line_item, no custom items.
// transactions[0].amount = 149.00 (NOISE — empirically wrong, we IGNORE it).
// refund_line_items[0].subtotal = 68.8 (the canonical deduction).
// ---------------------------------------------------------------------------
const uzoshopCrossDay: Order = {
  id: 10803404276006,                                       // Fixture from PROBE-EVIDENCE.md ## uzoshop
  created_at: '2026-05-02T14:30:21+03:00',                  // Fixture from PROBE-EVIDENCE.md ## uzoshop
  total_price: '68.80',                                     // Fixture from PROBE-EVIDENCE.md ## uzoshop
  current_total_price: '0.00',                              // Fixture from PROBE-EVIDENCE.md ## uzoshop
  financial_status: 'refunded',
  refunds: [{
    processed_at: '2026-05-20T15:27:19+03:00',              // Fixture from PROBE-EVIDENCE.md ## uzoshop
    transactions: [{ amount: '149.00' }],                   // diagnostic noise (PROBE-EVIDENCE §Finding 3) — algorithm MUST ignore
    refund_line_items: [
      { product_id: 'prod-uzoshop-1', subtotal: '68.8' },   // Fixture from PROBE-EVIDENCE.md ## uzoshop
    ],
  }],
};

// ---------------------------------------------------------------------------
// zolplus — order 6765917143189, single refund_line_item.
// transactions[0].amount = 149.00 (diagnostic noise).
// refund_line_items[0].subtotal = 65.28 (canonical deduction).
// ---------------------------------------------------------------------------
const zolplusCrossDay: Order = {
  id: 6765917143189,                                        // Fixture from PROBE-EVIDENCE.md ## zolplus
  created_at: '2026-03-09T19:41:46+02:00',                  // Fixture from PROBE-EVIDENCE.md ## zolplus
  total_price: '65.28',                                     // Fixture from PROBE-EVIDENCE.md ## zolplus
  current_total_price: '0.00',                              // Fixture from PROBE-EVIDENCE.md ## zolplus
  financial_status: 'refunded',
  refunds: [{
    processed_at: '2026-05-20T15:24:04+03:00',              // Fixture from PROBE-EVIDENCE.md ## zolplus
    transactions: [{ amount: '149.00' }],                   // diagnostic noise — algorithm MUST ignore
    refund_line_items: [
      { product_id: 'prod-zolplus-1', subtotal: '65.28' },  // Fixture from PROBE-EVIDENCE.md ## zolplus
    ],
  }],
};

// ---------------------------------------------------------------------------
// usmile360 — order 4697724059855, TWO refund objects, multi-line refund.
// refunds[0]: two refund_line_items with subtotals 81.08 + 55.35 = 136.43
// refunds[1]: an additional refund object captured in the probe — its
//             transactions[].amount = 302.10 (noise) but the probe did NOT
//             capture its refund_line_items[]. We model it as having ZERO
//             refund_line_items here, consistent with the probe row that
//             only logged a transactions entry. This mirrors a void/dupe
//             artifact (PROBE-EVIDENCE §Finding 3) — algorithm IGNORES
//             transactions and so this 2nd refund contributes 0 to deductions.
// ---------------------------------------------------------------------------
const usmile360CrossDay: Order = {
  id: 4697724059855,                                        // Fixture from PROBE-EVIDENCE.md ## usmile360
  created_at: '2026-04-11T11:35:10+03:00',                  // Fixture from PROBE-EVIDENCE.md ## usmile360
  total_price: '136.43',                                    // Fixture from PROBE-EVIDENCE.md ## usmile360
  current_total_price: '0.00',                              // Fixture from PROBE-EVIDENCE.md ## usmile360
  financial_status: 'refunded',
  refunds: [
    {
      processed_at: '2026-05-20T15:25:16+03:00',            // Fixture from PROBE-EVIDENCE.md ## usmile360
      transactions: [{ amount: '302.10' }],                 // diagnostic noise (Finding 3: 4.43× order)
      refund_line_items: [
        { product_id: 'prod-usmile360-a', subtotal: '81.08' }, // Fixture from PROBE-EVIDENCE.md ## usmile360
        { product_id: 'prod-usmile360-b', subtotal: '55.35' }, // Fixture from PROBE-EVIDENCE.md ## usmile360
      ],
    },
    {
      processed_at: '2026-05-20T15:25:46+03:00',            // Fixture from PROBE-EVIDENCE.md ## usmile360
      transactions: [{ amount: '302.10' }],                 // diagnostic noise — dupe-refund artifact, algorithm IGNORES
      refund_line_items: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Same-day order — created and refunded on DAY_D. Must NOT trigger cross-day
// deduction (D-A2). current_total_price is already net per AUDIT-P0-03, so
// for full reconciliation invariant 4 we model the line items consistently:
// line_items gross = 50.00, intra-order refund_line_items subtotal = 20.00,
// so per-product net = 30.00 == current_total_price.
// ---------------------------------------------------------------------------
const sameDayOrder: Order = {
  id: 'same-day-001',
  created_at: '2026-05-20T09:00:00+03:00',  // same calendar day in IL TZ as DAY_D
  total_price: '50.00',
  current_total_price: '30.00',              // already net of same-day refund (D-A1)
  financial_status: 'partially_refunded',
  line_items: [
    { product_id: 'prod-Z', price: '50.00', quantity: 1 },
  ],
  refunds: [{
    processed_at: '2026-05-20T15:00:00+03:00',  // SAME day — intra-order refund
    transactions: [{ amount: '20.00' }],
    refund_line_items: [{ product_id: 'prod-Z', subtotal: '20.00' }],
  }],
};

// ---------------------------------------------------------------------------
// Test order — must be EXCLUDED entirely (D-A1 / CONTEXT.md <specifics>).
// ---------------------------------------------------------------------------
const testOrder: Order = {
  id: 'test-001',
  created_at: '2026-05-20T11:00:00+03:00',
  total_price: '100.00',
  current_total_price: '100.00',
  test: true,
};

// ---------------------------------------------------------------------------
// Voided order — must be EXCLUDED entirely.
// ---------------------------------------------------------------------------
const voidedOrder: Order = {
  id: 'voided-001',
  created_at: '2026-05-20T12:00:00+03:00',
  total_price: '75.00',
  current_total_price: '75.00',
  financial_status: 'voided',
};

// ---------------------------------------------------------------------------
// Cross-day refund with product_id = null (custom item / deleted product).
// MUST be skipped in byProduct and surface in customItemRefundCad instead
// (REVISED D-C3 invariant 3).
//
// SYNTHETIC NOTE: the 2026-05-21 probe did not capture a null-product_id
// refund (Finding 1 shows all 3 stores had concrete product_ids). This
// fixture is a SYNTHETIC edge case for the custom-item code path — the
// numeric value (5.00) is NOT from the probe but the structural shape
// (refund_line_items[].product_id === null with subtotal) is what Shopify
// returns for manual / custom adjustments per the Admin REST docs.
// ---------------------------------------------------------------------------
const customItemCrossDay: Order = {
  id: 'custom-refund-001',
  created_at: '2026-05-10T10:00:00+03:00', // BEFORE DAY_D → cross-day
  total_price: '60.00',
  current_total_price: '55.00',
  refunds: [{
    processed_at: '2026-05-20T16:00:00+03:00',
    transactions: [{ amount: '5.00' }],
    refund_line_items: [{ product_id: null, subtotal: '5.00' }],
  }],
};

// ---------------------------------------------------------------------------
// SYNTHETIC FIXTURE for D-C3 invariant 6 (Gap 2 / CR-02 lock-in):
// Same-day order created on DAY_D with a FUTURE-day refund (5 days later).
// The intra-order refundByLineId map MUST filter by processed_at day so
// the same-day per-product net is the line gross (NOT line gross minus
// the future refund). Pre-Plan-08 algorithm leaked the future refund into
// same-day per-product net (CR-02 double-deduction shape).
//
// Numeric values are SYNTHETIC (not from PROBE-EVIDENCE.md) — the probe
// didn't capture a same-day order with a future refund. The SHAPE is
// what locks Gap 2's fix in.
// ---------------------------------------------------------------------------
const sameDayOrderWithFutureRefund: Order = {
  id: 'same-day-with-future-refund-001',
  created_at: '2026-05-20T10:00:00+03:00',     // SAME calendar day as DAY_D
  total_price: '100.00',
  current_total_price: '100.00',
  financial_status: 'partially_refunded',
  line_items: [
    { product_id: 'prod-future-refund', price: '100.00', quantity: 1 },
  ],
  refunds: [{
    processed_at: '2026-05-25T12:00:00+03:00', // 5 DAYS LATER — different calendar day
    transactions: [{ amount: '40.00' }],       // diagnostic noise — algorithm ignores
    refund_line_items: [{ product_id: 'prod-future-refund', subtotal: '40.00' }],
  }],
};

const fixtureOrders: Order[] = [
  uzoshopCrossDay,
  zolplusCrossDay,
  usmile360CrossDay,
  sameDayOrder,
  testOrder,
  voidedOrder,
  customItemCrossDay,
];

// Pre-computed expected totals — derived ONLY from the fixture numeric values
// above. Used by multiple tests to keep the math explicit and reviewable.
// Cross-day refund deduction across ALL refund_line_items (including null pid):
const CROSS_DAY_DEDUCTION_TOTAL =
  68.8           // uzoshop
  + 65.28        // zolplus
  + 81.08 + 55.35 // usmile360 refunds[0].refund_line_items[0..1]
                 // usmile360 refunds[1] has refund_line_items = [] → 0
  + 5.00;        // customItemCrossDay (null product_id, store-level still counts it)
// = 275.51

// Cross-day deduction grouped by product_id (skipping null/missing):
const CROSS_DAY_BY_PID_TOTAL =
  68.8 + 65.28 + 81.08 + 55.35; // = 270.51 (excludes the 5.00 custom-item)

// Custom-item portion (null/missing product_id):
const CUSTOM_ITEM_REFUND_TOTAL = 5.00;

// Same-day gross (current_total_price for orders created on DAY_D,
// excluding test/voided):
const SAME_DAY_GROSS = 30.00; // sameDayOrder.current_total_price

// Same-day per-product net (line_items gross MINUS intra-order
// refund_line_items.subtotal by pid):
//   prod-Z line gross = 50.00 * 1 = 50.00
//   prod-Z intra-order refund = 20.00
//   prod-Z same-day net = 30.00
const SAME_DAY_PROD_Z_NET = 30.00;

// ===========================================================================
// Tests — one `it(...)` per D-C3 invariant (REVISED 2026-05-21).
// ===========================================================================

describe('cross-day refunds', () => {
  it('D-C3 invariant 1: store-level = sum(current_total_price for D, excl test/voided) - sum(refund_line_items.subtotal for cross-day refunds on D, across ALL refund_line_items including null product_id)', () => {
    const result = computeRevenueWithCrossDayRefunds(fixtureOrders, DAY_D, PROBE_TZ);

    // Expected store net = same-day gross - cross-day deduction (storewide).
    //   = 30.00 - 275.51 = -245.51 (D-D3: negative is allowed, no clamping)
    expect(result.storeNetCad).toBeCloseTo(SAME_DAY_GROSS - CROSS_DAY_DEDUCTION_TOTAL, 2);
    expect(result.storeNetCad).toBeCloseTo(-245.51, 2);
  });

  it('D-C3 invariant 2: per-product net = (line gross for orders.created_at=D after intra-order refund deduction) - sum(refund_line_items.subtotal for cross-day refunds, grouped by product_id, skipping null/missing product_id)', () => {
    const result = computeRevenueWithCrossDayRefunds(fixtureOrders, DAY_D, PROBE_TZ);

    // Per-product expectations:
    //   - Cross-day refund pids get NEGATIVE entries (-Σ refund_line_items.subtotal).
    //   - Same-day pid gets POSITIVE entry (line gross - intra-order refund).
    //   - Null product_id NEVER appears in byProduct.
    expect(result.byProduct['prod-uzoshop-1']).toBeDefined();
    expect(result.byProduct['prod-uzoshop-1'].netRevenueCad).toBeCloseTo(-68.8, 2);

    expect(result.byProduct['prod-zolplus-1']).toBeDefined();
    expect(result.byProduct['prod-zolplus-1'].netRevenueCad).toBeCloseTo(-65.28, 2);

    expect(result.byProduct['prod-usmile360-a']).toBeDefined();
    expect(result.byProduct['prod-usmile360-a'].netRevenueCad).toBeCloseTo(-81.08, 2);

    expect(result.byProduct['prod-usmile360-b']).toBeDefined();
    expect(result.byProduct['prod-usmile360-b'].netRevenueCad).toBeCloseTo(-55.35, 2);

    // Same-day prod-Z: gross 50.00 minus intra-order refund 20.00 = 30.00.
    expect(result.byProduct['prod-Z']).toBeDefined();
    expect(result.byProduct['prod-Z'].netRevenueCad).toBeCloseTo(SAME_DAY_PROD_Z_NET, 2);

    // Null product_id MUST NOT surface in byProduct — only in customItemRefundCad.
    expect(result.byProduct['null']).toBeUndefined();
    expect(result.byProduct['']).toBeUndefined();
  });

  it('D-C3 invariant 3: cross-path reconciliation — storeRefundDeduction == sum(byProduct refund portion) + customItemRefundCad (no tax/shipping gap — both paths use refund_line_items.subtotal)', () => {
    const result = computeRevenueWithCrossDayRefunds(fixtureOrders, DAY_D, PROBE_TZ);

    // Store-level cross-day refund deduction (recovered from storeNetCad and
    // same-day gross):
    const storeLevelDeduction = SAME_DAY_GROSS - result.storeNetCad;
    expect(storeLevelDeduction).toBeCloseTo(CROSS_DAY_DEDUCTION_TOTAL, 2);

    // Per-product cross-day refund portion (recovered from byProduct net
    // minus the same-day positive). Sum across pids: each cross-day pid is
    // pure negative refund; prod-Z carries the +30.00 same-day net.
    const sumByProductNet = Object.values(result.byProduct).reduce(
      (s, p) => s + p.netRevenueCad,
      0,
    );
    // sumByProductNet = -68.8 -65.28 -81.08 -55.35 +30.00 = -240.51
    const byProductRefundPortion = SAME_DAY_PROD_Z_NET - sumByProductNet;
    expect(byProductRefundPortion).toBeCloseTo(CROSS_DAY_BY_PID_TOTAL, 2);

    // REVISED D-C3 invariant 3: both paths reconcile exactly.
    expect(storeLevelDeduction).toBeCloseTo(
      byProductRefundPortion + result.customItemRefundCad,
      2,
    );

    // Concrete check: only customItemCrossDay's null-pid refund contributes
    // (the 3 probe-real refunds all have concrete pids → contribute 0 here).
    expect(result.customItemRefundCad).toBeCloseTo(CUSTOM_ITEM_REFUND_TOTAL, 2);
  });

  it('D-C3 invariant 4: full reconciliation — store_net == sum(byProduct.netRevenueCad) + customItemRefundCad within ±0.01 CAD (CONTEXT.md REVISED — both paths use refund_line_items.subtotal, no tax/shipping gap)', () => {
    const result = computeRevenueWithCrossDayRefunds(fixtureOrders, DAY_D, PROBE_TZ);

    const sumByProductNet = Object.values(result.byProduct).reduce(
      (s, p) => s + p.netRevenueCad,
      0,
    );

    // CONTEXT.md REVISED D-C3 invariant 4: exact equality within float
    // rounding (±0.01 CAD). The store-level subtracts customItemRefundCad
    // (it's part of the storewide refund_line_items[].subtotal sum), but
    // byProduct skips null product_ids — so we ADD customItemRefundCad
    // back to byProduct net to recover store_net.
    //
    // Concrete: storeNetCad = -245.51
    //           ΣbyProduct  = -240.51 (= -68.8 -65.28 -81.08 -55.35 +30.00)
    //           customItemRefundCad = 5.00
    //           ΣbyProduct - customItemRefundCad = -245.51  ✓
    expect(result.storeNetCad).toBeCloseTo(
      sumByProductNet - result.customItemRefundCad,
      2,
    );
  });

  it('D-C3 invariant 5: period reconciliation - sum(storeNetCad) across all relevant days == sum(total_price) - sum(refund_line_items.subtotal) (closes Gap 5 / WR-01 - the suite previously could not catch CR-01 double-deduction)', () => {
    // Period under test = every unique day that appears in fixtureOrders:
    //   - Order-creation days: 2026-03-09, 2026-04-11, 2026-05-02, 2026-05-10, 2026-05-20
    //   - Refund-processing days: 2026-05-20 (all 5 fixture refunds, including
    //     sameDayOrder intra-order and customItemCrossDay)
    // Distinct days = 5.
    //
    // === DUAL-ALGORITHM RED GATE VERIFICATION ===
    //
    // Under Plan 08 algorithm (HEAD — total_price + no cross-day filter):
    //   2026-03-09 row: total_price(zolplus)=65.28; refunds=0  -> 65.28
    //   2026-04-11 row: total_price(usmile360)=136.43; refunds=0  -> 136.43
    //   2026-05-02 row: total_price(uzoshop)=68.80; refunds=0  -> 68.80
    //   2026-05-10 row: total_price(customItem)=60.00; refunds=0  -> 60.00
    //   2026-05-20 row: total_price(sameDay)=50.00;
    //                   refunds = uzo 68.80 + zol 65.28 + usmile 81.08+55.35
    //                          + intra-order 20.00 + custom 5.00 = 295.51
    //                   -> 50.00 - 295.51 = -245.51
    //   Period sum = 65.28 + 136.43 + 68.80 + 60.00 + (-245.51) = 85.00
    //
    //   Sum(total_price) (excl test/voided) = 65.28 + 136.43 + 68.80 + 60.00 + 50.00 = 380.51
    //   Sum(refund_line_items.subtotal)     = 68.80 + 65.28 + 81.08 + 55.35 + 20.00 + 5.00 = 295.51
    //   380.51 - 295.51 = 85.00  ✓
    //
    // Under PRE-Plan-08 algorithm (current_total_price + cross-day filter):
    //   2026-03-09 row: current_total_price(zolplus)=0.00; cross-day=0  -> 0
    //   2026-04-11 row: current_total_price(usmile360)=0.00; cross-day=0  -> 0
    //   2026-05-02 row: current_total_price(uzoshop)=0.00; cross-day=0  -> 0
    //   2026-05-10 row: current_total_price(customItem)=55.00; cross-day=0  -> 55.00
    //   2026-05-20 row: current_total_price(sameDay)=30.00;
    //                   cross-day = uzo 68.80 + zol 65.28 + usmile 81.08+55.35 + custom 5.00 = 275.51
    //                   -> 30.00 - 275.51 = -245.51
    //   Period sum (OLD) = 0 + 0 + 0 + 55.00 + (-245.51) = -190.51
    //
    // The pre-Plan-08 period sum (-190.51) != Plan 08 period sum (85.00) by
    // 275.51 CAD — exactly the cross-day refund double-deduction magnitude
    // for this fixture set. The 4 existing invariants 1-4 never sum across
    // days so they cannot catch this drift — invariant 5 closes that gate
    // (Gap 5 / WR-01).

    const PERIOD_DAYS = [
      '2026-03-09',
      '2026-04-11',
      '2026-05-02',
      '2026-05-10',
      '2026-05-20',
    ];
    const periodSum = PERIOD_DAYS.reduce((acc, day) => {
      const r = computeRevenueWithCrossDayRefunds(fixtureOrders, day, PROBE_TZ);
      return acc + r.storeNetCad;
    }, 0);

    // Sum(total_price) (non-test, non-voided):
    //   uzoshop 68.80 + zolplus 65.28 + usmile360 136.43 + sameDay 50.00 + customItem 60.00
    //   = 380.51
    const SUM_TOTAL_PRICE = 380.51;
    // Sum(refund_line_items.subtotal) (all refunds, same-day intra-order + cross-day):
    //   uzoshop 68.80 + zolplus 65.28 + usmile360 (81.08+55.35) + sameDay 20.00 + customItem 5.00
    //   = 295.51
    const SUM_REFUND_SUBTOTAL = 295.51;

    expect(periodSum).toBeCloseTo(SUM_TOTAL_PRICE - SUM_REFUND_SUBTOTAL, 2);
    expect(periodSum).toBeCloseTo(85.00, 2);
  });

  it('D-C3 invariant 6: same-day order with FUTURE-day refund - per-product same-day net == line gross (closes Gap 2 / CR-02 - pre-Plan-08 leaked the future refund into same-day net)', () => {
    // Fixture: order created 2026-05-20, refund processed 2026-05-25 (5 days later).
    //
    // === DUAL-ALGORITHM RED GATE VERIFICATION ===
    //
    // Under Plan 08 algorithm (Task 3 — refundByLineId filtered by processed_at):
    //   On 2026-05-20: refund's processed_at=2026-05-25 != 2026-05-20,
    //     so refundByLineId is EMPTY for this order today.
    //     Per-product net = line gross (100.00).
    //     storeNet = total_price(100.00) - 0 = 100.00.
    //   On 2026-05-25: order's created_at=2026-05-20 != 2026-05-25,
    //     so order does NOT contribute to same-day gross today.
    //     Refund's processed_at=2026-05-25 matches today, so it deducts.
    //     Per-product net = -refund_subtotal = -40.00.
    //     storeNet = 0 (no orders created today) - 40.00 = -40.00.
    //   Period sum = 100.00 + (-40.00) = 60.00.
    //   total_price - refund_subtotal = 100.00 - 40.00 = 60.00 ✓
    //
    // Under PRE-Plan-08 algorithm (refundByLineId UNFILTERED):
    //   On 2026-05-20: refundByLineId includes the future refund subtotal=40.00.
    //     Per-line net = max(0, 100 - 0 - 40) = 60.00 (per-product double-deduction starts).
    //     storeNet = current_total_price (60.00 after refund applied — IF the
    //                refund is already applied by 2026-05-20 query time;
    //                otherwise 100.00). Live field, unpredictable.
    //   On 2026-05-25: cross-day filter triggers, refund_line_items[].subtotal=40.00 deducts.
    //     Per-product net = -40.00.
    //   Period sum (OLD) = 60.00 + (-40.00) = 20.00  --> WRONG, off by 40.00 (double-deducted).
    //
    // Invariant 6 locks Plan 08 Task 3's fix: refundByLineId MUST filter by processed_at day.

    // Same-day path (D = 2026-05-20): per-product net == line gross (100.00).
    const onDayD = computeRevenueWithCrossDayRefunds(
      [sameDayOrderWithFutureRefund],
      '2026-05-20',
      PROBE_TZ,
    );
    expect(onDayD.byProduct['prod-future-refund']).toBeDefined();
    expect(onDayD.byProduct['prod-future-refund'].netRevenueCad).toBeCloseTo(100.00, 2);
    expect(onDayD.storeNetCad).toBeCloseTo(100.00, 2); // total_price(100) - 0 refunds today

    // Refund day (D+5 = 2026-05-25): per-product net == -refund_subtotal (-40.00).
    const onRefundDay = computeRevenueWithCrossDayRefunds(
      [sameDayOrderWithFutureRefund],
      '2026-05-25',
      PROBE_TZ,
    );
    expect(onRefundDay.byProduct['prod-future-refund']).toBeDefined();
    expect(onRefundDay.byProduct['prod-future-refund'].netRevenueCad).toBeCloseTo(-40.00, 2);
    expect(onRefundDay.storeNetCad).toBeCloseTo(-40.00, 2); // no orders created on D+5; 40.00 refund deducts

    // Period sum lock: total_price - refund_subtotal = 100 - 40 = 60.
    const periodSum = onDayD.storeNetCad + onRefundDay.storeNetCad;
    expect(periodSum).toBeCloseTo(100.00 - 40.00, 2);
    expect(periodSum).toBeCloseTo(60.00, 2);
  });
});
