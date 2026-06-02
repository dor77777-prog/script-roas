/**
 * Phase 05.6 Plan 09 — `cron-live-{store}` Inngest functions (× 3 stores).
 *
 * Cadence: every 10 minutes in Asia/Jerusalem. Mirrors Apps Script's
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
 *      Marketing Insights aggregates hourly upstream — polling every 10min
 *      for the same data wastes 6× the API calls and inflates Inngest's
 *      run-and-step counter. Original budget assumed 2 step.run + 1 function
 *      = 3 execs/run. After Phase 13.4 (memoised SELECTs for non-idempotent
 *      reads — see lines 1082-1102) and Phase 13.9 (cron-live-heavy split),
 *      the actual cron-live shape is ~7 step.run + 1 function ≈ 8 execs/run.
 *      Combined with cron-live-heavy + cron-daily + event triggers we sit
 *      above the original 50K free-tier ceiling; the per-step pattern is
 *      retained because non-idempotent reads inside one big step.run are
 *      the sharper risk (P0-E in the 2026-05-24 audit). Re-tightening
 *      should target step.run count per cron-live run, not adding more
 *      "atomic" mega-steps.
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
// Phase E1.5 (2026-05-30) — status fetchers removed; cron-live no
// longer calls Meta/Google/TikTok status APIs. Status discovery +
// enrollment placeholders moved to per-store workers via
// cron-tick-orchestrator.
// Phase E1.6 (2026-05-30) — fetch-meta-google-tiktok-spend-light-3day
// step removed; account-level spend is owned by the 3 hot_metrics
// worker branches. These imports (Meta/Google/TikTok light spend
// fetchers + getFxRate) are no longer needed in cron-live.
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { TIKTOK_ACTIVE_ENOUGH } from '@/lib/platformConfig';
// Phase 0 (2026-06-02) — dual-write parity: reuse cronDaily's canonical
// orders_attribution row mapper instead of hand-rolling a second literal.
import { toOrdersAttributionRow } from '@/inngest/functions/cronDaily';
// Phase 12.5.x (2026-05-24) — token-failure alerts. Same wiring as cronDaily;
// cron-live catches see token expiry first (every 10 min), so the operator
// gets the alert within ~10 min of the token going dead. notifyTokenFailure
// is soft-fail + throttled to 1 alert per 6h per (provider, store, operation).
import { notifyTokenFailure } from '@/lib/notifications/tokenFailures';
import { isAuthError } from '@/lib/notifications/detectAuthError';
import { captureStepError, captureCronFetchError } from '@/lib/sentry/capture';
// Phase 13.6 consolidation — single source of truth for backend store
// constants. Aliases preserve the historical local names at the use sites
// (minimizes diff churn).
import {
  STORE_ID_TO_NAME as STORE_NAMES,
} from '@/lib/platformsByStore';

// =============================================================================
// Constants
// =============================================================================

/**
 * Store list. Source of truth: `Config.gs:STORES` (uzoshop / zolplus /
 * usmile360). `as const` narrows the array element type for the factory.
 */
const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
type StoreId = (typeof STORES)[number];

// Canonical store-name map + per-store TikTok activation flag.
// Phase 13.6: both live in `@/lib/platformsByStore` (single source of
// truth) and are imported above under their historical aliases
// (`STORE_NAMES`, `STORES_WITH_TIKTOK`). STORE_NAMES used by the
// Shopify-fetch .catch fallback so a 401 / timeout never overwrites
// the row's store_name with the literal 'unknown' string. TikTok flag
// short-circuits TikTok fetches for stores without creds, avoiding the
// OAuth-token-helper error path on every 10-min tick.

/**
 * Project TZ. Matches `Config.gs:6` + `dashboard-web/src/lib/fetchers/shopify.ts:77`.
 * Used both for cron scheduling AND for the rolling-3-day-window date computation.
 */
const TZ = 'Asia/Jerusalem';

/**
 * Rolling window size. Mirrors Apps Script's `rollingBackfillDays = 3` —
 * a refund processed on day D can mutate the net of orders created on
 * D-2 or D-1 (within Shopify's typical 48h refund window + a 1-day safety
 * margin). Re-fetching the last 3 days every 10min catches all such
 * mutations within ≤10 min of the upstream refund event.
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
// Audit fix 2026-05-24 (U-01): the set previously lived inline here; it
// was duplicated as a single-value inline check in postgresReaders.ts:608
// (`statusNorm === 'ADGROUP_STATUS_DELIVERY_OK'`), so an ad-group in
// BUDGET_EXCEED with hasActivity=false was enrolled by the writer but
// dropped by the reader. Both writer + reader now consume the shared
// `TIKTOK_ACTIVE_ENOUGH` from `@/lib/platformConfig` — one source of
// truth, no drift possible. The full off-vs-active taxonomy (+ chip
// JSDoc) still lives in `CampaignsTableRow.isCampaignOff`; the chip
// has the same set + an OFF set, while the writer/reader pair only
// needs the active half because anything outside it falls through to
// "not delivering" → not enrolled / not surfaced.
//
// Source: TikTok Business API `/adgroup/get/` `operation_status` field.
// https://business-api.tiktok.com/portal/docs?id=1739561631127553

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
): Promise<void> {
  // Phase E1.6.2 (2026-05-30 evening) — cron-live is now PURELY Shopify.
  // It writes only Shopify-derived columns + the freshness timestamp +
  // cogs_cad (depends only on revenue). The derived columns that depend
  // on platform spend (total_spend_cad, roas, gross_profit_cad,
  // net_profit_cad) are re-computed by the `recompute_data_daily_derived`
  // RPC at the bottom of this function — atomic in the database so the
  // workers and cron-live never race over derived values.
  //
  // Removed from this function (vs pre-E1.6.2):
  //   - spendOverride parameter (and its 6-field shape)
  //   - opts.spendOnly parameter
  //   - prior parameter (memoized priorSpendByDate)
  //   - inline SELECT of fb/ga/tt spend + impressions
  //   - the 6-way cascade computing fbSpendCad/gaSpendCad/ttSpendCad/
  //     totalSpendCad/fbImpressions/gaImpressions
  //   - the dataDailyPayload entries for roas/gross/net/total
  //
  // The 3 workers (metaWorker / googleWorker / tiktokWorker) own
  // fb/ga/tt_spend_cad + fb/ga/tt_impressions and call the same
  // recompute RPC after their writes.
  const admin = getSupabaseAdmin();
  const liveTickAt = new Date().toISOString();
  const revenueCad = shopify.revenueCad;
  const cogs = revenueCad * getCogsRateForStore(storeId);

  const { error: dataErr } = await admin
    .from('data_daily')
    .upsert(
      {
        date,
        store_id: storeId,
        store_name: shopify.storeName,
        revenue_cad: revenueCad,
        gross_revenue_cad: shopify.grossRevenueCad,
        refund_deduction_cad: shopify.refundDeductionCad,
        cogs_cad: cogs,
        last_live_tick_at: liveTickAt,
      },
      { onConflict: 'date,store_id' },
    );
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
      // Phase A Task 14 (2026-05-29) — freshness timestamp for Phase D badges.
      last_live_tick_at: liveTickAt,
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

  // Phase E1.7 (2026-05-30 night) — unified agg RPC. Re-aggregates
  // campaigns_daily into data_daily.{fb,ga,tt}_spend_cad + impressions
  // and re-derives total/roas/gross/net atomically. Replaces the
  // narrower `recompute_data_daily_derived` (which only did the derive
  // step). Workers call the same RPC after their spend writes.
  const { error: aggErr } = await admin
    .rpc('agg_data_daily_for_date', { d: date });
  if (aggErr) {
    throw new Error(
      `agg_data_daily_for_date(${date}) for ${storeId}: ${aggErr.message}`,
    );
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
  todaySpendCad: { fb: number; ga: number; tt: number };
}> {
  try {
    return await runLiveForStoreInner(storeId, ctx);
  } catch (e) {
    // Phase 13.2 P0-C — capture top-level errors before re-throwing so
    // Inngest's retry/dead-letter remains the source of truth for retries.
    // cron-live runs every 10min; we deliberately do NOT use
    // captureCronFetchError for per-platform alerts here (cadence × 4
    // platforms × 3 stores would over-alert). Per-platform alerting
    // remains isAuthError-gated below; only top-level escapes alert.
    captureStepError({ fnId: 'cron-live', stepName: 'top-level', storeId }, e);
    throw e;
  }
}

async function runLiveForStoreInner(
  storeId: StoreId,
  ctx: { step: StepRunner },
): Promise<{
  storeId: StoreId;
  rollingDates: string[];
  perDayRevenue: Record<string, number>;
  todaySpendCad: { fb: number; ga: number; tt: number };
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
  // Phase 13.2.3 — Sentry dedup Set scoped to this tick's fetch step.
  // Each (platform, storeId) captured at most once per tick. Combined
  // with the fingerprint inside captureCronFetchError, all events of
  // (platform, storeId) across the entire day group into ONE Sentry
  // issue — so 96 ticks/day × full failure caps at 9 issues, not 9 × 96.
  const sentryDedup = new Set<string>();

  const shopifyByDate = await step.run('fetch-shopify-rolling-3day', async () => {
    const results = await Promise.all(
      dates.map((d) =>
        withTimeout(fetchShopifyDayRows(storeId, d), 12_000, `Shopify ${d}`).catch(
          (e) => {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.warn(
              `cron-live: Shopify ${storeId} ${d} failed/timed-out: ${errMsg}`,
            );
            if (isAuthError('shopify', errMsg)) {
              notifyTokenFailure({
                provider: 'shopify',
                storeId: storeId as 'uzoshop' | 'zolplus' | 'usmile360',
                operation: 'fetch_day_rows',
                errorMsg: errMsg,
                advice:
                  'Re-mint the Shopify Admin API access token and update ' +
                  `${storeId.toUpperCase()}_SHOPIFY_ACCESS_TOKEN in Vercel + redeploy.`,
              }).catch(() => {});
            } else {
              captureCronFetchError(
                { storeId, platform: 'shopify', dedup: sentryDedup, quietWhatsapp: true },
                e,
              ).catch(() => {});
            }
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
  // Phase E1.6.2 (2026-05-30 evening) — DateSpend type removed.
  // cron-live no longer carries any platform-spend values. Workers
  // (meta/google/tiktokWorker hot_metrics branches) own the fetch +
  // write of fb/ga/tt_spend_cad + impressions. The recompute RPC
  // re-derives total/roas/gross/net atomically.

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
  // Phase E1.6.2 (2026-05-30 evening) — cron-live is Shopify-only.
  // Write modes per date:
  //   1. Shopify OK  → persist Shopify columns + cogs + last_live_tick_at;
  //                     call recompute_data_daily_derived(date) to refresh
  //                     total/roas/gross/net atomically from worker-fresh
  //                     spend values in data_daily.
  //   2. Shopify FAILED → skip this date entirely (preserve last good row).
  //
  // Removed in E1.6.2: priorSpendByDate SELECT loop (no spend cascade
  // needed; workers own those columns and the recompute RPC consumes
  // them at the DB layer).

  await step.run('persist-rolling-3day', async () => {
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const shopify = shopifyByDate[date];
      // Audit fix 2026-05-23 (CR-02): `isToday` removed — every date in
      // the rolling window now refreshes ad-spend, not just today.
      const shopifyOk = !(shopify as { __shopifyFailed?: boolean }).__shopifyFailed;

      if (!shopifyOk) {
        // Phase E1.6.2 (2026-05-30 evening) — Shopify failure → skip
        // persist entirely. Workers own platform spend columns; the
        // pre-fix spend-only fallback that wrote fb/ga columns from
        // a stale priorSpend snapshot was the cause of the
        // user-reported race condition ("not updating except
        // Campaigns"). Next cron-live tick (≤10 min) retries Shopify.
        console.warn(
          `cron-live ${storeId} ${date}: Shopify failed — skipping persist (preserve last good row; workers own platform spend).`,
        );
        continue;
      }

      // Phase E1.6.2 (2026-05-30 evening) — cron-live is Shopify-only.
      // No spend cascade, no per-platform preserve, no spendOverride.
      // Workers (meta/google/tiktokWorker hot_metrics branches) own
      // fb/ga/tt_spend_cad + impressions; the agg RPC owns TikTok's
      // per-store split; recompute_data_daily_derived re-derives
      // total/roas/gross/net atomically in the DB after each write.
      await persistDayForStore(storeId, date, shopify);
    }

    // Phase 05.7.8 — persist today's orders_attribution rows. Same UPSERT
    // semantics as cron-daily (onConflict: 'store_id,order_id'). When the
    // fetch failed/timed-out above, `todayOrders` is `[]` — the .length>0
    // guard short-circuits without throwing so the spend persist above is
    // never reverted.
    if (todayOrders.length > 0) {
      const admin = getSupabaseAdmin();
      const orderRows = todayOrders.map((o) => toOrdersAttributionRow(o));
      const { error: ordErr } = await admin
        .from('orders_attribution')
        .upsert(orderRows, { onConflict: 'store_id,order_id' });
      if (ordErr) {
        throw new Error(
          `orders_attribution upsert for ${storeId} ${today}: ${ordErr.message}`,
        );
      }

      // Phase 3 (2026-06-02) — refresh first-order-EVER flags for this store
      // (full history, unfiltered). Soft-fail so a flag-recompute error never
      // reverts the orders persist above. The next tick (≤10 min) re-runs it.
      const { error: foErr } = await admin.rpc('recompute_first_order_flags', {
        p_store_id: storeId,
      });
      if (foErr) {
        console.warn(
          `cron-live ${storeId} ${today}: recompute_first_order_flags failed: ${foErr.message}`,
        );
      }
    }
  });

  // ----- STEP 5: REMOVED in Phase E1.5 (2026-05-30) -----
  //
  // The "refresh-effective-status + enroll-active-ad-sets" step lived
  // here from Phase 05.7.x through Phase D. It fetched per-platform
  // statuses for Meta/Google/TikTok and UPSERTed placeholder rows into
  // campaigns_daily + UPDATEd historical effective_status.
  //
  // Phase E1.5 migrated this work to the per-store status workers
  // (metaWorker.runMetaStatusBranch / googleWorker.runGoogleStatusBranch
  // / tiktokWorker.runTikTokStatusBranch) via cron-tick-orchestrator
  // (every 10 min). Those workers:
  //   • write registry rows (campaign_registry / adset_registry / ad_registry)
  //   • emit campaign_status_events on transitions
  //   • UPSERT campaigns_daily placeholders for ACTIVE / ENABLED /
  //     DELIVERY_OK adsets (Tasks 8/9/10 of the E1 plan)
  //
  // cron-live is now Shopify-only as the original 05.6 design intended.
  // See:
  //   docs/superpowers/specs/2026-05-30-phase-e1-decommission-cron-live-heavy-design.md
  //
  // The "refresh historical effective_status" UPDATE pass is also gone
  // — postgresReaders + UI now read reg_effective_status from the
  // campaign_registry via the campaigns_enriched VIEW. The legacy
  // campaigns_daily.effective_status field is fallback-only in
  // statusClassification.ts and stays NULL-safe.

  const perDayRevenue: Record<string, number> = {};
  for (const date of dates) {
    perDayRevenue[date] = shopifyByDate[date].revenueCad;
  }
  // Phase E1.6.2 (2026-05-30 evening) — cron-live no longer carries
  // platform-spend values; the operator-console summary that consumed
  // todaySpendCad now reads it from data_daily directly (or via the
  // hot_metrics workers' freshness rows). We keep the shape for
  // backwards-compat with tests but return zeros.
  return {
    storeId,
    rollingDates: dates,
    perDayRevenue,
    todaySpendCad: {
      // Phase E1.6.2 (2026-05-30 evening) — cron-live no longer
      // carries platform spend. Workers own those columns; this
      // summary return value is a deprecated shape kept only for
      // backwards-compat with existing test fixtures.
      fb: 0,
      ga: 0,
      tt: 0,
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
 * Cron: `TZ=Asia/Jerusalem *\/10 * * * *` (every 10 minutes at the same
 * local clock face — :00, :10, :20, :30, :40, :50 Israel time). The `TZ=`
 * prefix matters less for `*\/10` (which collapses to the same set of UTC
 * ticks) but is preserved for consistency with cron-daily (plan 08) and to
 * make the timezone intent self-documenting.
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
