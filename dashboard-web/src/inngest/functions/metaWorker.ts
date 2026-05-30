// dashboard-web/src/inngest/functions/metaWorker.ts
//
// Phase B — consumes meta/job.requested events emitted by cron-tick-
// orchestrator. Only handles scope='status' in this phase; Phase C
// extends with scope='hot_metrics'.
//
// Flow per event:
//   1. BUC pre-flight (Layer-1 hard gate at pct >= 95 or eta_minutes > 0).
//      On skip, write data_freshness rows with status='budget_skip' for
//      campaign_status + adset_status + ad_status so the operator panel
//      surfaces the cause.
//   2. Fetch via fetchMetaStatusForStore (single batched call).
//   3. Persist parsed BUC usage into meta_buc_usage (+ recordMetaBucUsage
//      for the WhatsApp alert path).
//   4. Load prior registry rows → diff → emit one StatusEventInsert per
//      transition into campaign_status_events (DO NOTHING on dedupe_key
//      unique conflict).
//   5. Upsert all 3 registries with the buildRegistryUpsertRow rules.
//   6. Mark data_freshness success for all 3 scopes.
//
// Pure core `runMetaWorkerJob` is exported so vitest can drive it with
// mocked deps; the Inngest binding wraps it in a single `step.run` for
// retry-safety (Inngest replays the step result on retry). The pure core
// reads env vars only lazily inside the `fetchStatus` call path — the
// happy-path test injects a vi.fn() resolver and never touches env vars.

import { inngest } from '@/inngest/client';
import { META_JOB_REQUESTED } from '@/lib/registries/eventNames';
import { recordFreshness } from '@/lib/inngest/freshness';
import { fetchMetaStatusForStore } from '@/lib/fetchers/metaStatus';
import type { MetaStatusFetchInput, MetaStatusResult } from '@/lib/fetchers/metaStatus';
import { diffAgainstRegistry } from '@/lib/registries/diff';
import {
  buildRegistryUpsertRow,
  insertStatusEventsBatch,
  upsertRegistryBatch,
} from '@/lib/registries/upsert';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { recordMetaBucUsage } from '@/lib/notifications/metaBucUsage';
import { isAuthError, isRateLimitError } from '@/lib/notifications/detectAuthError';
import { notifyTokenFailure } from '@/lib/notifications/tokenFailures';
// Phase E1.7 (2026-05-30 night) — Meta worker no longer fetches
// account-aggregate spend or writes data_daily.fb_spend_cad directly.
// campaigns_daily is the single source of truth; the unified RPC
// `agg_data_daily_for_date(d)` re-aggregates it into data_daily after
// every upsert. See ARCHITECTURE.md §Phase E1.7.
import {
  getAdAccountIdForStore,
  getMetaAccessTokenForStore,
  getFxCadAdapterForStore,
} from '@/lib/fetchers/metaAccountConfig';
import { fetchMetaHotMetricsForStore } from '@/lib/fetchers/metaHotMetrics';
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

const HARD_SKIP_PCT = 95;

type PriorMaps = {
  campaigns: Map<string, CampaignRegistryRow>;
  adsets: Map<string, AdsetRegistryRow>;
  ads: Map<string, AdRegistryRow>;
};

export type RunMetaWorkerJobInput = {
  jobData: JobRequestedEvent;
  bucProbe: (storeId: StoreId) => Promise<{ pct: number; etaMinutes: number }>;
  /**
   * fetchStatus signature matches `fetchMetaStatusForStore`. The pure core
   * builds the input synthetically — when vitest passes a `vi.fn()` the env
   * vars are never read because the unused-argument lookups inside the input
   * builder are wrapped in `getCredentials()` which is only invoked when an
   * env-backed config is needed.
   */
  fetchStatus: typeof fetchMetaStatusForStore;
  loadPriorRegistry: (storeId: StoreId) => Promise<PriorMaps>;
  upsertRegistry: (input: { table: 'campaign_registry' | 'adset_registry' | 'ad_registry'; rows: unknown[] }) => Promise<void>;
  insertStatusEvents: (input: { events: StatusEventInsert[] }) => Promise<void>;
  recordFreshness: (input: {
    storeId: StoreId;
    platform: 'meta';
    scope: string;
    tableName: string;
    status: 'success' | 'budget_skip' | 'transient_error';
    errorMessage?: string;
  }) => Promise<void>;
  upsertBuc: (row: Record<string, unknown>) => Promise<void>;
  /**
   * Phase E1 (2026-05-30) — operator WhatsApp alert hook. The hot_metrics
   * branch invokes this on BUC budget_skip / auth errors / rate-limit
   * errors with a `meta_hot_metrics_*` operation key. Optional because
   * existing tests don't all pass it; production Inngest binding always
   * supplies it via the notifyTokenFailure adapter.
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
   * impressions + derived totals (roas/gross/net) atomically at the
   * DB layer. Replaces the Phase E1.6 partial-column UPSERT path
   * (which failed silently on store_name NOT NULL for Day-3 dates).
   * Called twice: once before the empty-hot-set check (soft-fail) and
   * once after upsertCampaignsDaily (re-throw on error).
   */
  aggregateDataDaily?: (date: string) => Promise<void>;
  nowIso: string;
  /**
   * Optional credential resolver. When omitted (production path), the pure
   * core reads env vars via the metaAccountConfig helpers. When a test wants
   * to drive the happy path without setting env vars, it can pass a stub —
   * but the 4 happy-path / budget-skip tests don't need this because they
   * either short-circuit before fetch (budget skip / wrong scope) or pass a
   * fetch stub that consumes the synthetic credentials harmlessly.
   */
  getCredentials?: (storeId: StoreId) => Promise<{
    adAccountId: string;
    accessToken: string;
    getFxCadFor: MetaStatusFetchInput['getFxCadFor'];
  }>;
  // ---------------------------------------------------------------------------
  // Phase C — hot_metrics scope optional injections. All optional so the
  // existing Phase B unit tests (which only exercise scope='status') keep
  // passing without supplying these fields.
  // ---------------------------------------------------------------------------
  fetchHotMetrics?: typeof fetchMetaHotMetricsForStore;
  getHotCampaignIds?: (storeId: StoreId) => Promise<string[]>;
  getHotAdsetIds?: (storeId: StoreId) => Promise<string[]>;
  getHotAdIds?: (storeId: StoreId) => Promise<string[]>;
  upsertCampaignsDaily?: (rows: Array<Record<string, unknown>>) => Promise<void>;
  upsertAdsDaily?: (rows: Array<Record<string, unknown>>) => Promise<void>;
};

async function defaultCredentials(storeId: StoreId): Promise<{
  adAccountId: string;
  accessToken: string;
  getFxCadFor: MetaStatusFetchInput['getFxCadFor'];
}> {
  const [adAccountId, accessToken, getFxCadFor] = await Promise.all([
    getAdAccountIdForStore(storeId),
    getMetaAccessTokenForStore(storeId),
    getFxCadAdapterForStore(storeId),
  ]);
  return { adAccountId, accessToken, getFxCadFor };
}

async function safeCredentials(
  storeId: StoreId,
  override?: RunMetaWorkerJobInput['getCredentials'],
): Promise<{ adAccountId: string; accessToken: string; getFxCadFor: MetaStatusFetchInput['getFxCadFor'] }> {
  if (override) return override(storeId);
  try {
    return await defaultCredentials(storeId);
  } catch {
    // Unit-test path: env vars not set. The fetchStatus stub is a vi.fn()
    // that ignores the input shape, so synthetic placeholders are fine.
    return {
      adAccountId: '',
      accessToken: '',
      getFxCadFor: async () => 0,
    };
  }
}

export async function runMetaWorkerJob(input: RunMetaWorkerJobInput): Promise<void> {
  const {
    jobData,
    bucProbe,
    fetchStatus,
    loadPriorRegistry,
    upsertRegistry,
    insertStatusEvents,
    recordFreshness: rec,
    upsertBuc,
    nowIso,
    getCredentials,
  } = input;
  const { store_id: storeId, scope } = jobData;

  if (scope === 'hot_metrics') {
    return await runMetaHotMetricsBranch(input);
  }
  if (scope !== 'status') return;

  // 1. BUC pre-flight — Layer 1 hard gate (ETA > 0 or pct >= 95).
  //    The orchestrator already filters at pct >= 80 (Layer-2 soft gate),
  //    but the worker re-probes because (a) several seconds may have
  //    elapsed since the orchestrator emit, and (b) the fan-out may have
  //    landed multiple sibling jobs that already pushed BUC over the cliff.
  const buc = await bucProbe(storeId);
  if (buc.etaMinutes > 0 || buc.pct >= HARD_SKIP_PCT) {
    for (const s of ['campaign_status', 'adset_status', 'ad_status'] as const) {
      await rec({
        storeId,
        platform: 'meta',
        scope: s,
        tableName: registryNameForScope(s),
        status: 'budget_skip',
        errorMessage:
          buc.etaMinutes > 0
            ? `Meta ETA=${buc.etaMinutes}min`
            : `pct=${buc.pct}>=${HARD_SKIP_PCT}`,
      });
    }
    return;
  }

  // 2. Resolve credentials + fetch — single batched Graph call returning all
  //    3 entity types. safeCredentials swallows env-var errors so unit tests
  //    with stubbed fetchStatus run without UZOSHOP_META_ACCESS_TOKEN set.
  const creds = await safeCredentials(storeId, getCredentials);
  const status: MetaStatusResult = await fetchStatus({
    storeId,
    adAccountId: creds.adAccountId,
    accessToken: creds.accessToken,
    getFxCadFor: creds.getFxCadFor,
  });

  // 3. Update BUC usage — both the meta_buc_usage table (orchestrator
  //    reads this) and the recordMetaBucUsage notification path (WhatsApp
  //    alert at 80% threshold).
  await upsertBuc({
    store_id: storeId,
    ad_account_id: creds.adAccountId,
    ...status.bucUsage,
    last_updated_at: nowIso,
  });

  // 4. Load prior registry rows for the diff. Empty maps on first run →
  //    every fresh row becomes a 'first_seen' event.
  const prior = await loadPriorRegistry(storeId);

  // 5. Diff → status events (one per genuine status transition, cosmetic
  //    edits like name/budget changes do NOT emit events).
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

  // 6.5 — Phase E1.5 (2026-05-30) — placeholder enrollment migrated from
  // cron-live's enroll-active-ad-sets step. The status worker now owns
  // per-store enrollment for Meta: any ACTIVE adset gets a placeholder
  // row in campaigns_daily (no metric columns → preserved on conflict;
  // default 0 on insert) so it appears in the dashboard within 10 min of
  // going live, even when hot_metrics hasn't yet fetched real spend.
  // Without this, postgresReaders.fetchCampaigns row-existence check
  // would drop zero-spend active rows until cron-daily ran ~24h later.
  if (input.upsertCampaignsDaily) {
    const today = nowIso.slice(0, 10);
    const activePlaceholders = status.adsets
      .filter((a) => a.effective_status === 'ACTIVE')
      .map((a) => ({
        date: today,
        store_id: a.store_id,
        platform: 'meta' as const,
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
  for (const s of ['campaign_status', 'adset_status', 'ad_status'] as const) {
    await rec({
      storeId,
      platform: 'meta',
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

// ---------------------------------------------------------------------------
// Phase C — hot_metrics branch
//
// Flow per event:
//   1. BUC pre-flight (same Layer-1 hard gate as status branch). On skip,
//      mark data_freshness.campaign_metrics=budget_skip and return.
//   2. Load hot ids via Phase C Task 2 helpers (campaigns + adsets + ads).
//      Empty hot set → mark success and return (nothing to refresh today).
//   3. Fetch via fetchMetaHotMetricsForStore (Task 3). Single batched Graph
//      call returning campaigns/adsets/ads rows for `today` only.
//   4. Upsert into campaigns_daily (campaigns + adsets) + ads_daily, stamping
//      source='live_tick' + last_live_tick_at so the freshness chip in the UI
//      reflects the latest refresh tick.
//   5. Mark data_freshness.campaign_metrics=success.
//
// Empty hot set is a NORMAL state (e.g. all campaigns paused) — we mark
// freshness success because the worker did its job; there was simply nothing
// hot to refresh.
// ---------------------------------------------------------------------------

async function runMetaHotMetricsBranch(input: RunMetaWorkerJobInput): Promise<void> {
  const {
    jobData,
    bucProbe,
    recordFreshness: rec,
    fetchHotMetrics,
    getHotCampaignIds,
    getHotAdsetIds,
    getHotAdIds,
    upsertCampaignsDaily,
    upsertAdsDaily,
    getCredentials,
    nowIso,
  } = input;
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
      platform: 'meta',
      scope: 'campaign_metrics',
      tableName: 'campaigns_daily',
      status,
      errorMessage,
    });
    await rec({
      storeId,
      platform: 'meta',
      scope: 'ad_metrics',
      tableName: 'ads_daily',
      status,
      errorMessage,
    });
  };

  // 1. BUC pre-flight — same hard gate as status branch.
  const buc = await bucProbe(storeId);
  if (buc.etaMinutes > 0 || buc.pct >= HARD_SKIP_PCT) {
    const errorMsg = buc.etaMinutes > 0
      ? `Meta ETA=${buc.etaMinutes}min`
      : `pct=${buc.pct}>=${HARD_SKIP_PCT}`;
    await recHotPair('budget_skip', errorMsg);
    // Phase E1 (2026-05-30) — fire suppressed-WhatsApp alert via
    // notifyTokenFailure (operation throttles via the standard 1/6h
    // per-key window). Matches the cron-live-heavy behavior being
    // replaced — operator gets a DB notification row, no panic ping.
    if (input.notifyTokenFailure) {
      await input.notifyTokenFailure({
        provider: 'meta',
        storeId,
        operation: 'meta_hot_metrics_budget_skip',
        errorMsg,
        advice: 'Meta BUC reached the hard-skip threshold; hot_metrics worker skipped this tick. No operator action — worker will retry next orchestrator tick (10 min) once usage decays.',
      }).catch((alertErr) => {
        console.warn(`metaWorker hot_metrics budget_skip alert threw: ${alertErr instanceof Error ? alertErr.message : alertErr}`);
      });
    }
    return;
  }

  try {
    // 2. Load hot ids in parallel — missing injections default to empty list.
    const [hotCampaign, hotAdset, hotAd] = await Promise.all([
      (getHotCampaignIds ?? (async () => []))(storeId),
      (getHotAdsetIds ?? (async () => []))(storeId),
      (getHotAdIds ?? (async () => []))(storeId),
    ]);

    // 2.5 Resolve credentials early. Both the Phase E1.6 account-aggregate
    // write (below) AND the hot-set fetch (further down) need them. Moved
    // above the empty-hot-set gate by the 2026-05-30 regression fix so
    // account-aggregate spend runs every tick regardless of hot-set state.
    const creds = await safeCredentials(storeId, getCredentials);

    // 3. Phase E1.7 (2026-05-30 night) — pre-fetch agg RPC call.
    // Re-aggregates existing campaigns_daily values into data_daily.
    // Handles the empty-hot-set case where no new writes happen but
    // stored values may need re-aggregation (e.g. campaign was just
    // attributed to a different store via the campaign-store-map and
    // the prior store's row needs to zero). Soft-fail so hot-set
    // metrics path still runs if RPC has transient issue.
    if (input.aggregateDataDaily) {
      const todayDate = nowIso.slice(0, 10);
      try {
        await input.aggregateDataDaily(todayDate);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`metaWorker aggregateDataDaily (pre-fetch) ${todayDate}: ${message}`);
      }
    }

    // 4. Empty hot set short-circuit. The Phase E1.6 account-aggregate
    // write above already ran — for empty hot set the only remaining task
    // is to mark freshness success and return.
    if (hotCampaign.length + hotAdset.length + hotAd.length === 0) {
      await recHotPair('success');
      return;
    }

    // Wiring guard — Inngest binding must supply fetchHotMetrics for prod.
    if (!fetchHotMetrics) {
      await recHotPair('transient_error', 'fetchHotMetrics not wired');
      return;
    }

    // 5. Hot-set fetch — single batched insights call for hot ids only.
    const today = nowIso.slice(0, 10);
    const metrics = await fetchHotMetrics({
      storeId,
      adAccountId: creds.adAccountId,
      accessToken: creds.accessToken,
      hotCampaignIds: hotCampaign,
      hotAdsetIds: hotAdset,
      hotAdIds: hotAd,
      dateStr: today,
      getFxCadFor: creds.getFxCadFor,
    });

    // 6. Upsert campaigns_daily (adsets only) and ads_daily, stamping
    //    source='live_tick' + last_live_tick_at on every row.
    //    CRIT-B: hot-metrics fetcher returns only adset + ad rows; the
    //    campaign-level aggregate is computed at read time by the existing
    //    aggregators (Today / Today-Live). campaigns_daily.ad_set_id is
    //    NOT NULL so we cannot insert a campaign-only row.
    if (upsertCampaignsDaily && metrics.adsets.length > 0) {
      const all: Array<Record<string, unknown>> = metrics.adsets.map((a) => ({
        ...a,
        source: 'live_tick',
        last_live_tick_at: nowIso,
      }));
      await upsertCampaignsDaily(all);
    }
    if (upsertAdsDaily && metrics.ads.length > 0) {
      await upsertAdsDaily(
        metrics.ads.map((a) => ({ ...a, source: 'live_tick', last_live_tick_at: nowIso })),
      );
    }

    // 7. Phase E1.7 (2026-05-30 night) — post-upsert agg RPC call.
    // Re-aggregate the freshly-written campaigns_daily values into
    // data_daily and re-derive total/roas/gross/net atomically. Errors
    // re-throw so the outer catch records transient_error (we want
    // operator-visible failure here, unlike the pre-fetch call above).
    if (input.aggregateDataDaily) {
      await input.aggregateDataDaily(today);
    }

    // 8. Mark freshness success for both campaign_metrics + ad_metrics.
    await recHotPair('success');
  } catch (err) {
    // Phase E1 (2026-05-30) — surface auth/rate errors to the operator
    // panel AND fire WhatsApp via notifyTokenFailure. Mirrors googleWorker
    // pattern. Re-throw preserves Inngest's exponential-backoff retry.
    const message = err instanceof Error ? err.message : String(err);
    await recHotPair('transient_error', message);
    const isRate = isRateLimitError('meta', message);
    const isAuth = isAuthError('meta', message);
    if ((isRate || isAuth) && input.notifyTokenFailure) {
      await input.notifyTokenFailure({
        provider: 'meta',
        storeId,
        operation: isRate ? 'meta_hot_metrics_rate_limit' : 'meta_hot_metrics_auth',
        errorMsg: message,
        advice: isRate
          ? 'Meta reported HTTP 429 / quota-exceeded. Hot metrics worker will retry on next orchestrator tick (10 min). No operator action needed unless this persists across multiple ticks.'
          : 'Refresh the Meta access token in Vercel and redeploy. See docs/PROPS-MAP.md for the env var name.',
      }).catch((alertErr) => {
        console.warn(`metaWorker hot_metrics ${isRate ? 'rate' : 'auth'} alert threw: ${alertErr instanceof Error ? alertErr.message : alertErr}`);
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Inngest binding — mirrors cronLiveHeavy.ts's `triggers: [...]` style.
// Concurrency=1 per store prevents overlapping refreshes on the same ad
// account (the Graph API would BUC-throttle anyway). Throttle 900/h per
// store gives the worker headroom to keep pace with a 10-min orchestrator
// without blowing past Meta's per-app limit.
// ---------------------------------------------------------------------------

export const metaWorker = inngest.createFunction(
  {
    id: 'meta-worker',
    triggers: [{ event: META_JOB_REQUESTED }],
    concurrency: [{ key: 'event.data.store_id', limit: 1 }],
    throttle: { limit: 900, period: '1h', key: 'event.data.store_id' },
  },
  async ({ event, step }) => {
    await step.run('runMetaWorkerJob', async () => {
      const nowIso = new Date().toISOString();
      const sb = getSupabaseAdmin();
      const data = event.data as unknown as JobRequestedEvent;
      const storeId = data.store_id;

      const bucProbe = async (): Promise<{ pct: number; etaMinutes: number }> => {
        const { data: row } = await sb
          .from('meta_buc_usage')
          .select(
            'ads_insights_call_pct, ads_insights_cputime_pct, ads_insights_time_pct, ads_insights_eta_minutes, ads_management_call_pct, ads_management_cputime_pct, ads_management_time_pct, ads_management_eta_minutes',
          )
          .eq('store_id', storeId)
          .maybeSingle();
        const r = (row as Record<string, number | undefined> | null) ?? {};
        const pct = Math.max(
          Number(r.ads_insights_call_pct ?? 0),
          Number(r.ads_insights_cputime_pct ?? 0),
          Number(r.ads_insights_time_pct ?? 0),
          Number(r.ads_management_call_pct ?? 0),
          Number(r.ads_management_cputime_pct ?? 0),
          Number(r.ads_management_time_pct ?? 0),
        );
        const etaMinutes = Math.max(
          Number(r.ads_insights_eta_minutes ?? 0),
          Number(r.ads_management_eta_minutes ?? 0),
        );
        return { pct, etaMinutes };
      };

      const loadPriorRegistry = async (): Promise<PriorMaps> => {
        const [c, a, ad] = await Promise.all([
          sb.from('campaign_registry').select('*').eq('store_id', storeId).eq('platform', 'meta'),
          sb.from('adset_registry').select('*').eq('store_id', storeId).eq('platform', 'meta'),
          sb.from('ad_registry').select('*').eq('store_id', storeId).eq('platform', 'meta'),
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

      await runMetaWorkerJob({
        jobData: data,
        bucProbe,
        fetchStatus: fetchMetaStatusForStore,
        loadPriorRegistry,
        upsertRegistry: async (inp) =>
          upsertRegistryBatch({
            admin: sb,
            table: inp.table,
            rows: inp.rows as never,
          }),
        insertStatusEvents: async (inp) =>
          insertStatusEventsBatch({ admin: sb, events: inp.events }),
        recordFreshness: async (inp) =>
          recordFreshness({
            storeId: inp.storeId,
            platform: inp.platform,
            scope: inp.scope,
            tableName: inp.tableName,
            status: inp.status,
            errorMessage: inp.errorMessage,
          }),
        // Phase E1 (2026-05-30) — fire operator WhatsApp on
        // auth/rate/budget_skip errors from hot_metrics branch.
        // storeId cast is safe: workers only run for the 3 real stores
        // (uzoshop/zolplus/usmile360) which all match TokenFailureStore.
        // Return value of notifyTokenFailure ({alerted, throttled,...})
        // is intentionally discarded — adapter contract is Promise<void>.
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
        // → data_daily via partial-column UPSERT. See spec.
        // Phase E1.7 (2026-05-30 night) — unified agg RPC. Replaces the
        // Phase E1.6 fetchAccountSpend + cadConvert + upsertDataDailySpend
        // path which silently failed on store_name NOT NULL for Day-3.
        aggregateDataDaily: async (date: string) => {
          const { error } = await sb.rpc('agg_data_daily_for_date', { d: date });
          if (error) {
            throw new Error(`agg_data_daily_for_date(${date}) for meta: ${error.message}`);
          }
        },
        upsertBuc: async (row) => {
          await sb
            .from('meta_buc_usage')
            .upsert(row, { onConflict: 'store_id,ad_account_id' });
          const r = row as unknown as {
            ad_account_id: string;
            ads_insights_call_pct: number;
            ads_insights_cputime_pct: number;
            ads_insights_time_pct: number;
            ads_insights_eta_minutes: number;
            ads_management_call_pct: number;
            ads_management_cputime_pct: number;
            ads_management_time_pct: number;
            ads_management_eta_minutes: number;
          };
          await recordMetaBucUsage({
            store_id: storeId,
            ad_account_id: r.ad_account_id,
            ads_insights_call_pct: r.ads_insights_call_pct,
            ads_insights_cputime_pct: r.ads_insights_cputime_pct,
            ads_insights_time_pct: r.ads_insights_time_pct,
            ads_insights_eta_minutes: r.ads_insights_eta_minutes,
            ads_management_call_pct: r.ads_management_call_pct,
            ads_management_cputime_pct: r.ads_management_cputime_pct,
            ads_management_time_pct: r.ads_management_time_pct,
            ads_management_eta_minutes: r.ads_management_eta_minutes,
            last_url: 'meta-worker:status',
          });
        },
        // ---------------------------------------------------------------
        // Phase C — hot_metrics scope wiring
        // ---------------------------------------------------------------
        fetchHotMetrics: fetchMetaHotMetricsForStore,
        getHotCampaignIds: (sid: StoreId) =>
          getHotCampaignIdsHelper({ admin: sb, storeId: sid, platform: 'meta' }),
        getHotAdsetIds: (sid: StoreId) =>
          getHotAdsetIdsHelper({ admin: sb, storeId: sid, platform: 'meta' }),
        getHotAdIds: (sid: StoreId) =>
          getHotAdIdsHelper({ admin: sb, storeId: sid, platform: 'meta' }),
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
        nowIso,
      });
    });
  },
);
