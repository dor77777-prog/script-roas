// dashboard-web/src/app/api/activity-stats/__tests__/route.test.ts
//
// AS-T1 — dashboard "פעילות › סטטיסטיקות והתפלגויות" data endpoint.
//
// GET /api/activity-stats?from=&to=&store= aggregates, SERVER-SIDE, the
// attribution distribution that powers the two donuts + per-product table:
//   1. paid-vs-organic split of orders (count + revenueCad)
//   2. EXHAUSTIVE platform/channel buckets (sum to total) by orders + revenueCad
//   3. ATC platform distribution (store_events add_to_cart)
//   4. per-product purchases (orders_attribution.line_items) + ATC (store_events)
//      with the source split for each, + conversionPct
//   5. first-touch coverage (% of orders carrying a first_touch_source)
//
// Dashboard-cookie gated (a NORMAL data route — NOT operator). Reads via
// getSupabaseAdmin() and must NEVER leak PII/secrets (no order ids, customer
// ids, raw blobs). product ids / titles are fine.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase admin mock — chainable builder per .from(table). Each table serves
// its fixture rows on the first .range() page, empty after, so the route's
// pagination loop terminates. We capture filters to assert push-down.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  orders: [] as Row[],
  events: [] as Row[],
  products: [] as Row[],
  calls: [] as {
    table: string;
    eq: Record<string, unknown>;
    gte: Record<string, unknown>;
    lte: Record<string, unknown>;
    select: string;
  }[],
  ordersError: null as { message: string } | null,
  eventsError: null as { message: string } | null,
  productsError: null as { message: string } | null,
}));

function rowsFor(table: string): Row[] {
  if (table === 'orders_attribution') return db.orders;
  if (table === 'store_events') return db.events;
  return db.products;
}
function errorFor(table: string): { message: string } | null {
  if (table === 'orders_attribution') return db.ordersError;
  if (table === 'store_events') return db.eventsError;
  return db.productsError;
}

function makeBuilder(table: string) {
  const call = {
    table,
    eq: {} as Record<string, unknown>,
    gte: {} as Record<string, unknown>,
    lte: {} as Record<string, unknown>,
    select: '',
  };
  db.calls.push(call);
  const rows = rowsFor(table);
  const error = errorFor(table);
  let served = false;
  const builder: Record<string, unknown> = {
    select(sel: string) {
      call.select = sel;
      return builder;
    },
    eq(col: string, val: unknown) {
      call.eq[col] = val;
      return builder;
    },
    gte(col: string, val: unknown) {
      call.gte[col] = val;
      return builder;
    },
    lte(col: string, val: unknown) {
      call.lte[col] = val;
      return builder;
    },
    order() {
      return builder;
    },
    range() {
      if (served) return Promise.resolve({ data: [], error });
      served = true;
      return Promise.resolve({ data: error ? null : rows, error });
    },
  };
  return builder;
}

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => makeBuilder(table) }),
}));
vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));

import { GET } from '@/app/api/activity-stats/route';
import type { ActivityStatsResponse } from '@/app/api/activity-stats/route';

function reqWith(qs = ''): Request {
  return new Request(`http://x/api/activity-stats${qs}`);
}

beforeEach(() => {
  db.orders = [];
  db.events = [];
  db.products = [];
  db.calls = [];
  db.ordersError = null;
  db.eventsError = null;
  db.productsError = null;
});

// ---------------------------------------------------------------------------

describe('GET /api/activity-stats — paid vs organic', () => {
  it('splits orders + revenue into paid (*-paid incl other-paid) vs organic (the rest incl direct)', async () => {
    db.orders = [
      { source: 'meta-paid', total_cad: 100 },
      { source: 'google-paid', total_cad: 50 },
      { source: 'other-paid', total_cad: 30 },
      { source: 'direct', total_cad: 20 },
      { source: 'email', total_cad: 10 },
      { source: 'meta-organic', total_cad: 5 },
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;

    expect(body.orders.total).toBe(6);
    // paid = meta-paid + google-paid + other-paid = 3 orders, 180 revenue
    expect(body.orders.paidVsOrganic.paid.orders).toBe(3);
    expect(body.orders.paidVsOrganic.paid.revenueCad).toBeCloseTo(180, 5);
    // organic = direct + email + meta-organic = 3 orders, 35 revenue
    expect(body.orders.paidVsOrganic.organic.orders).toBe(3);
    expect(body.orders.paidVsOrganic.organic.revenueCad).toBeCloseTo(35, 5);
    // The two sides cover EVERY order.
    expect(
      body.orders.paidVsOrganic.paid.orders + body.orders.paidVsOrganic.organic.orders,
    ).toBe(body.orders.total);
  });
});

describe('GET /api/activity-stats — byPlatform buckets', () => {
  it('maps sources to exhaustive buckets that sum to total (meta-paid+meta-organic→meta)', async () => {
    db.orders = [
      { source: 'meta-paid', total_cad: 100 },
      { source: 'meta-organic', total_cad: 10 },
      { source: 'google-paid', total_cad: 50 },
      { source: 'google-organic', total_cad: 5 },
      { source: 'tiktok-paid', total_cad: 40 },
      { source: 'tiktok-organic', total_cad: 4 },
      { source: 'email', total_cad: 20 },
      { source: 'other-referral', total_cad: 8 },
      { source: 'app-referral', total_cad: 2 },
      { source: 'search-organic', total_cad: 6 },
      { source: 'other-paid', total_cad: 30 },
      { source: 'direct', total_cad: 15 },
      { source: '', total_cad: 3 }, // unknown
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;

    const byBucket = Object.fromEntries(body.orders.byPlatform.map((b) => [b.bucket, b]));
    // meta = meta-paid + meta-organic
    expect(byBucket['meta'].orders).toBe(2);
    expect(byBucket['meta'].revenueCad).toBeCloseTo(110, 5);
    // google = google-paid + google-organic
    expect(byBucket['google'].orders).toBe(2);
    // tiktok = tiktok-paid + tiktok-organic
    expect(byBucket['tiktok'].orders).toBe(2);
    // email
    expect(byBucket['email'].orders).toBe(1);
    // referral = other-referral + app-referral + search-organic
    expect(byBucket['referral'].orders).toBe(3);
    // other-paid
    expect(byBucket['other-paid'].orders).toBe(1);
    // direct = explicit 'direct' + the '' (unknown) catch-all → 2
    expect(byBucket['direct'].orders).toBe(2);

    // EXHAUSTIVE — every order lands in exactly one bucket; buckets sum to total.
    const sumOrders = body.orders.byPlatform.reduce((s, b) => s + b.orders, 0);
    expect(sumOrders).toBe(body.orders.total);
    const sumPct = body.orders.byPlatform.reduce((s, b) => s + b.pct, 0);
    expect(sumPct).toBeCloseTo(100, 5);
    // Revenue is aggregated per bucket and totals across buckets.
    const sumRev = body.orders.byPlatform.reduce((s, b) => s + b.revenueCad, 0);
    expect(sumRev).toBeCloseTo(100 + 10 + 50 + 5 + 40 + 4 + 20 + 8 + 2 + 6 + 30 + 15 + 3, 5);
    // Each bucket carries a Hebrew-ish label string.
    for (const b of body.orders.byPlatform) expect(typeof b.label).toBe('string');
  });
});

describe('GET /api/activity-stats — ATC distribution', () => {
  it('aggregates store_events add_to_cart by platform bucket, independent of orders', async () => {
    db.orders = [{ source: 'meta-paid', total_cad: 100 }];
    db.events = [
      { source: 'meta-paid', product_title: 'A', first_touch_source: null },
      { source: 'meta-organic', product_title: 'A', first_touch_source: null },
      { source: 'direct', product_title: 'B', first_touch_source: null },
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;

    expect(body.atc.total).toBe(3);
    const byBucket = Object.fromEntries(body.atc.byPlatform.map((b) => [b.bucket, b]));
    expect(byBucket['meta'].count).toBe(2); // meta-paid + meta-organic
    expect(byBucket['direct'].count).toBe(1);
    const sumCount = body.atc.byPlatform.reduce((s, b) => s + b.count, 0);
    expect(sumCount).toBe(body.atc.total);
  });

  it('filters store_events to type=add_to_cart and pushes the date range', async () => {
    db.events = [{ source: 'direct', product_title: 'B', first_touch_source: null }];
    await GET(reqWith('?from=2026-05-01&to=2026-05-31'));
    const eventsCall = db.calls.find((c) => c.table === 'store_events');
    expect(eventsCall?.eq['type']).toBe('add_to_cart');
    expect(String(eventsCall?.gte['received_at'])).toContain('2026-05-01');
    expect(String(eventsCall?.lte['received_at'])).toContain('2026-05-31');
    const ordersCall = db.calls.find((c) => c.table === 'orders_attribution');
    expect(ordersCall?.gte['date']).toBe('2026-05-01');
    expect(ordersCall?.lte['date']).toBe('2026-05-31');
  });
});

describe('GET /api/activity-stats — per-product', () => {
  it('joins purchases (line_items by productId) + ATC (store_events by title) with source splits + conversionPct', async () => {
    // products_daily provides the productId→title bridge for purchases.
    db.products = [
      { product_id: 'P1', product_title: 'Hair Dryer' },
      { product_id: 'P2', product_title: 'Serum' },
    ];
    db.orders = [
      // P1 purchased via meta-paid (2 lines across 2 orders) + google-paid (1).
      { source: 'meta-paid', total_cad: 100, line_items: JSON.stringify([{ p: 'P1', u: 1, r: 100 }]) },
      { source: 'meta-paid', total_cad: 90, line_items: JSON.stringify([{ p: 'P1', u: 1, r: 90 }]) },
      { source: 'google-paid', total_cad: 80, line_items: JSON.stringify([{ p: 'P1', u: 1, r: 80 }]) },
      // P2 purchased once via direct.
      { source: 'direct', total_cad: 50, line_items: JSON.stringify([{ p: 'P2', u: 1, r: 50 }]) },
    ];
    db.events = [
      // Hair Dryer ATC: 4 carts (meta-paid x3, direct x1) — title-matched to P1.
      { source: 'meta-paid', product_title: 'Hair Dryer', first_touch_source: null },
      { source: 'meta-paid', product_title: 'Hair Dryer', first_touch_source: null },
      { source: 'meta-paid', product_title: 'Hair Dryer', first_touch_source: null },
      { source: 'direct', product_title: 'Hair Dryer', first_touch_source: null },
      // Serum ATC: 2 carts.
      { source: 'meta-paid', product_title: 'Serum', first_touch_source: null },
      { source: 'direct', product_title: 'Serum', first_touch_source: null },
    ];

    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;

    const byProduct = Object.fromEntries(body.perProduct.map((p) => [p.productTitle, p]));
    const hd = byProduct['Hair Dryer'];
    expect(hd).toBeTruthy();
    expect(hd.productId).toBe('P1');
    expect(hd.purchaseCount).toBe(3);
    expect(hd.atcCount).toBe(4);
    // conversionPct = purchases / atc * 100 = 3/4 = 75
    expect(hd.conversionPct).toBeCloseTo(75, 5);
    // purchase source split: meta=2, google=1
    const hdPurchase = Object.fromEntries(hd.purchaseBySource.map((s) => [s.bucket, s.count]));
    expect(hdPurchase['meta']).toBe(2);
    expect(hdPurchase['google']).toBe(1);
    // atc source split: meta=3, direct=1
    const hdAtc = Object.fromEntries(hd.atcBySource.map((s) => [s.bucket, s.count]));
    expect(hdAtc['meta']).toBe(3);
    expect(hdAtc['direct']).toBe(1);

    // Sorted by purchaseCount DESC → Hair Dryer (3) before Serum (1).
    expect(body.perProduct[0].productTitle).toBe('Hair Dryer');
  });

  it('caps per-product to the top ~20 by purchaseCount', async () => {
    db.orders = [];
    for (let i = 0; i < 30; i++) {
      const pid = `P${i}`;
      // i+1 purchases each so ordering is deterministic.
      for (let n = 0; n <= i; n++) {
        db.orders.push({
          source: 'meta-paid',
          total_cad: 10,
          line_items: JSON.stringify([{ p: pid, u: 1, r: 10 }]),
        });
      }
      db.products.push({ product_id: pid, product_title: `Title ${i}` });
    }
    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;
    expect(body.perProduct.length).toBeLessThanOrEqual(20);
    // The highest purchase count (P29, 30 purchases) must be first.
    expect(body.perProduct[0].purchaseCount).toBe(30);
  });
});

describe('GET /api/activity-stats — first-touch coverage', () => {
  it('computes withFt / total / pct for orders', async () => {
    db.orders = [
      { source: 'direct', total_cad: 1, first_touch_source: 'meta-paid' },
      { source: 'direct', total_cad: 1, first_touch_source: null },
      { source: 'meta-paid', total_cad: 1, first_touch_source: 'meta-paid' },
      { source: 'google-paid', total_cad: 1, first_touch_source: '' },
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;
    expect(body.firstTouchCoverage.orders.total).toBe(4);
    expect(body.firstTouchCoverage.orders.withFt).toBe(2);
    expect(body.firstTouchCoverage.orders.pct).toBeCloseTo(50, 5);
  });

  it('coverage pct is 0 (not NaN) when there are no rows', async () => {
    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;
    expect(body.firstTouchCoverage.orders.pct).toBe(0);
    expect(body.orders.total).toBe(0);
    expect(body.atc.total).toBe(0);
    expect(body.perProduct).toEqual([]);
  });
});

describe('GET /api/activity-stats — store filter + range', () => {
  it('pushes store_id filter when store is a concrete id', async () => {
    db.orders = [{ source: 'meta-paid', total_cad: 1 }];
    await GET(reqWith('?store=uzoshop'));
    const ordersCall = db.calls.find((c) => c.table === 'orders_attribution');
    const eventsCall = db.calls.find((c) => c.table === 'store_events');
    expect(ordersCall?.eq['store_id']).toBe('uzoshop');
    expect(eventsCall?.eq['store_id']).toBe('uzoshop');
  });

  it('does NOT filter by store when store=All or absent', async () => {
    db.orders = [{ source: 'meta-paid', total_cad: 1 }];
    await GET(reqWith('?store=All'));
    const ordersCall = db.calls.find((c) => c.table === 'orders_attribution');
    expect(ordersCall?.eq['store_id']).toBeUndefined();
  });

  it('defaults to a ~30-day window ending today when no params given', async () => {
    const body = (await (await GET(reqWith())).json()) as ActivityStatsResponse;
    expect(body.range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const days = Math.round(
      (new Date(body.range.to).getTime() - new Date(body.range.from).getTime()) / 86_400_000,
    );
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(31);
  });
});

describe('GET /api/activity-stats — safety', () => {
  it('never leaks PII / secrets — no order ids, customer ids, or raw blobs in the body', async () => {
    db.orders = [
      {
        source: 'meta-paid',
        total_cad: 100,
        first_touch_source: 'meta-paid',
        line_items: JSON.stringify([{ p: 'P1', u: 1, r: 100 }]),
        order_id: 'SECRET-ORDER-99',
        customer_id: 'CUST-123',
      },
    ];
    db.events = [{ source: 'direct', product_title: 'B', first_touch_source: null }];
    db.products = [{ product_id: 'P1', product_title: 'Hair Dryer' }];
    const res = await GET(reqWith());
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('SECRET-ORDER-99');
    expect(text).not.toContain('CUST-123');
    expect(text).not.toContain('order_id');
    expect(text).not.toContain('customer_id');
    expect(text).not.toContain('raw');
  });

  it('soft-fails to an empty/typed body (HTTP 200) when the orders query errors', async () => {
    db.ordersError = { message: 'boom' };
    const res = await GET(reqWith());
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActivityStatsResponse;
    expect(body.error).toBeDefined();
    expect(body.orders.total).toBe(0);
    expect(body.atc.total).toBe(0);
    expect(body.perProduct).toEqual([]);
  });
});
