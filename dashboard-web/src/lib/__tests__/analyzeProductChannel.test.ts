import { describe, it, expect } from 'vitest';
import { analyzeProductChannel } from '@/lib/attributionAnalysis';
import { makeOrder, makeLineItem } from './fixtures';

const STORE_ID = 'uzoshop';
const DATE_FROM = '2026-05-01';
const DATE_TO = '2026-05-15';

const BASE_OPTS = { storeId: STORE_ID, dateFrom: DATE_FROM, dateTo: DATE_TO };

describe('analyzeProductChannel', () => {
  // ----------------------------------------------------------------
  // Empty inputs → explicit-zero (not null)
  // ----------------------------------------------------------------

  it('returns explicit-zero object (not null) for empty productIds', () => {
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: [],
      orders: [makeOrder()],
    });
    expect(result).not.toBeNull();
    expect(result.totalOrders).toBe(0);
    expect(result.facebookShare).toBe(0);
  });

  it('returns explicit-zero object (not null) for empty orders array', () => {
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1'],
      orders: [],
    });
    expect(result).not.toBeNull();
    expect(result.totalOrders).toBe(0);
    expect(result.facebookShare).toBe(0);
  });

  // ----------------------------------------------------------------
  // Order without lineItems → skipped
  // ----------------------------------------------------------------

  it('order with empty lineItems is not counted', () => {
    const order = makeOrder({ lineItems: [], date: '2026-05-10' });
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1'],
      orders: [order],
    });
    expect(result.totalOrders).toBe(0);
  });

  // ----------------------------------------------------------------
  // Facebook predicate
  // ----------------------------------------------------------------

  it('counts meta-paid source as Facebook', () => {
    const order = makeOrder({
      source: 'meta-paid',
      fbclidPresent: false,
      lineItems: [makeLineItem({ productId: 'p-1' })],
      date: '2026-05-10',
    });
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1'],
      orders: [order],
    });
    expect(result.facebookOrders).toBe(1);
  });

  it('counts meta-organic source as Facebook', () => {
    const order = makeOrder({
      source: 'meta-organic',
      fbclidPresent: false,
      lineItems: [makeLineItem({ productId: 'p-1' })],
      date: '2026-05-10',
    });
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1'],
      orders: [order],
    });
    expect(result.facebookOrders).toBe(1);
  });

  it('counts fbclidPresent=true as Facebook regardless of source (locked CONTEXT predicate)', () => {
    // Critical test: source is 'google-paid' but fbclid is present → Facebook
    const order = makeOrder({
      source: 'google-paid',
      fbclidPresent: true,
      lineItems: [makeLineItem({ productId: 'p-1' })],
      date: '2026-05-10',
    });
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1'],
      orders: [order],
    });
    expect(result.facebookOrders).toBe(1);
  });

  it('does not count direct source as Facebook', () => {
    const order = makeOrder({
      source: 'direct',
      fbclidPresent: false,
      lineItems: [makeLineItem({ productId: 'p-1' })],
      date: '2026-05-10',
    });
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1'],
      orders: [order],
    });
    expect(result.facebookOrders).toBe(0);
    expect(result.bySource['direct']?.orders).toBe(1);
  });

  // ----------------------------------------------------------------
  // Order counted once even with multiple matched products
  // ----------------------------------------------------------------

  it('order with 2 matched lineItems counts as 1 order but sums both revenues', () => {
    const order = makeOrder({
      lineItems: [
        makeLineItem({ productId: 'p-1', revenueCad: 50 }),
        makeLineItem({ productId: 'p-2', revenueCad: 30 }),
      ],
      date: '2026-05-10',
      source: 'meta-paid',
    });
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1', 'p-2'],
      orders: [order],
    });
    expect(result.totalOrders).toBe(1);
    expect(result.totalRevenue).toBeCloseTo(80, 4);
  });

  // ----------------------------------------------------------------
  // facebookShare divide-by-zero guard (Pitfall 3)
  // ----------------------------------------------------------------

  it('Pitfall3: facebookShare is 0 (not NaN, not Infinity) when totalOrders is 0', () => {
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1'],
      orders: [],
    });
    expect(result.facebookShare).toBe(0);
    expect(Number.isNaN(result.facebookShare)).toBe(false);
    expect(Number.isFinite(result.facebookShare)).toBe(true);
  });

  // ----------------------------------------------------------------
  // bySource bucketing
  // ----------------------------------------------------------------

  it('buckets orders by source correctly (meta-paid, google-paid, empty source → direct)', () => {
    const orders = [
      makeOrder({ source: 'meta-paid', fbclidPresent: false, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }),
      makeOrder({ source: 'google-paid', fbclidPresent: false, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }),
      makeOrder({ source: '', fbclidPresent: false, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }),
    ];
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1'],
      orders,
    });
    expect(result.bySource['meta-paid']?.orders).toBe(1);
    expect(result.bySource['google-paid']?.orders).toBe(1);
    // Empty source lumped into 'direct'
    expect(result.bySource['direct']?.orders).toBe(1);
    expect(result.totalOrders).toBe(3);
  });

  // ----------------------------------------------------------------
  // Date + store filter
  // ----------------------------------------------------------------

  it('excludes orders outside date range or wrong store', () => {
    const ordersOutsideDate = [
      makeOrder({ lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-06-01' }),
    ];
    const ordersWrongStore = [
      makeOrder({ lineItems: [makeLineItem({ productId: 'p-1' })], storeId: 'zolplus', date: '2026-05-10' }),
    ];
    const r1 = analyzeProductChannel({ ...BASE_OPTS, productIds: ['p-1'], orders: ordersOutsideDate });
    expect(r1.totalOrders).toBe(0);
    const r2 = analyzeProductChannel({ ...BASE_OPTS, productIds: ['p-1'], orders: ordersWrongStore });
    expect(r2.totalOrders).toBe(0);
  });
});
