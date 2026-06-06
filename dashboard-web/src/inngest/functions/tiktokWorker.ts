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
import { tiktokAccountFetchEnabled, type AdStateMap } from '@/lib/adState';
import { fetchAdStateFromPostgres } from '@/lib/postgresReaders';
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
import { isAuthError, isRateLimitError } from '@/lib/notifications/detectAuthError';
import { notifyTokenFailure } from '@/lib/notifications/tokenFailures';
import { getTodayInIsraelTz } from '@/lib/dateRange';
// Phase E1.6.1 (2026-05-30): TikTok does NOT use the bulk-date
// account-spend fetcher + cadConvert + upsertDataDailySpend path that
// Meta/Google use. Reason: there is ONE shared TikTok ad account
// (uzoshop's) serving multiple stores via per-ad pixel routing
// (Phase A.5 v2). The account-level spend from TikTok's API is the
// cross-store aggregate — writing it to one store_id's data_daily
// row would inflate that store and starve the others. The per-store
// split is owned by the SQL function `agg_tiktok_spend_per_store_for_date`
// which re-aggregates campaigns_daily (already correctly attributed
// via the campaign-store-map at write time) into data_daily.

// Phase E1.5 (2026-05-30) — TikTok's 5 "delivering / preparing" ad-group
// statuses. Mirrors the local set in cronLive.ts (being removed in
// Task 11). Inlined here to keep the worker self-contained without a
// circular import.
const TIKTOK_ACTIVE_STATUSES = new Set([
  'ADGROUP_STATUS_DELIVERY_OK',
  'ADGROUP_STATUS_BUDGET_EXCEED',
  'ADGROUP_STATUS_AUDIT',
  'ADGROUP_STATUS_REVIEWING',
  'ADGROUP_STATUS_NOT_START',
]);
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
   * Ads-off Phase 3 — account-level gate for TikTok. Skip the shared
   * advertiser-account fetch only when TikTok is OFF for ALL stores on the
   * shared account (uzoshop + usmile360). Defaults to {} (all ON) so existing
   * callers require no changes today; the Inngest binding loads and passes it.
   *
   * NOTE: NEVER gate per-store here — one TikTok account serves both stores.
   * Use `tiktokAccountFetchEnabled(adStateMap)` which returns true unless
   * EVERY member of TIKTOK_SHARED_STORES is false in the map.
   */
  adStateMap?: AdStateMap;
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
  /**
   * Phase D soak (2026-05-30) — DELETE registry rows that share
   * (platform, campaign_id) with a freshly-written row but live under a
   * different store_id (stale cross-attribution leftovers from a prior
   * mapping). Mirrors the DELETE-then-UPSERT pattern persistCampaignsLive
   * already uses for campaigns_daily (Phase A.5 v2). Optional because
   * the existing test fixtures predate this hook; production binding
   * always provides it.
   */
  deleteStaleAttributionRows?: (input: {
    platform: 'tiktok';
    entityType: 'campaign' | 'adset' | 'ad';
    freshCampaignIds: string[];
    freshTargetStoreIds: string[];
  }) => Promise<void>;
  upsertCampaignsDaily: (rows: Array<Record<string, unknown>>) => Promise<void>;
  upsertAdsDaily: (rows: Array<Record<string, unknown>>) => Promise<void>;
  /**
   * Phase E1.7 night (2026-05-30) — loads the adset → campaign map from
   * adset_registry for the hot adgroup ids. Required because TikTok's
   * AUCTION_ADGROUP report dimensions cannot include `campaign_id`
   * (`code=40002 data_level AUCTION_ADGROUP and dimension campaign_id do
   * not match`). Worker queries `SELECT adset_id, campaign_id FROM
   * adset_registry WHERE platform='tiktok' AND adset_id IN (hotAdgroupIds)`.
   *
   * Optional only for backwards-compat with vitest fixtures that pass no
   * hot adgroup ids; production binding always provides it.
   */
  loadAdsetCampaignMap?: (input: {
    storeId: StoreId;
    hotAdgroupIds: string[];
  }) => Promise<Map<string, string>>;
  /**
   * Phase E1.7 night (2026-05-30) — loads the ad_id → { adgroup_id,
   * campaign_id } map from ad_registry for the hot ad ids. Required
   * because TikTok's AUCTION_AD report dimensions cannot include parent
   * IDs (`code=40002 data_level AUCTION_AD and dimension <X> do not match`).
   * Worker queries `SELECT ad_id, adset_id, campaign_id FROM ad_registry
   * WHERE platform='tiktok' AND ad_id IN (hotAdIds)`.
   *
   * Optional only for backwards-compat with vitest fixtures that pass
   * no hot ad ids; production binding always provides it.
   */
  loadAdParentMap?: (input: {
    storeId: StoreId;
    hotAdIds: string[];
  }) => Promise<Map<string, { adgroup_id: string; campaign_id: string }>>;
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
  /**
   * Phase E1 (2026-05-30) — operator WhatsApp alert hook for the
   * hot_metrics branch. Invoked with operation 'tiktok_hot_metrics_*'
   * on auth/rate-limit errors.
   */
  notifyTokenFailure?: (input: {
    provider: 'meta' | 'google' | 'tiktok';
    storeId: string;
    operation: string;
    errorMsg: string;
    advice?: string;
  }) => Promise<void>;
  /**
   * Phase E1.7 hotfix #4 (2026-05-30 night) — DELETE stale
   * campaigns_daily rows for re-mapped campaigns. For each (date,
   * platform, campaign_id, ad_set_id) we're about to write under
   * store_id S, DELETE any existing row with same key but store_id != S.
   * Prevents double-count after the campaign-store-map moves a
   * campaign from store A to store B.
   */
  deleteStaleCampaignsDailyRows?: (rows: Array<{
    date: string;
    platform: 'tiktok';
    campaign_id: string;
    ad_set_id: string;
    store_id: string;
  }>) => Promise<void>;
  /** Phase E1.7 hotfix #4 — same idea for ads_daily (PK includes store_id). */
  deleteStaleAdsDailyRows?: (rows: Array<{
    date: string;
    platform: 'tiktok';
    ad_id: string;
    store_id: string;
  }>) => Promise<void>;
  /**
   * Phase E1.7 (2026-05-30 night) — unified agg RPC.
   *
   * Calls `agg_data_daily_for_date(d)` RPC to re-aggregate
   * `campaigns_daily.spend_cad + impressions` per (date, store_id,
   * platform) and write into `data_daily.{fb,ga,tt}_spend_cad +
   * {fb,ga,tt}_impressions`, then re-derive `total_spend_cad + roas +
   * gross_profit_cad + net_profit_cad`. Idempotent.
   *
   * Replaces Phase E1.6.1's `aggregateTiktokSpendByStore` (which called
   * `agg_tiktok_spend_per_store_for_date` — TikTok-only). The unified
   * RPC handles Meta + Google + TikTok in one pass and is used by all
   * 3 workers + cron-live.
   *
   * Optional for backwards-compat with test fixtures; production
   * binding always provides it.
   */
  aggregateDataDaily?: (date: string) => Promise<void>;
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

  // Ads-off Phase 3 — account-level gate. TikTok uses ONE shared advertiser
  // account (uzoshop) for all TIKTOK_SHARED_STORES. Skip only when TikTok is
  // OFF for every store on the account; turning off one store while another is
  // ON must NOT block the fetch (it would drop the still-on store's data).
  const adStateMap = input.adStateMap ?? {};
  if (!tiktokAccountFetchEnabled(adStateMap)) {
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

    // Phase D soak (2026-05-30) — after writing the fresh campaign rows,
    // DELETE any stale cross-store rows for the same campaign_ids. The
    // upsert key includes store_id, so a (tiktok, uzoshop, X) row left
    // over from a previous mapping does NOT conflict with the new
    // (tiktok, usmile360, X) row — without this DELETE both linger and
    // the uzoshop one stays at BACKFILL_UNKNOWN forever because the
    // worker never resolves X back to uzoshop.
    if (status.campaigns.length > 0 && input.deleteStaleAttributionRows) {
      const freshCampaignIds = [...new Set(status.campaigns.map((c) => c.campaign_id))];
      const freshTargetStoreIds = [...new Set(status.campaigns.map((c) => c.store_id))];
      await input.deleteStaleAttributionRows({
        platform: 'tiktok',
        entityType: 'campaign',
        freshCampaignIds,
        freshTargetStoreIds,
      });
    }

    const asRows = status.adsets.map((a) =>
      buildRegistryUpsertRow({ prior: prior.adsets.get(a.adset_id) ?? null, fresh: a, nowIso }),
    );
    await upsertRegistry({ table: 'adset_registry', rows: asRows });
    const adRows = status.ads.map((a) =>
      buildRegistryUpsertRow({ prior: prior.ads.get(a.ad_id) ?? null, fresh: a, nowIso }),
    );
    await upsertRegistry({ table: 'ad_registry', rows: adRows });

    // 6.5 — Phase E1.5 (2026-05-30) — placeholder enrollment for TikTok
    // (mirrors metaWorker/googleWorker Tasks 8/9). adset.store_id was
    // already resolved by the fetcher via campaign-store-map, so writing
    // a.store_id (NOT function-arg storeId) preserves the Phase A.5 v2
    // attribution model.
    if (input.upsertCampaignsDaily) {
      const today = getTodayInIsraelTz(nowIso);
      const activePlaceholders = status.adsets
        .filter((a) => TIKTOK_ACTIVE_STATUSES.has(a.effective_status ?? ''))
        .map((a) => ({
          date: today,
          store_id: a.store_id,
          platform: 'tiktok' as const,
          campaign_id: a.campaign_id,
          campaign_name: status.campaigns.find((c) => c.campaign_id === a.campaign_id)?.name ?? '',
          ad_set_id: a.adset_id,
          ad_set_name: a.name ?? '',
          effective_status: a.effective_status,
        }));
      if (activePlaceholders.length > 0) {
        await input.upsertCampaignsDaily(activePlaceholders);
      }
    }

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

  // Ads-off Phase 3 — account-level gate (mirrors status branch above).
  // Both branches share the same account — skip if all shared stores are off.
  if (!tiktokAccountFetchEnabled(input.adStateMap ?? {})) {
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

    // 1. Load hot ids in parallel with account + FX. loadStoreMap is
    //    only needed for the hot-set fetch path but is cheap and keeps
    //    the parallel block tight.
    const [hotCampaign, hotAdgroup, hotAd, campaignStoreMap, account, fxCadFor] = await Promise.all([
      getHotCampaignIds(storeId),
      getHotAdgroupIds(storeId),
      getHotAdIds(storeId),
      loadStoreMap(),
      safeAccount(storeId, getAccount),
      safeFxCadFor(storeId, getFxCadFor),
    ]);
    const today = getTodayInIsraelTz(nowIso);

    // Phase E1.7 night (2026-05-30) — load registry maps AFTER hot ids
    // resolve. Required because TikTok's AUCTION_ADGROUP report cannot
    // carry `campaign_id` as a dimension and AUCTION_AD cannot carry
    // adgroup_id/campaign_id. The fetcher uses these maps to enrich rows
    // so they route to the right store via the campaign-store-map.
    const [adsetIdToCampaignId, adIdToParent] = await Promise.all([
      hotAdgroup.length > 0 && input.loadAdsetCampaignMap
        ? input.loadAdsetCampaignMap({ storeId, hotAdgroupIds: hotAdgroup })
        : Promise.resolve(new Map<string, string>()),
      hotAd.length > 0 && input.loadAdParentMap
        ? input.loadAdParentMap({ storeId, hotAdIds: hotAd })
        : Promise.resolve(new Map<string, { adgroup_id: string; campaign_id: string }>()),
    ]);

    // Phase E1.6.1 (2026-05-30) — TikTok per-store spend split via the
    // agg RPC. Runs UNCONDITIONALLY (independent of hot-set state).
    //
    // Why this exists:
    //   - Pre-Phase E1: cron-live-heavy ran every 30 min, called
    //     persistCampaignsLive which called the agg RPC, so per-store
    //     tt_spend_cad for usmile360 + zolplus stayed fresh.
    //   - Phase E1 (2026-05-30 ~17:40 IL) disabled cron-live-heavy
    //     entirely. Only cronDaily nightly call remained → tt_spend_cad
    //     froze during the day.
    //   - Phase E1.6 (2026-05-30 ~18:30 IL) added a per-tick write of
    //     `data_daily.tt_spend_cad` from this branch via the bulk-date
    //     account spend fetcher. That fetcher returns the cross-store
    //     advertiser total → wrong value for uzoshop (inflated by
    //     other stores' campaigns) and silent zero for usmile360/zolplus
    //     (their workers skip at `checkTikTokConfigured`).
    //
    // Correct architecture: per-campaign spend is already attributed
    // to the right store_id in campaigns_daily (via the campaign-store-
    // map at write time). The agg RPC re-aggregates campaigns_daily
    // → data_daily per-store. Calling it after every hot_metrics
    // upsert keeps usmile360 + zolplus + uzoshop in sync within 10 min.
    //
    // Soft-fail: an RPC error here does NOT throw — we still want
    // the hot-set fetch below to run. Operator sees the failure via
    // the recHotPair('transient_error') path below if the worker
    // throws for other reasons.
    if (input.aggregateDataDaily) {
      try {
        await input.aggregateDataDaily(today);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`tiktokWorker aggregateDataDaily ${today}: ${message}`);
      }
    }

    // 2. Empty hot set is a NORMAL state (e.g. all campaigns paused) — we
    //    still mark freshness success because the worker did its job;
    //    there was simply nothing hot to refresh. The agg RPC above
    //    already ran against existing campaigns_daily rows.
    if (hotCampaign.length + hotAdgroup.length + hotAd.length === 0) {
      await recHotPair('success');
      return;
    }

    // 3. Fetch hot-set metrics for today only.
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
      adsetIdToCampaignId,
      adIdToParent,
      getFxCadFor: fxCadFor,
    });

    // 4. Phase E1.7 hotfix #4 — DELETE-then-UPSERT for re-mapped
    // campaigns. When a TikTok campaign moves stores via the
    // campaign-store-map (operator action), the new tick writes rows
    // under the NEW store_id; old rows under the OLD store_id linger
    // in campaigns_daily because the PK includes store_id. The agg
    // RPC would SUM both → double-count. Fix: for each (campaign_id,
    // ad_set_id) we're about to write, DELETE any rows on the same
    // date+platform under DIFFERENT store_id. Mirrors the Phase A.5 v2
    // pattern in persistCampaignsLive (which only ran from cron-live-
    // heavy, now disabled).
    //
    // Same DELETE-then-UPSERT applies to ads_daily for AD-level rows
    // (ads_daily PK includes store_id by the same logic).
    if (metrics.adsets.length > 0 && input.deleteStaleCampaignsDailyRows) {
      const adsetKeys = metrics.adsets.map((a) => ({
        date: today, platform: 'tiktok' as const,
        campaign_id: a.campaign_id, ad_set_id: a.ad_set_id, store_id: a.store_id,
      }));
      await input.deleteStaleCampaignsDailyRows(adsetKeys);
    }
    if (metrics.ads.length > 0 && input.deleteStaleAdsDailyRows) {
      const adKeys = metrics.ads.map((a) => ({
        date: today, platform: 'tiktok' as const,
        ad_id: a.ad_id, store_id: a.store_id,
      }));
      await input.deleteStaleAdsDailyRows(adKeys);
    }

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

    // 5. Re-aggregate AFTER fresh writes so data_daily.tt_spend_cad
    //    reflects the new campaigns_daily values (otherwise the RPC
    //    call at step 1 saw pre-write state). Soft-fail same as step 1.
    if (input.aggregateDataDaily) {
      try {
        await input.aggregateDataDaily(today);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`tiktokWorker aggregateDataDaily (post-upsert) ${today}: ${message}`);
      }
    }

    // 6. Mark freshness success for both campaign_metrics + ad_metrics.
    await recHotPair('success');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recHotPair('transient_error', message);
    // Phase E1 (2026-05-30) — fire WhatsApp via notifyTokenFailure on
    // auth/rate so operator gets paged within ~10 min of token going
    // dead (replaces cron-live-heavy's alert path).
    const isRate = isRateLimitError('tiktok', message);
    const isAuth = isAuthError('tiktok', message);
    if ((isRate || isAuth) && input.notifyTokenFailure) {
      await input.notifyTokenFailure({
        provider: 'tiktok',
        storeId,
        operation: isRate ? 'tiktok_hot_metrics_rate_limit' : 'tiktok_hot_metrics_auth',
        errorMsg: message,
        advice: isRate
          ? 'TikTok reported HTTP 429 / code=40001 quota exceeded. Hot metrics worker will retry on next orchestrator tick (10 min). No operator action needed unless this persists.'
          : 'Refresh the TikTok access token. See docs/PROPS-MAP.md (UZOSHOP_TIKTOK_ACCESS_TOKEN).',
      }).catch((alertErr) => {
        console.warn(`tiktokWorker hot_metrics ${isRate ? 'rate' : 'auth'} alert threw: ${alertErr instanceof Error ? alertErr.message : alertErr}`);
      });
    }
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

      const adStateMap = await fetchAdStateFromPostgres();

      await runTikTokWorkerJob({
        jobData: data,
        adStateMap,
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
        // Phase D soak (2026-05-30) — DELETE stale cross-attribution
        // registry rows for (platform, campaign_id) pairs whose current
        // mapping resolves to a store_id different from a prior write.
        // Soft-fail: registry stays as-is, next tick retries; the upsert
        // already succeeded so a transient DELETE error shouldn't fail
        // the whole status branch and obscure the operator panel.
        deleteStaleAttributionRows: async (inp) => {
          const tableName =
            inp.entityType === 'campaign' ? 'campaign_registry'
            : inp.entityType === 'adset' ? 'adset_registry'
            : 'ad_registry';
          if (inp.freshCampaignIds.length === 0) return;
          const { error } = await sb
            .from(tableName)
            .delete()
            .eq('platform', inp.platform)
            .in('campaign_id', inp.freshCampaignIds)
            .not(
              'store_id',
              'in',
              `(${inp.freshTargetStoreIds.map((s) => `"${s}"`).join(',')})`,
            );
          if (error) {
            console.warn(
              `tiktokWorker deleteStaleAttributionRows ${tableName}: ${error.message}`,
            );
          }
        },
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
        // Phase E1 (2026-05-30) — fire operator WhatsApp on auth/rate
        // errors from hot_metrics branch. See metaWorker for rationale.
        notifyTokenFailure: async (inp) => {
          await notifyTokenFailure({
            provider: inp.provider,
            storeId: inp.storeId as 'uzoshop' | 'zolplus' | 'usmile360' | 'global',
            operation: inp.operation,
            errorMsg: inp.errorMsg,
            advice: inp.advice,
          });
        },
        // Phase E1.6.1 (2026-05-30) — per-store TikTok spend split via
        // the SQL function. Replaces the Phase E1.6 cross-store
        // account-aggregate write (which incorrectly wrote the full
        // advertiser total to uzoshop's data_daily slot). See the
        // commentary on `aggregateTiktokSpendByStore` in the
        // RunTikTokWorkerJobInput type for rationale.
        // Phase E1.7 (2026-05-30 night) — unified agg RPC replaces the
        // TikTok-only `agg_tiktok_spend_per_store_for_date`.
        aggregateDataDaily: async (date: string) => {
          const { error } = await sb.rpc('agg_data_daily_for_date', { d: date });
          if (error) {
            throw new Error(`agg_data_daily_for_date(${date}) for tiktok: ${error.message}`);
          }
        },
        // Phase E1.7 hotfix #4 — DELETE-then-UPSERT for re-mapped
        // campaigns. For each fresh (date, platform, campaign_id,
        // ad_set_id, store_id) we're about to UPSERT, DELETE rows that
        // share the first 4 keys but have a DIFFERENT store_id. Without
        // this DELETE, a campaign that moves stores via the campaign-
        // store-map leaves stale rows under the old store_id that the
        // agg RPC would sum → double-count.
        deleteStaleCampaignsDailyRows: async (rows) => {
          for (const r of rows) {
            const { error } = await sb
              .from('campaigns_daily')
              .delete()
              .eq('date', r.date)
              .eq('platform', r.platform)
              .eq('campaign_id', r.campaign_id)
              .eq('ad_set_id', r.ad_set_id)
              .neq('store_id', r.store_id);
            if (error) {
              console.warn(
                `tiktokWorker deleteStaleCampaignsDailyRows ${r.campaign_id}/${r.ad_set_id} keep=${r.store_id}: ${error.message}`,
              );
            }
          }
        },
        deleteStaleAdsDailyRows: async (rows) => {
          for (const r of rows) {
            const { error } = await sb
              .from('ads_daily')
              .delete()
              .eq('date', r.date)
              .eq('platform', r.platform)
              .eq('ad_id', r.ad_id)
              .neq('store_id', r.store_id);
            if (error) {
              console.warn(
                `tiktokWorker deleteStaleAdsDailyRows ${r.ad_id} keep=${r.store_id}: ${error.message}`,
              );
            }
          }
        },
        // Phase E1.7 night (2026-05-30) — adsetId → campaign_id lookup
        // from adset_registry. Needed because TikTok's AUCTION_ADGROUP
        // report cannot include campaign_id as a dimension. Scope to
        // platform 'tiktok' — NOT to store_id, for the same reason as
        // loadAdParentMap (campaign-store-map handles routing).
        loadAdsetCampaignMap: async ({ hotAdgroupIds }) => {
          const out = new Map<string, string>();
          if (hotAdgroupIds.length === 0) return out;
          const { data, error } = await sb
            .from('adset_registry')
            .select('adset_id, campaign_id')
            .eq('platform', 'tiktok')
            .in('adset_id', hotAdgroupIds);
          if (error) {
            console.warn(`tiktokWorker loadAdsetCampaignMap: ${error.message}`);
            return out;
          }
          for (const row of (data ?? []) as Array<{ adset_id: string; campaign_id: string }>) {
            if (row.adset_id && row.campaign_id) {
              out.set(row.adset_id, row.campaign_id);
            }
          }
          return out;
        },
        // Phase E1.7 night (2026-05-30) — adId → { adgroup_id, campaign_id }
        // lookup from ad_registry. Needed because TikTok's AUCTION_AD report
        // cannot include parent IDs as dimensions. We scope to platform
        // 'tiktok' but NOT to a specific store_id — the campaign-store-map
        // may have re-routed the ad's campaign to a different store between
        // ticks, in which case the registry row still carries the correct
        // adgroup_id / campaign_id linkage (the fetcher will route via
        // resolveStore using the current map).
        loadAdParentMap: async ({ hotAdIds }) => {
          const out = new Map<string, { adgroup_id: string; campaign_id: string }>();
          if (hotAdIds.length === 0) return out;
          const { data, error } = await sb
            .from('ad_registry')
            .select('ad_id, adset_id, campaign_id')
            .eq('platform', 'tiktok')
            .in('ad_id', hotAdIds);
          if (error) {
            console.warn(`tiktokWorker loadAdParentMap: ${error.message}`);
            return out;
          }
          for (const row of (data ?? []) as Array<{ ad_id: string; adset_id: string; campaign_id: string }>) {
            if (row.ad_id && row.adset_id && row.campaign_id) {
              out.set(row.ad_id, { adgroup_id: row.adset_id, campaign_id: row.campaign_id });
            }
          }
          return out;
        },
        nowIso,
      });
    });
  },
);
