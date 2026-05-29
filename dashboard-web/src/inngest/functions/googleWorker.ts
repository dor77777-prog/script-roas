// dashboard-web/src/inngest/functions/googleWorker.ts
//
// Phase C — consumes google/job.requested events emitted by
// cron-tick-orchestrator. Handles both `scope='status'` (registry
// discovery via change_status + entity follow-up) and
// `scope='hot_metrics'` (per-hot-id metrics refresh into campaigns_daily
// + ads_daily, tagged source='live_tick').
//
// Mirrors the structure of `metaWorker.ts` (Phase B + Phase C task 4),
// minus the Meta-specific BUC pre-flight gate. Google Ads has different
// quota/throttling semantics — Inngest's exponential-backoff retry layer
// handles transient 429/RESOURCE_EXHAUSTED responses surfaced by
// runGaqlQuery instead of an explicit pre-call probe.
//
// Flow per event (status):
//   1. Fetch via fetchGoogleStatusForStore (single batched change_status +
//      entity follow-up). Returns full status rows for changed entities
//      only — empty arrays when nothing changed in the last 24h.
//   2. Load prior registry rows (filter platform='google') → diff →
//      emit StatusEventInsert per transition.
//   3. Upsert all 3 registries with buildRegistryUpsertRow rules.
//   4. Mark data_freshness success for campaign_status + adset_status + ad_status.
//
// Flow per event (hot_metrics):
//   1. Load hot ids via Phase C Task 2 RPC helpers.
//   2. Empty hot set → mark freshness success and return (nothing to refresh).
//   3. Fetch via fetchGoogleHotMetricsForStore for today.
//   4. Upsert campaigns_daily (campaigns + adsets) + ads_daily, tagged
//      source='live_tick' + last_live_tick_at = nowIso.
//   5. Mark data_freshness.campaign_metrics = success.
//
// The pure `runGoogleWorkerJob` is exported so vitest can drive it with
// mocked deps; the Inngest binding wraps it in a single `step.run` per
// Phase B retry-safety convention.

import { inngest } from '@/inngest/client';
import { GOOGLE_JOB_REQUESTED } from '@/lib/registries/eventNames';
import { recordFreshness } from '@/lib/inngest/freshness';
import { fetchGoogleStatusForStore } from '@/lib/fetchers/googleStatus';
import type { GoogleStatusInput, GoogleStatusResult } from '@/lib/fetchers/googleStatus';
import { fetchGoogleHotMetricsForStore } from '@/lib/fetchers/googleHotMetrics';
import type { GoogleHotMetricsInput, GoogleHotMetricsResult } from '@/lib/fetchers/googleHotMetrics';
import { getGoogleCustomerForStore } from '@/lib/fetchers/googleAccountConfig';
import { diffAgainstRegistry } from '@/lib/registries/diff';
import {
  buildRegistryUpsertRow,
  insertStatusEventsBatch,
  upsertRegistryBatch,
} from '@/lib/registries/upsert';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getHotCampaignIds as getHotCampaignIdsHelper,
  getHotAdsetIds as getHotAdsetIdsHelper,
  getHotAdIds as getHotAdIdsHelper,
} from '@/lib/registries/hotSet';
import type {
  AdRegistryRow,
  AdsetRegistryRow,
  CampaignRegistryRow,
  JobRequestedEvent,
  StatusEventInsert,
  StoreId,
} from '@/lib/registries/types';

type PriorMaps = {
  campaigns: Map<string, CampaignRegistryRow>;
  adsets: Map<string, AdsetRegistryRow>;
  ads: Map<string, AdRegistryRow>;
};

export type RunGoogleWorkerJobInput = {
  jobData: JobRequestedEvent;
  /**
   * fetchStatus signature matches `fetchGoogleStatusForStore`. The pure
   * core builds the input lazily — when vitest passes a `vi.fn()` the
   * customer-adapter env-var lookups go through `safeCustomer`, which
   * swallows missing-env-var errors ONLY when `process.env.VITEST` is
   * set. In production those errors propagate so Inngest records a
   * retryable failure instead of a false freshness-success.
   */
  fetchStatus: (input: GoogleStatusInput) => Promise<GoogleStatusResult>;
  fetchHotMetrics: (input: GoogleHotMetricsInput) => Promise<GoogleHotMetricsResult>;
  /**
   * Phase C hot-set helpers. The Google adapter exposes the field name
   * `getHotAdgroupIds` (Google terminology) but internally calls the
   * same `getHotAdsetIds` RPC because `adset_registry` is the unified
   * table for all platforms.
   */
  getHotCampaignIds: (storeId: StoreId) => Promise<string[]>;
  getHotAdgroupIds: (storeId: StoreId) => Promise<string[]>;
  getHotAdIds: (storeId: StoreId) => Promise<string[]>;
  loadPriorRegistry: (storeId: StoreId) => Promise<PriorMaps>;
  upsertRegistry: (input: { table: 'campaign_registry' | 'adset_registry' | 'ad_registry'; rows: unknown[] }) => Promise<void>;
  insertStatusEvents: (input: { events: StatusEventInsert[] }) => Promise<void>;
  upsertCampaignsDaily: (rows: Array<Record<string, unknown>>) => Promise<void>;
  upsertAdsDaily: (rows: Array<Record<string, unknown>>) => Promise<void>;
  recordFreshness: (input: {
    storeId: StoreId;
    platform: 'google';
    scope: string;
    tableName: string;
    status: 'success' | 'budget_skip' | 'transient_error';
    errorMessage?: string;
  }) => Promise<void>;
  nowIso: string;
  /**
   * Optional credential/customer resolver. When omitted (production), the
   * pure core resolves the Google customer via
   * `getGoogleCustomerForStore`. Tests pass stubbed fetchStatus /
   * fetchHotMetrics so the synthetic customer is never used.
   */
  getCustomer?: (storeId: StoreId) => Promise<{
    searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>>;
  }>;
};

async function safeCustomer(
  storeId: StoreId,
  override?: RunGoogleWorkerJobInput['getCustomer'],
): Promise<{ searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>> }> {
  if (override) return override(storeId);
  try {
    return await getGoogleCustomerForStore(storeId);
  } catch (err) {
    // In vitest, the test never exercises the customer (fetchStatus is
    // mocked), so a no-op stub keeps tests free of OAuth env-var setup.
    // In production, missing env vars are a real misconfig — rethrow so
    // Inngest's retry machinery records the failure (and the next
    // successful tick writes a freshness row). Swallowing here would
    // mask misconfigured stores as freshness-success, which is worse
    // than a loud transient error.
    if (process.env.VITEST) {
      return {
        searchStream: async () => [],
      };
    }
    throw err;
  }
}

export async function runGoogleWorkerJob(input: RunGoogleWorkerJobInput): Promise<void> {
  const { jobData } = input;
  if (jobData.scope === 'status') {
    return await runGoogleStatusBranch(input);
  }
  if (jobData.scope === 'hot_metrics') {
    return await runGoogleHotMetricsBranch(input);
  }
  // Unknown scope — silently no-op (orchestrator may emit future scopes
  // ahead of worker support).
}

async function runGoogleStatusBranch(input: RunGoogleWorkerJobInput): Promise<void> {
  const {
    jobData,
    fetchStatus,
    loadPriorRegistry,
    upsertRegistry,
    insertStatusEvents,
    recordFreshness: rec,
    getCustomer,
    nowIso,
  } = input;
  const storeId = jobData.store_id;

  // 1. Resolve customer + fetch — `fetchGoogleStatusForStore` runs a
  //    change_status discovery query then entity follow-ups for
  //    CAMPAIGN / AD_GROUP / AD_GROUP_AD types.
  const customer = await safeCustomer(storeId, getCustomer);
  const status = await fetchStatus({ storeId, customer });

  // 2. Load prior registry rows for the diff (platform='google').
  const prior = await loadPriorRegistry(storeId);

  // 3. Diff → status events (one per genuine transition; cosmetic
  //    edits like name changes do NOT emit events).
  const campaignEvents = diffAgainstRegistry({
    entityType: 'campaign',
    prior: prior.campaigns,
    fresh: status.campaigns,
    occurredAt: nowIso,
  });
  const adsetEvents = diffAgainstRegistry({
    entityType: 'adset',
    prior: prior.adsets as Map<string, CampaignRegistryRow>,
    fresh: status.adsets as CampaignRegistryRow[],
    occurredAt: nowIso,
  });
  const adEvents = diffAgainstRegistry({
    entityType: 'ad',
    prior: prior.ads as Map<string, CampaignRegistryRow>,
    fresh: status.ads as CampaignRegistryRow[],
    occurredAt: nowIso,
  });
  const allEvents = [...campaignEvents, ...adsetEvents, ...adEvents];
  if (allEvents.length > 0) {
    await insertStatusEvents({ events: allEvents });
  }

  // 4. Upsert all 3 registries. buildRegistryUpsertRow preserves
  //    first_seen_at + computes status_changed_at correctly.
  const campRows = status.campaigns.map((c) =>
    buildRegistryUpsertRow({ prior: prior.campaigns.get(c.campaign_id) ?? null, fresh: c, nowIso }),
  );
  await upsertRegistry({ table: 'campaign_registry', rows: campRows });
  const asRows = status.adsets.map((a) =>
    buildRegistryUpsertRow({ prior: prior.adsets.get(a.adset_id) ?? null, fresh: a, nowIso }),
  );
  await upsertRegistry({ table: 'adset_registry', rows: asRows });
  const adRows = status.ads.map((a) =>
    buildRegistryUpsertRow({ prior: prior.ads.get(a.ad_id) ?? null, fresh: a, nowIso }),
  );
  await upsertRegistry({ table: 'ad_registry', rows: adRows });

  // 5. Mark freshness success for all 3 scopes.
  for (const s of ['campaign_status', 'adset_status', 'ad_status'] as const) {
    await rec({
      storeId,
      platform: 'google',
      scope: s,
      tableName: registryNameForScope(s),
      status: 'success',
    });
  }
}

function registryNameForScope(scope: 'campaign_status' | 'adset_status' | 'ad_status'): string {
  if (scope === 'campaign_status') return 'campaign_registry';
  if (scope === 'adset_status') return 'adset_registry';
  return 'ad_registry';
}

async function runGoogleHotMetricsBranch(input: RunGoogleWorkerJobInput): Promise<void> {
  const {
    jobData,
    fetchHotMetrics,
    getHotCampaignIds,
    getHotAdgroupIds,
    getHotAdIds,
    upsertCampaignsDaily,
    upsertAdsDaily,
    recordFreshness: rec,
    getCustomer,
    nowIso,
  } = input;
  const storeId = jobData.store_id;

  // 1. Load hot ids in parallel.
  const [hotCampaign, hotAdgroup, hotAd] = await Promise.all([
    getHotCampaignIds(storeId),
    getHotAdgroupIds(storeId),
    getHotAdIds(storeId),
  ]);

  // 2. Empty hot set is a NORMAL state (e.g. all campaigns paused) — we
  //    still mark freshness success because the worker did its job;
  //    there was simply nothing hot to refresh.
  if (hotCampaign.length + hotAdgroup.length + hotAd.length === 0) {
    await rec({
      storeId,
      platform: 'google',
      scope: 'campaign_metrics',
      tableName: 'campaigns_daily',
      status: 'success',
    });
    return;
  }

  // 3. Resolve customer + fetch metrics for today only.
  const customer = await safeCustomer(storeId, getCustomer);
  const today = nowIso.slice(0, 10);
  const metrics = await fetchHotMetrics({
    storeId,
    customer,
    hotCampaignIds: hotCampaign,
    hotAdgroupIds: hotAdgroup,
    hotAdIds: hotAd,
    dateStr: today,
  });

  // 4. Upsert campaigns_daily (adsets only) and ads_daily, stamping
  //    source='live_tick' + last_live_tick_at on every row.
  //    CRIT-B: hot-metrics fetcher returns only adset + ad rows; the
  //    campaign-level aggregate is computed at read time by the existing
  //    aggregators (Today / Today-Live). campaigns_daily.ad_set_id is
  //    NOT NULL so we cannot insert a campaign-only row.
  if (metrics.adsets.length > 0) {
    const all: Array<Record<string, unknown>> = metrics.adsets.map((a) => ({
      ...a,
      source: 'live_tick',
      last_live_tick_at: nowIso,
    }));
    await upsertCampaignsDaily(all);
  }
  if (metrics.ads.length > 0) {
    await upsertAdsDaily(
      metrics.ads.map((a) => ({ ...a, source: 'live_tick', last_live_tick_at: nowIso })),
    );
  }

  // 5. Mark freshness success.
  await rec({
    storeId,
    platform: 'google',
    scope: 'campaign_metrics',
    tableName: 'campaigns_daily',
    status: 'success',
  });
}

// ---------------------------------------------------------------------------
// Inngest binding — mirrors metaWorker's `triggers: [...]` style.
// Concurrency=1 per store prevents overlapping refreshes on the same
// Google Ads customer (the API would 429/RESOURCE_EXHAUSTED anyway).
// Throttle 600/h per store gives the worker headroom to keep pace with a
// 10-min orchestrator without blowing past Google's per-developer-token
// daily limit.
// ---------------------------------------------------------------------------

export const googleWorker = inngest.createFunction(
  {
    id: 'google-worker',
    triggers: [{ event: GOOGLE_JOB_REQUESTED }],
    concurrency: [{ key: 'event.data.store_id', limit: 1 }],
    throttle: { limit: 600, period: '1h', key: 'event.data.store_id' },
  },
  async ({ event, step }) => {
    await step.run('runGoogleWorkerJob', async () => {
      const nowIso = new Date().toISOString();
      const sb = getSupabaseAdmin();
      const data = event.data as unknown as JobRequestedEvent;
      const storeId = data.store_id;

      const loadPriorRegistry = async (): Promise<PriorMaps> => {
        const [c, a, ad] = await Promise.all([
          sb.from('campaign_registry').select('*').eq('store_id', storeId).eq('platform', 'google'),
          sb.from('adset_registry').select('*').eq('store_id', storeId).eq('platform', 'google'),
          sb.from('ad_registry').select('*').eq('store_id', storeId).eq('platform', 'google'),
        ]);
        const cRows = (c.data ?? []) as CampaignRegistryRow[];
        const aRows = (a.data ?? []) as AdsetRegistryRow[];
        const adRows = (ad.data ?? []) as AdRegistryRow[];
        return {
          campaigns: new Map(cRows.map((r) => [r.campaign_id, r])),
          adsets: new Map(aRows.map((r) => [r.adset_id, r])),
          ads: new Map(adRows.map((r) => [r.ad_id, r])),
        };
      };

      await runGoogleWorkerJob({
        jobData: data,
        fetchStatus: fetchGoogleStatusForStore,
        fetchHotMetrics: fetchGoogleHotMetricsForStore,
        getHotCampaignIds: (sid: StoreId) =>
          getHotCampaignIdsHelper({ admin: sb, storeId: sid, platform: 'google' }),
        getHotAdgroupIds: (sid: StoreId) =>
          getHotAdsetIdsHelper({ admin: sb, storeId: sid, platform: 'google' }),
        getHotAdIds: (sid: StoreId) =>
          getHotAdIdsHelper({ admin: sb, storeId: sid, platform: 'google' }),
        loadPriorRegistry,
        upsertRegistry: async (inp) =>
          upsertRegistryBatch({
            admin: sb,
            table: inp.table,
            rows: inp.rows as never,
          }),
        insertStatusEvents: async (inp) =>
          insertStatusEventsBatch({ admin: sb, events: inp.events }),
        upsertCampaignsDaily: async (rows) => {
          if (rows.length === 0) return;
          const { error } = await sb
            .from('campaigns_daily')
            .upsert(rows, { onConflict: 'date,store_id,platform,campaign_id,ad_set_id' });
          if (error) throw new Error(`campaigns_daily upsert: ${error.message}`);
        },
        upsertAdsDaily: async (rows) => {
          if (rows.length === 0) return;
          const { error } = await sb
            .from('ads_daily')
            .upsert(rows, { onConflict: 'date,store_id,ad_id' });
          if (error) throw new Error(`ads_daily upsert: ${error.message}`);
        },
        recordFreshness: async (inp) =>
          recordFreshness({
            storeId: inp.storeId,
            platform: inp.platform,
            scope: inp.scope,
            tableName: inp.tableName,
            status: inp.status,
            errorMessage: inp.errorMessage,
          }),
        nowIso,
      });
    });
  },
);
