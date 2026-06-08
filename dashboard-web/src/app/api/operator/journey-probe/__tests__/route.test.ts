// dashboard-web/src/app/api/operator/journey-probe/__tests__/route.test.ts
//
// Operator diagnostic probe — GET /api/operator/journey-probe?store=<storeId>
//
// Forces fetchCustomerJourney (enabled=true) for a store's recent orders and
// returns PII-free counts + UTM sample. Tests assert:
//   - valid store + mocked journey → accessGranted true + correct ordersWithJourney count
//   - unavailable:true from the reader → accessGranted:false
//   - invalid / missing store → HTTP 400
//   - the response NEVER contains the Shopify access token or other secrets

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  activeStoreIds: ['uzoshop', 'zolplus', 'usmile360'] as string[],
  storeSecretValue: 'mystore.myshopify.com' as string | null,
  shopifyToken: 'shpat_TEST_TOKEN_SENTINEL' as string | null,
  shopifyTokenThrows: false,
  dbRows: [] as Array<{ order_id: string | null }>,
  dbError: null as { message: string } | null,
  journeyResult: {
    map: new Map<string, { first: { utmId: string | null; utmCampaign: string | null; landingPage: string | null } | null; last: { utmId: string | null } | null }>(),
    disabled: false,
    unavailable: false,
  },
}));

// ---------------------------------------------------------------------------
// Mock: loadActiveStoreIds
// ---------------------------------------------------------------------------

vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: () => Promise.resolve(mocks.activeStoreIds),
}));

// ---------------------------------------------------------------------------
// Mock: getStoreSecret
// ---------------------------------------------------------------------------

vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: (_storeId: string, key: string) => {
    if (key === 'SHOPIFY_DOMAIN') return Promise.resolve(mocks.storeSecretValue);
    return Promise.resolve(null);
  },
}));

// ---------------------------------------------------------------------------
// Mock: getShopifyAccessToken (from shopifyAuth)
// ---------------------------------------------------------------------------

vi.mock('@/lib/fetchers/shopifyAuth', () => ({
  getShopifyAccessToken: (_storeId: string) => {
    if (mocks.shopifyTokenThrows) return Promise.reject(new Error('missing creds'));
    return Promise.resolve(mocks.shopifyToken);
  },
}));

// ---------------------------------------------------------------------------
// Mock: getSupabaseAdmin
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          order: (_col2: string, _opts: unknown) => ({
            limit: (_n: number) =>
              Promise.resolve({ data: mocks.dbError ? null : mocks.dbRows, error: mocks.dbError }),
          }),
        }),
      }),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Mock: fetchCustomerJourney
// ---------------------------------------------------------------------------

vi.mock('@/lib/fetchers/shopifyCustomerJourney', () => ({
  fetchCustomerJourney: (_domain: string, _token: string, _gids: string[], _enabled: boolean) =>
    Promise.resolve(mocks.journeyResult),
}));

// ---------------------------------------------------------------------------
// Mock: Sentry + apiErrors
// ---------------------------------------------------------------------------

vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));
vi.mock('@/lib/apiErrors', () => ({ userFacingError: (msg: string) => `Error: ${msg}` }));

// ---------------------------------------------------------------------------
// Import route under test
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/operator/journey-probe/route';
import type { JourneyProbeResponse } from '@/app/api/operator/journey-probe/route';

function reqWith(qs = ''): Request {
  return new Request(`http://x/api/operator/journey-probe${qs}`);
}

beforeEach(() => {
  mocks.activeStoreIds = ['uzoshop', 'zolplus', 'usmile360'];
  mocks.storeSecretValue = 'mystore.myshopify.com';
  mocks.shopifyToken = 'shpat_TEST_TOKEN_SENTINEL';
  mocks.shopifyTokenThrows = false;
  mocks.dbRows = [];
  mocks.dbError = null;
  mocks.journeyResult = {
    map: new Map(),
    disabled: false,
    unavailable: false,
  };
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GET /api/operator/journey-probe — store validation', () => {
  it('returns HTTP 400 when store param is missing', async () => {
    const res = await GET(reqWith());
    expect(res.status).toBe(400);
    const body = (await res.json()) as JourneyProbeResponse;
    expect(body.error).toBeDefined();
  });

  it('returns HTTP 400 when store param is not in the active store list', async () => {
    const res = await GET(reqWith('?store=unknownstore'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as JourneyProbeResponse;
    expect(body.error).toBeDefined();
    expect(body.store).toBe('unknownstore');
  });

  it('returns HTTP 200 for a valid store id', async () => {
    mocks.dbRows = [{ order_id: '11111' }];
    const res = await GET(reqWith('?store=uzoshop'));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/operator/journey-probe — missing credentials', () => {
  it('returns { error: "missing shopify creds" } when domain is null', async () => {
    mocks.storeSecretValue = null;
    const res = await GET(reqWith('?store=uzoshop'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as JourneyProbeResponse;
    expect(body.error).toBe('missing shopify creds');
    expect(body.store).toBe('uzoshop');
  });

  it('returns { error: "missing shopify creds" } when token exchange throws', async () => {
    mocks.shopifyTokenThrows = true;
    const res = await GET(reqWith('?store=uzoshop'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as JourneyProbeResponse;
    expect(body.error).toBe('missing shopify creds');
  });
});

describe('GET /api/operator/journey-probe — journey result mapping', () => {
  it('accessGranted=true + correct ordersWithJourney count when journey data is returned', async () => {
    mocks.dbRows = [
      { order_id: '10001' },
      { order_id: '10002' },
      { order_id: '10003' },
    ];
    const journeyMap = new Map<string, { first: { utmId: string | null; utmCampaign: string | null; landingPage: string | null } | null; last: { utmId: string | null } | null }>();
    journeyMap.set('10001', { first: { utmId: 'camp_abc', utmCampaign: 'summer', landingPage: '/promo' }, last: { utmId: null } });
    journeyMap.set('10002', { first: null, last: null });
    mocks.journeyResult = { map: journeyMap, disabled: false, unavailable: false };

    const res = await GET(reqWith('?store=uzoshop'));
    const body = (await res.json()) as JourneyProbeResponse;

    expect(body.accessGranted).toBe(true);
    expect(body.unavailable).toBe(false);
    expect(body.disabled).toBe(false);
    expect(body.ordersChecked).toBe(3);
    expect(body.ordersWithJourney).toBe(2);
    expect(body.store).toBe('uzoshop');
  });

  it('accessGranted=false + unavailable=true when reader signals Protected Data denial', async () => {
    mocks.dbRows = [{ order_id: '20001' }];
    mocks.journeyResult = { map: new Map(), disabled: false, unavailable: true };

    const res = await GET(reqWith('?store=uzoshop'));
    const body = (await res.json()) as JourneyProbeResponse;

    expect(body.accessGranted).toBe(false);
    expect(body.unavailable).toBe(true);
    expect(body.ordersWithJourney).toBe(0);
  });

  it('ordersChecked=0 and ordersWithJourney=0 when there are no recent orders', async () => {
    mocks.dbRows = [];
    mocks.journeyResult = { map: new Map(), disabled: false, unavailable: false };

    const res = await GET(reqWith('?store=uzoshop'));
    const body = (await res.json()) as JourneyProbeResponse;

    expect(body.ordersChecked).toBe(0);
    expect(body.ordersWithJourney).toBe(0);
    expect(body.accessGranted).toBe(true);
  });

  it('sample includes up to 5 entries with correct PII-free fields', async () => {
    mocks.dbRows = Array.from({ length: 7 }, (_, i) => ({ order_id: String(30000 + i) }));
    const journeyMap = new Map<string, { first: { utmId: string | null; utmCampaign: string | null; landingPage: string | null } | null; last: { utmId: string | null } | null }>();
    for (let i = 0; i < 7; i++) {
      journeyMap.set(String(30000 + i), {
        first: { utmId: `uid_${i}`, utmCampaign: `camp_${i}`, landingPage: `/page${i}` },
        last: { utmId: null },
      });
    }
    mocks.journeyResult = { map: journeyMap, disabled: false, unavailable: false };

    const res = await GET(reqWith('?store=uzoshop'));
    const body = (await res.json()) as JourneyProbeResponse;

    expect(body.sample).toBeDefined();
    expect(body.sample!.length).toBe(5); // capped at 5
    for (const s of body.sample!) {
      expect(s).toHaveProperty('orderId');
      expect(s).toHaveProperty('firstUtmId');
      expect(s).toHaveProperty('firstUtmCampaign');
      expect(s).toHaveProperty('firstLandingPresent');
      expect(s).toHaveProperty('lastUtmId');
    }
  });

  it('firstLandingPresent is true when landingPage is set, false when null', async () => {
    mocks.dbRows = [{ order_id: '40001' }, { order_id: '40002' }];
    const journeyMap = new Map<string, { first: { utmId: string | null; utmCampaign: string | null; landingPage: string | null } | null; last: { utmId: string | null } | null }>();
    journeyMap.set('40001', { first: { utmId: null, utmCampaign: null, landingPage: '/promo' }, last: null });
    journeyMap.set('40002', { first: { utmId: null, utmCampaign: null, landingPage: null }, last: null });
    mocks.journeyResult = { map: journeyMap, disabled: false, unavailable: false };

    const res = await GET(reqWith('?store=uzoshop'));
    const body = (await res.json()) as JourneyProbeResponse;

    const s = Object.fromEntries(body.sample!.map((e) => [e.orderId, e]));
    expect(s['40001'].firstLandingPresent).toBe(true);
    expect(s['40002'].firstLandingPresent).toBe(false);
  });
});

describe('GET /api/operator/journey-probe — PII and secret safety', () => {
  it('NEVER includes the Shopify access token in the response body', async () => {
    mocks.dbRows = [{ order_id: '50001' }];
    mocks.shopifyToken = 'shpat_TEST_TOKEN_SENTINEL'; // uniquely grep-able
    const journeyMap = new Map<string, { first: { utmId: string | null; utmCampaign: string | null; landingPage: string | null } | null; last: { utmId: string | null } | null }>();
    journeyMap.set('50001', { first: { utmId: 'u1', utmCampaign: 'c1', landingPage: '/p1' }, last: null });
    mocks.journeyResult = { map: journeyMap, disabled: false, unavailable: false };

    const res = await GET(reqWith('?store=uzoshop'));
    const text = JSON.stringify(await res.json());

    expect(text).not.toContain('shpat_TEST_TOKEN_SENTINEL');
    expect(text).not.toContain('access_token');
  });

  it('response does NOT contain customer name, email, or order totals', async () => {
    mocks.dbRows = [{ order_id: '60001' }];
    const journeyMap = new Map<string, { first: { utmId: string | null; utmCampaign: string | null; landingPage: string | null } | null; last: { utmId: string | null } | null }>();
    journeyMap.set('60001', { first: { utmId: null, utmCampaign: null, landingPage: null }, last: null });
    mocks.journeyResult = { map: journeyMap, disabled: false, unavailable: false };

    const res = await GET(reqWith('?store=uzoshop'));
    const body = (await res.json()) as JourneyProbeResponse;
    const text = JSON.stringify(body);

    // Sensitive PII fields that must never appear
    expect(text).not.toContain('email');
    expect(text).not.toContain('customer_name');
    expect(text).not.toContain('total_price');
    expect(text).not.toContain('token');
  });

  it('soft-fails to { store, error } on DB error', async () => {
    mocks.dbError = { message: 'connection refused' };
    const res = await GET(reqWith('?store=uzoshop'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as JourneyProbeResponse;
    expect(body.error).toBeDefined();
    expect(body.store).toBe('uzoshop');
    // No token in the error response
    const text = JSON.stringify(body);
    expect(text).not.toContain('shpat_');
  });
});
