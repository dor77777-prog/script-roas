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

  // ----------------------------------------------------------------
  // TikTok predicate — symmetric with Meta/Google (classify-v2 T2).
  // Meta counts meta-paid + meta-organic; Google counts google-paid +
  // google-organic; TikTok must count tiktok-paid + tiktok-organic.
  // ----------------------------------------------------------------

  it('counts tiktok-paid source as TikTok', () => {
    const order = makeOrder({
      source: 'tiktok-paid',
      fbclidPresent: false,
      lineItems: [makeLineItem({ productId: 'p-1' })],
      date: '2026-05-10',
    });
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1'],
      orders: [order],
    });
    expect(result.tiktokOrders).toBe(1);
  });

  it('counts tiktok-organic source as TikTok (symmetric with meta-organic)', () => {
    const order = makeOrder({
      source: 'tiktok-organic',
      fbclidPresent: false,
      lineItems: [makeLineItem({ productId: 'p-1' })],
      date: '2026-05-10',
    });
    const result = analyzeProductChannel({
      ...BASE_OPTS,
      productIds: ['p-1'],
      orders: [order],
    });
    expect(result.tiktokOrders).toBe(1);
    expect(result.tiktokRevenue).toBeGreaterThan(0);
    // bySource still buckets the raw label distinctly.
    expect(result.bySource['tiktok-organic']?.orders).toBe(1);
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

  // ----------------------------------------------------------------
  // Full OrderSource sweep (TEST-08 — pins AUDIT-P3-08)
  // ----------------------------------------------------------------

  describe('full OrderSource sweep', () => {
    it('buckets every OrderSource value into bySource (with google-organic explicitly present)', () => {
      // One order per writer-emitted source label, all containing the
      // same mapped product. Verifies that no OrderSource value is silently
      // dropped — the original bug was google-organic missing from the
      // organic whitelist (AUDIT-P0-01).
      const sources: Array<{ source: 'meta-paid' | 'meta-organic' | 'google-paid' | 'google-organic' | 'direct' | 'email' | 'other-paid' | 'other-referral'; fbclidPresent: boolean; gclidPresent: boolean }> = [
        { source: 'meta-paid', fbclidPresent: true, gclidPresent: false },
        { source: 'meta-organic', fbclidPresent: false, gclidPresent: false },
        { source: 'google-paid', fbclidPresent: false, gclidPresent: true },
        { source: 'google-organic', fbclidPresent: false, gclidPresent: false },
        { source: 'direct', fbclidPresent: false, gclidPresent: false },
        { source: 'email', fbclidPresent: false, gclidPresent: false },
        { source: 'other-paid', fbclidPresent: false, gclidPresent: false },
        { source: 'other-referral', fbclidPresent: false, gclidPresent: false },
      ];
      const orders = sources.map(s => makeOrder({
        source: s.source,
        fbclidPresent: s.fbclidPresent,
        gclidPresent: s.gclidPresent,
        orderId: `o-${s.source}`,
        lineItems: [makeLineItem({ productId: 'p-1' })],
        date: '2026-05-10',
      }));

      const result = analyzeProductChannel({
        ...BASE_OPTS,
        productIds: ['p-1'],
        orders,
      });

      // Every source has one order with one revenue unit (50 from
      // makeLineItem default). bySource maps must contain every label.
      expect(result.totalOrders).toBe(8);
      expect(result.bySource['meta-paid']?.orders).toBe(1);
      expect(result.bySource['meta-organic']?.orders).toBe(1);
      expect(result.bySource['google-paid']?.orders).toBe(1);
      // CRITICAL: google-organic must be present, not silently merged.
      expect(result.bySource['google-organic']?.orders).toBe(1);
      expect(result.bySource['direct']?.orders).toBe(1);
      expect(result.bySource['email']?.orders).toBe(1);
      expect(result.bySource['other-paid']?.orders).toBe(1);
      expect(result.bySource['other-referral']?.orders).toBe(1);
    });

    it('counts google-organic distinctly in bySource (not silently dropped)', () => {
      // Targeted regression test for the AUDIT-P0-01 omission. Pre-fix
      // the dashboard's organic whitelist had impossible labels and
      // missed google-organic — analyzeProductChannel buckets by raw
      // source string so the bucket appears regardless, but we keep
      // this assertion focused as documentation of the specific bug.
      const order = makeOrder({
        source: 'google-organic',
        fbclidPresent: false,
        gclidPresent: false,
        lineItems: [makeLineItem({ productId: 'p-1' })],
        date: '2026-05-10',
      });
      const result = analyzeProductChannel({
        ...BASE_OPTS,
        productIds: ['p-1'],
        orders: [order],
      });
      expect(result.bySource['google-organic']?.orders).toBe(1);
      expect(result.bySource['google-organic']?.revenue).toBeGreaterThan(0);
    });

    it('TikTok count includes tiktok-paid + tiktok-organic (symmetric with Meta/Google), excludes other organics', () => {
      // classify-v2 T2: TikTok bucket is symmetric with Meta (meta-paid +
      // meta-organic) and Google (google-paid + google-organic). New organic
      // values (search-organic, app-referral) are NOT TikTok and must stay out.
      const orders = [
        makeOrder({ source: 'tiktok-paid', orderId: 'tt-paid', lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10' }),
        makeOrder({ source: 'tiktok-organic', orderId: 'tt-org', lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-11' }),
        makeOrder({ source: 'search-organic', orderId: 'srch', lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-12' }),
        makeOrder({ source: 'app-referral', orderId: 'app', lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-13' }),
      ];
      const result = analyzeProductChannel({
        ...BASE_OPTS,
        productIds: ['p-1'],
        orders,
      });
      expect(result.totalOrders).toBe(4);
      expect(result.tiktokOrders).toBe(2); // paid + organic, NOT search/app
      expect(result.tiktokRevenue).toBeGreaterThan(0);
      // New organic values bucket distinctly by raw source label.
      expect(result.bySource['tiktok-organic']?.orders).toBe(1);
      expect(result.bySource['search-organic']?.orders).toBe(1);
      expect(result.bySource['app-referral']?.orders).toBe(1);
    });

    it('Facebook count includes meta-paid + meta-organic + fbclidPresent (3 paths)', () => {
      // Locked CONTEXT predicate: facebook = (source ∈ {meta-paid,
      // meta-organic}) OR fbclidPresent. Three orders, each exercising
      // exactly one path → facebookOrders = 3.
      const orders = [
        makeOrder({ source: 'meta-paid', fbclidPresent: false, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-10', orderId: 'o1' }),
        makeOrder({ source: 'meta-organic', fbclidPresent: false, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-11', orderId: 'o2' }),
        // fbclid present but source is google-paid — would NOT match a
        // simple "source startsWith meta-" check, but must still count.
        makeOrder({ source: 'google-paid', fbclidPresent: true, lineItems: [makeLineItem({ productId: 'p-1' })], date: '2026-05-12', orderId: 'o3' }),
      ];
      const result = analyzeProductChannel({
        ...BASE_OPTS,
        productIds: ['p-1'],
        orders,
      });
      expect(result.totalOrders).toBe(3);
      expect(result.facebookOrders).toBe(3);
      expect(result.facebookRevenue).toBeGreaterThan(0);
    });
  });
});
