// dashboard-web/src/inngest/functions/tiktokWorker.ts
//
// Phase C — consumes tiktok/job.requested events emitted by
// cron-tick-orchestrator. Handles both `scope='status'` (registry
// discovery via paginated /campaign|adgroup|ad/get/) and
// `scope='hot_metrics'` (per-hot-id metrics refresh into campaigns_daily
// + ads_daily, tagged source='live_tick').
//
// Mirrors the structure of `googleWorker.ts` (Phase C Task 7) and
// `metaWorker.ts` (Phase B + Phase C Task 4), minus the Meta-specific
// BUC pre-flight gate. TikTok's API has its own QPS limits surfaced as
// HTTP 429 / `code !== 0` envelopes — Inngest's exponential-backoff
// retry layer handles transient throttling instead of an explicit
// pre-call probe.
//
// Phase A.5 mapping awareness: both fetchers need a `campaignStoreMap`
// (loaded once per event from `dashboard_state`) so multi-store
// advertisers attribute per-row store_id correctly. The worker loads
// the map before either branch's fetch call.
//
// Flow per event (status):
//   1. Load campaign-store-map (Phase A.5).
//   2. Resolve TikTok account (advertiser_id + access_token + currency)
//      via `getTikTokAccountForStore`.
//   3. Fetch via fetchTikTokStatusForStore (paginated list of campaigns,
//      adgroups, ads). Returns full registry rows resolved through the
//      store-map.
//   4. Load prior registry rows (filter platform='tiktok') → diff →
//      emit StatusEventInsert per transition.
//   5. Upsert all 3 registries with buildRegistryUpsertRow rules.
//   6. Mark data_freshness success for campaign_status + adset_status + ad_status.
//
// Flow per event (hot_metrics):
//   1. Load campaign-store-map + TikTok account.
//   2. Load hot ids via Phase C Task 2 RPC helpers.
//   3. Empty hot set → mark BOTH campaign_metrics AND ad_metrics
//      freshness success (IMP-C) and return (nothing to refresh).
//   4. Fetch via fetchTikTokHotMetricsForStore for today, passing
//      accountCurrency (CRIT-E TikTok parallel) + getFxCadFor.
//   5. Upsert campaigns_daily (adsets only, per CRIT-B) + ads_daily,
//      tagged source='live_tick' + last_live_tick_at = nowIso.
//   6. Mark data_freshness success for BOTH scopes.
//
// The pure `runTikTokWorkerJob` is exported so vitest can drive it with
// mocked deps; the Inngest binding wraps it in a single `step.run` per
// Phase B retry-safety convention.

import { inngest } from '@/inngest/client';
import { TIKTOK_JOB_REQUESTED } from '@/lib/registries/eventNames';
import { recordFreshness } from '@/lib/inngest/freshness';
import { fetchTikTokStatusForStore } from '@/lib/fetchers/tiktokStatus';
import type { TikTokStatusInput, TikTokStatusResult } from '@/lib/fetchers/tiktokStatus';
import { fetchTikTokHotMetricsForStore } from '@/lib/fetchers/tiktokHotMetrics';
import type { TikTokHotMetricsInput, TikTokHotMetricsResult } from '@/lib/fetchers/tiktokHotMetrics';
import {
  getTikTokAccountForStore,
  getTikTokFxCadAdapterForStore,
  isTikTokConfiguredForStore,
  type TikTokAccountConfig,
} from '@/lib/fetchers/tiktokAccountConfig';
import { loadCampaignStoreMapFromSupabase } from '@/lib/inngest/campaignStoreMap';
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

export type RunTikTokWorkerJobInput = {
  jobData: JobRequestedEvent;
  /**
   * Loads the campaign-store-map (Phase A.5) from dashboard_state. Pure
   * core receives this as a dependency so vitest can pass `async () => ({})`
   * without touching Supabase.
   */
  loadStoreMap: () => Promise<Record<string, string>>;
  /**
   * fetchStatus signature matches `fetchTikTokStatusForStore`. The pure
   * core builds the input lazily — when vitest passes a `vi.fn()` the
   * account-adapter env-var lookups go through `safeAccount`, which
   * swallows missing-env-var errors ONLY when `process.env.VITEST` is
   * set. In production those errors propagate so Inngest records a
   * retryable failure instead of a false freshness-success.
   */
  fetchStatus: (input: TikTokStatusInput) => Promise<TikTokStatusResult>;
  fetchHotMetrics: (input: TikTokHotMetricsInput) => Promise<TikTokHotMetricsResult>;
  /**
   * Phase C hot-set helpers. The TikTok adapter exposes the field name
   * `getHotAdgroupIds` (TikTok terminology) but internally calls the
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
    platform: 'tiktok';
    scope: string;
    tableName: string;
    status: 'success' | 'budget_skip' | 'transient_error';
    errorMessage?: string;
  }) => Promise<void>;
  nowIso: string;
  /**
   * Optional account resolver. When omitted (production), the pure core
   * resolves the TikTok account via `getTikTokAccountForStore`. Tests
   * pass stubbed fetchStatus / fetchHotMetrics so the synthetic account
   * is never used.
   */
  getAccount?: (storeId: StoreId) => Promise<TikTokAccountConfig>;
  /**
   * Optional FX adapter — production resolves via
   * `getTikTokFxCadAdapterForStore`. Tests never exercise this path
   * because fetchHotMetrics is stubbed.
   */
  getFxCadFor?: (storeId: StoreId) => Promise<TikTokHotMetricsInput['getFxCadFor']>;
  /**
   * Phase C soak fix (2026-05-30): optional override of the per-store
   * "is TikTok configured?" check. Defaults to `isTikTokConfiguredForStore`
   * (env-var presence of `${UPPER}_TIKTOK_ADVERTISER_ID` +
   * `${UPPER}_TIKTOK_ACCESS_TOKEN`). When false the worker no-ops and
   * records `success` freshness for every scope.
   *
   * Per ARCHITECTURE.md §5.4 + the operator confirmation 2026-05-30:
   * there is ONE TikTok ad account (uzoshop's). It serves multiple stores
   * via TikTok's per-ad pixel selection — operator uploads an ad and
   * picks the pixel matching the destination store. The Phase A.5 v2
   * `campaign-store-map` then attributes each campaign to the right
   * store at write time. The dedicated workers for usmile360/zolplus
   * therefore have nothing to do; uzoshop's worker writes their rows
   * via the map. Without this gate, every tick threw on missing env vars
   * and the operator panel stayed permanently empty for those rows.
   */
  isTikTokConfigured?: (storeId: StoreId) => boolean;
};

function checkTikTokConfigured(
  storeId: StoreId,
  override?: (storeId: StoreId) => boolean,
): boolean {
  if (override) return override(storeId);
  return isTikTokConfiguredForStore(storeId);
}

async function safeAccount(
  storeId: StoreId,
  override?: RunTikTokWorkerJobInput['getAccount'],
): Promise<TikTokAccountConfig> {
  if (override) return override(storeId);
  try {
    return await getTikTokAccountForStore(storeId);
  } catch (err) {
    // In vitest, the test never exercises the account (fetchStatus is
    // mocked), so a no-op stub keeps tests free of OAuth env-var setup.
    // In production, missing env vars are a real misconfig — rethrow so
    // Inngest's retry machinery records the failure (and the next
    // successful tick writes a freshness row). Swallowing here would
    // mask misconfigured stores as freshness-success, which is worse
    // than a loud transient error.
    if (process.env.VITEST) {
      return { advertiserId: '', accessToken: '', accountCurrency: 'USD' };
    }
    throw err;
  }
}

async function safeFxCadFor(
  storeId: StoreId,
  override?: RunTikTokWorkerJobInput['getFxCadFor'],
): Promise<TikTokHotMetricsInput['getFxCadFor']> {
  if (override) return override(storeId);
  try {
    return await getTikTokFxCadAdapterForStore(storeId);
  } catch (err) {
    // In vitest the fetch is stubbed and the test never exercises FX, so
    // a no-op stub keeps tests free of network setup. In production
    // getTikTokFxCadAdapterForStore does no I/O at construction so
    // hitting this catch is exceptional — but if it ever does throw, a
    // real error should not be swallowed into an identity-zero rate.
    // Rethrow so Inngest's retry machinery records the failure, mirroring
    // safeCustomer in googleWorker.ts.
    if (process.env.VITEST) {
      return async () => 0;
    }
    throw err;
  }
}

export async function runTikTokWorkerJob(input: RunTikTokWorkerJobInput): Promise<void> {
  const { jobData } = input;
  if (jobData.scope === 'status') {
    return await runTikTokStatusBranch(input);
  }
  if (jobData.scope === 'hot_metrics') {
    return await runTikTokHotMetricsBranch(input);
  }
  // Unknown scope — silently no-op (orchestrator may emit future scopes
  // ahead of worker support).
}

async function runTikTokStatusBranch(input: RunTikTokWorkerJobInput): Promise<void> {
  const { jobData, recordFreshness: rec } = input;
  const storeId = jobData.store_id;

  const recAllStatusScopes = async (
    status: 'success' | 'transient_error',
    errorMessage?: string,
  ): Promise<void> => {
    for (const s of ['campaign_status', 'adset_status', 'ad_status'] as const) {
      await rec({
        storeId,
        platform: 'tiktok',
        scope: s,
        tableName: registryNameForScope(s),
        status,
        errorMessage,
      });
    }
  };

  // Phase C soak: stores without their own TikTok account (usmile360 +
  // zolplus per the shared-account architecture, ARCHITECTURE.md §5.4)
  // record freshness success and return. uzoshop's worker writes any
  // tenant rows via the Phase A.5 v2 campaign-store-map.
  if (!checkTikTokConfigured(storeId, input.isTikTokConfigured)) {
    await recAllStatusScopes('success');
    return;
  }

  try {
    const {
      loadStoreMap,
      fetchStatus,
      loadPriorRegistry,
      upsertRegistry,
      insertStatusEvents,
      getAccount,
      nowIso,
    } = input;

    // 1. Load campaign-store-map (Phase A.5) BEFORE fetch so the fetcher
    //    resolves per-row store_id during the same call.
    const campaignStoreMap = await loadStoreMap();

    // 2. Resolve TikTok account (advertiser_id + access_token + currency).
    const account = await safeAccount(storeId, getAccount);

    // 3. Fetch status — paginated list of campaigns + adgroups + ads.
    const status = await fetchStatus({
      storeId,
      advertiserId: account.advertiserId,
      accessToken: account.accessToken,
      campaignStoreMap,
    });

    // 4. Load prior registry rows for the diff (platform='tiktok').
    const prior = await loadPriorRegistry(storeId);

    // 5. Diff → status events (one per genuine transition; cosmetic
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

    // 6. Upsert all 3 registries. buildRegistryUpsertRow preserves
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

    // 7. Mark freshness success for all 3 scopes.
    await recAllStatusScopes('success');
  } catch (err) {
    // Phase C soak: surface failure to the operator panel by writing a
    // transient_error row per scope BEFORE re-throwing. Re-throw
    // preserves Inngest's exponential-backoff retry.
    const message = err instanceof Error ? err.message : String(err);
    await recAllStatusScopes('transient_error', message);
    throw err;
  }
}

function registryNameForScope(scope: 'campaign_status' | 'adset_status' | 'ad_status'): string {
  if (scope === 'campaign_status') return 'campaign_registry';
  if (scope === 'adset_status') return 'adset_registry';
  return 'ad_registry';
}

async function runTikTokHotMetricsBranch(input: RunTikTokWorkerJobInput): Promise<void> {
  const { jobData, recordFreshness: rec } = input;
  const storeId = jobData.store_id;

  // IMP-C: every hot_metrics outcome records BOTH campaign_metrics
  // (campaigns_daily lag) AND ad_metrics (ads_daily lag) freshness rows.
  // Without the second write the ads_daily lag was invisible in the
  // operator panel.
  const recHotPair = async (
    status: 'success' | 'budget_skip' | 'transient_error',
    errorMessage?: string,
  ): Promise<void> => {
    await rec({
      storeId,
      platform: 'tiktok',
      scope: 'campaign_metrics',
      tableName: 'campaigns_daily',
      status,
      errorMessage,
    });
    await rec({
      storeId,
      platform: 'tiktok',
      scope: 'ad_metrics',
      tableName: 'ads_daily',
      status,
      errorMessage,
    });
  };

  // Phase C soak: stores without their own TikTok account record success
  // and return. Note: this gate is required EVEN with the hot-set empty
  // short-circuit below, because tenants in the Phase A.5 v2 map (e.g.
  // usmile360) may have campaign_registry rows written by uzoshop's
  // worker → getHotCampaignIds returns non-empty → without this check,
  // safeAccount would throw on missing env vars and no freshness row
  // would be recorded.
  if (!checkTikTokConfigured(storeId, input.isTikTokConfigured)) {
    await recHotPair('success');
    return;
  }

  try {
    const {
      loadStoreMap,
      fetchHotMetrics,
      getHotCampaignIds,
      getHotAdgroupIds,
      getHotAdIds,
      upsertCampaignsDaily,
      upsertAdsDaily,
      getAccount,
      getFxCadFor,
      nowIso,
    } = input;

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
      await recHotPair('success');
      return;
    }

    // 3. Load campaign-store-map + resolve account + FX adapter.
    const [campaignStoreMap, account, fxCadFor] = await Promise.all([
      loadStoreMap(),
      safeAccount(storeId, getAccount),
      safeFxCadFor(storeId, getFxCadFor),
    ]);
    const today = nowIso.slice(0, 10);
    const metrics = await fetchHotMetrics({
      storeId,
      advertiserId: account.advertiserId,
      accessToken: account.accessToken,
      accountCurrency: account.accountCurrency,
      hotCampaignIds: hotCampaign,
      hotAdgroupIds: hotAdgroup,
      hotAdIds: hotAd,
      dateStr: today,
      campaignStoreMap,
      getFxCadFor: fxCadFor,
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

    // 5. Mark freshness success for both campaign_metrics + ad_metrics.
    await recHotPair('success');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recHotPair('transient_error', message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Inngest binding — mirrors googleWorker's `triggers: [...]` style.
// Concurrency=1 per store prevents overlapping refreshes on the same
// TikTok advertiser (the Marketing API would 429 anyway). Throttle
// 1500/h per store gives the worker generous headroom — TikTok's
// documented per-advertiser QPS is well above what a 10-min orchestrator
// would generate, so the cap mainly protects against bug-induced bursts.
// ---------------------------------------------------------------------------

export const tiktokWorker = inngest.createFunction(
  {
    id: 'tiktok-worker',
    triggers: [{ event: TIKTOK_JOB_REQUESTED }],
    concurrency: [{ key: 'event.data.store_id', limit: 1 }],
    throttle: { limit: 1500, period: '1h', key: 'event.data.store_id' },
  },
  async ({ event, step }) => {
    await step.run('runTikTokWorkerJob', async () => {
      const nowIso = new Date().toISOString();
      const sb = getSupabaseAdmin();
      const data = event.data as unknown as JobRequestedEvent;
      const storeId = data.store_id;

      const loadPriorRegistry = async (): Promise<PriorMaps> => {
        const [c, a, ad] = await Promise.all([
          sb.from('campaign_registry').select('*').eq('store_id', storeId).eq('platform', 'tiktok'),
          sb.from('adset_registry').select('*').eq('store_id', storeId).eq('platform', 'tiktok'),
          sb.from('ad_registry').select('*').eq('store_id', storeId).eq('platform', 'tiktok'),
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

      await runTikTokWorkerJob({
        jobData: data,
        loadStoreMap: loadCampaignStoreMapFromSupabase,
        fetchStatus: fetchTikTokStatusForStore,
        fetchHotMetrics: fetchTikTokHotMetricsForStore,
        getHotCampaignIds: (sid: StoreId) =>
          getHotCampaignIdsHelper({ admin: sb, storeId: sid, platform: 'tiktok' }),
        getHotAdgroupIds: (sid: StoreId) =>
          getHotAdsetIdsHelper({ admin: sb, storeId: sid, platform: 'tiktok' }),
        getHotAdIds: (sid: StoreId) =>
          getHotAdIdsHelper({ admin: sb, storeId: sid, platform: 'tiktok' }),
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
