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

import { recordFreshness } from '@/lib/inngest/freshness';
import { isAdsEnabled, type AdStateMap } from '@/lib/adState';
import { fetchAdStateFromPostgres } from '@/lib/postgresReaders';
import { fetchGoogleStatusForStore } from '@/lib/fetchers/googleStatus';
import type { GoogleStatusInput, GoogleStatusResult } from '@/lib/fetchers/googleStatus';
import { fetchGoogleHotMetricsForStore } from '@/lib/fetchers/googleHotMetrics';
import type { GoogleHotMetricsInput, GoogleHotMetricsResult } from '@/lib/fetchers/googleHotMetrics';
import {
  getGoogleCustomerForStore,
  isGoogleConfiguredForStoreAsync,
} from '@/lib/fetchers/googleAccountConfig';
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
// Phase E1.7 (2026-05-30 night) — Google worker no longer fetches
// account-aggregate spend. campaigns_daily is the single source of
// truth; the unified RPC `agg_data_daily_for_date(d)` re-aggregates
// into data_daily after every upsert. See ARCHITECTURE.md §Phase E1.7.
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
  /**
   * Phase C soak fix (2026-05-30): optional override of the per-store
   * "is Google configured?" check. Defaults (Phase 4b, 2026-06-07) to
   * `isGoogleConfiguredForStoreAsync` — a DB-aware dual-read of
   * GOOGLEADS_CUSTOMER_ID via getStoreSecret (DB→env→null), falling back to
   * the sync env check. When false the worker no-ops and records `success`
   * freshness for every scope, then returns without touching the customer
   * resolver or the fetcher. May be sync or async (the worker awaits either).
   *
   * INERT today: env creds present → the async default returns the SAME
   * boolean as the old sync env check, so the 3 stores behave identically.
   * The DB-aware path only matters once Phase 6 can add a DB-only-cred store.
   *
   * Why this exists: only `uzoshop` has its own Google Ads account today
   * (see `docs/PROPS-MAP.md` §3/§4 + `ARCHITECTURE.md` §5.3); the
   * orchestrator naively fans out events for every (store, platform, scope)
   * combo (`cronTickOrchestrator.ts:17`). Without this gate, `safeCustomer`
   * threw `Missing ${UPPER}_GOOGLEADS_CUSTOMER_ID` every tick for
   * usmile360 + zolplus and the worker never reached `recordFreshness` —
   * the operator panel stayed permanently empty for those rows.
   */
  isGoogleConfigured?: (storeId: StoreId) => boolean | Promise<boolean>;
  /**
   * Phase E1 (2026-05-30) — operator WhatsApp alert hook for the
   * hot_metrics branch. Invoked with operation 'google_hot_metrics_*'
   * on auth/rate-limit errors. Optional for backwards-compat with
   * existing test fixtures.
   */
  notifyTokenFailure?: (input: {
    provider: 'meta' | 'google' | 'tiktok';
    storeId: string;
    operation: string;
    errorMsg: string;
    advice?: string;
  }) => Promise<void>;
  /**
   * Phase E1.7 (2026-05-30 night) — unified agg RPC.
   * Re-aggregates campaigns_daily → data_daily.{fb,ga,tt}_spend_cad +
   * impressions + derived totals atomically. Called twice: once before
   * the empty-hot-set check (soft-fail) and once after upsertCampaignsDaily
   * (re-throw on error). Replaces Phase E1.6 fetchAccountSpend path.
   */
  aggregateDataDaily?: (date: string) => Promise<void>;
  /**
   * Phase 3 (ads-off) — optional map of `${storeId}:${platform}` → enabled.
   * When omitted (or `{}`), all ads are considered ON (existing behaviour).
   * When a (store, platform) pair is OFF, the fetch is skipped but freshness
   * is still recorded as `success` so the operator panel stays green.
   */
  adStateMap?: AdStateMap;
};

async function checkGoogleConfigured(
  storeId: StoreId,
  override?: (storeId: StoreId) => boolean | Promise<boolean>,
): Promise<boolean> {
  // `await` on a sync override (e.g. tests passing `() => false`) resolves to
  // its boolean; on the async default it awaits the DB-aware dual-read. MUST
  // be awaited at every call site — a Promise is truthy, so a missing await
  // would wrongly mark EVERY store "configured".
  if (override) return await override(storeId);
  return isGoogleConfiguredForStoreAsync(storeId);
}

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
  const { jobData, recordFreshness: rec } = input;
  const storeId = jobData.store_id;

  const recAllStatusScopes = async (
    status: 'success' | 'transient_error',
    errorMessage?: string,
  ): Promise<void> => {
    for (const s of ['campaign_status', 'adset_status', 'ad_status'] as const) {
      await rec({
        storeId,
        platform: 'google',
        scope: s,
        tableName: registryNameForScope(s),
        status,
        errorMessage,
      });
    }
  };

  // Phase C soak: stores without their own Google Ads account (e.g.
  // usmile360, zolplus — only uzoshop has Google today per ARCHITECTURE.md
  // §5.3) record a freshness success and return. Without this, every tick
  // the orchestrator naively fanned out for these stores and the missing
  // env var (`${UPPER}_GOOGLEADS_CUSTOMER_ID`) made `safeCustomer` throw —
  // resulting in zero status freshness rows and a permanently empty
  // operator panel for Google status.
  if (!(await checkGoogleConfigured(storeId, input.isGoogleConfigured))) {
    await recAllStatusScopes('success');
    return;
  }

  // Phase 3 (ads-off) — skip the API fetch when this (store, platform) is
  // toggled OFF. Record freshness success for all 3 status scopes so the
  // operator Health tab does NOT show a false-red. Gate sits after the
  // "not configured" short-circuit and BEFORE any network calls.
  if (!isAdsEnabled(input.adStateMap ?? {}, storeId, 'google')) {
    await recAllStatusScopes('success');
    return;
  }

  try {
    const {
      fetchStatus,
      loadPriorRegistry,
      upsertRegistry,
      insertStatusEvents,
      getCustomer,
      nowIso,
    } = input;

    // 1. Resolve customer + fetch — `fetchGoogleStatusForStore` runs a
    //    change_status discovery query then entity follow-ups for
    //    CAMPAIGN / AD_GROUP / AD_GROUP_AD types.
    const customer = await safeCustomer(storeId, getCustomer);

    // Phase D soak (2026-05-30) — load prior registry BEFORE the fetch so
    // we can pass any BACKFILL_UNKNOWN campaign ids to the fetcher as
    // extraCampaignIds. change_status alone misses long-stable campaigns
    // (e.g. ENABLED for a week without edits), leaving the migration's
    // sentinel in place forever. This sweep is the structural fix —
    // every tick that has stale rows performs a one-shot refresh.
    const prior = await loadPriorRegistry(storeId);
    const extraCampaignIds: string[] = [];
    for (const row of prior.campaigns.values()) {
      if (row.configured_status === 'BACKFILL_UNKNOWN') {
        extraCampaignIds.push(row.campaign_id);
      }
    }

    const status = await fetchStatus({ storeId, customer, extraCampaignIds });

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

    // 4.5 — Phase E1.5 (2026-05-30) — placeholder enrollment for Google
    // (mirrors metaWorker Task 8 / cron-live's enroll-active-ad-sets
    // step being removed in Task 11). Any ENABLED ad-group gets a
    // placeholder row in campaigns_daily so it appears in the dashboard
    // within 10 min of going live, even when hot_metrics hasn't yet
    // fetched real spend.
    //
    // P1-13 (2026-06-10): filter on `is_enabled === true`, NOT
    // `effective_status === 'ENABLED'`. googleStatus.toAdsetRow builds
    // ad-group rows with effective_status ALWAYS null (Google's ad_group
    // resource exposes no serving_status — the IMP-D comment there); the
    // ENABLED signal lives in configured_status / is_enabled. The old
    // filter matched nothing → this whole block was dead code and
    // newly-enabled zero-spend Google campaigns stayed invisible until
    // they accrued spend, defeating the E1.5 design for Google.
    if (input.upsertCampaignsDaily) {
      const today = getTodayInIsraelTz(nowIso);
      const activePlaceholders = status.adsets
        .filter((a) => a.is_enabled === true)
        .map((a) => ({
          date: today,
          store_id: a.store_id,
          platform: 'google' as const,
          campaign_id: a.campaign_id,
          campaign_name: status.campaigns.find((c) => c.campaign_id === a.campaign_id)?.name ?? '',
          ad_set_id: a.adset_id,
          ad_set_name: a.name ?? '',
          // effective_status is null on googleStatus ad-group rows (no
          // serving_status at this level) — fall back to configured_status
          // ('ENABLED' for every row passing the is_enabled filter) so the
          // placeholder upsert doesn't NULL the column that the nightly
          // cron populates on the same row.
          effective_status: a.effective_status ?? a.configured_status ?? null,
        }));
      if (activePlaceholders.length > 0) {
        await input.upsertCampaignsDaily(activePlaceholders);
      }
    }

    // 5. Mark freshness success for all 3 scopes.
    await recAllStatusScopes('success');
  } catch (err) {
    // Phase C soak: surface the failure to the operator panel by writing a
    // transient_error row per scope BEFORE re-throwing. Re-throwing keeps
    // Inngest's exponential-backoff retry intact; the next successful tick
    // overwrites the row with status='success'.
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

async function runGoogleHotMetricsBranch(input: RunGoogleWorkerJobInput): Promise<void> {
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
      platform: 'google',
      scope: 'campaign_metrics',
      tableName: 'campaigns_daily',
      status,
      errorMessage,
    });
    await rec({
      storeId,
      platform: 'google',
      scope: 'ad_metrics',
      tableName: 'ads_daily',
      status,
      errorMessage,
    });
  };

  // Phase C soak: stores without their own Google Ads account record
  // freshness success and return. The hot-set empty-state short-circuit
  // below ALSO writes a success row, but only ran after `safeCustomer`
  // — for stores with hot ids and no creds the worker threw before
  // touching `recordFreshness`. This gate moves the no-creds case to
  // the top so it's not creds-vs-hot-ids order-dependent.
  if (!(await checkGoogleConfigured(storeId, input.isGoogleConfigured))) {
    await recHotPair('success');
    return;
  }

  // Phase 3 (ads-off) — skip the API fetch when this (store, platform) is
  // toggled OFF. Record freshness success for campaign_metrics + ad_metrics
  // so the operator panel stays green. Gate sits after "not configured" and
  // BEFORE any hot-set or network calls.
  if (!isAdsEnabled(input.adStateMap ?? {}, storeId, 'google')) {
    await recHotPair('success');
    return;
  }

  try {
    const {
      fetchHotMetrics,
      getHotCampaignIds,
      getHotAdgroupIds,
      getHotAdIds,
      upsertCampaignsDaily,
      upsertAdsDaily,
      getCustomer,
      nowIso,
    } = input;

    // 1. Load hot ids in parallel.
    const [hotCampaign, hotAdgroup, hotAd] = await Promise.all([
      getHotCampaignIds(storeId),
      getHotAdgroupIds(storeId),
      getHotAdIds(storeId),
    ]);

    // 1.5 Resolve customer early. Both the Phase E1.6 account-aggregate
    // write (below) AND the hot-set fetch (further down) need it. Moved
    // above the empty-hot-set gate by the 2026-05-30 regression fix so
    // account-aggregate spend runs every tick regardless of hot-set state.
    const customer = await safeCustomer(storeId, getCustomer);

    // 2. Phase E1.7 (2026-05-30 night) — pre-fetch agg RPC call. Same
    // semantics as metaWorker — re-aggregates existing campaigns_daily
    // values into data_daily so empty-hot-set ticks still keep
    // derived columns fresh. Soft-fail so hot-set metrics path runs
    // even if RPC has transient issue.
    if (input.aggregateDataDaily) {
      const todayDate = getTodayInIsraelTz(nowIso);
      try {
        await input.aggregateDataDaily(todayDate);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`googleWorker aggregateDataDaily (pre-fetch) ${todayDate}: ${message}`);
      }
    }

    // 3. Empty hot set is a NORMAL state (e.g. all campaigns paused) — we
    //    still mark freshness success because the worker did its job;
    //    there was simply nothing hot to refresh. Account-aggregate
    //    above already ran.
    if (hotCampaign.length + hotAdgroup.length + hotAd.length === 0) {
      await recHotPair('success');
      return;
    }

    // 4. Fetch hot-set metrics for today only.
    const today = getTodayInIsraelTz(nowIso);
    const metrics = await fetchHotMetrics({
      storeId,
      customer,
      hotCampaignIds: hotCampaign,
      hotAdgroupIds: hotAdgroup,
      hotAdIds: hotAd,
      dateStr: today,
    });

    // 5. Upsert campaigns_daily (adsets only) and ads_daily, stamping
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

    // 6. Phase E1.7 (2026-05-30 night) — post-upsert agg RPC call.
    // Re-aggregate the freshly-written campaigns_daily values into
    // data_daily atomically. Errors re-throw so outer catch records
    // transient_error.
    if (input.aggregateDataDaily) {
      await input.aggregateDataDaily(today);
    }

    // 7. Mark freshness success for both campaign_metrics + ad_metrics.
    await recHotPair('success');
  } catch (err) {
    // Phase C soak: surface the failure to the operator panel by writing
    // transient_error rows BEFORE re-throwing. Re-throw preserves the
    // Inngest retry behavior; next successful tick overwrites with success.
    const message = err instanceof Error ? err.message : String(err);
    await recHotPair('transient_error', message);
    // Phase E1 (2026-05-30) — fire WhatsApp via notifyTokenFailure on
    // auth/rate errors so operator gets paged within ~10 min of token
    // going dead (replaces cron-live-heavy's alert path).
    const isRate = isRateLimitError('google', message);
    const isAuth = isAuthError('google', message);
    if ((isRate || isAuth) && input.notifyTokenFailure) {
      await input.notifyTokenFailure({
        provider: 'google',
        storeId,
        operation: isRate ? 'google_hot_metrics_rate_limit' : 'google_hot_metrics_auth',
        errorMsg: message,
        advice: isRate
          ? 'Google reported RESOURCE_EXHAUSTED / 429. Hot metrics worker will retry on next orchestrator tick (10 min). No operator action needed unless this persists across multiple ticks.'
          : 'Refresh the Google OAuth refresh token. See docs/PROPS-MAP.md for the env var name (UZOSHOP_GOOGLE_REFRESH_TOKEN).',
      }).catch((alertErr) => {
        console.warn(`googleWorker hot_metrics ${isRate ? 'rate' : 'auth'} alert threw: ${alertErr instanceof Error ? alertErr.message : alertErr}`);
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Inngest binding — mirrors metaWorker's `triggers: [...]` style.
// Concurrency=1 per store prevents overlapping refreshes on the same
// Google Ads customer (the API would 429/RESOURCE_EXHAUSTED anyway).
// Throttle 600/h per store gives the worker headroom to keep pace with a
// 10-min orchestrator without blowing past Google's per-developer-token
// daily limit.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wired job runner — Inngest → Vercel Cron + QStash migration (Stage 2 Task
// 2.4). The full dependency wiring the Inngest binding built inside `step.run`
// is hoisted here so BOTH the Inngest binding AND the `/api/worker/google`
// QStash route call the SAME byte-identical wiring. The pure core
// (`runGoogleWorkerJob`) is unchanged; its unit tests drive it directly and
// stay green.
// ---------------------------------------------------------------------------
export async function runGoogleWorkerForJob(data: JobRequestedEvent): Promise<void> {
  const nowIso = new Date().toISOString();
  const sb = getSupabaseAdmin();
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

      // Degrade gracefully: an ad-state read failure must NOT fail the worker.
      // Empty map ⇒ all-ON ⇒ fetch normally (never wrongly skip).
      const adStateMap = await fetchAdStateFromPostgres().catch((): AdStateMap => ({}));

      await runGoogleWorkerJob({
        jobData: data,
        fetchStatus: fetchGoogleStatusForStore,
        fetchHotMetrics: fetchGoogleHotMetricsForStore,
        adStateMap,
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
        // Phase E1.6 (2026-05-30) — bulk-date account-aggregate spend
        // → data_daily via partial-column UPSERT.
        // Phase E1.7 (2026-05-30 night) — unified agg RPC replaces the
        // Phase E1.6 fetchAccountSpend path.
        aggregateDataDaily: async (date: string) => {
          const { error } = await sb.rpc('agg_data_daily_for_date', { d: date });
          if (error) {
            throw new Error(`agg_data_daily_for_date(${date}) for google: ${error.message}`);
          }
        },
        nowIso,
      });
}
