import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTikTokHotMetricsForStore } from '@/lib/fetchers/tiktokHotMetrics';

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchTikTokHotMetricsForStore()', () => {
  it('returns adset rows with metrics enriched via adsetIdToCampaignId map', async () => {
    // AUCTION_ADGROUP response only carries adgroup_id (TikTok rejects
    // campaign_id at that level). Worker passes adset_registry-derived map.
    const adgroupBody = {
      code: 0,
      data: {
        list: [{
          dimensions: { adgroup_id: 'TG1' },
          metrics: { spend: '25.5', impressions: '1000', clicks: '20', conversion: 3, complete_payment: '3', value_per_complete_payment: '50.0' },
        }],
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(adgroupBody), { status: 200 }));
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: ['TC1'], hotAdgroupIds: ['TG1'], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      accountCurrency: 'USD',
      adsetIdToCampaignId: new Map([['TG1', 'TC1']]),
      fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'USD' ? amount * 1.36 : amount,
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC1', ad_set_id: 'TG1',
      impressions: 1000, clicks: 20, conversions: 3,
    });
  });

  // P1-11 (2026-06-10): FX failure → adapter returns null → the row payload
  // OMITS spend_cad + conversion_value_cad (key-level) so the worker's upsert
  // ON CONFLICT preserves the last good value instead of zeroing it.
  it('P1-11: FX adapter returns null → adset rows omit spend_cad/conversion_value_cad but keep non-CAD metrics', async () => {
    const adgroupBody = {
      code: 0,
      data: {
        list: [{
          dimensions: { adgroup_id: 'TG1' },
          metrics: { spend: '25.5', impressions: '1000', clicks: '20', conversion: 3, complete_payment: '3', value_per_complete_payment: '50.0' },
        }],
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(adgroupBody), { status: 200 }));
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: ['TC1'], hotAdgroupIds: ['TG1'], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      accountCurrency: 'USD',
      adsetIdToCampaignId: new Map([['TG1', 'TC1']]),
      fetcher: fetchMock,
      // Frankfurter outage: USD→CAD conversion fails.
      getFxCadFor: async () => null,
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0]).not.toHaveProperty('spend_cad');
    expect(out.adsets[0]).not.toHaveProperty('conversion_value_cad');
    // Non-CAD metrics still refresh this tick.
    expect(out.adsets[0]).toMatchObject({
      campaign_id: 'TC1', ad_set_id: 'TG1',
      impressions: 1000, clicks: 20, conversions: 3,
    });
  });

  it('AUCTION_ADGROUP request sends only ["adgroup_id"] in dimensions', async () => {
    const adgroupBody = { code: 0, data: { list: [] } };
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify(adgroupBody), { status: 200 });
    });
    await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: [], hotAdgroupIds: ['TG1'], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      accountCurrency: 'USD',
      adsetIdToCampaignId: new Map([['TG1', 'TC1']]),
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    const adgroupUrl = calls.find(c => /data_level=AUCTION_ADGROUP/.test(c))!;
    expect(decodeURIComponent(adgroupUrl)).toContain('dimensions=["adgroup_id"]');
    expect(decodeURIComponent(adgroupUrl)).not.toContain('campaign_id');
  });

  it('ADGROUP rows without a campaign map entry are skipped', async () => {
    const adgroupBody = {
      code: 0,
      data: {
        list: [{
          dimensions: { adgroup_id: 'TG-ORPHAN' },
          metrics: { spend: '5', impressions: '100', clicks: '2', conversion: 0, purchase: '0', total_purchase_value: '0' },
        }],
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(adgroupBody), { status: 200 }));
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: [], hotAdgroupIds: ['TG-ORPHAN'], hotAdIds: [],
      dateStr: '2026-05-30', campaignStoreMap: {},
      accountCurrency: 'USD',
      // No adsetIdToCampaignId entry for TG-ORPHAN.
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    expect(out.adsets).toHaveLength(0);
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
        dimensions: { adgroup_id: 'TG1' },
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
      adsetIdToCampaignId: new Map([['TG1', 'TC1']]),
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
        dimensions: { adgroup_id: 'TG1' },
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
      adsetIdToCampaignId: new Map([['TG1', 'TC1']]),
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

  // Bug 2026-06-04: the live hot-metrics writer requested `purchase` /
  // `total_purchase_value` — empty for this Shopify web-pixel setup — so
  // every TikTok live tick wrote conversions=0, while TikTok Ads Manager
  // (and the nightly `fetchTikTokAdInsights` path) report sales under
  // `complete_payment`. Live API probe 2026-06-04: campaign 1866979241538642
  // returned purchase=0 but complete_payment=1, value_per_complete_payment=90.51.
  // The fetcher must read `complete_payment` (count) and synthesize value as
  // complete_payment × value_per_complete_payment, matching tiktok.ts.
  it('maps conversions from complete_payment (NOT the empty purchase metric)', async () => {
    const adgroupBody = {
      code: 0,
      data: {
        list: [{
          dimensions: { adgroup_id: 'TG1' },
          // Mirrors production: purchase is 0, the real sale is under complete_payment.
          metrics: {
            spend: '8.93', impressions: '5985', clicks: '47', conversion: '1',
            purchase: '0', total_purchase_value: '0.00',
            complete_payment: '2', value_per_complete_payment: '90.51',
          },
        }],
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(adgroupBody), { status: 200 }));
    const out = await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: ['TC1'], hotAdgroupIds: ['TG1'], hotAdIds: [],
      dateStr: '2026-06-04', campaignStoreMap: {},
      accountCurrency: 'USD',
      adsetIdToCampaignId: new Map([['TG1', 'TC1']]),
      fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'USD' ? amount * 1.36 : amount,
    });
    expect(out.adsets).toHaveLength(1);
    // 2 complete payments → conversions = 2 (not 0 from the empty purchase metric).
    expect(out.adsets[0].conversions).toBe(2);
    // value = complete_payment(2) × value_per_complete_payment(90.51) × FX(1.36).
    expect(out.adsets[0].conversion_value_cad).toBeCloseTo(2 * 90.51 * 1.36, 4);
  });

  it('requests complete_payment + value_per_complete_payment (NOT purchase/total_purchase_value)', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ code: 0, data: { list: [] } }), { status: 200 });
    });
    await fetchTikTokHotMetricsForStore({
      storeId: 'uzoshop', advertiserId: '12345', accessToken: 'tok',
      hotCampaignIds: [], hotAdgroupIds: ['TG1'], hotAdIds: [],
      dateStr: '2026-06-04', campaignStoreMap: {},
      accountCurrency: 'USD',
      adsetIdToCampaignId: new Map([['TG1', 'TC1']]),
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    const url = decodeURIComponent(calls.find(c => /data_level=AUCTION_ADGROUP/.test(c))!);
    expect(url).toContain('complete_payment');
    expect(url).toContain('value_per_complete_payment');
    expect(url).not.toContain('total_purchase_value');
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
