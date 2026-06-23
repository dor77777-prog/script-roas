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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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

  // P1-12 (2026-06-10): the status branch previously had NO try/catch — a
  // thrown fetch (including metaStatus.asArray's new throw-on-batch-part-error)
  // left zero freshness rows and, worse, a swallowed inner error fell through
  // to the unconditional success write. Now it mirrors its google/tiktok
  // siblings: transient_error per scope + re-throw (Inngest retries).
  it('P1-12: status fetchStatus rejects → records transient_error for all 3 status scopes, then re-throws', async () => {
    const err = new Error('Meta status batch part failed (code=500): {"error":{"message":"throttled"}}');
    const fetchStatus = vi.fn().mockRejectedValue(err);
    const upsertRegistry = vi.fn();
    const recordFreshness = vi.fn();
    await expect(runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 900, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry,
      insertStatusEvents: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      isMetaConfigured: () => true,
      nowIso: NOW_ISO,
    })).rejects.toThrow('throttled');
    // Nothing was upserted (the failure happened at fetch)…
    expect(upsertRegistry).not.toHaveBeenCalled();
    // …and the operator panel sees transient_error for ALL 3 status scopes
    // (previously: zero rows + Inngest retry with no panel signal).
    const transientCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'transient_error');
    expect(transientCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
    expect(transientCalls.every(c => /throttled/.test(c[0].errorMessage))).toBe(true);
    // No false-green: zero success rows.
    expect(recordFreshness.mock.calls.some(c => c[0].status === 'success')).toBe(false);
  });

  it('P1-12: status upsertRegistry rejects mid-pipeline → transient_error ×3 + re-throw (no success rows)', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      campaigns: [freshCampaign('C1', 'ACTIVE')],
      adsets: [], ads: [],
      bucUsage: {
        ads_insights_call_pct: 12, ads_insights_cputime_pct: 5, ads_insights_time_pct: 5, ads_insights_eta_minutes: 0,
        ads_management_call_pct: 7, ads_management_cputime_pct: 2, ads_management_time_pct: 2, ads_management_eta_minutes: 0,
      },
    });
    const recordFreshness = vi.fn();
    await expect(runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 900, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn().mockRejectedValue(new Error('campaign_registry upsert: connection reset')),
      insertStatusEvents: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      isMetaConfigured: () => true,
      nowIso: NOW_ISO,
    })).rejects.toThrow('connection reset');
    const transientCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'transient_error');
    expect(transientCalls).toHaveLength(3);
    expect(recordFreshness.mock.calls.some(c => c[0].status === 'success')).toBe(false);
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
      isMetaConfigured: () => true,
      nowIso: NOW_ISO,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('runMetaWorkerJob() — not configured (no Meta creds, MF-1 Phase 6a)', () => {
  // A self-serve store added WITHOUT Meta (a supported wizard option — the
  // POST writes Meta secrets only `if (meta)` and never creates a meta
  // `store_ad_state` row) has no META_AD_ACCOUNT_ID. The orchestrator still
  // naively fans out a meta/job.requested for every (store, platform, scope)
  // combo. Before MF-1 there was NO "is Meta configured?" gate — the status
  // branch resolved empty creds and drove an unguarded Graph batch with an
  // empty access_token → metaStatus.ts threw → Inngest retried/failed EVERY
  // 10-min tick and Meta freshness was never green. The gate makes the
  // not-configured store a no-op + freshness success, mirroring Google/TikTok.

  it('status: not configured → skips fetch, records 3 success freshness rows, never calls fetchStatus', async () => {
    const fetchStatus = vi.fn();
    const upsertRegistry = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'newstore', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
      bucProbe: async () => ({ pct: 0, etaMinutes: 0 }),
      fetchStatus,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry,
      insertStatusEvents: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
      isMetaConfigured: () => false,
    });
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(upsertRegistry).not.toHaveBeenCalled();
    const scopes = recordFreshness.mock.calls.map(c => c[0].scope).sort();
    expect(scopes).toEqual(['ad_status', 'adset_status', 'campaign_status']);
    expect(recordFreshness.mock.calls.every(c => c[0].status === 'success')).toBe(true);
  });

  it('hot_metrics: not configured → skips fetch, records 2 success freshness rows, never calls fetchHotMetrics', async () => {
    const fetchHotMetrics = vi.fn();
    const upsertCampaignsDaily = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'newstore', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      bucProbe: async () => ({ pct: 0, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics,
      getHotCampaignIds: async () => ['C1'],
      getHotAdsetIds: async () => ['AS1'],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily,
      upsertAdsDaily: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
      isMetaConfigured: () => false,
    });
    expect(fetchHotMetrics).not.toHaveBeenCalled();
    expect(upsertCampaignsDaily).not.toHaveBeenCalled();
    const scopes = recordFreshness.mock.calls.map(c => c[0].scope).sort();
    expect(scopes).toEqual(['ad_metrics', 'campaign_metrics']);
    expect(recordFreshness.mock.calls.every(c => c[0].status === 'success')).toBe(true);
  });

  // ZERO REGRESSION for the 3 live Meta stores: a configured store (gate true)
  // must still run the full fetch path, byte-identically. This is the guard
  // that proves uzoshop/zolplus/usmile360 are unaffected.
  it('status: configured (isMetaConfigured=true) → still runs full fetch path (zero-regression)', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({
      campaigns: [freshCampaign('C1', 'ACTIVE')],
      adsets: [],
      ads: [],
      bucUsage: {
        ads_insights_call_pct: 12, ads_insights_cputime_pct: 5, ads_insights_time_pct: 5, ads_insights_eta_minutes: 0,
        ads_management_call_pct: 7, ads_management_cputime_pct: 2, ads_management_time_pct: 2, ads_management_eta_minutes: 0,
      },
    });
    const upsertRegistry = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'status', tick_id: 'T', staleness_seconds: 900, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry,
      insertStatusEvents: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
      isMetaConfigured: () => true,
    });
    expect(fetchStatus).toHaveBeenCalled();
    expect(upsertRegistry).toHaveBeenCalledWith(expect.objectContaining({ table: 'campaign_registry' }));
    const successCalls = recordFreshness.mock.calls.filter(c => c[0].status === 'success');
    expect(successCalls.map(c => c[0].scope).sort()).toEqual(['ad_status', 'adset_status', 'campaign_status']);
  });

  it('hot_metrics: configured (isMetaConfigured=true) → still runs full fetch path (zero-regression)', async () => {
    const fetchHotMetrics = vi.fn().mockResolvedValue({
      adsets: [{ store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', campaign_name: 'C', ad_set_id: 'AS1', ad_set_name: 'AS', date: '2026-05-30', spend_cad: 25, impressions: 500, clicks: 10, conversions: 0, conversion_value_cad: 0 }],
      ads: [],
    });
    const upsertCampaignsDaily = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
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
      upsertCampaignsDaily,
      upsertAdsDaily: vi.fn(),
      getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 1 } as never),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
      isMetaConfigured: () => true,
    });
    expect(fetchHotMetrics).toHaveBeenCalled();
    expect(upsertCampaignsDaily).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ ad_set_id: 'AS1' })]));
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({ scope: 'campaign_metrics', status: 'success' }));
  });

  // Phase 6a regression: a DB-only-cred store (the configured-gate resolves
  // true via an ASYNC dual-read, env absent) must NOT be skipped. Also proves
  // the worker AWAITS an async injected gate (a missing await would leave a
  // truthy Promise → every store wrongly "configured" → no skip ever).
  it('status: ASYNC gate returning false (DB-aware, no creds anywhere) → worker skips, does NOT fetch', async () => {
    const fetchStatus = vi.fn();
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'newstore', scope: 'status', tick_id: 'T', staleness_seconds: 600, budget_pct_estimate: 0 },
      bucProbe: async () => ({ pct: 0, etaMinutes: 0 }),
      fetchStatus,
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      recordFreshness,
      upsertBuc: vi.fn(),
      nowIso: NOW_ISO,
      // DB-aware gate resolved FALSE (no creds in DB or env) — async on purpose.
      isMetaConfigured: async () => false,
    });
    expect(fetchStatus).not.toHaveBeenCalled();
    const scopes = recordFreshness.mock.calls.map(c => c[0].scope).sort();
    expect(scopes).toEqual(['ad_status', 'adset_status', 'campaign_status']);
    expect(recordFreshness.mock.calls.every(c => c[0].status === 'success')).toBe(true);
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
      notifyTokenFailure,
      nowIso: NOW_ISO,
    })).rejects.toThrow('invalid access token');
    expect(notifyTokenFailure).toHaveBeenCalledOnce();
    expect(notifyTokenFailure.mock.calls[0][0].operation).toBe('meta_hot_metrics_auth');
    // Real token failure keeps the refresh-the-token guidance.
    expect(String(notifyTokenFailure.mock.calls[0][0].advice)).toMatch(/refresh.*access token/i);
  });

  // 2026-06-23 — transient classification at the hot_metrics catch. Meta wraps
  // EVERY Graph error in type:OAuthException, so a transient code 2 "Service
  // temporarily unavailable" (subcode 1504044) must NOT be alerted as an auth
  // failure with "refresh the token" advice — it self-heals on the next tick.
  it('hot_metrics fetch rejects with code 2 "Service temporarily unavailable" → transient alert, NOT auth, no refresh advice', async () => {
    const notifyTokenFailure = vi.fn().mockResolvedValue(undefined);
    const err = new Error(
      'Meta hot-metrics batch part failed (code=400): {"error":{"message":"Service temporarily unavailable","type":"OAuthException","is_transient":false,"code":2,"error_subcode":1504044}}',
    );
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
      isMetaConfigured: () => true,
      notifyTokenFailure,
      nowIso: NOW_ISO,
    })).rejects.toThrow('Service temporarily unavailable');
    expect(notifyTokenFailure).toHaveBeenCalledOnce();
    const call = notifyTokenFailure.mock.calls[0][0];
    // Must NOT be branded a token/auth failure.
    expect(call.operation).not.toBe('meta_hot_metrics_auth');
    expect(String(call.operation)).not.toMatch(/auth/i);
    // Must NOT advise refreshing the access token.
    expect(String(call.advice)).not.toMatch(/refresh.*access token/i);
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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
      isMetaConfigured: () => true,
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
