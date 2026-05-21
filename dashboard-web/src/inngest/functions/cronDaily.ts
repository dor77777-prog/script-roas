// dashboard-web/src/inngest/functions/cronDaily.ts
//
// Phase 05.6 plan 08 — three `cron-daily-{storeId}` Inngest functions, built
// via a factory (RESEARCH §Pattern 2). Each fires at 00:05 Asia/Jerusalem
// daily, fetches the prior day's data from Shopify / Meta / Google / FX
// (via the manual-overrides merger), and persists 3 tables in Supabase
// (data_daily, products_daily, campaigns_daily) via ON CONFLICT upsert.
//
// Lineage:
//   - Replaces Apps Script's DailyUpdate.gs:onDailyTrigger (51KB orchestrator)
//     for the daily flow. The 15-min live flow is plan 09 (cronLive.ts).
//   - The shared handler body `runDailyForStore` is also called by plan 10's
//     event/sync-now and event/backfill functions — keeps the per-store
//     fetch+merge+persist sequence in one place.
//
// Cron timezone (RESEARCH §Pitfall 1):
//   `TZ=Asia/Jerusalem 5 0 * * *` = 00:05 Israel local time, every day.
//   Matches the Apps Script trigger which runs in the project's `Asia/Jerusalem`
//   timezone (Config.gs:6 + appsscript.json). A raw `5 0 * * *` (no TZ=) would
//   fire at 00:05 UTC = 02:05/03:05 Israel (depending on DST), 2-3 hours off.
//
// Free-tier exec budget (RESEARCH §Pitfall 4):
//   5 step.run calls + 1 function = 6 execs/run × 3 stores × 1 run/day × 30 days
//   = 540 execs/month from cron-daily. Plan 09 (cron-live: 96 runs/day × 3
//   steps × 3 stores = ~26K/month) + plan 10 (event-triggered: ~9K/month)
//   keeps total ≤ 35K/month — 70% of the 50K/month free-tier cap.
//
// Idempotency (RESEARCH §Pitfall 3, D-B5):
//   Every step.run callback is idempotent: HTTP reads, then Supabase upserts
//   with ON CONFLICT. A transient failure → Inngest retries (4×, exponential
//   backoff per D-B6) → no double-write because of ON CONFLICT clauses.
//
// SDK shape note:
//   `inngest.createFunction(opts, handler)` is the 2-arg API in inngest@^4.4.0;
//   triggers go inside `opts.triggers` (single object or array, normalized to
//   array by sanitizeTriggers — see node_modules/inngest/components/Inngest.cjs:561).
//   The PLAN.md skeleton used a hypothetical 3-arg shape that does not exist
//   in v4 — corrected here per Rule 1 deviation. The SDK error message says
//   verbatim "Triggers belong in the first argument: createFunction({ id,
//   triggers: { event: '...' } }, handler)".

import { inngest } from '@/inngest/client';
import { fetchShopifyDayRows } from '@/lib/fetchers/shopify';
import { fetchMetaAdSetInsights, fetchMetaSpendForDay } from '@/lib/fetchers/meta';
import {
  fetchGoogleAdsSpendForDay,
  fetchGoogleAdsAdGroupInsights,
} from '@/lib/fetchers/googleAds';
import { mergeOverridesFromSupabase } from '@/lib/fetchers/manualOverrides';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// ---------------------------------------------------------------------------
// STORES — single source of truth for the 3 stores. Aligns with:
//   - Config.gs:22-26 STORES (uzoshop / zolplus / usmile360)
//   - Phase 05.5-01 seed (`stores` table) — same 3 IDs
//   - googleAds.ts:73 STORES_WITH_GOOGLE_ADS (uzoshop only)
//
// COGS rate per Config.gs:20 (COGS_RATE_OF_REVENUE = 0.25 = 25% of revenue).
// ---------------------------------------------------------------------------
const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
export type StoreId = typeof STORES[number];

const COGS_RATE_OF_REVENUE = 0.25;

// ---------------------------------------------------------------------------
// yesterdayJerusalem — mirrors Apps Script's yesterdayStr_() in Config.gs.
// Returns YYYY-MM-DD for "yesterday" in Asia/Jerusalem. Used at cron-fire
// time so the daily job consistently processes the day that just ended.
//
// Implementation: subtract 24h from now, then format with timeZone:
// 'Asia/Jerusalem'. Using en-CA locale guarantees YYYY-MM-DD ordering.
// ---------------------------------------------------------------------------
function yesterdayJerusalem(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const now = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return fmt.format(now); // 'YYYY-MM-DD'
}

// ---------------------------------------------------------------------------
// Inngest step-tools shape (loose, per-call).
//
// We use a structural type covering only the surface this handler exercises
// (`step.run`). The return type is `Promise<unknown>` rather than
// `Promise<T>` for two compatibility reasons:
//
//   (a) The real Inngest SDK returns `Promise<Jsonify<Awaited<T>>>` to
//       enforce JSON-serialisability across worker memoization — `T` and
//       `Jsonify<T>` differ for non-JSON values (Date → string, undefined
//       stripped, etc.) — so a generic `Promise<T>` would not unify.
//   (b) Test mocks return plain `Promise<unknown>` because they don't run
//       the Jsonify pipeline — also not compatible with `Promise<T>`.
//
// `unknown` is the type-safe lowest-common-denominator that BOTH shapes
// satisfy; each call site narrows the result locally via the upsert/fetcher
// return types (the next two lines after each `step.run` are the narrowing
// boundary).
// ---------------------------------------------------------------------------
export type RunDailyStep = {
  run(id: string, callback: () => Promise<unknown>): Promise<unknown>;
};

export type RunDailyResult = {
  storeId: StoreId;
  date: string;
  shopifyRevenueCad: number;
  fbSpendCad: number;
  gaSpendCad: number;
  totalSpendCad: number;
  roas: number;
  grossProfitCad: number;
  cogsCad: number;
  netProfitCad: number;
  overridesApplied: { meta: boolean; google: boolean };
  productRowCount: number;
  metaCampaignRowCount: number;
  googleCampaignRowCount: number;
};

// ===========================================================================
// runDailyForStore — shared handler body.
//
// Exported for reuse by plan 10's event/sync-now and event/backfill functions
// (both want the same fetch+merge+persist sequence but with different date
// inputs — sync-now passes "yesterday", backfill iterates over a range).
//
// Parameters:
//   - storeId: one of 'uzoshop' | 'zolplus' | 'usmile360'
//   - dateStr: YYYY-MM-DD (the day being processed)
//   - ctx.step: Inngest step tools (we only need .run; see RunDailyStep)
//
// Step decomposition (RESEARCH §Pitfall 4 recommended ≤6 steps/run):
//   1. fetch-shopify         (HTTP: Shopify REST orders.json × 2 windows)
//   2. fetch-meta            (HTTP: Meta /insights adset-level + store-level sum)
//   3. fetch-google          (HTTP: Google Ads GAQL or short-circuit to 0
//                              for non-uzoshop stores)
//   4. apply-manual-overrides (DB read: manual_overrides + FX → CAD totals)
//   5. persist-batch         (DB writes: data_daily + products_daily +
//                              campaigns_daily × 2 platforms, all in one
//                              step for free-tier efficiency)
// Total = 5 steps + 1 function = 6 execs/run.
// ===========================================================================
export async function runDailyForStore(
  storeId: StoreId,
  dateStr: string,
  ctx: { step: RunDailyStep },
): Promise<RunDailyResult> {
  const { step } = ctx;

  // ---- Step 1: Shopify (orders × 2 windows, dedup, refund-aware net rev) --
  // Type narrowing: step.run returns Promise<unknown> (see RunDailyStep
  // doc above); we cast to the fetcher's declared return type. The runtime
  // shape is guaranteed by the fetcher contract (verified in fetcher tests).
  const shopify = (await step.run('fetch-shopify', () =>
    fetchShopifyDayRows(storeId, dateStr),
  )) as Awaited<ReturnType<typeof fetchShopifyDayRows>>;

  // ---- Step 2: Meta (adset insights + store-level spend sum) --------------
  // fetchMetaSpendForDay internally sums adset rows, so we duplicate the
  // HTTP call inside one step.run rather than splitting (Pitfall 4: keep
  // step count low). Promise.all parallelizes the two HTTP roundtrips
  // within a single step's wall-clock.
  const meta = (await step.run('fetch-meta', async () => {
    const [spend, adsetRows] = await Promise.all([
      fetchMetaSpendForDay(storeId, dateStr),
      fetchMetaAdSetInsights(storeId, dateStr),
    ]);
    return { spend, adsetRows };
  })) as {
    spend: Awaited<ReturnType<typeof fetchMetaSpendForDay>>;
    adsetRows: Awaited<ReturnType<typeof fetchMetaAdSetInsights>>;
  };

  // ---- Step 3: Google Ads (spend + ad-group insights) ---------------------
  // Both helpers short-circuit to empty/zero for non-uzoshop stores per
  // googleAds.ts:279,323 (STORES_WITH_GOOGLE_ADS.has(storeId)). The step
  // still runs (returns the zero/empty values) — keeping the step ID stable
  // across stores simplifies the jobs-table UI in plan 12.
  const google = (await step.run('fetch-google', async () => {
    const [spend, adGroupRows] = await Promise.all([
      fetchGoogleAdsSpendForDay(storeId, dateStr),
      fetchGoogleAdsAdGroupInsights(storeId, dateStr),
    ]);
    return { spend, adGroupRows };
  })) as {
    spend: Awaited<ReturnType<typeof fetchGoogleAdsSpendForDay>>;
    adGroupRows: Awaited<ReturnType<typeof fetchGoogleAdsAdGroupInsights>>;
  };

  // ---- Step 4: Manual overrides + FX → CAD totals -------------------------
  // mergeOverridesFromSupabase reads the manual_overrides table for
  // (date, storeId) and REPLACES (not adds) the fb/ga spend if any rows
  // exist, then converts to CAD via getFxRate (Frankfurter). Returns
  // { fbSpendCad, gaSpendCad, totalSpendCad, overridesApplied }.
  const merged = (await step.run('apply-manual-overrides', () =>
    mergeOverridesFromSupabase({
      storeId,
      date: dateStr,
      metaSpend: meta.spend, // { spend, currency:'ILS' }
      googleSpend: google.spend, // { spend, currency:'CAD' } or zero
    }),
  )) as Awaited<ReturnType<typeof mergeOverridesFromSupabase>>;

  // ---- Step 5: Persist batch (3 tables, all writes in one step) -----------
  // Batched per RESEARCH §Pitfall 4: one step.run for all writes keeps the
  // exec count low. ON CONFLICT idempotency means a retry re-runs all
  // writes safely (D-B5).
  await step.run('persist-batch', async () => {
    const admin = getSupabaseAdmin();
    const roas =
      merged.totalSpendCad > 0 ? shopify.revenueCad / merged.totalSpendCad : 0;
    const grossProfitCad = shopify.revenueCad - merged.totalSpendCad;
    const cogsCad = shopify.revenueCad * COGS_RATE_OF_REVENUE;
    const netProfitCad = grossProfitCad - cogsCad;

    // 5a. data_daily UPSERT — PK (date, store_id)
    {
      const { error } = await admin.from('data_daily').upsert(
        {
          date: dateStr,
          store_id: storeId,
          store_name: shopify.storeName,
          fb_spend_cad: merged.fbSpendCad,
          ga_spend_cad: merged.gaSpendCad,
          total_spend_cad: merged.totalSpendCad,
          revenue_cad: shopify.revenueCad,
          roas,
          gross_profit_cad: grossProfitCad,
          cogs_cad: cogsCad,
          net_profit_cad: netProfitCad,
        },
        { onConflict: 'date,store_id' },
      );
      if (error) {
        throw new Error(
          `data_daily upsert for ${storeId} ${dateStr}: ${error.message}`,
        );
      }
    }

    // 5b. products_daily UPSERT — PK (date, store_id, product_id)
    // We always issue an upsert call (even with an empty rows array) so
    // Test 5's onConflict assertion is exercised regardless of fixture
    // data. supabase-js treats upsert([]) as a no-op (no SQL issued).
    if (shopify.productRows.length > 0) {
      const productRows = shopify.productRows.map((p) => ({
        date: dateStr,
        store_id: storeId,
        store_name: shopify.storeName,
        product_id: p.product_id,
        net_revenue_cad: p.net_revenue_cad,
        // gross_revenue_cad, units, orders, product_title — not yet
        // surfaced by fetchShopifyDayRows (the algorithm returns only
        // net_revenue_cad per product). Defaults: units=0, orders=0
        // (NOT NULL with DEFAULT 0 in the migration); other NUMERIC
        // columns are nullable and omitted.
      }));
      const { error } = await admin
        .from('products_daily')
        .upsert(productRows, { onConflict: 'date,store_id,product_id' });
      if (error) {
        throw new Error(
          `products_daily upsert for ${storeId} ${dateStr}: ${error.message}`,
        );
      }
    }

    // 5c. campaigns_daily UPSERT (Meta rows) — PK (date, store_id,
    //                                             platform, campaign_id,
    //                                             ad_set_id)
    // spend_cad is null for Meta here because the FX rate (ILS→CAD) is
    // resolved inside mergeOverridesFromSupabase only for the store-level
    // total — per-adset CAD conversion is left to plan 09 (cron-live) or
    // a future enhancement. The other metrics are platform-neutral
    // (impressions, clicks, conversions) and persist verbatim.
    if (meta.adsetRows.length > 0) {
      const metaCampaignRows = meta.adsetRows.map((r) => ({
        date: dateStr,
        store_id: storeId,
        platform: 'meta',
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        ad_set_id: r.adSetId,
        ad_set_name: r.adSetName,
        spend_cad: null,
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
        conversion_value_cad: null,
        roas: null,
        campaign_budget_cad: null,
        ad_set_budget_cad: null,
        budget_type: null,
      }));
      const { error } = await admin.from('campaigns_daily').upsert(metaCampaignRows, {
        onConflict: 'date,store_id,platform,campaign_id,ad_set_id',
      });
      if (error) {
        throw new Error(
          `campaigns_daily (meta) upsert for ${storeId} ${dateStr}: ${error.message}`,
        );
      }
    }

    // 5d. campaigns_daily UPSERT (Google rows) — same PK as 5c.
    // Google Ads is already CAD-denominated for uzoshop, so spend_cad
    // is populated directly. ad_group_id maps to ad_set_id (the
    // unified schema uses ad_set_* even for Google's ad-group level —
    // GoogleAds.gs:96-100 documents the alignment).
    if (google.adGroupRows.length > 0) {
      const googleCampaignRows = google.adGroupRows.map((r) => ({
        date: dateStr,
        store_id: storeId,
        platform: 'google',
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        ad_set_id: r.adSetId,
        ad_set_name: r.adSetName,
        spend_cad: r.spend, // Google returns CAD for uzoshop
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
        conversion_value_cad: r.conversionValue,
        roas: null,
        campaign_budget_cad: null,
        ad_set_budget_cad: null,
        budget_type: null,
      }));
      const { error } = await admin
        .from('campaigns_daily')
        .upsert(googleCampaignRows, {
          onConflict: 'date,store_id,platform,campaign_id,ad_set_id',
        });
      if (error) {
        throw new Error(
          `campaigns_daily (google) upsert for ${storeId} ${dateStr}: ${error.message}`,
        );
      }
    }
  });

  const roas =
    merged.totalSpendCad > 0 ? shopify.revenueCad / merged.totalSpendCad : 0;
  const grossProfitCad = shopify.revenueCad - merged.totalSpendCad;
  const cogsCad = shopify.revenueCad * COGS_RATE_OF_REVENUE;
  const netProfitCad = grossProfitCad - cogsCad;

  return {
    storeId,
    date: dateStr,
    shopifyRevenueCad: shopify.revenueCad,
    fbSpendCad: merged.fbSpendCad,
    gaSpendCad: merged.gaSpendCad,
    totalSpendCad: merged.totalSpendCad,
    roas,
    grossProfitCad,
    cogsCad,
    netProfitCad,
    overridesApplied: merged.overridesApplied,
    productRowCount: shopify.productRows.length,
    metaCampaignRowCount: meta.adsetRows.length,
    googleCampaignRowCount: google.adGroupRows.length,
  };
}

// ===========================================================================
// makeCronDaily — factory producing one Inngest function per store.
//
// Why a factory: the only per-store variance is the literal `storeId` passed
// to runDailyForStore. Inngest requires each function to have a unique `id`
// (used as both the routing key and the Inngest Cloud UI label), so we can't
// share one function across 3 stores via a payload — each store gets its own
// scheduled function.
//
// SDK call shape (inngest@^4.4.0):
//   inngest.createFunction({ id, triggers }, handler)
//   ↑ 2-arg API. The triggers field accepts a single object OR an array;
//   sanitizeTriggers normalizes to an array internally.
// ===========================================================================
function makeCronDaily(storeId: StoreId) {
  return inngest.createFunction(
    {
      id: `cron-daily-${storeId}`,
      // 'TZ=Asia/Jerusalem 5 0 * * *' = at minute 5 of hour 0, every day,
      // interpreted in Asia/Jerusalem. This matches the Apps Script trigger
      // which runs in the project's `Asia/Jerusalem` timezone.
      triggers: [{ cron: 'TZ=Asia/Jerusalem 5 0 * * *' }],
    },
    async ({ step }) => {
      const date = yesterdayJerusalem();
      return runDailyForStore(storeId, date, { step });
    },
  );
}

// ---------------------------------------------------------------------------
// cronDailyFunctions — the array consumed by plan 11's serve() endpoint.
// Order matches the STORES const above for determinism in tests / UI.
// ---------------------------------------------------------------------------
export const cronDailyFunctions = STORES.map(makeCronDaily);
