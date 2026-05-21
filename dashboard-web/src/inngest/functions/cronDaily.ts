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
import {
  fetchShopifyDayRows,
  fetchShopifyOrdersAttribution,
  fetchShopifyProductsCatalog,
} from '@/lib/fetchers/shopify';
import {
  fetchMetaAdSetInsights,
  fetchMetaAdInsights,
  fetchMetaSpendForDay,
  fetchMetaBudgets,
} from '@/lib/fetchers/meta';
import {
  fetchGoogleAdsSpendForDay,
  fetchGoogleAdsAdGroupInsights,
  fetchGoogleAdsAdInsights,
} from '@/lib/fetchers/googleAds';
import { mergeOverridesFromSupabase } from '@/lib/fetchers/manualOverrides';
import { getFxRate } from '@/lib/fetchers/fx';
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
  // Phase 05.6.1 — the 3 newly-populated user-data tables. Surfaced on the
  // return value so the operator console's jobs table (plan 12) can show a
  // "what just got written" summary without re-querying the DB.
  metaAdRowCount: number;
  googleAdRowCount: number;
  ordersAttributionRowCount: number;
  productCatalogRowCount: number;
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
  // Phase 05.6.1: extended to also fetch orders-attribution + product-catalog
  // in parallel. The 3 HTTP calls share one step.run callback so the cron
  // exec count stays at 5 (RESEARCH §Pitfall 4 free-tier budget).
  //
  // catalog is a snapshot (no date arg) — same payload regardless of dateStr;
  // we fetch it inside the daily run anyway because:
  //   1) Inngest steps are isolated per-execution (no shared cache across
  //      stores), so a daily refresh per store costs at most ~250 products
  //      worth of bandwidth (well under any quota).
  //   2) Operator drift detection: if a product is archived/deleted between
  //      two daily runs, the next-day snapshot reflects it (Apps Script
  //      behavior parity — Shopify.gs:537 is also called per daily run).
  const shopify = (await step.run('fetch-shopify', async () => {
    const [day, orders, catalog] = await Promise.all([
      fetchShopifyDayRows(storeId, dateStr),
      fetchShopifyOrdersAttribution(storeId, dateStr),
      fetchShopifyProductsCatalog(storeId),
    ]);
    return { ...day, orders, catalog };
  })) as Awaited<ReturnType<typeof fetchShopifyDayRows>> & {
    orders: Awaited<ReturnType<typeof fetchShopifyOrdersAttribution>>;
    catalog: Awaited<ReturnType<typeof fetchShopifyProductsCatalog>>;
  };

  // ---- Step 2: Meta (adset + ad-level insights + store-level spend sum + budgets) ---
  // Phase 05.6.1: extended Promise.all to fetch ad-level insights alongside
  // adset-level and store-level spend.
  // Phase 05.7.2: extended again to fetch per-campaign + per-adset BUDGETS in
  // parallel. The Sheets-side reader had budget data (sourced from
  // MetaAds.gs:157 getMetaBudgets); cronDaily previously wrote `null` for
  // campaign_budget_cad/ad_set_budget_cad/budget_type, leaving the dashboard
  // campaigns tab unable to show budgets — a cut-over regression.
  //
  // Four parallel HTTP roundtrips within one step's wall-clock — exec count
  // unchanged. The budgets endpoint is the SAME ad account + token, so all 4
  // fetches share the auth/host warmup and finish in roughly the same time
  // as the slowest one (insights is dominant; budgets is a small endpoint).
  const meta = (await step.run('fetch-meta', async () => {
    const [spend, adsetRows, adRows, budgets] = await Promise.all([
      fetchMetaSpendForDay(storeId, dateStr),
      fetchMetaAdSetInsights(storeId, dateStr),
      fetchMetaAdInsights(storeId, dateStr),
      fetchMetaBudgets(storeId),
    ]);
    return { spend, adsetRows, adRows, budgets };
  })) as {
    spend: Awaited<ReturnType<typeof fetchMetaSpendForDay>>;
    adsetRows: Awaited<ReturnType<typeof fetchMetaAdSetInsights>>;
    adRows: Awaited<ReturnType<typeof fetchMetaAdInsights>>;
    budgets: Awaited<ReturnType<typeof fetchMetaBudgets>>;
  };

  // ---- Step 3: Google Ads (spend + ad-group + ad-level insights) ----------
  // Phase 05.6.1: extended to fetch ad-level insights. All three helpers
  // short-circuit to empty/zero for non-uzoshop stores per googleAds.ts —
  // the step still runs for non-uzoshop (returns zero/empty), keeping the
  // step ID stable across stores so the jobs-table UI (plan 12) can render
  // a uniform per-store row.
  const google = (await step.run('fetch-google', async () => {
    const [spend, adGroupRows, adRows] = await Promise.all([
      fetchGoogleAdsSpendForDay(storeId, dateStr),
      fetchGoogleAdsAdGroupInsights(storeId, dateStr),
      fetchGoogleAdsAdInsights(storeId, dateStr),
    ]);
    return { spend, adGroupRows, adRows };
  })) as {
    spend: Awaited<ReturnType<typeof fetchGoogleAdsSpendForDay>>;
    adGroupRows: Awaited<ReturnType<typeof fetchGoogleAdsAdGroupInsights>>;
    adRows: Awaited<ReturnType<typeof fetchGoogleAdsAdInsights>>;
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

    // 2026-05-21 fix: per-row Meta FX conversion.
    //
    // Previously the campaigns_daily + ads_daily Meta rows wrote
    // `spend_cad: null` / `conversion_value_cad: null` because per-row
    // FX was deferred (see prior cronDaily.ts comment + MetaAdRow
    // docstring before today's edit). The dashboard's campaigns tab
    // therefore rendered every Meta campaign with $0 spend — a
    // regression vs the Sheets-side reader.
    //
    // Fix: fetch ONE FX rate per (store, date) — `currency` is uniform
    // across all rows in a given Meta /insights response because it's
    // sourced from `account_currency`. If a row's currency is not ILS,
    // we fetch a different rate (defensive — shouldn't happen for our
    // 3 stores but keeps the code generic).
    //
    // We cache rates inside the closure: getFxRate fires one Frankfurter
    // call per unique currency. For the dominant case (all ILS), that's
    // exactly 1 extra HTTP call per cron-daily, inside the existing
    // persist-batch step.run — exec budget unchanged.
    const fxCache = new Map<string, number>();
    const cadFor = async (amount: number, currency: string): Promise<number> => {
      if (!Number.isFinite(amount) || amount === 0) return 0;
      const cur = (currency || 'ILS').toUpperCase();
      if (cur === 'CAD') return amount;
      let rate = fxCache.get(cur);
      if (rate === undefined) {
        rate = await getFxRate(cur, 'CAD', dateStr);
        fxCache.set(cur, rate);
      }
      return amount * rate;
    };

    // 5a. data_daily UPSERT — PK (date, store_id)
    // 2026-05-21 (Phase 05.7.3): also populate gross_revenue_cad +
    // refund_deduction_cad so the dashboard can show "before/after refunds"
    // and the refund-day indicator chip + tooltip. Invariant:
    // revenue_cad = gross_revenue_cad − refund_deduction_cad.
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
          gross_revenue_cad: shopify.grossRevenueCad,
          refund_deduction_cad: shopify.refundDeductionCad,
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
      // 2026-05-21: now populates gross_revenue_cad / units / orders /
      // product_title (previously only net_revenue_cad was tracked, which
      // broke the dashboard's refund % formula `(1 − net/gross)` because
      // gross stayed null and degenerated the calc to 0%).
      const productRows = shopify.productRows.map((p) => ({
        date: dateStr,
        store_id: storeId,
        store_name: shopify.storeName,
        product_id: p.product_id,
        product_title: p.product_title || null,
        units: Math.round(p.units),
        gross_revenue_cad: p.gross_revenue_cad,
        orders: Math.round(p.orders),
        net_revenue_cad: p.net_revenue_cad,
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
    //
    // Bug fix 2026-05-21 (Postgres bigint coercion): campaigns_daily +
    // ads_daily have BIGINT columns for impressions/clicks/conversions,
    // but Google Ads + Meta APIs can return FRACTIONAL conversions
    // (view-through attribution, multi-touch, partial-credit models —
    // e.g. `conversions: 16.88633`). The DB rejects these with
    // `invalid input syntax for type bigint: "16.88633"`. We round to
    // the nearest whole number for the BIGINT columns and lose the
    // sub-conversion decimal. (Future: a NUMERIC schema change would
    // preserve precision; not worth a migration for now since the
    // dashboard sums these by 4+ rows and the rounding error vanishes.)
    if (meta.adsetRows.length > 0) {
      // 2026-05-21 (FX fix): populate spend_cad + conversion_value_cad via FX
      // (was hardcoded null — see cadFor() comment above).
      //
      // 2026-05-21 (Phase 05.7.2 budgets): populate campaign_budget_cad,
      // ad_set_budget_cad, budget_type from the new `meta.budgets` fetch.
      // Mirrors MetaAds.gs:142-146 (Hebrew comment) — CBO vs ABO logic:
      //   - CBO: campaign owns the budget. campaign daily/lifetime > 0.
      //   - ABO: ad-set owns the budget. ad-set daily/lifetime > 0.
      //   - '' (unknown / paused / lifetime-only fallback): both 0.
      //
      // Lifetime-budget fallback: when daily_budget is 0 we use
      // lifetime_budget as the "current commitment" surface — matches the
      // Apps Script semantics. The dashboard renders ONE number per row;
      // operators reading it understand "daily" or "lifetime" by the
      // budgetType chip on the row (CBO/ABO).
      const metaCampaignRows = await Promise.all(
        meta.adsetRows.map(async (r) => {
          const cBud = meta.budgets.campaigns[r.campaignId];
          const aBud = meta.budgets.adSets[r.adSetId];
          // Prefer daily; fall back to lifetime when daily is 0/unset.
          const cDaily = cBud?.dailyBudget ?? 0;
          const cLifetime = cBud?.lifetimeBudget ?? 0;
          const aDaily = aBud?.dailyBudget ?? 0;
          const aLifetime = aBud?.lifetimeBudget ?? 0;
          const campaignBudgetRaw = cDaily > 0 ? cDaily : cLifetime;
          const adSetBudgetRaw = aDaily > 0 ? aDaily : aLifetime;
          // Budget-type classification: CBO wins if the campaign owns budget,
          // else ABO if the ad-set owns it. If neither has budget data the
          // value is '' (empty string) — the dashboard's CampaignsTableRow
          // hides the CBO/ABO chip for empty budgetType.
          let bt: 'CBO' | 'ABO' | '' = '';
          if (campaignBudgetRaw > 0) bt = 'CBO';
          else if (adSetBudgetRaw > 0) bt = 'ABO';
          return {
            date: dateStr,
            store_id: storeId,
            platform: 'meta',
            campaign_id: r.campaignId,
            campaign_name: r.campaignName,
            ad_set_id: r.adSetId,
            ad_set_name: r.adSetName,
            spend_cad: await cadFor(r.spend, r.currency),
            impressions: Math.round(r.impressions),
            clicks: Math.round(r.clicks),
            conversions: Math.round(r.conversions),
            conversion_value_cad: await cadFor(r.conversionValue, r.currency),
            roas: null,
            // Budgets are denominated in `meta.budgets.currency` (the account
            // currency from the act_{id}?fields=currency one-shot). Pass it
            // through `cadFor` so the column lands in CAD on disk — the
            // dashboard's CampaignsTableRow renders this value as `C$X.XX`
            // and assumes CAD.
            campaign_budget_cad:
              campaignBudgetRaw > 0
                ? await cadFor(campaignBudgetRaw, meta.budgets.currency)
                : null,
            ad_set_budget_cad:
              adSetBudgetRaw > 0
                ? await cadFor(adSetBudgetRaw, meta.budgets.currency)
                : null,
            // Empty string '' stays in the DB; `postgresReaders.fetchCampaigns`
            // already normalizes '' / null / undefined → '' (campaigns.ts:135).
            budget_type: bt,
          };
        }),
      );
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
        // BIGINT-safe: see comment on metaCampaignRows above.
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        conversions: Math.round(r.conversions),
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

    // Phase 05.6.1 — 5e. ads_daily UPSERT (Meta + Google ad-level rows).
    // PK (date, store_id, ad_id). Both platforms write into the same table
    // because the schema is platform-tagged (`platform` column).
    //
    // Meta rows leave spend_cad / conversion_value_cad NULL (per the
    // MetaAdRow type docstring — per-ad FX conversion deferred).
    // Google rows populate both (CAD-native for uzoshop).
    //
    // We build a single combined array and issue ONE upsert call so the
    // total number of DB roundtrips inside persist-batch stays bounded
    // (Pitfall 4 budget — 1 SQL statement per logical table, not per
    // platform). Supabase's UPSERT handles mixed-row arrays correctly.
    {
      // 2026-05-21: populate spend_cad + conversion_value_cad via FX
      // (was hardcoded null — see cadFor() comment above).
      const metaAdsRows = await Promise.all(
        meta.adRows.map(async (r) => ({
          date: r.date,
          store_id: r.storeId,
          platform: r.platform, // 'meta'
          campaign_id: r.campaignId,
          campaign_name: r.campaignName,
          ad_set_id: r.adSetId,
          ad_set_name: r.adSetName,
          ad_id: r.adId,
          ad_name: r.adName,
          spend_cad: await cadFor(r.spend, r.currency),
          // BIGINT-safe: see comment on metaCampaignRows above.
          impressions: Math.round(r.impressions),
          clicks: Math.round(r.clicks),
          conversions: Math.round(r.conversions),
          conversion_value_cad: await cadFor(r.conversionValue, r.currency),
          roas: null,
        })),
      );
      const googleAdsRows = google.adRows.map((r) => ({
        date: r.date,
        store_id: r.storeId,
        platform: r.platform, // 'google'
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        ad_set_id: r.adSetId,
        ad_set_name: r.adSetName,
        ad_id: r.adId,
        ad_name: r.adName,
        spend_cad: r.spendCad,
        // BIGINT-safe: see comment on metaCampaignRows above.
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        conversions: Math.round(r.conversions),
        conversion_value_cad: r.conversionValueCad,
        roas: null,
      }));
      const adsRows = [...metaAdsRows, ...googleAdsRows];
      if (adsRows.length > 0) {
        const { error } = await admin
          .from('ads_daily')
          .upsert(adsRows, { onConflict: 'date,store_id,ad_id' });
        if (error) {
          throw new Error(
            `ads_daily upsert for ${storeId} ${dateStr}: ${error.message}`,
          );
        }
      }
    }

    // Phase 05.6.1 — 5f. orders_attribution UPSERT.
    // PK (store_id, order_id) — note: NOT (date, store_id, order_id). The
    // PK lives outside the date axis because order_id is globally unique
    // per store; an order can only ever have ONE attribution row even if
    // a backfill re-fetches a different day's window (a refund or update
    // does not change the order's primary attribution).
    //
    // line_items is JSONB — we pass the `{p,u,r}` compact array through
    // as-is; the postgresReaders parser at line 101-120 reads it back
    // into the dashboard shape.
    if (shopify.orders.length > 0) {
      const orderRows = shopify.orders.map((o) => ({
        store_id: o.storeId,
        order_id: o.orderId,
        date: o.date,
        total_cad: o.totalCad,
        source: o.source,
        utm_source: o.utmSource,
        utm_medium: o.utmMedium,
        utm_campaign: o.utmCampaign,
        utm_content: o.utmContent,
        fbclid_present: o.fbclidPresent,
        gclid_present: o.gclidPresent,
        referrer: o.referrer,
        utm_id: o.utmId,
        utm_term: o.utmTerm,
        line_items: o.lineItems,
      }));
      const { error } = await admin
        .from('orders_attribution')
        .upsert(orderRows, { onConflict: 'store_id,order_id' });
      if (error) {
        throw new Error(
          `orders_attribution upsert for ${storeId} ${dateStr}: ${error.message}`,
        );
      }
    }

    // Phase 05.6.1 — 5g. product_catalog UPSERT.
    // PK (store_id, product_id). Snapshot table — each daily run overwrites
    // the prior snapshot for active products. Products that go inactive
    // (archived / deleted) are NOT pruned here — they remain in the table
    // with their last-known status. A future plan can add a "vacuum
    // archived products older than N days" pass; for now the dashboard
    // filters on `status = 'active'` at read time.
    if (shopify.catalog.length > 0) {
      const catalogRows = shopify.catalog.map((p) => ({
        store_id: p.storeId,
        product_id: p.productId,
        title: p.title,
        handle: p.handle,
        status: p.status,
        price_cad: p.priceCad,
        image_url: p.imageUrl,
        product_type: p.productType,
        vendor: p.vendor,
        updated_at: p.updatedAt,
      }));
      const { error } = await admin
        .from('product_catalog')
        .upsert(catalogRows, { onConflict: 'store_id,product_id' });
      if (error) {
        throw new Error(
          `product_catalog upsert for ${storeId} ${dateStr}: ${error.message}`,
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
    // Phase 05.6.1 — newly populated user-data tables.
    metaAdRowCount: meta.adRows.length,
    googleAdRowCount: google.adRows.length,
    ordersAttributionRowCount: shopify.orders.length,
    productCatalogRowCount: shopify.catalog.length,
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
