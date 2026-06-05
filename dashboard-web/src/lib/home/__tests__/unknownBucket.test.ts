import { describe, expect, it } from 'vitest';
import { decomposeUnknownBucket } from '../unknownBucket';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

// Minimal row factory — only the fields the decomposition reads matter; the
// rest are filled with attribution-EMPTY values so the row lands in the
// unknown bucket unless we explicitly add a signal.
function row(over: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-06-01', storeId: 'uzoshop', storeName: 'uzoshop', orderId: 'o1',
    totalCad: 0, source: 'direct', utmSource: '', utmMedium: '', utmCampaign: '',
    utmContent: '', fbclidPresent: false, gclidPresent: false, referringSite: '',
    utmId: '', utmTerm: '', lineItems: [], customerId: null, orderCreatedAt: null,
    isFirstOrder: null, firstTouchSource: null, firstFbclidPresent: false,
    firstGclidPresent: false, firstTtclidPresent: false, firstUtmSource: null,
    firstUtmMedium: null, firstUtmCampaign: null, firstUtmContent: null,
    firstUtmId: null, firstUtmTerm: null, firstSeenAt: null,
    surveySource: null, // added in Feature B; harmless here
    ...over,
  } as OrderAttributionRow;
}

describe('decomposeUnknownBucket', () => {
  it('returns the empty shape when there are no rows', () => {
    const b = decomposeUnknownBucket([]);
    expect(b.unknownOrders).toBe(0);
    expect(b.newVsReturning).toEqual({ new: 0, returning: 0, unclassifiable: 0 });
    expect(b.byStore).toEqual([]);
    expect(b.topProducts).toEqual([]);
    expect(b.byPaymentCategory).toEqual({ credit: 0, paypal: 0, other: 0 });
    expect(b.aovBands).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it('only counts orders WITHOUT an attribution signal (never redistributes covered)', () => {
    const rows = [
      row({ orderId: 'attributed', fbclidPresent: true, totalCad: 100 }), // covered → excluded
      row({ orderId: 'unknown', source: 'direct', totalCad: 40 }),         // unknown → counted
    ];
    const b = decomposeUnknownBucket(rows);
    expect(b.unknownOrders).toBe(1);
    expect(b.unknownRevenueCad).toBeCloseTo(40);
  });

  it('splits new vs returning vs unclassifiable by isFirstOrder', () => {
    const rows = [
      row({ orderId: 'a', isFirstOrder: true }),
      row({ orderId: 'b', isFirstOrder: false }),
      row({ orderId: 'c', isFirstOrder: null }),
      row({ orderId: 'd', isFirstOrder: true }),
    ];
    const b = decomposeUnknownBucket(rows);
    expect(b.newVsReturning).toEqual({ new: 2, returning: 1, unclassifiable: 1 });
  });

  it('buckets AOV into low (<50) / mid (50–70) / high (>70)', () => {
    const rows = [
      row({ orderId: 'a', totalCad: 30 }),  // low
      row({ orderId: 'b', totalCad: 60 }),  // mid (50–70)
      row({ orderId: 'c', totalCad: 200 }), // high
      row({ orderId: 'd', totalCad: 70 }),  // inclusive upper edge of mid
    ];
    const b = decomposeUnknownBucket(rows);
    expect(b.aovBands).toEqual({ low: 1, mid: 2, high: 1 });
  });

  it('groups by store (display name) descending by orders', () => {
    const rows = [
      row({ orderId: 'a', storeName: 'Zol Plus' }),
      row({ orderId: 'b', storeName: '360usmile' }),
      row({ orderId: 'c', storeName: 'Zol Plus' }),
    ];
    const b = decomposeUnknownBucket(rows);
    expect(b.byStore[0]).toEqual({ store: 'Zol Plus', orders: 2 });
    expect(b.byStore[1]).toEqual({ store: '360usmile', orders: 1 });
  });

  it('rolls top products from lineItems (capped at TOP_N), descending by units', () => {
    const rows = [
      row({ orderId: 'a', lineItems: [{ productId: 'p1', units: 2, revenueCad: 20 }] }),
      row({ orderId: 'b', lineItems: [{ productId: 'p1', units: 1, revenueCad: 10 },
                                      { productId: 'p2', units: 5, revenueCad: 50 }] }),
    ];
    const b = decomposeUnknownBucket(rows);
    expect(b.topProducts[0]).toEqual({ productId: 'p2', units: 5, revenueCad: 50 });
    expect(b.topProducts[1]).toEqual({ productId: 'p1', units: 3, revenueCad: 30 });
  });

  it('categorizes payment gateway via the shared categorizer', () => {
    const rows = [
      row({ orderId: 'a', paymentGateway: 'paypal' }),
      row({ orderId: 'b', paymentGateway: 'shopify_payments' }),
      row({ orderId: 'c', paymentGateway: null }), // → other
    ];
    const b = decomposeUnknownBucket(rows);
    expect(b.byPaymentCategory).toEqual({ credit: 1, paypal: 1, other: 1 });
  });
});
