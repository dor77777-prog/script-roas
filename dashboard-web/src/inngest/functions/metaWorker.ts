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
import {
  getAdAccountIdForStore,
  getMetaAccessTokenForStore,
  getFxCadAdapterForStore,
} from '@/lib/fetchers/metaAccountConfig';
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
        nowIso,
      });
    });
  },
);
