import { describe, expect, it, vi } from 'vitest';
import { runTikTokWorkerJob } from '@/inngest/functions/tiktokWorker';

const NOW_ISO = '2026-05-29T20:00:00.000Z';

describe('runTikTokWorkerJob() — status scope', () => {
  it('fetches, diffs, upserts registries, records freshness', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      campaigns: [{
        store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC1', name: 'T1',
        configured_status: 'ENABLE', effective_status: 'ADGROUP_STATUS_DELIVERY_OK', delivery_status: 'DELIVERING',
        is_enabled: true, is_serving: true,
        first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
        platform_updated_at: null, status_changed_at: null,
        last_metrics_success_at: null, last_status_success_at: null,
        raw_status_payload: null, missed_seen_count: 0, is_removed: false,
      }],
      adsets: [], ads: [],
    });
    const upsertRegistry = vi.fn();
    const insertStatusEvents = vi.fn();
    const recordFreshness = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus, fetchHotMetrics: vi.fn(),
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry, insertStatusEvents,
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchStatus).toHaveBeenCalled();
    expect(upsertRegistry).toHaveBeenCalledWith(expect.objectContaining({ table: 'campaign_registry' }));
    expect(insertStatusEvents).toHaveBeenCalled();
    const successCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'success');
    expect(successCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
  });
});

describe('runTikTokWorkerJob() — hot_metrics scope', () => {
  it('happy path: getHotIds → fetchMetrics → upsert daily', async () => {
    const fetchHotMetrics = vi.fn().mockResolvedValue({
      adsets: [{ store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC1', ad_set_id: 'TG1', date: '2026-05-30', spend_cad: 25, impressions: 500, clicks: 10, conversions: 1, conversion_value_cad: 30, campaign_name: 'T1', ad_set_name: 'TG1' }],
      ads: [],
    });
    const upsertCampaignsDaily = vi.fn();
    const recordFreshness = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(), fetchHotMetrics,
      getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily, upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchHotMetrics).toHaveBeenCalled();
    expect(upsertCampaignsDaily).toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'ad_metrics', status: 'success' }));
  });
});

describe('runTikTokWorkerJob() — hot_metrics with empty hot set', () => {
  it('skips fetch but still records campaign_metrics + ad_metrics success', async () => {
    const fetchHotMetrics = vi.fn();
    const recordFreshness = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(), fetchHotMetrics,
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'ad_metrics', status: 'success' }));
  });
});

describe('runTikTokWorkerJob() — unknown scope', () => {
  it('no-ops', async () => {
    const fetchStatus = vi.fn();
    const recordFreshness = vi.fn();
    await runTikTokWorkerJob({
      // @ts-expect-error — intentionally bogus
      jobData: { store_id: 'uzoshop', scope: 'bogus', tick_id: 'T', staleness_seconds: 0, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus, fetchHotMetrics: vi.fn(),
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(recordFreshness).not.toHaveBeenCalled();
  });
});
