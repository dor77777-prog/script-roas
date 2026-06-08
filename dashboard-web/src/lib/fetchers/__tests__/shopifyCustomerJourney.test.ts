/**
 * Task 8 — shopifyCustomerJourney.ts reader tests.
 *
 * Capability-gated: behind the per-store DB flag `stores.enable_customer_journey`.
 * - enabled:false → returns disabled:true, no fetch call.
 * - enabled:true + OK response → parses UTM + utmId from landingPage.
 * - enabled:true + ACCESS_DENIED errors → unavailable:true, no throw.
 * - enabled:true + throwing fetch → degrades to empty result, no throw.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchCustomerJourney } from '../shopifyCustomerJourney';

const DOMAIN = 'test-store.myshopify.com';
const TOKEN = 'shpat_test_token';
const ORDER_GID = 'gid://shopify/Order/99887766';
const NUMERIC_ID = '99887766';

/** Build a minimal GraphQL response for nodes query */
function makeNodesResponse(orders: unknown[]) {
  return {
    data: {
      nodes: orders,
    },
  };
}

function makeOrderNode(id = ORDER_GID, firstLandingPage: string | null = null, utmCampaign: string | null = null) {
  return {
    id,
    customerJourneySummary: {
      firstVisit: firstLandingPage
        ? {
            landingPage: firstLandingPage,
            source: 'google',
            utmParameters: {
              source: 'google',
              medium: 'cpc',
              campaign: utmCampaign,
              content: null,
              term: null,
            },
          }
        : null,
      lastVisit: {
        landingPage: '/checkout',
        source: 'direct',
        utmParameters: {
          source: null,
          medium: null,
          campaign: null,
          content: null,
          term: null,
        },
      },
    },
  };
}

function mockFetchSuccess(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('fetchCustomerJourney', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: enabled:false → disabled, no fetch
  // ---------------------------------------------------------------------------
  it('returns disabled:true and empty map when enabled is false', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], false);

    expect(result.disabled).toBe(true);
    expect(result.unavailable).toBe(false);
    expect(result.map.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns disabled:true when enabled is false (even with orderGids provided)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], false);

    expect(result.disabled).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 2: enabled:true + successful response → parses UTM + utmId from landingPage
  // ---------------------------------------------------------------------------
  it('parses utmId from landingPage and utmCampaign from utmParameters', async () => {
    const landingPage = '/products/toothbrush?utm_id=c1&utm_campaign=Sale&utm_source=google&utm_medium=cpc';
    const node = makeOrderNode(ORDER_GID, landingPage, 'Sale');
    const body = makeNodesResponse([node]);

    vi.stubGlobal('fetch', mockFetchSuccess(body));

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], true);

    expect(result.disabled).toBe(false);
    expect(result.unavailable).toBe(false);

    const entry = result.map.get(NUMERIC_ID);
    expect(entry).toBeDefined();
    expect(entry!.first).not.toBeNull();
    expect(entry!.first!.utmId).toBe('c1');
    expect(entry!.first!.utmCampaign).toBe('Sale');
    expect(entry!.first!.utmSource).toBe('google');
    expect(entry!.first!.utmMedium).toBe('cpc');
    expect(entry!.first!.landingPage).toBe(landingPage);
  });

  it('returns map keyed by numeric order id (last GID segment)', async () => {
    const node = makeOrderNode('gid://shopify/Order/11112222', '/p?utm_id=abc', 'Test');
    vi.stubGlobal('fetch', mockFetchSuccess(makeNodesResponse([node])));

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, ['gid://shopify/Order/11112222'], true);

    expect(result.map.has('11112222')).toBe(true);
    expect(result.map.has('gid://shopify/Order/11112222')).toBe(false);
  });

  it('sets utmId to null when landingPage has no utm_id param', async () => {
    const node = makeOrderNode(ORDER_GID, '/products/brush?utm_campaign=Spring', 'Spring');
    vi.stubGlobal('fetch', mockFetchSuccess(makeNodesResponse([node])));

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], true);
    const entry = result.map.get(NUMERIC_ID);
    expect(entry!.first!.utmId).toBeNull();
    expect(entry!.first!.utmCampaign).toBe('Spring');
  });

  it('sets utmId to null when landingPage is null', async () => {
    const node = makeOrderNode(ORDER_GID, null, null);
    vi.stubGlobal('fetch', mockFetchSuccess(makeNodesResponse([node])));

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], true);
    const entry = result.map.get(NUMERIC_ID);
    expect(entry!.first).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 3: ACCESS_DENIED → unavailable:true, no throw
  // ---------------------------------------------------------------------------
  it('returns unavailable:true and empty map on ACCESS_DENIED errors', async () => {
    const errorBody = {
      errors: [
        {
          message: 'Access denied',
          extensions: { code: 'ACCESS_DENIED' },
        },
      ],
    };
    vi.stubGlobal('fetch', mockFetchSuccess(errorBody));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], true);

    expect(result.unavailable).toBe(true);
    expect(result.disabled).toBe(false);
    expect(result.map.size).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns unavailable:true on "protected customer data" error message', async () => {
    const errorBody = {
      errors: [{ message: 'Field requires protected customer data approval' }],
    };
    vi.stubGlobal('fetch', mockFetchSuccess(errorBody));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], true);

    expect(result.unavailable).toBe(true);
    expect(result.map.size).toBe(0);
  });

  it('returns unavailable:true on "not approved" error message', async () => {
    const errorBody = {
      errors: [{ message: 'This app is not approved to access this data' }],
    };
    vi.stubGlobal('fetch', mockFetchSuccess(errorBody));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], true);

    expect(result.unavailable).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 4: fetch throws → degrades gracefully, no throw
  // ---------------------------------------------------------------------------
  it('degrades gracefully (empty map, no throw) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], true),
    ).resolves.toMatchObject({ disabled: false, unavailable: false });

    const r = await fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], true);
    expect(r.map.size).toBe(0);
  });

  it('degrades gracefully when fetch returns non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 })),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, [ORDER_GID], true);
    expect(result.map.size).toBe(0);
    expect(result.disabled).toBe(false);
    expect(result.unavailable).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Additional: empty orderGids → returns empty map without fetching
  // ---------------------------------------------------------------------------
  it('returns empty map without fetching when orderGids is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, [], true);

    expect(result.map.size).toBe(0);
    expect(result.disabled).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Batching: >250 ids → multiple fetch calls
  // ---------------------------------------------------------------------------
  it('batches requests when more than 250 orderGids provided', async () => {
    // Generate 300 order GIDs
    const gids = Array.from({ length: 300 }, (_, i) => `gid://shopify/Order/${1000 + i}`);
    const nodes = gids.map((gid) => ({ id: gid, customerJourneySummary: null }));

    // Return first 250 for batch 1, remaining for batch 2
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      const start = callCount * 250;
      const batch = nodes.slice(start, start + 250);
      callCount++;
      return Promise.resolve(
        new Response(JSON.stringify(makeNodesResponse(batch)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchCustomerJourney(DOMAIN, TOKEN, gids, true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.disabled).toBe(false);
  });
});
