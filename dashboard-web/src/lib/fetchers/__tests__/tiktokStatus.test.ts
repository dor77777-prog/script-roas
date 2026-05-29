import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTikTokStatusForStore } from '@/lib/fetchers/tiktokStatus';

// URL-dispatched mock — each endpoint substring (e.g. '/campaign/get/')
// gets its own queue of response bodies, indexed by call order. Lets
// pagination tests work without depending on Promise.all execution order.
function mockFetchByEndpoint(byEndpoint: Record<string, Array<Record<string, unknown>>>) {
  const cursors: Record<string, number> = {};
  return vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const u = url.toString();
    const key = Object.keys(byEndpoint).find(k => u.includes(k));
    if (!key) throw new Error(`unexpected URL: ${u}`);
    const idx = cursors[key] ?? 0;
    cursors[key] = idx + 1;
    const body = byEndpoint[key][idx] ?? { data: { list: [] } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchTikTokStatusForStore()', () => {
  it('paginates each list endpoint and returns campaigns + adgroups + ads', async () => {
    const fetchMock = mockFetchByEndpoint({
      '/campaign/get/': [
        { data: { list: [{ campaign_id: 'TC1', campaign_name: 'TT 1', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
      ],
      '/adgroup/get/': [
        { data: { list: [{ campaign_id: 'TC1', adgroup_id: 'TG1', adgroup_name: 'TT AG1', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
      ],
      '/ad/get/': [
        { data: { list: [{ campaign_id: 'TC1', adgroup_id: 'TG1', ad_id: 'TA1', ad_name: 'TT A1', operation_status: 'ENABLE', secondary_status: 'AD_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
      ],
    });
    const out = await fetchTikTokStatusForStore({
      storeId: 'uzoshop',
      advertiserId: '12345',
      accessToken: 'tok',
      campaignStoreMap: {},
      fetcher: fetchMock,
    });
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC1',
      configured_status: 'ENABLE', effective_status: 'ADGROUP_STATUS_DELIVERY_OK',
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.ads).toHaveLength(1);
  });

  it('campaign-store-map: redirects mapped campaigns to the target store_id', async () => {
    const fetchMock = mockFetchByEndpoint({
      '/campaign/get/': [
        { data: { list: [{ campaign_id: 'TC2', campaign_name: 'TT 2', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
      ],
      '/adgroup/get/': [
        { data: { list: [], page_info: { total_number: 0, total_page: 0, page: 1 } } },
      ],
      '/ad/get/': [
        { data: { list: [], page_info: { total_number: 0, total_page: 0, page: 1 } } },
      ],
    });
    const out = await fetchTikTokStatusForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      campaignStoreMap: { 'tiktok::12345::TC2': 'usmile360' },
      fetcher: fetchMock,
    });
    expect(out.campaigns[0].store_id).toBe('usmile360');
  });

  it('paginates through multiple pages until total_page is reached', async () => {
    const fetchMock = mockFetchByEndpoint({
      '/campaign/get/': [
        // page 1: 1 row, claims total_page=2
        { data: { list: [{ campaign_id: 'TC10', campaign_name: 'TT 10', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 2, total_page: 2, page: 1 } } },
        // page 2: 1 more row, total_page still 2 → loop exits
        { data: { list: [{ campaign_id: 'TC11', campaign_name: 'TT 11', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 2, total_page: 2, page: 2 } } },
      ],
      '/adgroup/get/': [
        { data: { list: [], page_info: { total_number: 0, total_page: 1, page: 1 } } },
      ],
      '/ad/get/': [
        { data: { list: [], page_info: { total_number: 0, total_page: 1, page: 1 } } },
      ],
    });
    const out = await fetchTikTokStatusForStore({
      storeId: 'uzoshop',
      advertiserId: '12345',
      accessToken: 'tok',
      campaignStoreMap: {},
      fetcher: fetchMock,
    });
    // /campaign/get/ should have been called exactly twice (page 1 + page 2)
    const campaignCalls = fetchMock.mock.calls.filter(([url]) => url.toString().includes('/campaign/get/')).length;
    expect(campaignCalls).toBe(2);
    expect(out.campaigns).toHaveLength(2);
    expect(out.campaigns.map(c => c.campaign_id)).toEqual(['TC10', 'TC11']);
  });

  it('throws on non-OK HTTP response with status + body in error message', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
      return new Response('{"code":40100,"message":"rate limited"}', { status: 429 });
    });
    await expect(
      fetchTikTokStatusForStore({
        storeId: 'uzoshop',
        advertiserId: '12345',
        accessToken: 'tok',
        campaignStoreMap: {},
        fetcher: fetchMock,
      }),
    ).rejects.toThrow(/429.*rate limited/);
  });
});
