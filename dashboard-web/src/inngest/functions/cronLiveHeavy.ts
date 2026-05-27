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

export async function runHeavyForStore(
  storeId: StoreId,
  { step }: { step: StepRunner },
): Promise<void> {
  const today = todayInIsrael();
  const yesterday = addDaysIso(today, -1);
  const dates = [today, yesterday];

  // FX closure shared across all dates / currencies for this tick.
  // Returns the RATE (not the converted amount) — persistCampaignsLive's
  // local `cadFor` then multiplies amount × rate. This matches Task 2's
  // contract (persistCampaignsLive.ts:154-164).
  async function getFx(_amount: number, currency: string): Promise<number | null> {
    try {
      const rate = await getFxRate(currency.toUpperCase(), 'CAD', today);
      if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
      return rate;
    } catch {
      return null;
    }
  }

  for (const date of dates) {
    await step.run(`fetch-and-persist-${storeId}-${date}`, async () => {
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
            operation: isRate
              ? 'cron_live_heavy_rate_limit'
              : 'cron_live_heavy_auth',
            errorMsg: f.errorMsg,
            advice: isRate
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
        getFx,
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

function makeCronLiveHeavy(storeId: StoreId) {
  return inngest.createFunction(
    {
      id: `cron-live-heavy-${storeId}`,
      // Every 30 min, Asia/Jerusalem. Sits between cron-live (10 min,
      // light) and cron-daily (01:00, full). The 30-min cadence is
      // calibrated to stay under Meta's per-app rate limit for tier-2
      // accounts (~600 calls/h) given 6 fetches × 2 dates × 3 stores per
      // tick + Meta's standard insights paging.
      triggers: [{ cron: 'TZ=Asia/Jerusalem */30 * * * *' }],
    },
    async ({ step }) =>
      runHeavyForStore(storeId, { step: step as unknown as StepRunner }),
  );
}

/**
 * 3 cron-live-heavy functions — exported as an array so
 * `src/app/api/inngest/route.ts` can spread them into its `serve()` list
 * (mirrors the cronLiveFunctions / cronDailyFunctions pattern).
 */
export const cronLiveHeavyFunctions = ALL_STORES.map(makeCronLiveHeavy);
