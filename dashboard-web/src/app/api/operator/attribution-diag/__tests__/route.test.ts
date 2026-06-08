// dashboard-web/src/app/api/operator/attribution-diag/__tests__/route.test.ts
//
// classify-v2 T4 — re-runnable operator attribution diagnostic.
//
// GET /api/operator/attribution-diag aggregates, SERVER-SIDE, the same
// source-distribution analysis we ran ad-hoc against the DB:
//   1. orders source distribution (count + pct per `source`)
//   2. ATC source distribution (count + pct per `source`, store_events type=add_to_cart)
//   3. murky-bucket breakdowns:
//        - other-paid    → top "utm_source | utm_medium" combos
//        - other-referral→ top referrer domains
//        - direct        → first_touch_source breakdown
//   4. first-touch coverage (% of orders + ATC that carry a first_touch_source)
//
// The route reads via getSupabaseAdmin() and must NEVER leak PII/secrets
// (no order ids, customer ids, raw blobs). utm_source / utm_medium / referrer
// DOMAINS are marketing labels and are fine to surface.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase admin mock — a chainable query builder. Each .from(table) returns a
// fresh builder whose terminal await resolves to the table's fixture rows.
// We capture the filters applied so the test can assert the date push-down +
// the add_to_cart type filter actually happened.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  orders: [] as Row[],
  events: [] as Row[],
  calls: [] as { table: string; eq: Record<string, unknown>; gte: Record<string, unknown>; lte: Record<string, unknown>; select: string }[],
  ordersError: null as { message: string } | null,
  eventsError: null as { message: string } | null,
}));

function makeBuilder(table: string) {
  const call = { table, eq: {} as Record<string, unknown>, gte: {} as Record<string, unknown>, lte: {} as Record<string, unknown>, select: '' };
  db.calls.push(call);
  const rows = table === 'orders_attribution' ? db.orders : db.events;
  const error = table === 'orders_attribution' ? db.ordersError : db.eventsError;
  // The terminal value the route awaits after .range(). PostgREST returns
  // { data, error }. We return ALL fixture rows on the first page and an empty
  // page afterwards so the route's pagination loop terminates.
  let served = false;
  const builder: Record<string, unknown> = {
    select(sel: string) { call.select = sel; return builder; },
    eq(col: string, val: unknown) { call.eq[col] = val; return builder; },
    gte(col: string, val: unknown) { call.gte[col] = val; return builder; },
    lte(col: string, val: unknown) { call.lte[col] = val; return builder; },
    order() { return builder; },
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

import { GET } from '@/app/api/operator/attribution-diag/route';
import type { AttributionDiagResponse } from '@/app/api/operator/attribution-diag/route';

function reqWith(qs = ''): Request {
  return new Request(`http://x/api/operator/attribution-diag${qs}`);
}

beforeEach(() => {
  db.orders = [];
  db.events = [];
  db.calls = [];
  db.ordersError = null;
  db.eventsError = null;
});

describe('GET /api/operator/attribution-diag — orders source distribution', () => {
  it('counts orders per source and computes percentages summing to ~100', async () => {
    db.orders = [
      { source: 'meta-paid' },
      { source: 'meta-paid' },
      { source: 'google-paid' },
      { source: 'direct' },
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as AttributionDiagResponse;

    expect(body.orders.total).toBe(4);
    const bySource = Object.fromEntries(body.orders.bySource.map((b) => [b.source, b]));
    expect(bySource['meta-paid'].count).toBe(2);
    expect(bySource['meta-paid'].pct).toBeCloseTo(50, 5);
    expect(bySource['google-paid'].count).toBe(1);
    expect(bySource['direct'].count).toBe(1);
    // Distribution is sorted count DESC.
    expect(body.orders.bySource[0].source).toBe('meta-paid');
    // Percentages add up to ~100.
    const sumPct = body.orders.bySource.reduce((s, b) => s + b.pct, 0);
    expect(sumPct).toBeCloseTo(100, 5);
  });

  it('treats empty / missing source as the "" (unknown) bucket', async () => {
    db.orders = [{ source: '' }, { source: null }, { source: '   ' }, { source: 'direct' }];
    const res = await GET(reqWith());
    const body = (await res.json()) as AttributionDiagResponse;
    const unknown = body.orders.bySource.find((b) => b.source === '');
    expect(unknown?.count).toBe(3);
  });
});

describe('GET /api/operator/attribution-diag — ATC source distribution', () => {
  it('aggregates store_events (add_to_cart) separately from orders', async () => {
    db.orders = [{ source: 'meta-paid' }];
    db.events = [
      { source: 'meta-paid', first_touch_source: null },
      { source: 'direct', first_touch_source: null },
      { source: 'direct', first_touch_source: null },
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as AttributionDiagResponse;

    expect(body.atc.total).toBe(3);
    const bySource = Object.fromEntries(body.atc.bySource.map((b) => [b.source, b]));
    expect(bySource['direct'].count).toBe(2);
    expect(bySource['meta-paid'].count).toBe(1);
    // The orders distribution is independent of the ATC one.
    expect(body.orders.total).toBe(1);
  });

  it('filters store_events to type=add_to_cart and pushes down the date range', async () => {
    db.events = [{ source: 'direct', first_touch_source: null }];
    await GET(reqWith('?from=2026-05-01&to=2026-05-31'));
    const eventsCall = db.calls.find((c) => c.table === 'store_events');
    expect(eventsCall?.eq['type']).toBe('add_to_cart');
    // received_at window bounds applied (IL-anchored timestamps).
    expect(String(eventsCall?.gte['received_at'])).toContain('2026-05-01');
    expect(String(eventsCall?.lte['received_at'])).toContain('2026-05-31');
    const ordersCall = db.calls.find((c) => c.table === 'orders_attribution');
    expect(ordersCall?.gte['date']).toBe('2026-05-01');
    expect(ordersCall?.lte['date']).toBe('2026-05-31');
  });
});

describe('GET /api/operator/attribution-diag — murky-bucket breakdowns', () => {
  it('other-paid → top "utm_source | utm_medium" combos', async () => {
    db.orders = [
      { source: 'other-paid', utm_source: 'partnerX', utm_medium: 'affiliate' },
      { source: 'other-paid', utm_source: 'partnerX', utm_medium: 'affiliate' },
      { source: 'other-paid', utm_source: 'influencerY', utm_medium: 'bio' },
      { source: 'meta-paid', utm_source: 'facebook', utm_medium: 'cpc' }, // ignored — not other-paid
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as AttributionDiagResponse;
    const combos = Object.fromEntries(body.buckets.otherPaid.map((b) => [b.key, b.count]));
    expect(combos['partnerX | affiliate']).toBe(2);
    expect(combos['influencerY | bio']).toBe(1);
    // facebook|cpc must NOT appear (it was meta-paid, not other-paid).
    expect(combos['facebook | cpc']).toBeUndefined();
    // sorted count DESC.
    expect(body.buckets.otherPaid[0].key).toBe('partnerX | affiliate');
  });

  it('other-referral → top referrer domains (host only, not full URL)', async () => {
    db.orders = [
      { source: 'other-referral', referrer: 'https://blog.example.com/post/123?x=1' },
      { source: 'other-referral', referrer: 'https://blog.example.com/other' },
      { source: 'other-referral', referrer: 'http://news.site.co/abc' },
      { source: 'direct', referrer: '' }, // ignored
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as AttributionDiagResponse;
    const domains = Object.fromEntries(body.buckets.otherReferral.map((b) => [b.domain, b.count]));
    expect(domains['blog.example.com']).toBe(2);
    expect(domains['news.site.co']).toBe(1);
    // No path / query leaked into the domain key.
    for (const b of body.buckets.otherReferral) {
      expect(b.domain).not.toContain('/');
      expect(b.domain).not.toContain('?');
    }
  });

  it('direct → first_touch_source breakdown (carries-a-signal vs none)', async () => {
    db.orders = [
      { source: 'direct', first_touch_source: 'meta-paid' },
      { source: 'direct', first_touch_source: 'meta-paid' },
      { source: 'direct', first_touch_source: null },
      { source: 'direct', first_touch_source: '' },
      { source: 'meta-paid', first_touch_source: 'google-paid' }, // ignored — not direct
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as AttributionDiagResponse;
    const ft = Object.fromEntries(body.buckets.directFirstTouch.map((b) => [b.firstTouch, b.count]));
    expect(ft['meta-paid']).toBe(2);
    // null/'' collapse to the "(ללא)" no-signal bucket.
    expect(ft['(ללא)']).toBe(2);
  });
});

describe('GET /api/operator/attribution-diag — first-touch coverage', () => {
  it('computes withFt / total / pct for orders AND atc', async () => {
    db.orders = [
      { source: 'direct', first_touch_source: 'meta-paid' },
      { source: 'direct', first_touch_source: null },
      { source: 'meta-paid', first_touch_source: 'meta-paid' },
      { source: 'google-paid', first_touch_source: '' },
    ];
    db.events = [
      { source: 'direct', first_touch_source: 'meta-paid' },
      { source: 'direct', first_touch_source: null },
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as AttributionDiagResponse;

    expect(body.firstTouchCoverage.orders.total).toBe(4);
    expect(body.firstTouchCoverage.orders.withFt).toBe(2);
    expect(body.firstTouchCoverage.orders.pct).toBeCloseTo(50, 5);

    expect(body.firstTouchCoverage.atc.total).toBe(2);
    expect(body.firstTouchCoverage.atc.withFt).toBe(1);
    expect(body.firstTouchCoverage.atc.pct).toBeCloseTo(50, 5);
  });

  it('coverage pct is 0 (not NaN) when there are no rows', async () => {
    const res = await GET(reqWith());
    const body = (await res.json()) as AttributionDiagResponse;
    expect(body.firstTouchCoverage.orders.pct).toBe(0);
    expect(body.firstTouchCoverage.atc.pct).toBe(0);
    expect(body.orders.total).toBe(0);
    expect(body.atc.total).toBe(0);
  });
});

describe('GET /api/operator/attribution-diag — range + safety', () => {
  it('defaults to a ~30-day window ending today when no params given', async () => {
    await GET(reqWith());
    const body = (await (await GET(reqWith())).json()) as AttributionDiagResponse;
    expect(body.range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // ~30 days apart (allow 29-31 for month boundaries).
    const fromMs = new Date(body.range.from).getTime();
    const toMs = new Date(body.range.to).getTime();
    const days = Math.round((toMs - fromMs) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(31);
  });

  it('never leaks PII / secrets — no order ids, customer ids, or raw blobs in the body', async () => {
    db.orders = [
      { source: 'meta-paid', utm_source: 'facebook', utm_medium: 'cpc', first_touch_source: 'meta-paid', referrer: 'https://l.facebook.com/x', order_id: 'SECRET-ORDER-99', customer_id: 'CUST-123' },
    ];
    db.events = [{ source: 'direct', first_touch_source: null }];
    const res = await GET(reqWith());
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('SECRET-ORDER-99');
    expect(text).not.toContain('CUST-123');
    expect(text).not.toContain('order_id');
    expect(text).not.toContain('customer_id');
    expect(text).not.toContain('raw');
  });

  it('caps long utm / domain strings so a malicious label cannot bloat the payload', async () => {
    const huge = 'x'.repeat(5000);
    db.orders = [
      { source: 'other-paid', utm_source: huge, utm_medium: 'aff' },
      { source: 'other-referral', referrer: `https://${huge}.com/path` },
    ];
    const res = await GET(reqWith());
    const body = (await res.json()) as AttributionDiagResponse;
    for (const b of body.buckets.otherPaid) expect(b.key.length).toBeLessThanOrEqual(200);
    for (const b of body.buckets.otherReferral) expect(b.domain.length).toBeLessThanOrEqual(200);
  });

  it('soft-fails to an empty/typed body (HTTP 200) when the orders query errors', async () => {
    db.ordersError = { message: 'boom' };
    const res = await GET(reqWith());
    expect(res.status).toBe(200);
    const body = (await res.json()) as AttributionDiagResponse;
    expect(body.error).toBeDefined();
    expect(body.orders.total).toBe(0);
    expect(body.atc.total).toBe(0);
  });
});
