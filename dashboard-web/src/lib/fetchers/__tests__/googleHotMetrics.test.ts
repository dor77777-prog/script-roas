import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleHotMetricsForStore } from '@/lib/fetchers/googleHotMetrics';

describe('fetchGoogleHotMetricsForStore()', () => {
  it('returns metrics rows for hot campaign + adgroup + ad ids', async () => {
    const searchStream = vi.fn();
    // campaign metrics
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, metrics: { impressions: '1000', clicks: '20', cost_micros: '50000000', conversions: 3, conversions_value: '150.0' }, segments: { date: '2026-05-30' } },
    ]);
    // ad-group metrics
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, ad_group: { id: 'AG1' }, metrics: { impressions: '500', clicks: '10', cost_micros: '25000000', conversions: 0, conversions_value: '0' }, segments: { date: '2026-05-30' } },
    ]);
    // ad metrics
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, ad_group: { id: 'AG1' }, ad_group_ad: { ad: { id: 'AD1' } }, metrics: { impressions: '500', clicks: '10', cost_micros: '25000000', conversions: 0, conversions_value: '0' }, segments: { date: '2026-05-30' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleHotMetricsForStore>[0]['customer'];
    const out = await fetchGoogleHotMetricsForStore({
      storeId: 'uzoshop',
      customer,
      hotCampaignIds: ['GC1'], hotAdgroupIds: ['AG1'], hotAdIds: ['AD1'],
      dateStr: '2026-05-30',
    });
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1',
      spend_cad: 50, impressions: 1000, clicks: 20, conversions: 3, conversion_value_cad: 150,
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0].adset_id).toBe('AG1');
    expect(out.ads).toHaveLength(1);
    expect(out.ads[0].ad_id).toBe('AD1');
  });

  it('skips levels with empty hot sets', async () => {
    const searchStream = vi.fn();
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleHotMetricsForStore>[0]['customer'];
    const out = await fetchGoogleHotMetricsForStore({
      storeId: 'uzoshop', customer,
      hotCampaignIds: [], hotAdgroupIds: [], hotAdIds: [],
      dateStr: '2026-05-30',
    });
    expect(searchStream).not.toHaveBeenCalled();
    expect(out.campaigns).toHaveLength(0);
  });
});
