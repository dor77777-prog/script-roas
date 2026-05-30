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
      isTikTokConfigured: () => true,
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
    });
    expect(fetchStatus).toHaveBeenCalled();
    expect(upsertRegistry).toHaveBeenCalledWith(expect.objectContaining({ table: 'campaign_registry' }));
    expect(insertStatusEvents).toHaveBeenCalled();
    const successCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'success');
    expect(successCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
  });

  // Phase D soak (2026-05-30) — after upserting fresh campaign rows under
  // the resolved store_id, the worker MUST DELETE any registry rows for
  // the same (platform, campaign_id) under a DIFFERENT store_id. The
  // PK includes store_id, so upsert never conflicts with stale rows from
  // a previous mapping — they linger at BACKFILL_UNKNOWN forever.
  it('Phase D soak: after upsert, calls deleteStaleAttributionRows with the fresh ids + target stores', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      campaigns: [{
        store_id: 'usmile360', platform: 'tiktok', campaign_id: '1866440028463153', name: 'X',
        configured_status: 'ENABLE', effective_status: 'ADGROUP_STATUS_DELIVERY_OK', delivery_status: 'DELIVERING',
        is_enabled: true, is_serving: true,
        first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
        platform_updated_at: null, status_changed_at: null,
        last_metrics_success_at: null, last_status_success_at: null,
        raw_status_payload: null, missed_seen_count: 0, is_removed: false,
      }],
      adsets: [], ads: [],
    });
    // Prior registry has a stale (tiktok, uzoshop, X) row from before the
    // mapping moved to usmile360 — worker MUST schedule its DELETE.
    const loadPriorRegistry = vi.fn().mockResolvedValue({
      campaigns: new Map([['1866440028463153', {
        store_id: 'uzoshop', platform: 'tiktok', campaign_id: '1866440028463153',
        configured_status: 'BACKFILL_UNKNOWN', effective_status: 'ADGROUP_STATUS_DELIVERY_OK',
      }]]),
      adsets: new Map(), ads: new Map(),
    });
    const deleteStaleAttributionRows = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus, fetchHotMetrics: vi.fn(),
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry,
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      deleteStaleAttributionRows,
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      nowIso: NOW_ISO,
      isTikTokConfigured: () => true,
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
    });
    expect(deleteStaleAttributionRows).toHaveBeenCalledOnce();
    const call = deleteStaleAttributionRows.mock.calls[0][0];
    expect(call.platform).toBe('tiktok');
    expect(call.entityType).toBe('campaign');
    expect(call.freshCampaignIds).toEqual(['1866440028463153']);
    expect(call.freshTargetStoreIds.sort()).toEqual(['usmile360']);
  });

  it('Phase E1.5: delivering/preparing adsets UPSERT placeholder rows into campaigns_daily (no metrics)', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      campaigns: [{
        store_id: 'usmile360', platform: 'tiktok', campaign_id: 'TC1', name: 'TT Camp 1',
        configured_status: 'ENABLE', effective_status: 'ADGROUP_STATUS_DELIVERY_OK', delivery_status: 'DELIVERING',
        is_enabled: true, is_serving: true,
        first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
        platform_updated_at: null, status_changed_at: null,
        last_metrics_success_at: null, last_status_success_at: null,
        raw_status_payload: null, missed_seen_count: 0, is_removed: false,
      }],
      adsets: [
        {
          store_id: 'usmile360', platform: 'tiktok', campaign_id: 'TC1', adset_id: 'TG1', name: 'AdGroup delivering',
          configured_status: 'ENABLE', effective_status: 'ADGROUP_STATUS_DELIVERY_OK', delivery_status: 'DELIVERING',
          is_enabled: true, is_serving: true,
          first_seen_at: null, last_seen_at: null,
          platform_updated_at: null, status_changed_at: null,
          last_metrics_success_at: null, last_status_success_at: null,
          raw_status_payload: null, missed_seen_count: 0, is_removed: false,
        },
        {
          store_id: 'uzoshop', platform: 'tiktok', campaign_id: 'TC2', adset_id: 'TG2', name: 'AdGroup disabled',
          configured_status: 'DISABLE', effective_status: 'ADGROUP_STATUS_CAMPAIGN_DISABLE', delivery_status: 'NOT_DELIVERING',
          is_enabled: false, is_serving: false,
          first_seen_at: null, last_seen_at: null,
          platform_updated_at: null, status_changed_at: null,
          last_metrics_success_at: null, last_status_success_at: null,
          raw_status_payload: null, missed_seen_count: 0, is_removed: false,
        },
      ],
      ads: [],
    });
    const upsertCampaignsDaily = vi.fn().mockResolvedValue(undefined);
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus, fetchHotMetrics: vi.fn(),
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily, upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      nowIso: NOW_ISO,
      isTikTokConfigured: () => true,
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
    });
    expect(upsertCampaignsDaily).toHaveBeenCalledOnce();
    const rows = upsertCampaignsDaily.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      store_id: 'usmile360',
      platform: 'tiktok',
      campaign_id: 'TC1',
      ad_set_id: 'TG1',
    });
    expect(rows[0]).not.toHaveProperty('spend_cad');
  });

  it('Phase D soak: does NOT call deleteStaleAttributionRows when fetch returns zero campaigns', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ campaigns: [], adsets: [], ads: [] });
    const deleteStaleAttributionRows = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus, fetchHotMetrics: vi.fn(),
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      deleteStaleAttributionRows,
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      nowIso: NOW_ISO,
      isTikTokConfigured: () => true,
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
    });
    // Empty fresh set → no DELETE (would otherwise wipe ALL rows for the
    // platform; guarded by the if-block in the worker).
    expect(deleteStaleAttributionRows).not.toHaveBeenCalled();
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
      isTikTokConfigured: () => true,
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
      getFxCadFor: async () => async (amount: number) => amount,
    });
    expect(fetchHotMetrics).toHaveBeenCalled();
    expect(upsertCampaignsDaily).toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'ad_metrics', status: 'success' }));
  });
});

describe('runTikTokWorkerJob() — hot_metrics Phase E1.6.1 per-store agg RPC', () => {
  // Phase E1.6.1 (2026-05-30): TikTok does NOT use the bulk-date account
  // spend fetcher Meta/Google use. The advertiser-level total is the
  // cross-store aggregate (one TikTok account serves multiple stores via
  // per-ad pixel routing) — writing it to one store_id's data_daily row
  // would inflate that store and starve the others. Instead, the worker
  // calls `agg_tiktok_spend_per_store_for_date(d)` which re-aggregates
  // campaigns_daily (already attributed correctly via the campaign-store-
  // map) per-store into data_daily.

  it('with non-empty hot set: calls agg RPC TWICE (pre-fetch + post-upsert) for today', async () => {
    const aggregateDataDaily = vi.fn().mockResolvedValue(undefined);
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn().mockResolvedValue({ adsets: [], ads: [] }),
      getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
      getFxCadFor: async () => async () => 1.4,
      aggregateDataDaily,
      nowIso: '2026-05-29T16:00:00.000Z',
      isTikTokConfigured: () => true,
    });
    // Once before hot-set fetch (refresh from existing campaigns_daily) +
    // once after upsertCampaignsDaily (pick up fresh writes).
    expect(aggregateDataDaily).toHaveBeenCalledTimes(2);
    expect(aggregateDataDaily).toHaveBeenNthCalledWith(1, '2026-05-29');
    expect(aggregateDataDaily).toHaveBeenNthCalledWith(2, '2026-05-29');
  });

  it('soft-fails on agg RPC rejection — hot_metrics success still recorded', async () => {
    const aggregateDataDaily = vi.fn().mockRejectedValue(
      new Error('agg_tiktok_spend_per_store_for_date(2026-05-29): function not found'),
    );
    const recordFreshness = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn().mockResolvedValue({ adsets: [], ads: [] }),
      getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
      getFxCadFor: async () => async () => 1.4,
      aggregateDataDaily,
      nowIso: '2026-05-29T16:00:00.000Z',
      isTikTokConfigured: () => true,
    });
    expect(aggregateDataDaily).toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'campaign_metrics', status: 'success',
    }));
  });
});

describe('runTikTokWorkerJob() — hot_metrics auth/rate alerts (Phase E1)', () => {
  it('rate-limit → notifyTokenFailure(tiktok_hot_metrics_rate_limit)', async () => {
    const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
    const err = new Error('TikTok report API: code=40001 rate limit exceeded');
    const fetchHotMetrics = vi.fn().mockRejectedValue(err);
    await expect(runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(), fetchHotMetrics,
      getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      notifyTokenFailure,
      nowIso: NOW_ISO,
      isTikTokConfigured: () => true,
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
      getFxCadFor: async () => async () => 1,
    })).rejects.toThrow('rate limit');
    expect(notifyTokenFailure).toHaveBeenCalledOnce();
    expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('tiktok_hot_metrics_rate_limit');
  });

  it('auth error → notifyTokenFailure(tiktok_hot_metrics_auth)', async () => {
    const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
    const err = new Error('TikTok report API: code=40105 access token invalid');
    const fetchHotMetrics = vi.fn().mockRejectedValue(err);
    await expect(runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(), fetchHotMetrics,
      getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      notifyTokenFailure,
      nowIso: NOW_ISO,
      isTikTokConfigured: () => true,
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
      getFxCadFor: async () => async () => 1,
    })).rejects.toThrow('access token invalid');
    expect(notifyTokenFailure).toHaveBeenCalledOnce();
    expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('tiktok_hot_metrics_auth');
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
      isTikTokConfigured: () => true,
    });
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'ad_metrics', status: 'success' }));
  });

  it('Phase E1.6.1 regression fix (2026-05-30): empty hot set STILL calls the agg RPC (re-aggregate from existing campaigns_daily) — hot-set early-exit must NOT pre-empt the per-store split', async () => {
    // Pre-fix: the empty-hot-set early-exit returned BEFORE the
    // per-store agg call, freezing data_daily.tt_spend_cad +
    // tt_impressions for ALL stores. usmile360 + zolplus tt_spend_cad
    // stale during the day (only the nightly cronDaily RPC ran).
    const aggregateDataDaily = vi.fn().mockResolvedValue(undefined);
    const fetchHotMetrics = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(),
      fetchHotMetrics,
      getHotCampaignIds: async () => [],
      getHotAdgroupIds: async () => [],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
      getFxCadFor: async () => async () => 1.4,
      aggregateDataDaily,
      nowIso: '2026-05-29T16:00:00.000Z',
      isTikTokConfigured: () => true,
    });
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    // Exactly 1 call (the post-upsert call is skipped because the
    // empty-hot-set branch returns before fetchHotMetrics + upserts).
    expect(aggregateDataDaily).toHaveBeenCalledTimes(1);
    expect(aggregateDataDaily).toHaveBeenCalledWith('2026-05-29');
  });
});

describe('runTikTokWorkerJob() — not configured (shared TikTok account architecture)', () => {
  // Per ARCHITECTURE.md §5.4 + the user-confirmed model (2026-05-30):
  // there is ONE TikTok ad account (uzoshop's) that serves multiple
  // stores. Per-store TikTok env vars exist only for uzoshop. usmile360
  // + zolplus are "tenants" whose data is written by uzoshop's worker
  // via the Phase A.5 v2 campaign-store-map. Their dedicated workers
  // must NOT throw on missing env vars — they should no-op and record a
  // freshness success so the operator panel stays consistent.

  it('status: skips loadStoreMap + fetch when not configured, records 3 success rows', async () => {
    const loadStoreMap = vi.fn();
    const fetchStatus = vi.fn();
    const upsertRegistry = vi.fn();
    const recordFreshness = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'usmile360', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
      loadStoreMap, fetchStatus, fetchHotMetrics: vi.fn(),
      getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry, insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
      isTikTokConfigured: () => false,
    });
    expect(loadStoreMap).not.toHaveBeenCalled();
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(upsertRegistry).not.toHaveBeenCalled();
    const scopes = recordFreshness.mock.calls.map(c => c[0].scope).sort();
    expect(scopes).toEqual(['ad_status', 'adset_status', 'campaign_status']);
    expect(recordFreshness.mock.calls.every(c => c[0].status === 'success')).toBe(true);
  });

  it('hot_metrics: skips fetch + safeAccount when not configured even if hot ids exist, records 2 success rows', async () => {
    // Critical: usmile360 may have campaign_registry rows (uzoshop's worker
    // writes them via campaign-store-map) → getHotCampaignIds may return
    // ids. Without the early-return, safeAccount throws and no freshness
    // is recorded.
    const fetchHotMetrics = vi.fn();
    const recordFreshness = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'usmile360', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(), fetchHotMetrics,
      getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      nowIso: NOW_ISO,
      isTikTokConfigured: () => false,
    });
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    const scopes = recordFreshness.mock.calls.map(c => c[0].scope).sort();
    expect(scopes).toEqual(['ad_metrics', 'campaign_metrics']);
    expect(recordFreshness.mock.calls.every(c => c[0].status === 'success')).toBe(true);
  });
});

describe('runTikTokWorkerJob() — fetch throws (transient API failure, etc.)', () => {
  // Same antipattern as Google: without a try/catch wrap, fetcher failures
  // leave data_freshness empty and the operator can't distinguish broken
  // from never-ran. Both branches must record transient_error before
  // re-throwing.

  it('status: records 3 transient_error rows then re-throws', async () => {
    const err = new Error('TikTok HTTP 503: Service Unavailable');
    const fetchStatus = vi.fn().mockRejectedValue(err);
    const recordFreshness = vi.fn();
    await expect(
      runTikTokWorkerJob({
        jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
        loadStoreMap: async () => ({}),
        fetchStatus, fetchHotMetrics: vi.fn(),
        getHotCampaignIds: async () => [], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
        loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
        upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
        upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
        recordFreshness,
        nowIso: NOW_ISO,
        isTikTokConfigured: () => true,
        getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
      }),
    ).rejects.toThrow('HTTP 503');
    const errorCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'transient_error');
    expect(errorCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
    expect(errorCalls[0][0].errorMessage).toContain('HTTP 503');
  });

  it('hot_metrics: records 2 transient_error rows then re-throws', async () => {
    const err = new Error('TikTok report API: code=40001 rate limit exceeded');
    const fetchHotMetrics = vi.fn().mockRejectedValue(err);
    const recordFreshness = vi.fn();
    await expect(
      runTikTokWorkerJob({
        jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
        loadStoreMap: async () => ({}),
        fetchStatus: vi.fn(), fetchHotMetrics,
        getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
        loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
        upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
        upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
        recordFreshness,
        nowIso: NOW_ISO,
        isTikTokConfigured: () => true,
        getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
        getFxCadFor: async () => async (amount: number) => amount,
      }),
    ).rejects.toThrow('rate limit');
    const errorCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'transient_error');
    expect(errorCalls.map(c => c[0].scope).sort()).toEqual(['ad_metrics', 'campaign_metrics']);
    expect(errorCalls[0][0].errorMessage).toContain('rate limit');
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
