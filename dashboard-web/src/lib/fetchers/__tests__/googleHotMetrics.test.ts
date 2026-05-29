import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleHotMetricsForStore } from '@/lib/fetchers/googleHotMetrics';

describe('fetchGoogleHotMetricsForStore()', () => {
  it('returns adset + ad metrics rows for hot ids (no campaign-level rows per CRIT-B)', async () => {
    const searchStream = vi.fn();
    // ad-group metrics
    // CRIT-C: JSON keys are camelCase — adGroup, costMicros, conversionsValue.
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, adGroup: { id: 'AG1' }, metrics: { impressions: '500', clicks: '10', costMicros: '25000000', conversions: 0, conversionsValue: '0' }, segments: { date: '2026-05-30' } },
    ]);
    // ad metrics
    // CRIT-C: JSON keys are camelCase — adGroup, adGroupAd.
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, adGroup: { id: 'AG1' }, adGroupAd: { ad: { id: 'AD1' } }, metrics: { impressions: '500', clicks: '10', costMicros: '25000000', conversions: 0, conversionsValue: '0' }, segments: { date: '2026-05-30' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleHotMetricsForStore>[0]['customer'];
    const out = await fetchGoogleHotMetricsForStore({
      storeId: 'uzoshop',
      customer,
      hotCampaignIds: ['GC1'], hotAdgroupIds: ['AG1'], hotAdIds: ['AD1'],
      dateStr: '2026-05-30',
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0].ad_set_id).toBe('AG1');
    expect(out.adsets[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1',
      spend_cad: 25, impressions: 500, clicks: 10,
    });
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
    expect(out.adsets).toHaveLength(0);
    expect(out.ads).toHaveLength(0);
  });
});
