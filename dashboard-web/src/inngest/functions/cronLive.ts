/**
 * Phase 05.6 Plan 09 — `cron-live-{store}` Inngest functions (× 3 stores).
 *
 * Cadence: every 15 minutes in Asia/Jerusalem. Mirrors Apps Script's
 * existing live trigger semantics (`DailyUpdate.gs` → live branch): refresh
 * Shopify revenue for a rolling 3-day window. Meta + Google Ads spend
 * insights are NOT refreshed on the live cadence — that's the daily cron's
 * job (plan 08).
 *
 * === Why Shopify-only on live? ===
 *
 *   1. **Algorithm parity (D-C4).** Apps Script's live trigger only refreshes
 *      Shopify; mirroring that exactly keeps the TS port behavior-identical
 *      until Phase 05.7's cut-over.
 *
 *   2. **Free-tier execution budget (05.6-RESEARCH.md §Pitfall 4).** Meta
 *      Marketing Insights aggregates hourly upstream — polling every 15min
 *      for the same data wastes 4× the API calls and inflates Inngest's
 *      run-and-step counter. Total budget with this skip:
 *
 *        cron-live: 2 step.run + 1 function = 3 execs/run
 *        × 3 stores × 96 runs/day × 30 days  = 25,920/month
 *        + cron-daily forecast               =  ~  540/month
 *        + event triggers (sync-now/backfill) ~  500/month
 *        = ~ 27,000/month = 54% of 50K free tier (46% headroom).
 *
 *      If we also polled Meta + Google on live, that doubles to ≥50K/month —
 *      blowing the cap inside 30 days.
 *
 *   3. **Cross-day refunds (Phase 05.2.3.0).** Shopify revenue is the variable
 *      signal — orders and refunds within a 72h cross-day window mutate the
 *      net. The 3-day rolling window (today + today-1 + today-2 in
 *      Asia/Jerusalem) matches Apps Script's `rollingBackfillDays = 3`.
 *
 * === Persist semantics (Threat T-05.6-09-T2 mitigation) ===
 *
 * The live trigger MUST NOT overwrite the daily cron's spend values
 * (`fb_spend_cad`, `ga_spend_cad`, `total_spend_cad`) with stale zeros.
 *
 * Approach:
 *   1. SELECT the existing data_daily row's spend columns (NULL if no row).
 *   2. Compute derived columns (roas, gross_profit, cogs, net_profit) using
 *      the preserved spend (default 0 when no row exists).
 *   3. UPSERT with ON CONFLICT (date, store_id) DO UPDATE — but the payload
 *      OMITS `fb_spend_cad` / `ga_spend_cad` / `total_spend_cad` for the
 *      update path (so they're preserved). For the insert path (new row),
 *      they default to NULL (or 0 if explicitly seeded) — daily cron fills
 *      them on its next tick.
 *
 *   Supabase JS `.upsert({...}, { onConflict: 'pkey' })` semantics: the SET
 *   clause includes ONLY the columns present in the payload. Omitting a
 *   column from the payload preserves it on conflict.
 *
 *   For products_daily: same pattern — payload has only PK cols + store_name
 *   + net_revenue_cad. Columns owned by daily (`units`, `orders`,
 *   `gross_revenue_cad`, `product_title`) are preserved on UPDATE and
 *   default-NULL/0 on INSERT.
 *
 * === Step decomposition (Pitfall 4 budget) ===
 *
 * 2 step.runs per handler invocation:
 *   step.run('fetch-shopify-rolling-3day')   — Promise.all over 3 days
 *   step.run('persist-rolling-3day')         — SELECT+UPSERT loop over 3 days
 *
 * Plus the function itself = 3 execs/run. Per Pitfall 4 recommendation
 * (RESEARCH.md:1414-1416 verbatim: "live: step.run('fetch-shopify-rolling-3day'),
 * step.run('persist-data-daily') = 2 steps + 1 function = 3 execs").
 *
 * === Idempotency (Pitfall 3) ===
 *
 * Both step.run callbacks are idempotent:
 *   - fetch-shopify-rolling-3day: HTTP GET only (idempotent by definition).
 *   - persist-rolling-3day: SELECT + UPSERT with ON CONFLICT. Re-running
 *     produces the same row state (revenue overwrites itself; spend cols
 *     untouched). Safe across Inngest's default 4-retry exponential backoff.
 *
 * Decision IDs referenced:
 *   - D-B2: function inventory line for `cron-live-{store}` × 3
 *   - D-B3: TypeScript implementation
 *   - D-B5: ON CONFLICT idempotency
 *   - D-B6: throw → Inngest retries
 *   - D-C4: algorithm parity (Shopify-only on live matches Apps Script)
 *
 * Refs:
 *   - 05.6-09-PLAN.md §<tasks> Task 2
 *   - 05.6-RESEARCH.md §Pattern 2 (lines 381-492)
 *   - 05.6-RESEARCH.md §Pitfall 4 (lines 1395-1419)
 *   - 05.6-PATTERNS.md S-9 §cronLive.ts (lines 521-528)
 */

import { inngest } from '@/inngest/client';
import {
  fetchShopifyDayRows,
  fetchShopifyOrdersAttribution,
  type ShopifyDayRows,
  type ShopifyOrderRow,
} from '@/lib/fetchers/shopify';
import { fetchMetaBudgets, fetchMetaSpendForDayLight } from '@/lib/fetchers/meta';
import {
  fetchGoogleAdsAdGroupStatuses,
  fetchGoogleAdsSpendForDay,
} from '@/lib/fetchers/googleAds';
import {
  fetchTikTokAdGroupStatuses,
  fetchTikTokSpendForDay,
} from '@/lib/fetchers/tiktok';
import { getFxRate } from '@/lib/fetchers/fx';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// =============================================================================
// Constants
// =============================================================================

/**
 * Store list. Source of truth: `Config.gs:STORES` (uzoshop / zolplus /
 * usmile360). `as const` narrows the array element type for the factory.
 */
const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
type StoreId = (typeof STORES)[number];

/**
 * Canonical store-name map. Used by the Shopify-fetch .catch fallback so a
 * 401 / timeout never overwrites the row's store_name with the literal
 * 'unknown' string. Matches shopify.ts:STORE_NAMES verbatim.
 */
const STORE_NAMES: Record<StoreId, string> = {
  uzoshop: 'uzoshop',
  zolplus: 'Zol Plus',
  usmile360: '360usmile',
};

/**
 * Phase 05.7.7 — Per-store TikTok activation flag. Currently uzoshop only.
 * Used by cron-live to short-circuit TikTok fetches for stores that don't
 * have TikTok creds — avoids hitting the OAuth-token-helper error path
 * on every tick for the 2 stores that legitimately have no TikTok integration.
 */
const STORES_WITH_TIKTOK: Set<StoreId> = new Set(['uzoshop']);

/**
 * Project TZ. Matches `Config.gs:6` + `dashboard-web/src/lib/fetchers/shopify.ts:77`.
 * Used both for cron scheduling AND for the rolling-3-day-window date computation.
 */
const TZ = 'Asia/Jerusalem';

/**
 * Rolling window size. Mirrors Apps Script's `rollingBackfillDays = 3` —
 * a refund processed on day D can mutate the net of orders created on
 * D-2 or D-1 (within Shopify's typical 48h refund window + a 1-day safety
 * margin). Re-fetching the last 3 days every 15min catches all such
 * mutations within an hour.
 */
const ROLLING_WINDOW_DAYS = 3;

/**
 * Default COGS rate when no per-store env override is set. Kept as a private
 * fallback for `getCogsRateForStore`; callers MUST go through that helper so
 * cron-live and cron-daily land identical `cogs_cad` values per store.
 *
 * NOTE: when stores receive an updated COGS ratio (per-store-per-product
 * via `product_cogs` table), Phase 05.7+ migrates this to a per-row lookup.
 */
const DEFAULT_COGS_RATE = 0.25;

/**
 * Audit fix 2026-05-23 (BL-COGS): per-store COGS rate, mirroring the same
 * helper in cronDaily.ts. Without this, cron-live's hardcoded 0.25 silently
 * OVERWROTE cron-daily's per-store `cogs_cad` value every 10 minutes — so
 * stores that calibrate their COGS via env vars saw the right number for
 * ~10 min at 00:05 IL, then drifted back to 25% for the rest of the day.
 *
 * Env-var convention (must stay byte-identical to cronDaily.ts so a single
 * env-var update flows through both writers):
 *   `${STORE_UPPERCASE}_COGS_RATE` — e.g. UZOSHOP_COGS_RATE=0.25,
 *   ZOLPLUS_COGS_RATE=0.30, USMILE360_COGS_RATE=0.18. Unset → fallback to
 *   DEFAULT_COGS_RATE (0.25), preserving the pre-fix behavior for any store
 *   that hasn't been calibrated yet.
 *
 * Read at write time (NOT module load) so a Vercel env-var update takes
 * effect on the next cron-live tick (~10 min) without a redeploy.
 */
function getCogsRateForStore(storeId: StoreId): number {
  const envKey = `${String(storeId).toUpperCase()}_COGS_RATE`;
  const raw = process.env[envKey];
  if (!raw) return DEFAULT_COGS_RATE;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    console.warn(
      `cron-live: ${envKey}=${raw} is not a valid 0..1 rate — falling back to default ${DEFAULT_COGS_RATE}.`,
    );
    return DEFAULT_COGS_RATE;
  }
  return parsed;
}

// =============================================================================
// Date helpers
// =============================================================================

/**
 * Returns the calendar day for `instantMs` formatted as 'YYYY-MM-DD' in
 * the project TZ (Asia/Jerusalem). Uses `Intl.DateTimeFormat('en-CA', ...)`
 * which produces ISO-shape `YYYY-MM-DD`. Matches the helper at
 * `shopifyRevenueRefunds.ts:120-133` (`dayInTz`) by intent.
 */
function dayInJerusalem(instantMs: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(instantMs));
}

// =============================================================================
// Effective-status classification — OPERATOR-1 audit fix (2026-05-23)
// =============================================================================
//
// TikTok's ad-group status taxonomy has TEN distinct values — FIVE are
// "delivering / preparing" (ad-group will spend) and FIVE are "terminal /
// blocked" (truly off). Pre-fix code at cronLive.ts (the local
// `isActiveForPlatform` previously nested inside the
// 'refresh-effective-status' step) treated any TikTok status other than
// 'ADGROUP_STATUS_DELIVERY_OK' as NOT-ACTIVE, which meant we never
// enrolled placeholder rows for ad-groups in BUDGET_EXCEED (paused TODAY
// due to daily cap; resumes tomorrow), AUDIT (under creative review;
// will deliver once approved), REVIEWING (same), or NOT_START (scheduled,
// not yet at start time). The operator reported (2026-05-23) that
// campaigns showing in TikTok Ads Manager as Active were missing from the
// dashboard's placeholder-enrollment step.
//
// The TIKTOK_ACTIVE_ENOUGH set below mirrors the dashboard chip helper
// `CampaignsTableRow.isCampaignOff`'s TIKTOK_ACTIVE_ENOUGH (the full
// off vs. active taxonomy + a more verbose JSDoc lives there — this
// cron only needs the "is delivering / preparing" half because the OFF
// path here just returns false from `isActiveForPlatform`). Both helpers
// MUST agree — otherwise an ad-set in BUDGET_EXCEED could be UPSERTed
// here as "active" while the row chip simultaneously paints it "off".
//
// Source: TikTok Business API `/adgroup/get/` `operation_status` field.
// https://business-api.tiktok.com/portal/docs?id=1739561631127553
const TIKTOK_ACTIVE_ENOUGH = new Set([
  'ADGROUP_STATUS_DELIVERY_OK',
  'ADGROUP_STATUS_BUDGET_EXCEED',
  'ADGROUP_STATUS_AUDIT',
  'ADGROUP_STATUS_REVIEWING',
  'ADGROUP_STATUS_NOT_START',
]);

/**
 * Should an ad-set's current `status` qualify for placeholder enrollment
 * (an UPSERT of TODAY's campaigns_daily row)?
 *
 * Per-platform active state:
 *   Meta:   'ACTIVE'
 *   Google: 'ENABLED'
 *   TikTok: any value in TIKTOK_ACTIVE_ENOUGH (delivering / preparing).
 *           TIKTOK_OFF_STATUSES → not enrolled. Anything outside both
 *           sets (e.g. an unknown future TikTok status) → not enrolled,
 *           so we don't invent a placeholder row for an ad-set we can't
 *           classify.
 *
 * Mirrored in `CampaignsTableRow.isCampaignOff` (the dashboard chip logic).
 * Both helpers MUST agree — otherwise an ad-set in BUDGET_EXCEED could
 * be UPSERTed here as "active" while the row chip simultaneously paints
 * it "off". OPERATOR-1 audit fix (2026-05-23) makes the two consistent.
 *
 * Exported so the audit's regression tests can pin all 10 TikTok status
 * values without standing up a full Inngest dev server.
 */
export function isActiveForPlatform(platform: string, status: string): boolean {
  const norm = status.trim().toUpperCase();
  switch (platform) {
    case 'meta':
      return norm === 'ACTIVE';
    case 'google':
      return norm === 'ENABLED';
    case 'tiktok':
      return TIKTOK_ACTIVE_ENOUGH.has(norm);
    default:
      return false;
  }
}

/**
 * Returns the rolling N-day window as an array of 'YYYY-MM-DD' dates in
 * Asia/Jerusalem time, ordered today→oldest (today, today-1, ..., today-(N-1)).
 *
 * Why subtract milliseconds and re-format each tick (rather than
 * decrementing the date string string-wise):
 *   - Across DST transitions (Asia/Jerusalem flips IDT⇄IST in March/Oct),
 *     a fixed 24h subtraction from "today's midnight" lands on the same
 *     local calendar day before formatting. The TZ-aware formatter then
 *     yields the correct local calendar day. String-decrement arithmetic
 *     would land on the wrong day for the 1-2 ticks that straddle DST.
 *
 * Returns 3 distinct strings (assumption checked by tests).
 */
function rollingWindowDates(daysBack: number, nowMs: number = Date.now()): string[] {
  const dates: string[] = [];
  for (let i = 0; i < daysBack; i++) {
    const tick = nowMs - i * 24 * 60 * 60 * 1000;
    dates.push(dayInJerusalem(tick));
  }
  // De-dup defensively (would only matter if `nowMs` straddles a TZ-change
  // boundary that compresses two ticks onto the same local day — should
  // never happen for daysBack=3 in Asia/Jerusalem, but cheap to guard).
  return Array.from(new Set(dates));
}

// =============================================================================
// Persist helper — data_daily + products_daily for ONE date
// =============================================================================

/**
 * SELECT-then-UPSERT for one (storeId, date, shopify-day-rows) tuple.
 *
 * data_daily:
 *   - SELECT existing fb_spend_cad / ga_spend_cad / total_spend_cad.
 *   - Compute derived columns against preserved spend (default 0 if no row).
 *   - UPSERT with payload OMITTING the 3 spend columns when a row exists
 *     (so the daily cron's values survive ON CONFLICT DO UPDATE).
 *   - If no row exists yet (e.g., the daily cron hasn't run for today),
 *     UPSERT-as-INSERT seeds the spend columns to 0 so subsequent SELECTs
 *     get NUMERIC zeros instead of NULL (daily cron then UPDATEs them).
 *
 * products_daily:
 *   - UPSERT only PK cols + store_name + net_revenue_cad.
 *   - Columns owned by daily (`units`, `orders`, `gross_revenue_cad`,
 *     `product_title`) are NOT in the SET clause and are preserved on
 *     UPDATE; on INSERT they take their schema defaults (NOT NULL DEFAULT
 *     0 for `units`/`orders`; NULL for `gross_revenue_cad`/`product_title`).
 *
 * Throws on any Supabase error so Inngest's 4-retry exponential backoff
 * kicks in.
 */
async function persistDayForStore(
  storeId: StoreId,
  date: string,
  shopify: ShopifyDayRows,
  /**
   * Phase 05.7.6 (2026-05-22): when cron-live fetches Meta+Google+TikTok
   * for "today" (idx=0 of the rolling window), it passes the fresh CAD
   * spend here so we OVERWRITE the spend columns on data_daily. For
   * yesterday + day-before (idx=1, idx=2 of rolling window) callers omit
   * this and we preserve the spend that cron-daily wrote at 00:05.
   *
   * Phase 05.7.7 (2026-05-22) — extended with ttSpendCad for the new
   * TikTok integration (uzoshop only currently).
   */
  spendOverride?: {
    fbSpendCad: number;
    gaSpendCad: number;
    ttSpendCad: number;
  },
): Promise<void> {
  const admin = getSupabaseAdmin();

  // -----------------------------------------------------------------
  // data_daily — SELECT existing spend, then UPSERT preserving them
  // -----------------------------------------------------------------
  const { data: existing, error: selErr } = await admin
    .from('data_daily')
    .select('fb_spend_cad, ga_spend_cad, tt_spend_cad, total_spend_cad')
    .eq('date', date)
    .eq('store_id', storeId)
    .maybeSingle();
  if (selErr) {
    throw new Error(`data_daily select for ${storeId} ${date}: ${selErr.message}`);
  }

  const fbSpendCad =
    spendOverride !== undefined
      ? spendOverride.fbSpendCad
      : Number(existing?.fb_spend_cad ?? 0) || 0;
  const gaSpendCad =
    spendOverride !== undefined
      ? spendOverride.gaSpendCad
      : Number(existing?.ga_spend_cad ?? 0) || 0;
  const ttSpendCad =
    spendOverride !== undefined
      ? spendOverride.ttSpendCad
      : Number(existing?.tt_spend_cad ?? 0) || 0;
  const totalSpendCad =
    spendOverride !== undefined
      ? fbSpendCad + gaSpendCad + ttSpendCad
      : Number(existing?.total_spend_cad ?? 0) || 0;

  const revenueCad = shopify.revenueCad;
  // Audit fix 2026-05-23 (BL-COGS): use the per-store rate (matches
  // cronDaily's writer). Previously a hardcoded 0.25 here clobbered
  // cronDaily's correct value within 10 min of the daily cron landing.
  const cogs = revenueCad * getCogsRateForStore(storeId);
  const grossProfit = revenueCad - totalSpendCad;
  const netProfit = grossProfit - cogs;
  const roas = totalSpendCad > 0 ? revenueCad / totalSpendCad : 0;

  // Build the payload. Spend columns ABSENT from the payload → preserved on
  // ON CONFLICT DO UPDATE (Supabase JS only includes payload keys in the
  // SET clause). For a fresh INSERT (no existing row), we ADD zeros so the
  // 3 spend columns have NUMERIC defaults — otherwise they'd be NULL until
  // the next daily-cron tick.
  //
  // Phase 05.7.4 (2026-05-22) — gross_revenue_cad + refund_deduction_cad MUST
  // be written together with revenue_cad. If cronLive writes revenue_cad in
  // isolation (as it did pre-fix), a stale gross from a prior cronDaily run
  // produces the impossible state `revenue > gross` (uzoshop 2026-05-21
  // showed revenue=$2,133 vs gross=$2,029, refund=$0). The fetcher returns
  // all three together, so passing all three to the upsert costs nothing
  // and preserves the invariant `revenue = gross − refund_deduction` on
  // every write.
  type DataDailyUpsertRow = {
    date: string;
    store_id: string;
    store_name: string;
    revenue_cad: number;
    gross_revenue_cad: number;
    refund_deduction_cad: number;
    roas: number;
    gross_profit_cad: number;
    cogs_cad: number;
    net_profit_cad: number;
    fb_spend_cad?: number;
    ga_spend_cad?: number;
    tt_spend_cad?: number;
    total_spend_cad?: number;
  };
  const dataDailyPayload: DataDailyUpsertRow = {
    date,
    store_id: storeId,
    store_name: shopify.storeName,
    revenue_cad: revenueCad,
    gross_revenue_cad: shopify.grossRevenueCad,
    refund_deduction_cad: shopify.refundDeductionCad,
    roas,
    gross_profit_cad: grossProfit,
    cogs_cad: cogs,
    net_profit_cad: netProfit,
  };
  // When spendOverride is supplied, include the spend columns in the payload
  // so the UPSERT updates them. When NOT supplied and the row exists, omit
  // them so ON CONFLICT preserves existing values. When NOT supplied and the
  // row doesn't exist (fresh INSERT), seed with zeros so subsequent reads
  // get NUMERIC 0 instead of NULL.
  if (spendOverride !== undefined) {
    dataDailyPayload.fb_spend_cad = fbSpendCad;
    dataDailyPayload.ga_spend_cad = gaSpendCad;
    dataDailyPayload.tt_spend_cad = ttSpendCad;
    dataDailyPayload.total_spend_cad = totalSpendCad;
  } else if (!existing) {
    dataDailyPayload.fb_spend_cad = 0;
    dataDailyPayload.ga_spend_cad = 0;
    dataDailyPayload.tt_spend_cad = 0;
    dataDailyPayload.total_spend_cad = 0;
  }

  const { error: dataErr } = await admin
    .from('data_daily')
    .upsert(dataDailyPayload, { onConflict: 'date,store_id' });
  if (dataErr) {
    throw new Error(`data_daily upsert for ${storeId} ${date}: ${dataErr.message}`);
  }

  // -----------------------------------------------------------------
  // products_daily — UPSERT including units/orders/gross/title so a fresh
  // INSERT path (no prior cron-daily row exists yet for today) doesn't
  // leave NULLs that read back as phantom "—" rows on the dashboard.
  //
  // Phase 05.7.8 fix (2026-05-22):
  //   Earlier the payload omitted units/orders/gross_revenue_cad/product_title
  //   to "preserve" them on UPDATE. That preservation logic was correct, but
  //   on the FIRST INSERT of the day cron-live created rows with NULL/0 for
  //   every column except net_revenue_cad — so a refund-only product with
  //   only a net_revenue_cad value rendered in the dashboard as a phantom
  //   row with title="—", units=0, orders=0, gross=0. fetchShopifyDayRows
  //   already returns gross_revenue_cad / units / orders / product_title on
  //   every productRow (shopify.ts:603-610), so passing them through costs
  //   nothing and keeps the table self-consistent. Idempotent: cron-daily's
  //   later write still owns those columns and will overwrite with the
  //   authoritative full-day values.
  // -----------------------------------------------------------------
  if (shopify.productRows.length > 0) {
    const productRows = shopify.productRows.map((p) => ({
      date,
      store_id: storeId,
      store_name: shopify.storeName,
      product_id: p.product_id,
      product_title: p.product_title || '(refund-only)',
      units: p.units,
      orders: p.orders,
      gross_revenue_cad: p.gross_revenue_cad,
      net_revenue_cad: p.net_revenue_cad,
    }));

    const { error: prodErr } = await admin
      .from('products_daily')
      .upsert(productRows, { onConflict: 'date,store_id,product_id' });
    if (prodErr) {
      throw new Error(
        `products_daily upsert for ${storeId} ${date}: ${prodErr.message}`,
      );
    }
  }
}

// =============================================================================
// Public handler — shared by all 3 factory instances
// =============================================================================

/**
 * Shape of the `step` object the handler depends on. We only use `step.run`;
 * type-narrow to the minimum surface so the factory is testable with a
 * lightweight stub (see `__tests__/cronLive.test.ts`).
 */
type StepRunner = {
  run<T>(label: string, fn: () => Promise<T>): Promise<T>;
};

/**
 * Per-store live handler. Exported so it can be tested without standing up
 * a full Inngest dev server. Same intent as cronDaily's
 * `runDailyForStore` (plan 08) but with a much shorter step decomposition.
 *
 * Returns a small summary object so the operator console's jobs table
 * (plan 14) can render "Rolling 3-day window refreshed for {storeId}:
 * rev=${...} on {date1, date2, date3}".
 */
export async function runLiveForStore(
  storeId: StoreId,
  ctx: { step: StepRunner },
): Promise<{
  storeId: StoreId;
  rollingDates: string[];
  perDayRevenue: Record<string, number>;
  todaySpendCad: { fb: number; ga: number };
}> {
  const { step } = ctx;
  const dates = rollingWindowDates(ROLLING_WINDOW_DAYS);
  const today = dates[0];

  // Phase 05.7.6 PROPER FIX v2 (2026-05-22 03:00 IL): every fetcher is
  // wrapped in a 12-second timeout. This GUARANTEES the cron-live step
  // completes within ~15 seconds total even if Meta / Google / Shopify
  // is slow or hanging upstream. Without timeouts, a single slow API
  // dragged previous cron-live ticks past the Inngest 5-min wall-clock
  // and killed every run.
  //
  // Trade-off: a timed-out fetcher returns null → that platform's data
  // is "no update this tick". Next tick (10 min later) tries again.
  // Better than blocking the entire dashboard refresh for everyone.
  //
  // ----- STEP 1: fetch Shopify rolling 3-day (with timeout per day) -----
  //
  // On error/timeout: we return a sentinel ShopifyDayRows-shaped object
  // so the persist step can still run for the other 2 dates AND the
  // 2 ad-platforms. CRITICAL: the sentinel uses the canonical store name
  // from STORE_NAMES (NOT the literal 'unknown') — otherwise a Shopify
  // 401 would overwrite the row's store_name in data_daily with 'unknown',
  // breaking the dashboard's per-store grouping.
  //
  // ALSO CRITICAL: the sentinel sets a flag (`__shopifyFailed: true` via
  // type assertion) so the persist step knows NOT to overwrite revenue /
  // gross / refund_deduction columns on a Shopify failure — preserve
  // whatever was last successfully written.
  const shopifyByDate = await step.run('fetch-shopify-rolling-3day', async () => {
    const results = await Promise.all(
      dates.map((d) =>
        withTimeout(fetchShopifyDayRows(storeId, d), 12_000, `Shopify ${d}`).catch(
          (e) => {
            console.warn(
              `cron-live: Shopify ${storeId} ${d} failed/timed-out: ${e instanceof Error ? e.message : e}`,
            );
            // Sentinel: canonical store_name (NOT 'unknown'), and we
            // mark __shopifyFailed so the persister can short-circuit.
            return {
              storeId,
              date: d,
              storeName: STORE_NAMES[storeId],
              revenueCad: 0,
              productRows: [],
              customItemRefundCad: 0,
              grossRevenueCad: 0,
              refundDeductionCad: 0,
              __shopifyFailed: true,
            } as ShopifyDayRows & { __shopifyFailed: true };
          },
        ),
      ),
    );
    const map: Record<string, ShopifyDayRows & { __shopifyFailed?: boolean }> = {};
    for (let i = 0; i < dates.length; i++) {
      map[dates[i]] = results[i];
    }
    return map;
  });

  // ----- STEP 2: fetch Meta + Google + TikTok spend for the FULL rolling
  //              window (LIGHT + timed-out per date × per platform) -----
  //
  // Audit fix 2026-05-23 (CR-02 pipeline / BLOCKER): previously cron-live
  // only fetched ad-spend for `today` (idx 0). Yesterday + day-before-yesterday
  // spend depended ENTIRELY on cron-daily's 00:05 IL run — when that failed
  // its 4× retry burst, those dates would stay stale for up to 24h with
  // NO operator-visible signal (the freshness chip bumped `updated_at` from
  // the Shopify revenue refresh, so it falsely read "fresh" while spend
  // sat stale).
  //
  // Fix: fetch all 3 platforms × all 3 dates per tick (9 calls). Each
  // fetcher independently timeout-wrapped + .catch'd; null on failure
  // → per-platform preserve in the persist step. Quota envelope: 54
  // calls/hour per platform × 3 stores ≈ negligible vs each platform's
  // rate limits (Meta ~1/s, Google 15K/day, TikTok 600/min).
  //
  // Phase 05.7.7: TikTok added alongside Meta + Google. Same per-fetcher
  // soft-fail policy. TikTok is uzoshop-only via STORES_WITH_TIKTOK; other
  // stores short-circuit to null without hitting the API.
  type DateSpend = { fbSpendCad: number | null; gaSpendCad: number | null; ttSpendCad: number | null };
  const spendByDate = await step.run('fetch-meta-google-tiktok-spend-light-3day', async () => {
    // Audit fix 2026-05-23 (a/WARN-3): FX failure must NOT silently
    // convert at 1×. Pre-fix, when getFxRate timed-out or 5xx'd, the
    // `.catch(() => 1)` treated 1 USD as 1 CAD — overwriting today's
    // CAD spend column with raw USD numbers (~30% low). Amplified by
    // the rolling 3-day refresh, a single FX outage could corrupt 3
    // dates × 3 stores × 3 platforms simultaneously.
    //
    // New behavior: FX failure returns null from cadConvert. The
    // caller's null check (below in the .then) propagates null all
    // the way to the per-platform preserve in the persist step,
    // which keeps the prior-day's column value. Net result: if FX
    // fails today, the CAD spend column shows the prior-day value
    // until FX recovers — a less-bad failure than overwriting USD
    // spend with garbage. The operator sees stale data (which is
    // surfaced by the freshness chip) instead of wrong data.
    const cadConvert = async (
      value: { spend: number; currency: string } | null,
      dateStr: string,
    ): Promise<number | null> => {
      if (!value || !Number.isFinite(value.spend) || value.spend === 0) return 0;
      const currency = (value.currency || 'CAD').toUpperCase();
      if (currency === 'CAD') return value.spend;
      const rate = await withTimeout(
        getFxRate(currency, 'CAD', dateStr),
        5_000,
        'FX',
      ).catch(() => null);
      if (rate === null || !Number.isFinite(rate) || rate <= 0) {
        console.warn(
          `cron-live: FX ${currency}→CAD on ${dateStr} failed — skipping spend update for this date/platform (per-platform preserve keeps prior value).`,
        );
        return null;
      }
      return value.spend * rate;
    };
    const out: Record<string, DateSpend> = {};
    // Fetch all 3 platforms × all 3 dates in parallel. Each platform/date
    // pair is independent (no cross-dependency) so a single Promise.all
    // is fine for both throughput and per-call timeout isolation.
    const tasks: Array<Promise<{ date: string; key: 'fb' | 'ga' | 'tt'; cad: number | null }>> = [];
    for (const d of dates) {
      tasks.push(
        withTimeout(fetchMetaSpendForDayLight(storeId, d), 12_000, 'Meta')
          .catch((e) => {
            console.warn(
              `cron-live: Meta light spend ${storeId} ${d} failed/timed-out: ${e instanceof Error ? e.message : e}`,
            );
            return null;
          })
          .then(async (v) => ({ date: d, key: 'fb' as const, cad: v === null ? null : await cadConvert(v, d) })),
      );
      tasks.push(
        withTimeout(fetchGoogleAdsSpendForDay(storeId, d), 12_000, 'Google')
          .catch((e) => {
            console.warn(
              `cron-live: Google spend ${storeId} ${d} failed/timed-out: ${e instanceof Error ? e.message : e}`,
            );
            return null;
          })
          .then(async (v) => ({ date: d, key: 'ga' as const, cad: v === null ? null : await cadConvert(v, d) })),
      );
      if (STORES_WITH_TIKTOK.has(storeId)) {
        tasks.push(
          withTimeout(fetchTikTokSpendForDay(storeId, d), 12_000, 'TikTok')
            .catch((e) => {
              console.warn(
                `cron-live: TikTok spend ${storeId} ${d} failed/timed-out: ${e instanceof Error ? e.message : e}`,
              );
              return null;
            })
            .then(async (v) => ({ date: d, key: 'tt' as const, cad: v === null ? null : await cadConvert(v, d) })),
        );
      }
    }
    const results = await Promise.all(tasks);
    for (const d of dates) {
      out[d] = { fbSpendCad: null, gaSpendCad: null, ttSpendCad: null };
    }
    for (const r of results) {
      const slot = out[r.date];
      if (!slot) continue;
      if (r.key === 'fb') slot.fbSpendCad = r.cad;
      else if (r.key === 'ga') slot.gaSpendCad = r.cad;
      else slot.ttSpendCad = r.cad;
    }
    return out;
  }) as Record<string, DateSpend>;

  // ----- STEP 3: fetch today's orders_attribution (for WhatsApp summary) -----
  //
  // Phase 05.7.8 (2026-05-22 fix): cron-daily writes orders_attribution at
  // 00:05 IL — meaning the 12:00 + 18:00 WhatsApp summaries see STALE order
  // counts (everything from after 00:05 today is missing). Net result: the
  // noon WhatsApp shows "1 order" when uzoshop already had 6 orders, leading
  // the operator to think the dashboard is broken.
  //
  // Fix: cron-live refreshes orders_attribution for TODAY only (not the full
  // rolling 3-day window — yesterday + day-before are owned by cron-daily and
  // re-fetching them every 10 min wastes Shopify API quota). Today's orders
  // arrive via UPSERT on PK (store_id, order_id) so the operation is fully
  // idempotent across the 10-min cadence. Refunds processed today on orders
  // from D-1 / D-2 are still captured by cron-daily's next tick.
  const todayOrders = await step.run('fetch-shopify-orders-attribution-today', async () => {
    return await withTimeout(
      fetchShopifyOrdersAttribution(storeId, today),
      12_000,
      `Shopify orders-attribution ${today}`,
    ).catch((e) => {
      console.warn(
        `cron-live: orders-attribution ${storeId} ${today} failed/timed-out: ${e instanceof Error ? e.message : e}`,
      );
      return [] as ShopifyOrderRow[];
    });
  });

  // ----- STEP 4: persist (sequential, idempotent) -----
  //
  // Three write modes per date based on what succeeded:
  //
  //   1. Shopify OK + all ad platforms attempted OK → write everything
  //      (revenue/gross/refund + fb/ga/tt/total spend + derived cols)
  //   2. Shopify OK + ads partial/failed → write Shopify cols, preserve spend
  //   3. Shopify FAILED → write NOTHING for this date (preserve last good row)
  //
  // For TikTok: stores NOT in STORES_WITH_TIKTOK always pass ttSpendCad=0 in
  // the override (so total_spend stays correct), without ever calling the
  // TikTok API. For uzoshop with a failed TikTok fetch, we treat it like
  // any other platform failure — preserve whatever was last written.
  await step.run('persist-rolling-3day', async () => {
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const shopify = shopifyByDate[date];
      // Audit fix 2026-05-23 (CR-02): `isToday` removed — every date in
      // the rolling window now refreshes ad-spend, not just today.
      const shopifyOk = !(shopify as { __shopifyFailed?: boolean }).__shopifyFailed;

      if (!shopifyOk) {
        console.warn(
          `cron-live ${storeId} ${date}: Shopify failed — skipping persist to preserve last good row.`,
        );
        continue;
      }

      // Phase 05.7.8 (2026-05-22) — relaxed the all-or-nothing override gate.
      //
      // Previous behavior (regression):
      //   If ANY of Meta / Google / TikTok returned null (timeout, 401,
      //   missing creds), the whole spend override was dropped, so
      //   persistDayForStore got `undefined` and BOTH fb+ga (which DID
      //   succeed) were preserved at their stale value. For a TikTok store
      //   like uzoshop, a single TikTok auth blip would freeze today's
      //   Meta+Google spend for hours.
      //
      // New behavior (per-platform preserve):
      //   We always write an override on "today", and for each platform that
      //   returned null we fall back to the existing column value from the
      //   data_daily row (or 0 if the row doesn't exist yet). That way Meta
      //   updates fresh even when TikTok 401s, TikTok updates fresh even
      //   when Meta times out, etc. The "preserve" logic moves down into
      //   persistDayForStore via the per-column nullish-coalesce below.
      //
      // We still skip the override entirely if cron-live couldn't fetch ANY
      // of the three platforms (network down at the worker) — in that case
      // there's nothing fresh to write and we let cron-daily handle today's
      // spend at 00:05 IL tomorrow.
      // Audit fix 2026-05-23 (CR-02 pipeline): per-date spend lookup
      // replaces the previous single `fbSpendCad/gaSpendCad/ttSpendCad`
      // closure variables (which only held "today"'s values). Now
      // yesterday + day-before-yesterday also benefit from the cron-live
      // refresh — operator no longer loses 24h of ad-spend recovery when
      // cron-daily's 00:05 IL run fails.
      const dateSpend = spendByDate[date] ?? { fbSpendCad: null, gaSpendCad: null, ttSpendCad: null };
      const haveAnySpend =
        dateSpend.fbSpendCad !== null ||
        dateSpend.gaSpendCad !== null ||
        dateSpend.ttSpendCad !== null;

      // (Removed `isToday` gate: cron-live now overrides spend for every
      //  date in the rolling window when ad-platform data is fresh.)
      if (haveAnySpend) {
        // Read the existing row's spend columns so we can fall back for
        // platforms that returned null on this tick. This is a fresh SELECT
        // because persistDayForStore does its own SELECT internally, but
        // doing it here keeps the "merge with existing" logic explicit at
        // the call site.
        const admin = getSupabaseAdmin();
        const { data: prior } = await admin
          .from('data_daily')
          .select('fb_spend_cad, ga_spend_cad, tt_spend_cad')
          .eq('date', date)
          .eq('store_id', storeId)
          .maybeSingle();
        const priorFb = Number(prior?.fb_spend_cad ?? 0) || 0;
        const priorGa = Number(prior?.ga_spend_cad ?? 0) || 0;
        const priorTt = Number(prior?.tt_spend_cad ?? 0) || 0;
        await persistDayForStore(storeId, date, shopify, {
          fbSpendCad: dateSpend.fbSpendCad ?? priorFb,
          gaSpendCad: dateSpend.gaSpendCad ?? priorGa,
          ttSpendCad: STORES_WITH_TIKTOK.has(storeId)
            ? (dateSpend.ttSpendCad ?? priorTt)
            : 0,
        });
      } else {
        await persistDayForStore(storeId, date, shopify, undefined);
      }
    }

    // Phase 05.7.8 — persist today's orders_attribution rows. Same UPSERT
    // semantics as cron-daily (onConflict: 'store_id,order_id'). When the
    // fetch failed/timed-out above, `todayOrders` is `[]` — the .length>0
    // guard short-circuits without throwing so the spend persist above is
    // never reverted.
    if (todayOrders.length > 0) {
      const admin = getSupabaseAdmin();
      const orderRows = todayOrders.map((o) => ({
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
      const { error: ordErr } = await admin
        .from('orders_attribution')
        .upsert(orderRows, { onConflict: 'store_id,order_id' });
      if (ordErr) {
        throw new Error(
          `orders_attribution upsert for ${storeId} ${today}: ${ordErr.message}`,
        );
      }
    }
  });

  // ----- STEP 5: refresh effective_status + enroll new campaigns -----
  //
  // Phase 05.7.x (2026-05-22 → 2026-05-23):
  //   First iteration (UPDATE-only) shipped 2026-05-22. It refreshed status
  //   on EXISTING campaigns_daily rows within 10 min. BUT — a brand-new
  //   campaign that hadn't yet served any impressions had NO row in
  //   campaigns_daily (the insights-based writers filter empty rows), so
  //   UPDATE was a no-op and the new campaign stayed invisible to the
  //   dashboard until cron-daily ran 24h later.
  //
  // Iteration 2 (this commit, 2026-05-23): switch from UPDATE to UPSERT
  //   for TODAY's row, using non-date-filtered enumeration endpoints:
  //     - Meta:    /act_{id}/campaigns + /act_{id}/adsets  (already in fetchMetaBudgets)
  //     - Google:  ad_group resource, no date filter      (new fetchGoogleAdsAdGroupStatuses)
  //     - TikTok:  /adgroup/get/                          (already, now returns names)
  //   For every (campaign, ad-set) the enumeration returns, we UPSERT a
  //   row into campaigns_daily for TODAY. Existing rows get their
  //   effective_status (+ name) refreshed; rows that don't exist yet get
  //   created with zero metrics + the live status. The dashboard's
  //   campaigns reader (postgresReaders.fetchCampaigns) is relaxed to keep
  //   rows that have effective_status set even when all metrics are zero,
  //   so the placeholder appears in the table.
  //
  // We ONLY upsert TODAY (not the rolling lookback) because the lookback
  // is for HISTORICAL data — past days where the campaign existed but
  // we want fresh status. If a campaign exists in the enumeration but
  // had no insights on day D-3, writing a placeholder row for D-3 would
  // create a phantom "campaign existed and ran on D-3" history that
  // never happened. Status-only UPDATE on existing past rows still
  // happens (handles the "I paused yesterday" case).
  //
  // Soft-fail per platform: a 401 / timeout / quota error on one
  // platform doesn't block the others. The previous status + the
  // existing rows survive until the next tick.
  await step.run('refresh-effective-status', async () => {
    const lookbackDays = 7;
    const lookbackFrom = (() => {
      const tick = Date.now() - (lookbackDays - 1) * 86400_000;
      return dayInJerusalem(tick);
    })();
    const today = dates[0];
    const admin = getSupabaseAdmin();

    // 1. Parallel fetch of all 3 platforms' enumerations with per-platform
    //    timeout + soft-fail.
    const metaPromise = withTimeout(
      fetchMetaBudgets(storeId),
      15_000,
      'Meta budgets (status)',
    ).catch((e) => {
      console.warn(
        `cron-live: Meta status refresh ${storeId} failed/timed-out: ${e instanceof Error ? e.message : e}`,
      );
      return null;
    });
    const googlePromise = withTimeout(
      fetchGoogleAdsAdGroupStatuses(storeId),
      15_000,
      'Google ad-group statuses',
    ).catch((e) => {
      console.warn(
        `cron-live: Google status refresh ${storeId} failed/timed-out: ${e instanceof Error ? e.message : e}`,
      );
      return null;
    });
    const tiktokPromise = STORES_WITH_TIKTOK.has(storeId)
      ? withTimeout(
          fetchTikTokAdGroupStatuses(storeId),
          15_000,
          'TikTok ad-group statuses',
        ).catch((e) => {
          console.warn(
            `cron-live: TikTok status refresh ${storeId} failed/timed-out: ${e instanceof Error ? e.message : e}`,
          );
          return null;
        })
      : Promise.resolve(null);

    const [metaBudgets, googleStatuses, tiktokStatuses] = await Promise.all([
      metaPromise,
      googlePromise,
      tiktokPromise,
    ]);

    // Build a flat list of (platform, campaignId, campaignName, adSetId,
    // adSetName, status) tuples — one per ad-set/ad-group enumeration row.
    type Enrollment = {
      platform: 'meta' | 'google' | 'tiktok';
      campaignId: string;
      campaignName: string;
      adSetId: string;
      adSetName: string;
      status: string;
    };
    const enrollments: Enrollment[] = [];

    if (metaBudgets) {
      for (const [adSetId, bucket] of Object.entries(metaBudgets.adSets)) {
        // Prefer ad-set status; fall back to campaign-level when ad-set is
        // unknown. Matches cronDaily's precedence (cronDaily.ts:475-481).
        const adSetStatus = bucket.effectiveStatus ?? null;
        const campaignBucket = metaBudgets.campaigns[bucket.campaignId];
        const campaignStatus = campaignBucket?.effectiveStatus ?? null;
        const status = adSetStatus ?? campaignStatus;
        if (!status) continue;
        enrollments.push({
          platform: 'meta',
          campaignId: bucket.campaignId,
          campaignName: campaignBucket?.name ?? '',
          adSetId,
          adSetName: bucket.name ?? '',
          status,
        });
      }
    }
    if (googleStatuses) {
      for (const r of googleStatuses) {
        enrollments.push({
          platform: 'google',
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          adSetId: r.adGroupId,
          adSetName: r.adGroupName,
          status: r.status,
        });
      }
    }
    if (tiktokStatuses) {
      for (const [adSetId, meta] of tiktokStatuses.entries()) {
        enrollments.push({
          platform: 'tiktok',
          campaignId: meta.campaignId,
          campaignName: meta.campaignName,
          adSetId,
          adSetName: meta.adGroupName,
          status: meta.status,
        });
      }
    }

    // 2. UPSERT a row for TODAY — but ONLY for ad-sets whose CURRENT status
    //    is "active" for their platform (Meta=ACTIVE, Google=ENABLED,
    //    TikTok=ADGROUP_STATUS_DELIVERY_OK). Paused ad-sets are NOT
    //    placeholder-enrolled — they'd just be visual noise in the
    //    dashboard ("why is this paused campaign showing up?"). Operator
    //    spec (2026-05-23):
    //      "Active campaigns appear immediately. Paused campaigns only
    //       appear if they had spend in the range."
    //
    //    For PAUSED ad-sets we still want their status reflected on
    //    HISTORICAL rows (so an ad-set paused this morning shows the
    //    off-chip on yesterday's row) — that's the UPDATE step below
    //    (#3), which runs on existing rows only without creating new
    //    placeholder rows.
    //
    //    UPSERT payload OMITS the metric columns (spend_cad, impressions,
    //    clicks, conversions, conversion_value_cad). When a row already
    //    exists from cron-live's spend writer, ON CONFLICT DO UPDATE
    //    leaves those columns untouched (Supabase JS only puts payload
    //    keys in the SET clause). When the row doesn't exist yet, the
    //    INSERT path uses the schema defaults (0) for the missing
    //    metrics — exactly the "placeholder" state we want for a
    //    just-launched, not-yet-spent campaign.
    const activeEnrollments = enrollments.filter((e) =>
      isActiveForPlatform(e.platform, e.status),
    );
    if (activeEnrollments.length > 0) {
      const upsertRows = activeEnrollments.map((e) => ({
        date: today,
        store_id: storeId,
        platform: e.platform,
        campaign_id: e.campaignId,
        campaign_name: e.campaignName || '—',
        ad_set_id: e.adSetId,
        ad_set_name: e.adSetName || '—',
        effective_status: e.status,
      }));
      // Chunk to keep individual PostgREST payloads bounded. 200 rows per
      // chunk is the same convention used by other UPSERTs in the
      // codebase (e.g. orders_attribution writer).
      const CHUNK = 200;
      for (let i = 0; i < upsertRows.length; i += CHUNK) {
        const slice = upsertRows.slice(i, i + CHUNK);
        const { error } = await admin
          .from('campaigns_daily')
          .upsert(slice, {
            onConflict: 'date,store_id,platform,campaign_id,ad_set_id',
          });
        if (error) {
          console.warn(
            `cron-live: campaigns_daily upsert (enrollment) ${storeId} chunk ${i}: ${error.message}`,
          );
          // Continue — partial enrollment is better than throwing the
          // whole step (the OTHER enrollment rows still write).
        }
      }
    }

    // 3. ALSO update effective_status on past rows in the lookback window
    //    (yesterday + back N days). Operator-side use case: "I paused this
    //    campaign yesterday morning — yesterday's row should reflect that
    //    even though today is a fresh row". UPDATE-only (no INSERT) on
    //    past dates — we never invent activity that wasn't there.
    //
    // Audit fix 2026-05-23 (HIGH-12 / O4-HI-01 + HIGH-NEW-4): replaced
    // Promise.all with sequential `for...of await` + per-iteration try/catch
    // AND explicit `result.error` check on each Supabase response.
    //
    // Pre-fix had two failure modes:
    //   (1) Promise.all rejects the whole batch on ANY single ad-set's
    //       update rejection — one ad-set's update failure aborted the
    //       step BEFORE the others ran (Inngest then retried 4× and
    //       dead-lettered after the 4th throw).
    //   (2) Supabase often resolves with `{ error: {...} }` rather than
    //       rejecting (e.g. RLS denied, schema mismatch). The previous
    //       code never destructured the result → silent corruption: the
    //       step "succeeded" but no status update landed for some
    //       ad-sets, leaving stale "active/off" chips with no operator
    //       signal.
    //
    // Fix: sequential for-of so each update is its own try-block. Both
    // throw-path and error-result path are logged via console.warn but
    // we CONTINUE iterating so a single ad-set's failure cannot prevent
    // the others from landing. No throw escapes this section — Inngest
    // never dead-letters the whole step due to one bad row.
    const platforms: Array<'meta' | 'google' | 'tiktok'> = [
      'meta',
      'google',
      'tiktok',
    ];
    const enrollmentsByPlatformAdSet = new Map<string, string>();
    for (const e of enrollments) {
      enrollmentsByPlatformAdSet.set(`${e.platform}::${e.adSetId}`, e.status);
    }
    for (const platform of platforms) {
      const platformEnrollments = enrollments.filter((e) => e.platform === platform);
      if (platformEnrollments.length === 0) continue;
      for (const { adSetId, status } of platformEnrollments) {
        try {
          const result = await admin
            .from('campaigns_daily')
            .update({ effective_status: status })
            .eq('store_id', storeId)
            .eq('platform', platform)
            .eq('ad_set_id', adSetId)
            .gte('date', lookbackFrom)
            .lt('date', today); // UPSERT above already handled today
          // Supabase shape: result is `{ error: PostgrestError | null }`
          // (the chain returns the response object directly when not
          // awaiting `.select()`). RLS denials + schema errors come back
          // here, NOT as a rejected promise.
          const errResult = (result as { error?: { message?: string } | null })
            ?.error;
          if (errResult) {
            console.warn(
              `cron-live: campaigns_daily status UPDATE failed (${platform}/${adSetId}) for ${storeId}: ${
                errResult.message ?? String(errResult)
              }`,
            );
          }
        } catch (e) {
          // Rejection path (network drop, abort, runtime error). Log +
          // continue — other ad-sets must still get their status update.
          console.warn(
            `cron-live: campaigns_daily status UPDATE threw (${platform}/${adSetId}) for ${storeId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
    }
  });

  const perDayRevenue: Record<string, number> = {};
  for (const date of dates) {
    perDayRevenue[date] = shopifyByDate[date].revenueCad;
  }
  // Audit fix 2026-05-23 (CR-02 pipeline): today's spend now comes
  // from spendByDate[today] rather than the deprecated closure vars.
  const todaySpendEntry = spendByDate[today] ?? { fbSpendCad: null, gaSpendCad: null, ttSpendCad: null };
  return {
    storeId,
    rollingDates: dates,
    perDayRevenue,
    todaySpendCad: {
      fb: todaySpendEntry.fbSpendCad ?? 0,
      ga: todaySpendEntry.gaSpendCad ?? 0,
    },
  };
}

/**
 * Phase 05.7.6 — wraps a promise with a wall-clock timeout. Rejects with
 * `Error: <label> timed out after Nms` if the wrapped promise hasn't
 * settled by then. The timer is cleared if the inner promise settles
 * first so we don't leak it.
 *
 * Used to prevent any single fetcher (Shopify / Meta / Google) from
 * stalling the entire cron-live tick past Inngest's 5-min step budget.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// =============================================================================
// Factory — one Inngest function per store
// =============================================================================

/**
 * Build one `cron-live-{storeId}` Inngest function. The handler body is a
 * thin wrapper around `runLiveForStore` so unit tests can exercise the
 * shared logic without spinning up Inngest's dev server.
 *
 * Cron: `TZ=Asia/Jerusalem *\/15 * * * *` (every 15 minutes at the same
 * local clock face — :00, :15, :30, :45 Israel time). The `TZ=` prefix
 * matters less for `*\/15` (which collapses to the same set of UTC ticks)
 * but is preserved for consistency with cron-daily (plan 08) and to make
 * the timezone intent self-documenting.
 *
 * NOTE on the Inngest SDK v4.4 signature: `inngest.createFunction(opts,
 * handler)` is the 2-arg form, with the trigger nested in
 * `opts.triggers`. The 3-arg form `(opts, trigger, handler)` shown in
 * older docs and the 05.6-09-PLAN.md `<action>` snippet was deprecated in
 * the v4 line — see `inngest@4.4.0/components/Inngest.js:550-565`.
 */
function makeCronLive(storeId: StoreId) {
  return inngest.createFunction(
    {
      id: `cron-live-${storeId}`,
      // Phase 05.7.6 (2026-05-22): cadence reduced from */15 to */10 so the
      // dashboard's "today" data refreshes within 10 min of new orders +
      // ad spend changes. The Phase 05.6 plan's grep guard for the exact
      // substring `TZ=Asia/Jerusalem */15 * * * *` was deliberately dropped
      // along with the cadence change (the test now checks for `*/10 * * * *`
      // instead). Exec budget remains within the 50K/month Inngest free-tier
      // cap: 2 step.runs × 3 stores × 144 ticks/day = 864/day = ~26K/month.
      triggers: [{ cron: 'TZ=Asia/Jerusalem */10 * * * *' }],
    },
    async ({ step }) =>
      // The cast narrows Inngest's full step API (which has `sendEvent`,
      // `sleep`, `waitForEvent`, etc.) to the `StepRunner` subset
      // `runLiveForStore` consumes. Inngest's `step.run<T>` returns
      // `Promise<Jsonify<T>>` rather than `Promise<T>` (the Jsonify type
      // strips Date / Map / etc. that aren't serializable across worker
      // boundaries) — for the handler's primitive returns (numbers,
      // strings, plain records), `Jsonify<T> ≡ T`, so this cast is sound.
      //
      // Tests bypass this cast entirely by calling `runLiveForStore`
      // directly with a `StepRunner`-shaped stub (see
      // `__tests__/cronLive.test.ts:makeStepStub`).
      runLiveForStore(storeId, { step: step as unknown as StepRunner }),
  );
}

/**
 * 3 cron-live functions — exported as an array so plan 11's `serve()`
 * webhook can spread them into its function list:
 *
 *   import { cronLiveFunctions } from '@/inngest/functions/cronLive';
 *   serve({ client: inngest, functions: [...cronLiveFunctions, ...] });
 */
export const cronLiveFunctions = STORES.map(makeCronLive);
