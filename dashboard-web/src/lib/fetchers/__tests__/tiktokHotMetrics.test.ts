import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTikTokHotMetricsForStore } from '@/lib/fetchers/tiktokHotMetrics';

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchTikTokHotMetricsForStore()', () => {
  it('returns adset + ad rows with metrics for hot ids (no campaign-level rows per CRIT-B)', async () => {
    const adgroupBody = {
      code: 0,
      data: {
        list: [{
          dimensions: { campaign_id: 'TC1', adgroup_id: 'TG1' },
          metrics: { spend: '25.5', impressions: '1000', clicks: '20', conversion: 3, purchase: '3', total_purchase_value: '150.0' },
        }],
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(adgroupBody), { status: 200 }));
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: ['TC1'], hotAdgroupIds: ['TG1'], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      accountCurrency: 'USD',
      fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'USD' ? amount * 1.36 : amount,
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC1', ad_set_id: 'TG1',
      impressions: 1000, clicks: 20, conversions: 3,
    });
  });

  it('AUCTION_AD request sends only ["ad_id"] in dimensions (parent IDs come from adIdToParent)', async () => {
    // Worker passes parent map from ad_registry. Fetcher uses it to enrich
    // AD rows (TikTok rejects parent IDs as AUCTION_AD dimensions).
    const adIdToParent = new Map<string, { adgroup_id: string; campaign_id: string }>([
      ['AD-1', { adgroup_id: 'TG1', campaign_id: 'TC1' }],
    ]);
    const adgroupBody = {
      code: 0,
      data: { list: [{
        dimensions: { campaign_id: 'TC1', adgroup_id: 'TG1' },
        metrics: { spend: '10', impressions: '100', clicks: '5', conversion: 1, purchase: '1', total_purchase_value: '20' },
      }] },
    };
    const adBody = {
      code: 0,
      data: { list: [{
        dimensions: { ad_id: 'AD-1' },
        metrics: { spend: '4', impressions: '50', clicks: '2', conversion: 1, purchase: '1', total_purchase_value: '12' },
      }] },
    };
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      calls.push(u);
      return new Response(JSON.stringify(u.includes('data_level=AUCTION_AD&') ? adBody : adgroupBody), { status: 200 });
    });
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: ['TC1'], hotAdgroupIds: ['TG1'], hotAdIds: ['AD-1'],
      dateStr: '2026-05-30', campaignStoreMap: {},
      accountCurrency: 'USD',
      adIdToParent,
      fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'USD' ? amount * 1.36 : amount,
    });
    // AUCTION_AD URL must encode `dimensions=["ad_id"]` ONLY.
    // Note: 'AUCTION_AD' is a substring of 'AUCTION_ADGROUP' — match the
    // exact tail of the data_level param.
    const adUrl = calls.find(c => /data_level=AUCTION_AD(&|$)/.test(c))!;
    expect(decodeURIComponent(adUrl)).toContain('dimensions=["ad_id"]');
    expect(decodeURIComponent(adUrl)).not.toContain('adgroup_id');
    expect(decodeURIComponent(adUrl)).not.toContain('campaign_id');
    // AD row is enriched from the map with adgroup_id + campaign_id and
    // routed via campaign-store-map (here defaults to storeId).
    expect(out.ads).toHaveLength(1);
    expect(out.ads[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'tiktok',
      ad_id: 'AD-1', ad_set_id: 'TG1', campaign_id: 'TC1',
    });
  });

  it('AD rows without a parent map entry are skipped (would otherwise be unattributable)', async () => {
    const adBody = {
      code: 0,
      data: { list: [{
        dimensions: { ad_id: 'AD-ORPHAN' },
        metrics: { spend: '4', impressions: '50', clicks: '2', conversion: 0, purchase: '0', total_purchase_value: '0' },
      }] },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(adBody), { status: 200 }));
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: [], hotAdgroupIds: [], hotAdIds: ['AD-ORPHAN'],
      dateStr: '2026-05-30', campaignStoreMap: {},
      accountCurrency: 'USD',
      // No adIdToParent entry for AD-ORPHAN.
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    expect(out.ads).toHaveLength(0);
  });

  it('AD rows route via campaign-store-map (campaign_id lookup → correct store_id)', async () => {
    // Campaign TC1 is mapped to usmile360 even though the worker is for uzoshop.
    const adIdToParent = new Map<string, { adgroup_id: string; campaign_id: string }>([
      ['AD-1', { adgroup_id: 'TG1', campaign_id: 'TC1' }],
    ]);
    const adgroupBody = {
      code: 0,
      data: { list: [{
        dimensions: { campaign_id: 'TC1', adgroup_id: 'TG1' },
        metrics: { spend: '10', impressions: '100', clicks: '5', conversion: 1, purchase: '1', total_purchase_value: '20' },
      }] },
    };
    const adBody = {
      code: 0,
      data: { list: [{
        dimensions: { ad_id: 'AD-1' },
        metrics: { spend: '4', impressions: '50', clicks: '2', conversion: 1, purchase: '1', total_purchase_value: '12' },
      }] },
    };
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      return new Response(JSON.stringify(u.includes('data_level=AUCTION_AD&') ? adBody : adgroupBody), { status: 200 });
    });
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: ['TC1'], hotAdgroupIds: ['TG1'], hotAdIds: ['AD-1'],
      dateStr: '2026-05-30',
      campaignStoreMap: { 'tiktok::12345::TC1': 'usmile360' },
      accountCurrency: 'USD',
      adIdToParent,
      fetcher: fetchMock,
      getFxCadFor: async (amount) => amount,
    });
    expect(out.adsets[0].store_id).toBe('usmile360');
    expect(out.ads[0].store_id).toBe('usmile360');
  });

  it('surfaces TikTok envelope error (code !== 0) so the worker records transient_error', async () => {
    const errBody = { code: 40002, message: 'Invalid filter_value', data: {} };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(errBody), { status: 200 }));
    await expect(fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: [], hotAdgroupIds: ['TG1'], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      accountCurrency: 'USD',
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    })).rejects.toThrow(/code=40002/);
  });

  it('skips with empty hot sets', async () => {
    const fetchMock = vi.fn();
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: [], hotAdgroupIds: [], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      accountCurrency: 'USD',
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.adsets).toHaveLength(0);
    expect(out.ads).toHaveLength(0);
  });
});
