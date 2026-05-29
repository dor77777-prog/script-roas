import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTikTokHotMetricsForStore } from '@/lib/fetchers/tiktokHotMetrics';

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchTikTokHotMetricsForStore()', () => {
  it('returns campaigns rows with metrics for hot ids', async () => {
    const body = {
      data: {
        list: [{
          dimensions: { campaign_id: 'TC1' },
          metrics: { spend: '25.5', impressions: '1000', clicks: '20', conversion: 3, total_complete_payment_rate: '0', purchase: '3', total_purchase_value: '150.0' },
        }],
        page_info: { total_number: 1, total_page: 1, page: 1 },
      },
    };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: ['TC1'], hotAdgroupIds: [], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'USD' ? amount * 1.36 : amount,
    });
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC1',
      impressions: 1000, clicks: 20, conversions: 3,
    });
  });

  it('skips with empty hot sets', async () => {
    const fetchMock = vi.fn();
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: [], hotAdgroupIds: [], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.campaigns).toHaveLength(0);
  });
});
