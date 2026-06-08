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
      // line_items is a real ARRAY (the jsonb shape supabase-js decodes to),
      // NOT a JSON string — this exercises the live parseLineItems array path.
      { source: 'meta-paid', total_cad: 100, line_items: [{ p: 'P1', u: 1, r: 100 }] },
      { source: 'meta-paid', total_cad: 90, line_items: [{ p: 'P1', u: 1, r: 90 }] },
      { source: 'google-paid', total_cad: 80, line_items: [{ p: 'P1', u: 1, r: 80 }] },
      // P2 purchased once via direct.
      { source: 'direct', total_cad: 50, line_items: [{ p: 'P2', u: 1, r: 50 }] },
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
    // Purchases ARE counted from the array-shaped line_items (the live path).
    // If parseLineItems regressed to returning [] for arrays this would be 0.
    expect(hd.purchaseCount).toBeGreaterThan(0);
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

  it('counts a purchase from array-shaped line_items AND joins it to an id-bearing ATC (the live supabase jsonb path)', async () => {
    // End-to-end guard for the parseLineItems bug: the orders row's line_items
    // is the REAL supabase shape — an already-decoded ARRAY of {p,u,r}, NOT a
    // JSON string. The ATC carries a raw scalar product_id ('999', the value
    // supabase returns for the `raw->>product_id` JSON-path SELECT alias). The
    // route must (a) count the purchase from the array, and (b) merge it with
    // the ATC under one productId row. Before the fix parseLineItems threw on
    // the array → purchaseCount 0 → this test fails.
    db.products = [{ product_id: '999', product_title: 'Vitamin C' }];
    db.orders = [
      { source: 'meta-paid', total_cad: 60, line_items: [{ p: '999', u: 2, r: 60 }] },
    ];
    db.events = [
      { source: 'meta-paid', product_id: '999', product_title: 'Vitamin C', first_touch_source: null },
    ];

    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;

    const row = body.perProduct.find((p) => p.productId === '999');
    expect(row).toBeTruthy();
    // Purchase counted off the array path (would be 0 on the regressed parser).
    expect(row!.purchaseCount).toBeGreaterThanOrEqual(1);
    // ATC joined to the same row via the raw scalar product_id.
    expect(row!.atcCount).toBeGreaterThanOrEqual(1);
    // The id-join produced exactly ONE merged row (purchase + ATC together).
    expect(row!.purchaseCount).toBe(1);
    expect(row!.atcCount).toBe(1);
    expect(row!.conversionPct).toBeCloseTo(100, 5);
  });

  it('merges an ATC carrying raw.product_id with a purchase of the SAME productId into ONE row, even when titles differ (PPJ-T2)', async () => {
    // Catalog title differs from the ATC product_title — the join MUST be by id.
    db.products = [{ product_id: '7654321', product_title: 'Catalog Title' }];
    db.orders = [
      // One purchase of product 7654321 via meta-paid.
      {
        source: 'meta-paid',
        total_cad: 100,
        // Real ARRAY (supabase jsonb shape), not a JSON string.
        line_items: [{ p: '7654321', u: 1, r: 100 }],
      },
    ];
    db.events = [
      // Two ATC events for the SAME product, but tagged with a DIFFERENT title.
      { source: 'meta-paid', product_id: '7654321', product_title: 'Beacon Title', first_touch_source: null },
      { source: 'direct', product_id: '7654321', product_title: 'Beacon Title', first_touch_source: null },
    ];

    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;

    // Exactly ONE per-product row for this id — not two split rows.
    const rows = body.perProduct.filter((p) => p.productId === '7654321');
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.atcCount).toBe(2);
    expect(row.purchaseCount).toBe(1);
    // conversionPct = 1/2 = 50 (only correct because the id-join merged them).
    expect(row.conversionPct).toBeCloseTo(50, 5);
    // Title comes from the catalog (products_daily), not the beacon title.
    expect(row.productTitle).toBe('Catalog Title');
    // There is NO separate ATC-only row titled by the beacon title.
    expect(body.perProduct.some((p) => p.productTitle === 'Beacon Title')).toBe(false);
  });

  it('merges a historical ATC WITHOUT product_id via the title fallback (legacy) (PPJ-T2)', async () => {
    db.products = [{ product_id: 'P9', product_title: 'Night Cream' }];
    db.orders = [
      { source: 'meta-paid', total_cad: 50, line_items: [{ p: 'P9', u: 1, r: 50 }] },
    ];
    db.events = [
      // No product_id (historical event) but the title matches the catalog title.
      { source: 'direct', product_title: 'Night Cream', first_touch_source: null },
    ];

    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;

    const rows = body.perProduct.filter((p) => p.productId === 'P9');
    expect(rows.length).toBe(1);
    expect(rows[0].atcCount).toBe(1);
    expect(rows[0].purchaseCount).toBe(1);
    expect(rows[0].conversionPct).toBeCloseTo(100, 5);
    expect(rows[0].productTitle).toBe('Night Cream');
  });

  it('keeps a historical ATC WITHOUT product_id and no catalog title match as its own ATC-only row (PPJ-T2)', async () => {
    db.products = [];
    db.orders = [];
    db.events = [
      { source: 'direct', product_title: 'Mystery Widget', first_touch_source: null },
    ];

    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;

    const row = body.perProduct.find((p) => p.productTitle === 'Mystery Widget');
    expect(row).toBeTruthy();
    expect(row!.atcCount).toBe(1);
    expect(row!.purchaseCount).toBe(0);
    // No ATC denominator vs purchases that exist → conversionPct = 0/1 = 0.
    expect(row!.conversionPct).toBeCloseTo(0, 5);
    expect(row!.productId).toBeNull();
  });

  it('keeps a purchased product with NO ATC as a row with buy>0, atc=0 (PPJ-T2)', async () => {
    db.products = [{ product_id: 'P5', product_title: 'Lone Product' }];
    db.orders = [
      { source: 'meta-paid', total_cad: 70, line_items: [{ p: 'P5', u: 1, r: 70 }] },
    ];
    db.events = [];

    const res = await GET(reqWith());
    const body = (await res.json()) as ActivityStatsResponse;

    const row = body.perProduct.find((p) => p.productId === 'P5');
    expect(row).toBeTruthy();
    expect(row!.purchaseCount).toBe(1);
    expect(row!.atcCount).toBe(0);
    // No ATC → conversionPct null.
    expect(row!.conversionPct).toBeNull();
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
          line_items: [{ p: pid, u: 1, r: 10 }],
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
        line_items: [{ p: 'P1', u: 1, r: 100 }],
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
