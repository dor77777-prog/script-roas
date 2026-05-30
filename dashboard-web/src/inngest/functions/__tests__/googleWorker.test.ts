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
      isGoogleConfigured: () => true,
    });
    expect(fetchStatus).toHaveBeenCalled();
    expect(upsertRegistry).toHaveBeenCalledWith(expect.objectContaining({ table: 'campaign_registry' }));
    expect(insertStatusEvents).toHaveBeenCalled();
    const successCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'success');
    expect(successCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
  });
});

describe('runGoogleWorkerJob() — hot_metrics scope', () => {
  it('happy path: getHotIds → fetchMetrics → upsert daily (CRIT-B: adsets-only into campaigns_daily)', async () => {
    // CRIT-B: fetcher returns only adsets + ads (no campaign-level rows).
    // IMP-A: row payloads include campaign_name / ad_set_name.
    const fetchMetrics = vi.fn().mockResolvedValue({
      adsets: [{ store_id: 'uzoshop', platform: 'google', campaign_id: 'GC1', campaign_name: 'GC', ad_set_id: 'AG1', ad_set_name: 'AG', date: '2026-05-30', spend_cad: 25, impressions: 500, clicks: 10, conversions: 1, conversion_value_cad: 30 }],
      ads: [],
    });
    const upsertCampaignsDaily = vi.fn();
    const recordFreshness = vi.fn();
    await runGoogleWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      fetchStatus: vi.fn(), fetchHotMetrics: fetchMetrics,
      getHotCampaignIds: async () => ['GC1'], getHotAdgroupIds: async () => ['AG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily, upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
      isGoogleConfigured: () => true,
    });
    expect(fetchMetrics).toHaveBeenCalled();
    expect(upsertCampaignsDaily).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ ad_set_id: 'AG1' })]));
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });
});

describe('runGoogleWorkerJob() — hot_metrics auth/rate alerts (Phase E1)', () => {
  it('rate-limit → notifyTokenFailure(google_hot_metrics_rate_limit)', async () => {
    const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
    const err = new Error('Google Ads API: RESOURCE_EXHAUSTED quota exceeded');
    const fetchHotMetrics = vi.fn().mockRejectedValue(err);
    await expect(runGoogleWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      fetchStatus: vi.fn(), fetchHotMetrics,
      getHotCampaignIds: async () => ['GC1'], getHotAdgroupIds: async () => ['AG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      notifyTokenFailure,
      nowIso: NOW_ISO,
      isGoogleConfigured: () => true,
    })).rejects.toThrow('RESOURCE_EXHAUSTED');
    expect(notifyTokenFailure).toHaveBeenCalledOnce();
    expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('google_hot_metrics_rate_limit');
  });

  it('auth error → notifyTokenFailure(google_hot_metrics_auth)', async () => {
    const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
    const err = new Error('Google Ads API: UNAUTHENTICATED invalid_grant refresh token expired');
    const fetchHotMetrics = vi.fn().mockRejectedValue(err);
    await expect(runGoogleWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      fetchStatus: vi.fn(), fetchHotMetrics,
      getHotCampaignIds: async () => ['GC1'], getHotAdgroupIds: async () => ['AG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      notifyTokenFailure,
      nowIso: NOW_ISO,
      isGoogleConfigured: () => true,
    })).rejects.toThrow('UNAUTHENTICATED');
    expect(notifyTokenFailure).toHaveBeenCalledOnce();
    expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('google_hot_metrics_auth');
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
      isGoogleConfigured: () => true,
    });
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    expect(upsertCampaignsDaily).not.toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });
});

describe('runGoogleWorkerJob() — not configured (no per-store Google creds)', () => {
  // Stores without per-store env vars (e.g. usmile360 / zolplus when only
  // uzoshop has Google Ads) must NOT throw. The orchestrator naively fans
  // out for every (store, platform, scope) combo; the worker handles the
  // "this store has no Google account" case as a no-op + freshness success
  // so the operator panel stays consistent and Inngest doesn't accumulate
  // retryable failures forever.

  it('status: skips fetch, records 3 success freshness rows', async () => {
    const fetchStatus = vi.fn();
    const upsertRegistry = vi.fn();
    const recordFreshness = vi.fn();
    await runGoogleWorkerJob({
      jobData: { store_id: 'usmile360', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
      fetchStatus, fetchHotMetrics: vi.fn(),
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry, insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
      isGoogleConfigured: () => false,
    });
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(upsertRegistry).not.toHaveBeenCalled();
    const scopes = recordFreshness.mock.calls.map(c => c[0].scope).sort();
    expect(scopes).toEqual(['ad_status', 'adset_status', 'campaign_status']);
    expect(recordFreshness.mock.calls.every(c => c[0].status === 'success')).toBe(true);
  });

  it('hot_metrics: skips fetch, records 2 success freshness rows', async () => {
    const fetchHotMetrics = vi.fn();
    const upsertCampaignsDaily = vi.fn();
    const recordFreshness = vi.fn();
    await runGoogleWorkerJob({
      jobData: { store_id: 'usmile360', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      fetchStatus: vi.fn(), fetchHotMetrics,
      getHotCampaignIds: async () => ['HC1'], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily, upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
      isGoogleConfigured: () => false,
    });
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    expect(upsertCampaignsDaily).not.toHaveBeenCalled();
    const scopes = recordFreshness.mock.calls.map(c => c[0].scope).sort();
    expect(scopes).toEqual(['ad_metrics', 'campaign_metrics']);
    expect(recordFreshness.mock.calls.every(c => c[0].status === 'success')).toBe(true);
  });
});

describe('runGoogleWorkerJob() — fetch throws (CHANGE_DATE_RANGE_INFINITE, transient API failure, etc.)', () => {
  // Phase C soak found that when fetchStatus throws, no freshness row gets
  // written and the operator panel cannot distinguish "broken" from
  // "this store has not run yet". Both branches must now record a
  // transient_error row before re-throwing (Inngest's retry layer still
  // sees a thrown error → exponential backoff preserved).

  it('status: records 3 transient_error rows then re-throws', async () => {
    const err = new Error('CHANGE_DATE_RANGE_INFINITE');
    const fetchStatus = vi.fn().mockRejectedValue(err);
    const recordFreshness = vi.fn();
    await expect(
      runGoogleWorkerJob({
        jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
        fetchStatus, fetchHotMetrics: vi.fn(),
        getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
        loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
        upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
        upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
        recordFreshness,
        nowIso: NOW_ISO,
        isGoogleConfigured: () => true,
      }),
    ).rejects.toThrow('CHANGE_DATE_RANGE_INFINITE');
    const errorCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'transient_error');
    expect(errorCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
    expect(errorCalls[0][0].errorMessage).toContain('CHANGE_DATE_RANGE_INFINITE');
  });

  it('hot_metrics: records 2 transient_error rows then re-throws', async () => {
    const err = new Error('HTTP 503: Backend unavailable');
    const fetchHotMetrics = vi.fn().mockRejectedValue(err);
    const recordFreshness = vi.fn();
    await expect(
      runGoogleWorkerJob({
        jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
        fetchStatus: vi.fn(), fetchHotMetrics,
        getHotCampaignIds: async () => ['HC1'], getHotAdgroupIds: async () => ['HA1'], getHotAdIds: async () => [],
        loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
        upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
        upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
        recordFreshness,
        nowIso: NOW_ISO,
        isGoogleConfigured: () => true,
      }),
    ).rejects.toThrow('HTTP 503');
    const errorCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'transient_error');
    expect(errorCalls.map(c => c[0].scope).sort()).toEqual(['ad_metrics', 'campaign_metrics']);
    expect(errorCalls[0][0].errorMessage).toContain('HTTP 503');
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
