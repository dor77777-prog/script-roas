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
});
