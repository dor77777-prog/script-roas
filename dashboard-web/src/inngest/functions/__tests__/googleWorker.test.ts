import { describe, expect, it, vi } from 'vitest';
import { runGoogleWorkerJob } from '@/inngest/functions/googleWorker';

const NOW_ISO = '2026-05-29T20:00:00.000Z';

describe('runGoogleWorkerJob() — status scope', () => {
  it('happy path: fetchStatus → diff → upsert registries → record freshness success', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      campaigns: [{
        store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1', name: 'G1',
        configured_status: 'ENABLED', effective_status: 'SERVING', delivery_status: 'DELIVERING',
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
    await runGoogleWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 10 },
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

describe('runGoogleWorkerJob() — hot_metrics scope', () => {
  it('happy path: getHotIds → fetchMetrics → upsert daily', async () => {
    const fetchMetrics = vi.fn().mockResolvedValue({
      campaigns: [{ store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1', date: '2026-05-30', spend_cad: 25, impressions: 500, clicks: 10, conversions: 1, conversion_value_cad: 30 }],
      adsets: [], ads: [],
    });
    const upsertCampaignsDaily = vi.fn();
    const recordFreshness = vi.fn();
    await runGoogleWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      fetchStatus: vi.fn(), fetchHotMetrics: fetchMetrics,
      getHotCampaignIds: async () => ['GC1'], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily, upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchMetrics).toHaveBeenCalled();
    expect(upsertCampaignsDaily).toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });
});

describe('runGoogleWorkerJob() — hot_metrics with empty hot set', () => {
  it('skips fetch but still records campaign_metrics success', async () => {
    const fetchHotMetrics = vi.fn();
    const upsertCampaignsDaily = vi.fn();
    const recordFreshness = vi.fn();
    await runGoogleWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      fetchStatus: vi.fn(), fetchHotMetrics,
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily, upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    expect(upsertCampaignsDaily).not.toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });
});

describe('runGoogleWorkerJob() — unknown scope', () => {
  it('no-ops: no fetch, no upsert, no freshness write', async () => {
    const fetchStatus = vi.fn();
    const fetchHotMetrics = vi.fn();
    const upsertRegistry = vi.fn();
    const recordFreshness = vi.fn();
    await runGoogleWorkerJob({
      // @ts-expect-error — intentionally exercising a bogus scope to confirm
      // the silent no-op branch (matches metaWorker precedent).
      jobData: { store_id: 'uzoshop', scope: 'bogus_scope', tick_id: 'T', staleness_seconds: 0, budget_pct_estimate: 0 },
      fetchStatus, fetchHotMetrics,
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry, insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
    });
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    expect(upsertRegistry).not.toHaveBeenCalled();
    expect(recordFreshness).not.toHaveBeenCalled();
  });
});
