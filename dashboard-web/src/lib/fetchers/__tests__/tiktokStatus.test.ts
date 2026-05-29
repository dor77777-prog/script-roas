import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTikTokStatusForStore } from '@/lib/fetchers/tiktokStatus';

function mockFetch(responses: Record<string, unknown>[]) {
  const queue = [...responses];
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    const body = queue.shift() ?? { data: { list: [] } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchTikTokStatusForStore()', () => {
  it('paginates each list endpoint and returns campaigns + adgroups + ads', async () => {
    const fetchMock = mockFetch([
      // campaigns page 1
      { data: { list: [{ campaign_id: 'TC1', campaign_name: 'TT 1', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
      // adgroups page 1
      { data: { list: [{ campaign_id: 'TC1', adgroup_id: 'TG1', adgroup_name: 'TT AG1', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
      // ads page 1
      { data: { list: [{ campaign_id: 'TC1', adgroup_id: 'TG1', ad_id: 'TA1', ad_name: 'TT A1', operation_status: 'ENABLE', secondary_status: 'AD_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
    ]);
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
    const fetchMock = mockFetch([
      { data: { list: [{ campaign_id: 'TC2', campaign_name: 'TT 2', operation_status: 'ENABLE', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' }], page_info: { total_number: 1, total_page: 1, page: 1 } } },
      { data: { list: [], page_info: { total_number: 0, total_page: 0, page: 1 } } },
      { data: { list: [], page_info: { total_number: 0, total_page: 0, page: 1 } } },
    ]);
    const out = await fetchTikTokStatusForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      campaignStoreMap: { 'tiktok::12345::TC2': 'usmile360' },
      fetcher: fetchMock,
    });
    expect(out.campaigns[0].store_id).toBe('usmile360');
  });
});
