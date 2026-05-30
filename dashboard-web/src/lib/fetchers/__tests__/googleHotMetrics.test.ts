import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleHotMetricsForStore } from '@/lib/fetchers/googleHotMetrics';

describe('fetchGoogleHotMetricsForStore()', () => {
  it('queries FROM campaign for hot CAMPAIGN ids and synthesizes ad_set_id = campaign_id', async () => {
    // Works for Performance Max (which has no ad_group resource), Standard
    // Shopping (which has ad_groups but is also queryable at campaign level),
    // Search, and Display campaigns alike. The previous per-ad_group query
    // returned 0 rows for PMax → data_daily.ga_spend_cad froze.
    const searchStream = vi.fn();
    searchStream.mockResolvedValueOnce([{ customer: { timeZone: 'Asia/Jerusalem' } }]);
    // CRIT-C: JSON keys are camelCase — costMicros, conversionsValue.
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1', name: 'G Campaign 1' }, metrics: { impressions: '500', clicks: '10', costMicros: '25000000', conversions: 0, conversionsValue: '0' }, segments: { date: '2026-05-30' } },
    ]);
    // ad-level branch query (FROM ad_group_ad).
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1', name: 'G Campaign 1' }, adGroup: { id: 'AG1', name: 'AdGroup 1' }, adGroupAd: { ad: { id: 'AD1', name: 'Ad 1' } }, metrics: { impressions: '500', clicks: '10', costMicros: '25000000', conversions: 0, conversionsValue: '0' }, segments: { date: '2026-05-30' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleHotMetricsForStore>[0]['customer'];
    const out = await fetchGoogleHotMetricsForStore({
      storeId: 'uzoshop',
      customer,
      hotCampaignIds: ['GC1'], hotAdgroupIds: ['AG1'], hotAdIds: ['AD1'],
      dateStr: '2026-05-30',
    });
    expect(out.adsets).toHaveLength(1);
    // ad_set_id == campaign_id (synthetic, matches PMax convention).
    expect(out.adsets[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1', ad_set_id: 'GC1',
      campaign_name: 'G Campaign 1', ad_set_name: 'G Campaign 1',
      spend_cad: 25, impressions: 500, clicks: 10,
    });
    expect(out.ads).toHaveLength(1);
    expect(out.ads[0]).toMatchObject({
      ad_id: 'AD1', ad_set_id: 'AG1', campaign_id: 'GC1',
      campaign_name: 'G Campaign 1', ad_set_name: 'AdGroup 1', ad_name: 'Ad 1',
    });
  });

  it('issues the campaign-level GAQL query with FROM campaign and account-tz date range', async () => {
    const searchStream = vi.fn();
    searchStream.mockResolvedValueOnce([{ customer: { timeZone: 'America/Toronto' } }]);
    searchStream.mockResolvedValueOnce([]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleHotMetricsForStore>[0]['customer'];
    await fetchGoogleHotMetricsForStore({
      storeId: 'uzoshop', customer,
      hotCampaignIds: ['GC1', 'GC2'], hotAdgroupIds: [], hotAdIds: [],
      dateStr: '2026-05-30',
    });
    const campaignQueryCall = searchStream.mock.calls.find(c => /FROM campaign/.test(String(c[0].query)));
    expect(campaignQueryCall).toBeDefined();
    expect(String(campaignQueryCall![0].query)).toContain("WHERE campaign.id IN ('GC1','GC2')");
    expect(String(campaignQueryCall![0].query)).toMatch(/segments\.date BETWEEN '\d{4}-\d{2}-\d{2}' AND '\d{4}-\d{2}-\d{2}'/);
  });

  it('skips fetches with empty hot sets', async () => {
    const searchStream = vi.fn();
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleHotMetricsForStore>[0]['customer'];
    const out = await fetchGoogleHotMetricsForStore({
      storeId: 'uzoshop', customer,
      hotCampaignIds: [], hotAdgroupIds: [], hotAdIds: [],
      dateStr: '2026-05-30',
    });
    expect(searchStream).not.toHaveBeenCalled();
    expect(out.adsets).toHaveLength(0);
    expect(out.ads).toHaveLength(0);
  });
});
