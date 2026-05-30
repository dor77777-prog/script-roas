/**
 * Phase 13.9 (2026-05-27) — cron-live-heavy.
 *
 * Runs every 30 minutes (Asia/Jerusalem). For each store + each date in
 * the rolling 2-day window [today, yesterday]:
 *   1. Fetches Meta adset insights + ad insights + budgets
 *   2. Fetches Google ad-group insights + ad insights
 *   3. Fetches TikTok ad insights
 *   4. Calls persistCampaignsLive() to UPSERT campaigns_daily + ads_daily
 *
 * Co-exists with cron-daily (runs once at 01:00) and cron-live (runs
 * every 10 min, writes only data_daily + status placeholders to
 * campaigns_daily without metric columns). Same Supabase UPSERT keys, so
 * concurrent writes reconcile per-column (last writer wins for the
 * columns it touches; absent payload keys preserve prior values).
 *
 * Rate-limit & auth failures soft-fail per-platform: when a platform's
 * fetcher throws, we (a) classify the error via isRateLimitError /
 * isAuthError, (b) fire a throttled WhatsApp alert via
 * notifyTokenFailure when appropriate, and (c) let the persist step run
 * for the platforms that DID succeed. Next tick (30 min later) retries.
 *
 * Mapping layer (see PersistCampaignsLiveInput in
 * `@/lib/inngest/persistCampaignsLive.ts` for the normalized row types):
 *   - MetaAdRow            → MetaAdLiveRow      (strip storeId/date/platform)
 *   - GoogleAdsAdGroupRow  → GoogleAdGroupLiveRow (drop `currency`)
 *   - GoogleAdsAdRow       → GoogleAdLiveRow    (rename spendCad→spend,
 *                                                 conversionValueCad→conversionValue)
 *   - TikTokAdRow          → TikTokAdLiveRow    (rename adGroupId/Name→adSetId/Name,
 *                                                 drop `currency`)
 */

import { inngest } from '@/inngest/client';
import {
  fetchMetaAdSetInsights,
  fetchMetaAdInsights,
  fetchMetaBudgets,
  type MetaAdSetRow,
  type MetaAdRow,
  type MetaBudgets,
} from '@/lib/fetchers/meta';
import {
  fetchGoogleAdsAdGroupInsights,
  fetchGoogleAdsAdInsights,
  type GoogleAdsAdGroupRow,
  type GoogleAdsAdRow,
} from '@/lib/fetchers/googleAds';
import { fetchTikTokAdInsights, type TikTokAdRow } from '@/lib/fetchers/tiktok';
import { getFxRate } from '@/lib/fetchers/fx';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { todayInIsrael } from '@/lib/getTodayInIsrael';
import {
  persistCampaignsLive,
  type MetaAdLiveRow,
  type GoogleAdGroupLiveRow,
  type GoogleAdLiveRow,
  type TikTokAdLiveRow,
} from '@/lib/inngest/persistCampaignsLive';
import { isAuthError, isRateLimitError } from '@/lib/notifications/detectAuthError';
import { notifyTokenFailure } from '@/lib/notifications/tokenFailures';
import { getMetaBucUsageForStore } from '@/lib/notifications/metaBucUsage';
import { recordFreshness } from '@/lib/inngest/freshness';

type StoreId = 'uzoshop' | 'zolplus' | 'usmile360';
const ALL_STORES: StoreId[] = ['uzoshop', 'zolplus', 'usmile360'];

/**
 * Tracks which fetcher threw — used by the per-platform soft-fail path to
 * classify the error and fire a throttled WhatsApp alert. Each platform
 * gets its own bucket so a Meta auth-failure doesn't shadow Google's.
 */
type PlatformFailure = {
  provider: 'meta' | 'google' | 'tiktok';
  errorMsg: string;
};

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Subset of Inngest's step API we use — matches the StepRunner pattern in
 * cronLive.ts. Tests pass a stub of this shape directly to
 * `runHeavyForStore`; production goes through the factory below which
 * casts Inngest's full step API down to this subset.
 */
export type StepRunner = {
  run<T>(id: string, cb: () => Promise<T>): Promise<T>;
};

// =============================================================================
// Mapping layer — raw fetcher rows → normalized *LiveRow types
// =============================================================================
//
// persistCampaignsLive defines its OWN normalized row types (see Task 2 doc-
// string in persistCampaignsLive.ts:24-36) so it can stay agnostic of
// per-fetcher quirks. Each mapper is intentionally trivial — most are
// field renames / dropped redundant carriers — so the helper stays pure.

function mapMetaAdRow(r: MetaAdRow): MetaAdLiveRow {
  return {
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    adSetId: r.adSetId,
    adSetName: r.adSetName,
    adId: r.adId,
    adName: r.adName,
    spend: r.spend,
    currency: r.currency,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    conversionValue: r.conversionValue,
  };
}

function mapGoogleAdGroupRow(r: GoogleAdsAdGroupRow): GoogleAdGroupLiveRow {
  return {
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    adSetId: r.adSetId,
    adSetName: r.adSetName,
    // Google Ads is CAD-native for uzoshop — the fetcher emits `spend` in
    // the account currency (also CAD for uzoshop), so the helper writes
    // it through to spend_cad unchanged.
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    conversionValue: r.conversionValue,
    effectiveStatus: r.effectiveStatus,
  };
}

function mapGoogleAdRow(r: GoogleAdsAdRow): GoogleAdLiveRow {
  return {
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    adSetId: r.adSetId,
    adSetName: r.adSetName,
    adId: r.adId,
    adName: r.adName,
    // The fetcher type uses `spendCad`/`conversionValueCad`; the live row
    // shape uses `spend`/`conversionValue`. Same CAD-native passthrough
    // semantics (see mapGoogleAdGroupRow note).
    spend: r.spendCad,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    conversionValue: r.conversionValueCad,
  };
}

function mapTikTokAdRow(r: TikTokAdRow): TikTokAdLiveRow {
  return {
    // Phase A.5 — propagate the fetcher-resolved storeId so persistCampaignsLive
    // can upsert each row under the correct store_id for shared TikTok advertisers.
    storeId: r.storeId,
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    // TikTok's API calls them ad_group; the unified schema calls them
    // ad_set. Rename here so the helper doesn't have to know about both.
    adSetId: r.adGroupId,
    adSetName: r.adGroupName,
    adId: r.adId,
    adName: r.adName,
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    conversionValue: r.conversionValue,
    effectiveStatus: r.effectiveStatus,
  };
}

// =============================================================================
// Handler — exported for tests + the factory
// =============================================================================

// ---------------------------------------------------------------------------
// Pre-flight budget-gate constants (Phase A 2026-05-29)
// ---------------------------------------------------------------------------
const META_BUDGET_THRESHOLD_PCT = 80;
const BUC_FRESH_WINDOW_MIN = 15; // "Pre-flight read sees stale value, skips wrongly" mitigation

export async function runHeavyForStore(
  storeId: StoreId,
  { step }: { step: StepRunner },
): Promise<void> {
  const today = todayInIsrael();
  const yesterday = addDaysIso(today, -1);
  const dates = [today, yesterday];

  // ------------------------------------------------------------------
  // Pre-flight Meta BUC gate (Phase A 2026-05-29)
  //
  // Read the most recent meta_buc_usage snapshot for this store. If
  // any insights pct >= 80 AND the snapshot was written within the
  // last 15 min, short-circuit the entire Meta fetch block for this
  // tick. Google + TikTok still run. The skip is recorded in
  // data_freshness for all three Meta scopes.
  // ------------------------------------------------------------------
  const bucUsage = await step.run(`pre-flight-meta-buc-${storeId}`, async () =>
    getMetaBucUsageForStore(storeId),
  );

  const metaSkipDueToBudget = (() => {
    if (!bucUsage || !bucUsage.rows.length) return false;
    // Pick the most recent last_updated_at across rows (one row per ad-account)
    const newest = Math.max(
      ...bucUsage.rows.map((r) => new Date((r as { last_updated_at: string }).last_updated_at).getTime()),
    );
    const ageMin = (Date.now() - newest) / 60_000;
    if (ageMin > BUC_FRESH_WINDOW_MIN) return false; // stale: proceed optimistically
    return (
      bucUsage.max_ads_insights_call_pct >= META_BUDGET_THRESHOLD_PCT ||
      bucUsage.max_ads_insights_cputime_pct >= META_BUDGET_THRESHOLD_PCT ||
      bucUsage.max_ads_insights_time_pct >= META_BUDGET_THRESHOLD_PCT
    );
  })();

  // If pre-flight gates Meta, record freshness for all three scopes once
  // (not per-date — a BUC-skip is a store-tick-level event, not date-scoped).
  if (metaSkipDueToBudget) {
    const skipMsg = 'META_BUDGET_HIGH: pre-flight skip; max BUC ≥ 80% within last 15 min';
    await Promise.all([
      recordFreshness({
        storeId,
        platform: 'meta',
        scope: 'campaign_metrics',
        tableName: 'campaigns_daily',
        status: 'budget_skip',
        errorCode: 'META_BUDGET_HIGH',
        errorMessage: skipMsg,
        budgetSkip: true,
      }),
      recordFreshness({
        storeId,
        platform: 'meta',
        scope: 'adset_metrics',
        tableName: 'campaigns_daily',
        status: 'budget_skip',
        errorCode: 'META_BUDGET_HIGH',
        errorMessage: skipMsg,
        budgetSkip: true,
      }),
      recordFreshness({
        storeId,
        platform: 'meta',
        scope: 'ad_metrics',
        tableName: 'ads_daily',
        status: 'budget_skip',
        errorCode: 'META_BUDGET_HIGH',
        errorMessage: skipMsg,
        budgetSkip: true,
      }),
    ]);
  }

  for (const date of dates) {
    // P1-7 / A7-F2 (2026-05-28): split fetch and persist into separate
    // step.run calls so Inngest memoizes the fetched data across retries.
    // Pre-fix: a combined "fetch-and-persist-{store}-{date}" step re-fetched
    // fresh platform data on every Inngest retry, producing subtle data-drift
    // (the retried persist used newer impressions/spend numbers than the first
    // attempt). Splitting into two steps means the fetch step result is
    // memoized — on retry, Inngest replays the memoized fetch result rather
    // than re-executing the fetch callback.

    // FX-date artifact (P0-3, 2026-05-28): pass each date's own date to
    // getFxRate instead of the captured `today`. Pre-fix: both today and
    // yesterday used today's ILS→CAD rate, causing per-day ~$10 CAD variance
    // vs cron-daily's nightly write (which correctly uses yesterday's rate
    // for yesterday's row). cron-daily corrects the yesterday row at 00:05 IL
    // but this fix prevents the intraday drift from accumulating.
    function makeFxForDate(dateStr: string) {
      return async function getFx(_amount: number, currency: string): Promise<number | null> {
        try {
          const rate = await getFxRate(currency.toUpperCase(), 'CAD', dateStr);
          if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
          return rate;
        } catch {
          return null;
        }
      };
    }

    type FetchedPlatformData = {
      meta: {
        adsetRows: MetaAdSetRow[];
        adRows: MetaAdLiveRow[];
        budgets: MetaBudgets;
      };
      google: {
        adGroupRows: GoogleAdGroupLiveRow[];
        adRows: GoogleAdLiveRow[];
      };
      tiktok: { adRows: TikTokAdLiveRow[] };
      failures: PlatformFailure[];
    };

    // Step A: fetch all platforms for this date (memoized by Inngest on retry).
    const fetched = (await step.run(`fetch-${storeId}-${date}`, async () => {
      const failures: PlatformFailure[] = [];

      // Per-platform empty sentinels — used when the fetcher throws so
      // persistCampaignsLive sees an empty array for that platform and
      // simply skips its branch (no UPSERT rows for that platform this
      // tick).
      const metaEmpty = {
        adsetRows: [] as MetaAdSetRow[],
        adRows: [] as MetaAdLiveRow[],
        budgets: { currency: 'ILS', campaigns: {}, adSets: {} } as MetaBudgets,
      };
      const googleEmpty = {
        adGroupRows: [] as GoogleAdGroupLiveRow[],
        adRows: [] as GoogleAdLiveRow[],
      };
      const tiktokEmpty = { adRows: [] as TikTokAdLiveRow[] };

      const meta = await (async () => {
        // Pre-flight gate: skip Meta entirely if BUC is high + fresh
        if (metaSkipDueToBudget) {
          failures.push({
            provider: 'meta',
            errorMsg:
              'META_BUDGET_HIGH: pre-flight skip; max BUC ≥ 80% within last 15 min',
          });
          return metaEmpty;
        }
        try {
          const [adsetRows, adRowsRaw, budgets] = await Promise.all([
            fetchMetaAdSetInsights(storeId, date),
            fetchMetaAdInsights(storeId, date),
            fetchMetaBudgets(storeId),
          ]);
          return { adsetRows, adRows: adRowsRaw.map(mapMetaAdRow), budgets };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          failures.push({ provider: 'meta', errorMsg: msg });
          return metaEmpty;
        }
      })();

      const google = await (async () => {
        try {
          const [adGroupRowsRaw, adRowsRaw] = await Promise.all([
            fetchGoogleAdsAdGroupInsights(storeId, date),
            fetchGoogleAdsAdInsights(storeId, date),
          ]);
          return {
            adGroupRows: adGroupRowsRaw.map(mapGoogleAdGroupRow),
            adRows: adRowsRaw.map(mapGoogleAdRow),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          failures.push({ provider: 'google', errorMsg: msg });
          return googleEmpty;
        }
      })();

      const tiktok = await (async () => {
        try {
          const adRowsRaw = await fetchTikTokAdInsights(storeId, date);
          return { adRows: adRowsRaw.map(mapTikTokAdRow) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          failures.push({ provider: 'tiktok', errorMsg: msg });
          return tiktokEmpty;
        }
      })();

      return { meta, google, tiktok, failures } satisfies FetchedPlatformData;
    })) as FetchedPlatformData;

    // Step B: persist whatever did succeed (memoized fetch result is used,
    // not re-fetched on retry).
    await step.run(`persist-${storeId}-${date}`, async () => {
      const { meta, google, tiktok, failures } = fetched;

      // Fire per-platform alerts BEFORE persist — even if persist fails
      // the operator still sees the upstream cause.
      for (const f of failures) {
        const isRate = isRateLimitError(f.provider, f.errorMsg);
        const isAuth = isAuthError(f.provider, f.errorMsg);
        if (isRate || isAuth) {
          await notifyTokenFailure({
            provider: f.provider,
            storeId,
            // Operation key is stable per (store, platform) so notifyTokenFailure's
            // (provider, storeId, operation) throttle dedupes across the rolling-window
            // dates within one tick — one alert per outage, not one-per-date.
            //
            // Phase A 2026-05-29: META_BUDGET_HIGH (both pre-flight synthetic
            // failure and reactive MetaBudgetHighError thrown mid-fetch) routes
            // to `cron_live_heavy_budget_skip` — this engages the Task 11
            // WhatsApp-suppression gate (DB row written, no panic alert).
            operation: isRate
              ? (f.errorMsg.includes('META_BUDGET_HIGH')
                  ? 'cron_live_heavy_budget_skip'
                  : 'cron_live_heavy_rate_limit')
              : 'cron_live_heavy_auth',
            errorMsg: f.errorMsg,
            advice: f.errorMsg.includes('META_BUDGET_HIGH')
              ? 'Meta BUC reached 80% threshold; pre-flight gate skipped this tick. No operator action — cron-live-heavy will retry next tick once usage decays.'
              : isRate
                ? 'Platform reported HTTP 429 / quota-exceeded. cron-live-heavy will retry on the next tick (30 min). No operator action needed unless this persists across multiple ticks.'
                : 'Refresh the platform access token in Vercel and redeploy. See docs/PROPS-MAP.md for the per-platform env var name.',
          }).catch((alertErr) => {
            console.warn(
              `cron-live-heavy: notifyTokenFailure threw for ${f.provider}/${storeId}/${date}: ${alertErr instanceof Error ? alertErr.message : alertErr}`,
            );
          });
        } else {
          console.warn(
            `cron-live-heavy: ${f.provider} fetch failed for ${storeId} ${date} (no alert — neither rate-limit nor auth): ${f.errorMsg}`,
          );
        }
      }

      // Persist whatever did succeed. If all three platforms failed this
      // tick, persistCampaignsLive sees three empty arrays and short-
      // circuits (no UPSERTs).
      await persistCampaignsLive({
        storeId,
        dateStr: date,
        admin: getSupabaseAdmin(),
        getFx: makeFxForDate(date),
        meta,
        google,
        tiktok,
      });
    });
  }
}

// =============================================================================
// Factory — one Inngest function per store
// =============================================================================

/**
 * Phase A 2026-05-29 — Per-store cron stagger.
 *
 * Previously all 3 stores fired at :00 and :30 (* /30), meaning Meta's shared
 * app rate-limit budget got hit by 3 simultaneous batches of insights calls.
 * Now each store gets a 10-min offset so the sibling ticks don't pile up:
 *
 *   uzoshop:    :00 and :30 (offset +0 min)
 *   zolplus:    :10 and :40 (offset +10 min)
 *   usmile360:  :20 and :50 (offset +20 min)
 *
 * Each store still runs the same 2-date rolling window [today, yesterday] per
 * tick. The stagger is purely a scheduling change — runHeavyForStore is
 * unchanged.
 */
const CRON_STAGGER: Record<StoreId, string> = {
  uzoshop:   'TZ=Asia/Jerusalem 0,30 * * * *',
  zolplus:   'TZ=Asia/Jerusalem 10,40 * * * *',
  usmile360: 'TZ=Asia/Jerusalem 20,50 * * * *',
};

function makeCronLiveHeavy(storeId: StoreId) {
  return inngest.createFunction(
    {
      id: `cron-live-heavy-${storeId}`,
      // Phase A 2026-05-29 — staggered per store so the 3 Meta accounts
      // don't all hit /insights at :00 + :30 together. Each store gets
      // 10 min of "Meta breathing room" between sibling ticks, reducing
      // the chance of any one store tripping the pre-flight gate due to
      // a shared-app rate-limit pileup.
      triggers: [{ cron: CRON_STAGGER[storeId] }],
    },
    async ({ step }) =>
      runHeavyForStore(storeId, { step: step as unknown as StepRunner }),
  );
}

/**
 * Phase E1 (2026-05-30) — DISABLED. The 3 per-store cron-live-heavy
 * Inngest functions are no longer registered. cron-tick-orchestrator
 * (every 10 min) is the single source of live truth for
 * campaigns_daily + ads_daily refreshes via the hot_metrics worker
 * branches in metaWorker / googleWorker / tiktokWorker. The
 * runHeavyForStore + makeCronLiveHeavy + persistCampaignsLive code is
 * retained for (a) existing vitest fixtures and (b) potential
 * rollback via git revert. See:
 * docs/superpowers/specs/2026-05-30-phase-e1-decommission-cron-live-heavy-design.md
 */
export const cronLiveHeavyFunctions: never[] = [];
