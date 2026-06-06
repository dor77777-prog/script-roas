import { describe, expect, it, vi } from 'vitest';
import { runMetaWorkerJob } from '@/inngest/functions/metaWorker';
import type { CampaignRegistryRow } from '@/lib/registries/types';

const NOW_ISO = '2026-05-29T14:30:42.000Z';

function freshCampaign(id: string, configured: string): CampaignRegistryRow {
  return {
    store_id: 'uzoshop', platform: 'meta', campaign_id: id,
    name: 'Campaign ' + id, configured_status: configured,
    effective_status: configured, delivery_status: 'DELIVERING',
    is_enabled: configured === 'ACTIVE', is_serving: configured === 'ACTIVE',
    first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
    platform_updated_at: '2026-05-29T14:00:00.000Z',
    status_changed_at: null,
    last_metrics_success_at: null, last_status_success_at: null,
    raw_status_payload: null, missed_seen_count: 0, is_removed: false,
  };
}

describe('runMetaWorkerJob()', () => {
  it('budget skip path: BUC pct >= 95 → mark freshness budget_skip, no fetch', async () => {
    const fetcher = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 0, budget_pct_estimate: 96 },
      bucProbe: async () => ({ pct: 96, etaMinutes: 0 }),
      fetchStatus: fetcher,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({
      status: 'budget_skip',
      scope: 'campaign_status',
    }));
  });

  it('ETA gate: eta_minutes > 0 → skip even with low pct', async () => {
    const fetcher = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 0, budget_pct_estimate: 5 },
      bucProbe: async () => ({ pct: 5, etaMinutes: 3 }),
      fetchStatus: fetcher,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ status: 'budget_skip' }));
  });

  it('happy path: fetch → diff → upsert registries → insert status events → mark success', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      campaigns: [freshCampaign('C1', 'ACTIVE')],
      adsets: [],
      ads: [],
      bucUsage: {
        ads_insights_call_pct: 12, ads_insights_cputime_pct: 5, ads_insights_time_pct: 5, ads_insights_eta_minutes: 0,
        ads_management_call_pct: 7, ads_management_cputime_pct: 2, ads_management_time_pct: 2, ads_management_eta_minutes: 0,
      },
    });
    const upsertRegistry = vi.fn();
    const insertEvents = vi.fn();
    const recordFreshness = vi.fn();
    const upsertBuc = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 900, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: fetcher,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry,
      insertStatusEvents: insertEvents,
      recordFreshness,
      upsertBuc,
      nowIso: NOW_ISO,
    });
    expect(fetcher).toHaveBeenCalled();
    expect(upsertRegistry).toHaveBeenCalledWith(expect.objectContaining({ table: 'campaign_registry' }));
    expect(insertEvents).toHaveBeenCalled();
    expect(insertEvents.mock.calls[0][0].events).toHaveLength(1);
    expect(insertEvents.mock.calls[0][0].events[0].change_kind).toBe('first_seen');
    expect(upsertBuc).toHaveBeenCalledWith(expect.objectContaining({ ads_management_call_pct: 7 }));
    const successCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'success');
    expect(successCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
  });

  it('Phase E1.5: ACTIVE adsets UPSERT placeholder rows into campaigns_daily (no metrics)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      campaigns: [freshCampaign('C1', 'ACTIVE'), freshCampaign('C2', 'PAUSED')],
      adsets: [
        {
          store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'AS1', name: 'Adset Active',
          configured_status: 'ACTIVE', effective_status: 'ACTIVE', delivery_status: 'DELIVERING',
          is_enabled: true, is_serving: true,
          first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
          platform_updated_at: null, status_changed_at: null,
          last_metrics_success_at: null, last_status_success_at: null,
          raw_status_payload: null, missed_seen_count: 0, is_removed: false,
          daily_budget_cad: null, lifetime_budget_cad: null,
        },
        {
          store_id: 'uzoshop', platform: 'meta', campaign_id: 'C2', adset_id: 'AS2', name: 'Adset Paused',
          configured_status: 'PAUSED', effective_status: 'PAUSED', delivery_status: 'NOT_DELIVERING',
          is_enabled: false, is_serving: false,
          first_seen_at: '__placeholder__', last_seen_at: '__placeholder__',
          platform_updated_at: null, status_changed_at: null,
          last_metrics_success_at: null, last_status_success_at: null,
          raw_status_payload: null, missed_seen_count: 0, is_removed: false,
          daily_budget_cad: null, lifetime_budget_cad: null,
        },
      ],
      ads: [],
      bucUsage: {
        ads_insights_call_pct: 12, ads_insights_cputime_pct: 5, ads_insights_time_pct: 5, ads_insights_eta_minutes: 0,
        ads_management_call_pct: 7, ads_management_cputime_pct: 2, ads_management_time_pct: 2, ads_management_eta_minutes: 0,
      },
    });
    const upsertCampaignsDaily = vi.fn().mockResolvedValue(undefined);
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 900, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: fetcher,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily,
      upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
    });
    expect(upsertCampaignsDaily).toHaveBeenCalledOnce();
    const rows = upsertCampaignsDaily.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-05-29',
      store_id: 'uzoshop',
      platform: 'meta',
      campaign_id: 'C1',
      ad_set_id: 'AS1',
      effective_status: 'ACTIVE',
    });
    expect(rows[0]).not.toHaveProperty('spend_cad');
    expect(rows[0]).not.toHaveProperty('impressions');
    expect(rows[0]).not.toHaveProperty('clicks');
    expect(rows[0]).not.toHaveProperty('conversions');
  });

  it('ignores scope !== status (Phase C will handle hot_metrics)', async () => {
    const fetcher = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 0, budget_pct_estimate: 0 },
      bucProbe: async () => ({ pct: 0, etaMinutes: 0 }),
      fetchStatus: fetcher,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      recordFreshness: vi.fn(),
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('runMetaWorkerJob() — ads-off fetch-gate (Phase 3)', () => {
  it('status + OFF: fetchStatus NOT called, freshness success recorded for all 3 status scopes', async () => {
    const fetcher = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 0, budget_pct_estimate: 0 },
      bucProbe: async () => ({ pct: 0, etaMinutes: 0 }),
      fetchStatus: fetcher,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
      adStateMap: { 'uzoshop:meta': false },
    });
    expect(fetcher).not.toHaveBeenCalled();
    const successCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'success');
    expect(successCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
  });

  it('hot_metrics + OFF: fetchHotMetrics NOT called, freshness success recorded for campaign_metrics + ad_metrics', async () => {
    const fetcher = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 0, budget_pct_estimate: 0 },
      bucProbe: async () => ({ pct: 0, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics: fetcher,
      getHotCampaignIds: async () => ['C1'],
      getHotAdsetIds: async () => ['AS1'],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
      adStateMap: { 'uzoshop:meta': false },
    });
    expect(fetcher).not.toHaveBeenCalled();
    const successCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'success');
    expect(successCalls.map(c => c[0].scope).sort()).toEqual(['ad_metrics', 'campaign_metrics']);
  });

  it('status + adStateMap={} (empty/all-on): fetchStatus IS called (default on behavior preserved)', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      campaigns: [], adsets: [], ads: [],
      bucUsage: {
        ads_insights_call_pct: 1, ads_insights_cputime_pct: 1, ads_insights_time_pct: 1, ads_insights_eta_minutes: 0,
        ads_management_call_pct: 1, ads_management_cputime_pct: 1, ads_management_time_pct: 1, ads_management_eta_minutes: 0,
      },
    });
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 0, budget_pct_estimate: 0 },
      bucProbe: async () => ({ pct: 0, etaMinutes: 0 }),
      fetchStatus: fetcher,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      recordFreshness: vi.fn(),
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
      adStateMap: {},
    });
    expect(fetcher).toHaveBeenCalled();
  });
});

describe('runMetaWorkerJob() — hot_metrics scope', () => {
  it('hot_metrics happy path: getHotIds → fetchMetrics → upsert campaigns_daily + ads_daily → mark freshness', async () => {
    const getHotCampaign = vi.fn().mockResolvedValue(['C1']);
    const getHotAdset = vi.fn().mockResolvedValue(['AS1']);
    const getHotAd = vi.fn().mockResolvedValue(['AD1']);
    // CRIT-B: fetcher returns only adsets + ads (no campaign-level rows).
    // IMP-A: row payloads include campaign_name / ad_set_name / ad_name.
    const fetcher = vi.fn().mockResolvedValue({
      adsets: [{ store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', campaign_name: 'C', ad_set_id: 'AS1', ad_set_name: 'AS', date: '2026-05-30', spend_cad: 25, impressions: 500, clicks: 10, conversions: 0, conversion_value_cad: 0 }],
      ads: [{ store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', campaign_name: 'C', ad_set_id: 'AS1', ad_set_name: 'AS', ad_id: 'AD1', ad_name: 'AD', date: '2026-05-30', spend_cad: 25, impressions: 500, clicks: 10, conversions: 0, conversion_value_cad: 0 }],
    });
    const upsertCampaignsDaily = vi.fn();
    const upsertAdsDaily = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics: fetcher,
      getHotCampaignIds: getHotCampaign,
      getHotAdsetIds: getHotAdset,
      getHotAdIds: getHotAd,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily,
      upsertAdsDaily,
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
    });
    expect(getHotCampaign).toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalled();
    expect(upsertCampaignsDaily).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ ad_set_id: 'AS1' })]));
    expect(upsertAdsDaily).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ ad_id: 'AD1' })]));
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });

  it('hot_metrics with empty hot set: skip fetch, still mark freshness success', async () => {
    const fetcher = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics: fetcher,
      getHotCampaignIds: async () => [],
      getHotAdsetIds: async () => [],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });

  it('Phase E1.7 regression fix: empty hot set STILL calls aggregateDataDaily (pre-fetch) — early-exit must NOT pre-empt the agg RPC', async () => {
    // Pre-Phase-E1.7 history (preserved for context):
    // - Phase E1.6 (2026-05-30 ~18:30 IL) moved account-aggregate fetch
    //   to workers but the empty-hot-set early-exit pre-empted it.
    // - Phase E1.6.1 (~19:30 IL) fixed by running account-aggregate
    //   BEFORE the empty-hot-set check.
    // - Phase E1.7 (this fix, ~20:30 IL) replaces account-aggregate
    //   with the unified `agg_data_daily_for_date` RPC. The pre-fetch
    //   call is preserved (re-aggregates campaigns_daily even when no
    //   new writes happen this tick).
    const aggregateDataDaily = vi.fn().mockResolvedValue(undefined);
    const fetchHotMetrics = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics,
      getHotCampaignIds: async () => [],
      getHotAdsetIds: async () => [],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 0.5 } as never),
      recordFreshness: vi.fn(),
      upsertBuc: vi.fn(),
      aggregateDataDaily,
      nowIso: '2026-05-29T16:00:00.000Z',
    });
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    // Exactly 1 call (pre-fetch). Post-upsert call is skipped because
    // the empty-hot-set early-exit returns before upsertCampaignsDaily.
    expect(aggregateDataDaily).toHaveBeenCalledTimes(1);
    expect(aggregateDataDaily).toHaveBeenCalledWith('2026-05-29');
  });

  it('Phase E1: hot_metrics fetch rejects with 429 → recHotPair transient_error + notifyTokenFailure(meta_hot_metrics_rate_limit)', async () => {
    const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
    const recordFreshness = vi.fn().mockResolvedValue(undefined);
    const err = new Error('Meta Graph API: HTTP 429 rate limit exceeded');
    const fetchHotMetrics = vi.fn().mockRejectedValue(err);
    await expect(runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics,
      getHotCampaignIds: async () => ['C1'],
      getHotAdsetIds: async () => ['AS1'],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 1 } as never),
      recordFreshness,
      upsertBuc: vi.fn(),
      notifyTokenFailure,
      nowIso: NOW_ISO,
    })).rejects.toThrow('rate limit');
    const transientErrorCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'transient_error');
    expect(transientErrorCalls.map(c => c[0].scope).sort()).toEqual(['ad_metrics', 'campaign_metrics']);
    expect(notifyTokenFailure).toHaveBeenCalledOnce();
    expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('meta_hot_metrics_rate_limit');
  });

  it('Phase E1: hot_metrics fetch rejects with auth → notifyTokenFailure(meta_hot_metrics_auth)', async () => {
    const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
    const err = new Error('Meta Graph API: HTTP 401 OAuthException invalid access token');
    const fetchHotMetrics = vi.fn().mockRejectedValue(err);
    await expect(runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics,
      getHotCampaignIds: async () => ['C1'],
      getHotAdsetIds: async () => ['AS1'],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 1 } as never),
      recordFreshness: vi.fn(),
      upsertBuc: vi.fn(),
      notifyTokenFailure,
      nowIso: NOW_ISO,
    })).rejects.toThrow('invalid access token');
    expect(notifyTokenFailure).toHaveBeenCalledOnce();
    expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('meta_hot_metrics_auth');
  });

  it('Phase E1.7 (2026-05-30 night): hot_metrics calls aggregateDataDaily twice (pre-fetch + post-upsert) for today', async () => {
    const aggregateDataDaily = vi.fn().mockResolvedValue(undefined);
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn().mockResolvedValue({ adsets: [], ads: [] }),
      getHotCampaignIds: async () => ['C1'],
      getHotAdsetIds: async () => ['AS1'],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 0.5 } as never),
      recordFreshness: vi.fn(),
      upsertBuc: vi.fn(),
      aggregateDataDaily,
      nowIso: '2026-05-29T16:00:00.000Z',
    });
    // Once pre-fetch (before empty-hot-set check) + once post-upserts
    // (after upsertCampaignsDaily + upsertAdsDaily, before recHotPair).
    expect(aggregateDataDaily).toHaveBeenCalledTimes(2);
    expect(aggregateDataDaily).toHaveBeenNthCalledWith(1, '2026-05-29');
    expect(aggregateDataDaily).toHaveBeenNthCalledWith(2, '2026-05-29');
  });

  it('Phase E1.7: pre-fetch aggregateDataDaily soft-fails (log + continue); hot_metrics still records success', async () => {
    const aggregateDataDaily = vi.fn()
      .mockRejectedValueOnce(new Error('RPC transient'))
      .mockResolvedValue(undefined);
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn().mockResolvedValue({ adsets: [], ads: [] }),
      getHotCampaignIds: async () => ['C1'],
      getHotAdsetIds: async () => [],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 0.5 } as never),
      recordFreshness,
      upsertBuc: vi.fn(),
      aggregateDataDaily,
      nowIso: '2026-05-29T16:00:00.000Z',
    });
    // Pre-fetch call (rejected) logs warning + continues. Post-upsert
    // call (resolved) succeeds. Both campaign_metrics + ad_metrics
    // recHotPair('success') still fires.
    expect(aggregateDataDaily).toHaveBeenCalledTimes(2);
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'campaign_metrics', status: 'success',
    }));
  });

  it('Phase E1: BUC budget_skip fires notifyTokenFailure(meta_hot_metrics_budget_skip)', async () => {
    const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
    const recordFreshness = vi.fn().mockResolvedValue(undefined);
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 90 },
      bucProbe: async () => ({ etaMinutes: 5, pct: 92 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn(),
      getHotCampaignIds: async () => [],
      getHotAdsetIds: async () => [],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      notifyTokenFailure,
      nowIso: NOW_ISO,
    });
    const budgetSkipCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'budget_skip');
    expect(budgetSkipCalls.length).toBeGreaterThan(0);
    expect(notifyTokenFailure).toHaveBeenCalledOnce();
    const call = notifyTokenFailure.mock.calls[0][0];
    expect(call.provider).toBe('meta');
    expect(call.storeId).toBe('uzoshop');
    expect(call.operation).toBe('meta_hot_metrics_budget_skip');
    expect(call.errorMsg).toMatch(/ETA=5/);
  });
});
