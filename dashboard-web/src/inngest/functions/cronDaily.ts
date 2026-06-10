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
// Self-serve stores Phase 4b (Task 8) — scheduler→worker fold imports.
// loadActiveStoreIds enumerates the active store list at runtime so a store
// added via the DB enters the daily fan-out with no deploy; planStoreJobs is
// the pure oracle that builds one event per store (right name/id/payload).
import { loadActiveStoreIds } from '@/lib/getStores';
import { planStoreJobs } from '@/lib/inngest/planStoreJobs';
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
import {
  fetchTikTokSpendForDay,
  fetchTikTokAdInsights,
  type TikTokDaySpend,
  type TikTokAdRow,
} from '@/lib/fetchers/tiktok';
import { mergeOverridesFromSupabase } from '@/lib/fetchers/manualOverrides';
import { getFxRate } from '@/lib/fetchers/fx';
import { getTodayInIsraelTz } from '@/lib/dateRange';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
// Phase 12.5.x (2026-05-24) — token-failure alerts. `notifyTokenFailure` is
// soft-fail (never throws); we wrap each platform's catch with an auth-shape
// detector + alert call. The DB row is always written; the WhatsApp template
// `token_failure_alert` was approved by Meta on 2026-05-24, so alerts now
// actually reach +972524809540 (operator's primary number).
import { notifyTokenFailure } from '@/lib/notifications/tokenFailures';
import { isAuthError } from '@/lib/notifications/detectAuthError';
import { captureCronFetchError, captureStepError } from '@/lib/sentry/capture';
// Phase A 2026-05-29 (Task 13) — pre-flight Meta BUC gate + finalization writes.
import { getMetaBucUsageForStore } from '@/lib/notifications/metaBucUsage';
import { recordFreshness } from '@/lib/inngest/freshness';
// Phase 13.6 consolidation — single source of truth for backend store
// constants. Aliased to `STORES_WITH_TIKTOK` to preserve the historical
// local name at the use sites (minimizes diff churn).
import { STORES_WITH_TIKTOK_IDS as STORES_WITH_TIKTOK } from '@/lib/platformsByStore';
// ads-off Phase 3 (2026-06-06) — fetch-gate: skip per-platform fetches when
// the store/platform is toggled off. Lightweight DB read loaded as the first
// step so every downstream step in the same run can branch on it.
import { isAdsEnabled, tiktokAccountFetchEnabled } from '@/lib/adState';
import { fetchAdStateFromPostgres } from '@/lib/postgresReaders';

/**
 * Phase 0 (2026-06-02) — single source of truth for the orders_attribution
 * UPSERT column shape. cronDaily AND cronLive both build their upsert rows
 * from this mapper so a new attribution field can't be added to one writer
 * and silently dropped by the other. `ordersAttributionRowKeys()` is the
 * dual-write parity guard's read surface.
 *
 * Field nullability mirrors the `ShopifyOrderRow` fetcher output
 * (`src/lib/fetchers/shopify.ts` — the utm fields, referrer and line_items
 * are nullable); the upsert tolerated those nulls before this extraction,
 * so the widened types preserve the exact runtime contract while pinning
 * the column set.
 */
export type OrderAttributionUpsertRow = {
  store_id: string;
  order_id: string;
  date: string;
  total_cad: number;
  source: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  fbclid_present: boolean;
  gclid_present: boolean;
  referrer: string | null;
  utm_id: string | null;
  utm_term: string | null;
  line_items: unknown;
  // Phase 3 (2026-06-02) — new-vs-returning support. customer_id is the
  // Shopify opaque numeric id (privacy: id only); order_created_at is the
  // immutable Shopify created_at. Both nullable (guest checkout → NULL
  // customer_id). is_first_order itself is NOT written here — it is owned by
  // recompute_first_order_flags() + the one-time Bulk-Operations backfill.
  customer_id: string | null;
  order_created_at: string | null;
  // Phase 4 (2026-06-02) — first-click lens. Additive nullable columns
  // (migration 20260603090000); both writers dual-write them through this
  // mapper. NULL = "no first-click signal" (explicitly NOT 'direct'). The
  // first_* values are read-only toward ad platforms (Shopify cart attrs only).
  first_touch_source: string | null;
  first_fbclid_present: boolean;
  first_gclid_present: boolean;
  first_ttclid_present: boolean;
  first_utm_source: string | null;
  first_utm_medium: string | null;
  first_utm_campaign: string | null;
  first_utm_content: string | null;
  first_utm_id: string | null;
  first_utm_term: string | null;
  first_seen_at: string | null;
  // תשלומים (2026-06-03) — raw primary Shopify payment gateway name
  // (shopify_payments/paypal/gift_card/…; migration adds the column). Picked
  // by primaryGateway() in the fetcher; categorized to credit/paypal/other in
  // code at read time. Dual-written by both cronDaily + cronLive via this
  // mapper. NULL = order lists no gateway / not-yet-backfilled.
  payment_gateway: string | null;
};

export function toOrdersAttributionRow(o: {
  storeId: string;
  orderId: string;
  date: string;
  totalCad: number;
  source: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  fbclidPresent: boolean;
  gclidPresent: boolean;
  referrer: string | null;
  utmId: string | null;
  utmTerm: string | null;
  lineItems: unknown;
  customerId: string | null;
  createdAt: string | null;
  firstTouchSource: string | null;
  firstFbclidPresent: boolean;
  firstGclidPresent: boolean;
  firstTtclidPresent: boolean;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
  firstUtmId: string | null;
  firstUtmTerm: string | null;
  firstSeenAt: string | null;
  paymentGateway: string | null;
}): OrderAttributionUpsertRow {
  return {
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
    customer_id: o.customerId,
    order_created_at: o.createdAt,
    first_touch_source: o.firstTouchSource,
    first_fbclid_present: o.firstFbclidPresent,
    first_gclid_present: o.firstGclidPresent,
    first_ttclid_present: o.firstTtclidPresent,
    first_utm_source: o.firstUtmSource,
    first_utm_medium: o.firstUtmMedium,
    first_utm_campaign: o.firstUtmCampaign,
    first_utm_content: o.firstUtmContent,
    first_utm_id: o.firstUtmId,
    first_utm_term: o.firstUtmTerm,
    first_seen_at: o.firstSeenAt,
    payment_gateway: o.paymentGateway ?? null,
  };
}

export function ordersAttributionRowKeys(): string[] {
  return Object.keys(
    toOrdersAttributionRow({
      storeId: '',
      orderId: '',
      date: '',
      totalCad: 0,
      source: '',
      utmSource: '',
      utmMedium: '',
      utmCampaign: '',
      utmContent: '',
      fbclidPresent: false,
      gclidPresent: false,
      referrer: '',
      utmId: '',
      utmTerm: '',
      lineItems: [],
      customerId: null,
      createdAt: null,
      firstTouchSource: null,
      firstFbclidPresent: false,
      firstGclidPresent: false,
      firstTtclidPresent: false,
      firstUtmSource: null,
      firstUtmMedium: null,
      firstUtmCampaign: null,
      firstUtmContent: null,
      firstUtmId: null,
      firstUtmTerm: null,
      firstSeenAt: null,
      paymentGateway: null,
    }),
  );
}

// ---------------------------------------------------------------------------
// STORES — single source of truth for the 3 stores. Aligns with:
//   - Config.gs:22-26 STORES (uzoshop / zolplus / usmile360)
//   - Phase 05.5-01 seed (`stores` table) — same 3 IDs
//   - googleAds.ts isGoogleConfiguredForStoreAsync gate (DB→env per-store; uzoshop today)
//
// COGS rate per Config.gs:20 (COGS_RATE_OF_REVENUE = 0.25 = 25% of revenue).
// ---------------------------------------------------------------------------
const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
export type StoreId = typeof STORES[number];

// Phase 05.7.7 — Per-store TikTok activation flag (currently uzoshop only).
// Non-TikTok stores short-circuit to zero spend + empty insights without
// hitting the TikTok API. The constant lives in
// `@/lib/platformsByStore` (Phase 13.6 single-source-of-truth); imported
// above as `STORES_WITH_TIKTOK` (aliased from STORES_WITH_TIKTOK_IDS).
// If a second store gains a TikTok account, update platformsByStore.ts —
// every consumer (cronDaily, cronLive, components) picks it up.

const COGS_RATE_OF_REVENUE = 0.25;

/**
 * Audit fix 2026-05-23 (MR-01 health-and-conclusions): per-store COGS rate.
 *
 * The single global 0.25 (= 25% of revenue) was calibrated for one store's
 * margin profile but applied to all 3 (uzoshop, Zol Plus, 360usmile) that
 * carry very different product categories. Net-profit headlines were wrong
 * for at least 2 of 3 stores; "pause if below profitability" decisions
 * were made against a fake threshold.
 *
 * Env-var convention: `${STORE_UPPERCASE}_COGS_RATE` overrides the default
 * for that store. Operator can set e.g.:
 *   UZOSHOP_COGS_RATE=0.25
 *   ZOLPLUS_COGS_RATE=0.30
 *   USMILE360_COGS_RATE=0.18
 * Unset → fallback to 0.25 (no behavior change).
 *
 * Reads at cron-write time so a Vercel env-var update takes effect on the
 * next cron-daily run.
 */
function getCogsRateForStore(storeId: StoreId): number {
  const envKey = `${String(storeId).toUpperCase()}_COGS_RATE`;
  const raw = process.env[envKey];
  if (!raw) return COGS_RATE_OF_REVENUE;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    console.warn(
      `cron-daily: ${envKey}=${raw} is not a valid 0..1 rate — falling back to default ${COGS_RATE_OF_REVENUE}.`,
    );
    return COGS_RATE_OF_REVENUE;
  }
  return parsed;
}

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
  // P1-11 (2026-06-10): null = the merge-layer FX conversion failed and the
  // corresponding data_daily column was OMITTED (prior value preserved).
  fbSpendCad: number | null;
  gaSpendCad: number | null;
  totalSpendCad: number | null;
  roas: number;
  grossProfitCad: number;
  cogsCad: number;
  netProfitCad: number;
  overridesApplied: { meta: boolean; google: boolean; tiktok: boolean };
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

// ---------------------------------------------------------------------------
// chooseTikTokSpendCad — authoritative per-store tt_spend_cad selector.
//
// Phase 1 (2026-06-02). When an operator TikTok manual-override exists for
// (store, date), the operator's typed value is the authoritative per-store
// TikTok spend and MUST win — even over a fetched value and even when the
// fetched value is null (FX failure). Otherwise the fetched/FX'd value stands
// (and the agg RPC may later re-derive it from campaigns_daily for the
// non-override case). Extracted as a pure function so the decision is unit-
// testable without a full cron integration harness.
//
// Operationally: a TikTok override is the operator correcting an account
// outage where campaigns_daily is empty/wrong, so the override is the correct
// source — never silently re-derived.
export function chooseTikTokSpendCad(args: {
  overrideApplied: boolean;
  overrideCad: number;
  fetchedCad: number | null;
}): number | null {
  return args.overrideApplied ? args.overrideCad : args.fetchedCad;
}

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
  // Phase 13.2 P0-D — in-memory dedup for fetcher-error alerts. Scoped to
  // this single Inngest invocation; one WhatsApp alert per (platform, storeId)
  // per cron run. The existing 1/6h per-provider throttle in tokenFailures.ts
  // is the second-line dedupe across runs.
  const fetchErrorDedup = new Set<string>();
  try {
    return await runDailyForStoreInner(storeId, dateStr, ctx, fetchErrorDedup);
  } catch (e) {
    // Phase 13.2 P0-C — capture any error escaping the handler to Sentry
    // before Inngest's retry/dead-letter takes over. Re-throw preserves
    // existing retry semantics.
    captureStepError({ fnId: 'cron-daily', stepName: 'top-level', storeId }, e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Pre-flight budget-gate constants (Phase A 2026-05-29, Task 13)
// ---------------------------------------------------------------------------
const META_BUDGET_THRESHOLD_PCT = 80;
const BUC_FRESH_WINDOW_MIN = 15;

async function runDailyForStoreInner(
  storeId: StoreId,
  dateStr: string,
  ctx: { step: RunDailyStep },
  fetchErrorDedup: Set<string>,
): Promise<RunDailyResult> {
  const { step } = ctx;

  // Phase A 2026-05-29 (Task 13): single reconciledAt timestamp for all 6
  // finalization-tracked upserts in this tick. Captured once so every row
  // persisted by this nightly reconcile run carries the exact same timestamp
  // — an auditability invariant: "all rows reconciled in the same job run
  // share the same reconciled_at".
  const reconciledAt = new Date().toISOString();

  // P1-14 (2026-06-10): is_finalized must reflect whether the processed day
  // is actually OVER in Israel time. The nightly cron always runs for
  // yesterday (true), but the operator "Refresh All" / sync-now path runs
  // runDailyForStore for TODAY too — unconditionally stamping
  // is_finalized=true mid-day made the UI provenance verdict
  // (lib/freshness/provenance.ts) lie for the rest of the day (cron-live's
  // later writes omit the column, so the stale flag persisted). source stays
  // 'daily_reconcile' for ALL runs (it honestly describes the pipeline that
  // produced the row; no new source enum exists) — only the finalized bit is
  // date-aware now. The next post-midnight nightly run flips today→true.
  const isFinalized = dateStr < getTodayInIsraelTz();

  // ---- Step 0: Load ad-state map (ads-off Phase 3, 2026-06-06) ---------------
  // Lightweight DB read — fetches store_ad_state in one paginated query.
  // Missing key ⇒ ON (isAdsEnabled defaults to true) so an empty table is
  // fully backwards-compatible. Gates Meta/Google per (store, platform);
  // TikTok uses account-level gate (tiktokAccountFetchEnabled) since the
  // shared account serves multiple stores. Steps 1 (Shopify), 4 (overrides),
  // 5 (persist) and the agg RPCs are intentionally NOT gated — revenue/
  // product data must always land regardless of ad state.
  const adStateMap = (await step.run('fetch-ad-state', () =>
    // Degrade gracefully: an ad-state read failure must NOT crash the whole
    // daily run. Empty map ⇒ all-ON ⇒ fetch normally (never wrongly skip).
    fetchAdStateFromPostgres().catch(() => ({})),
  )) as Awaited<ReturnType<typeof fetchAdStateFromPostgres>>;

  // ------------------------------------------------------------------
  // Pre-flight Meta BUC gate (Phase A 2026-05-29, Task 13)
  //
  // Read the most recent meta_buc_usage snapshot for this store. If any
  // insights pct >= 80 AND the snapshot was written within the last 15
  // min, short-circuit the entire Meta fetch block for this tick.
  // Google + TikTok + Shopify still run. recordFreshness is called per
  // Meta scope with status='budget_skip'.
  // ------------------------------------------------------------------
  const bucUsage = await step.run(`pre-flight-meta-buc-${storeId}`, async () =>
    getMetaBucUsageForStore(storeId),
  );

  const metaSkipDueToBudget = (() => {
    if (!bucUsage || !(bucUsage as { rows: unknown[] }).rows?.length) return false;
    const newest = Math.max(
      ...(bucUsage as { rows: Array<{ last_updated_at: string }> }).rows.map(
        (r) => new Date(r.last_updated_at).getTime(),
      ),
    );
    if ((Date.now() - newest) / 60_000 > BUC_FRESH_WINDOW_MIN) return false;
    return (
      (bucUsage as { max_ads_insights_call_pct: number }).max_ads_insights_call_pct >= META_BUDGET_THRESHOLD_PCT ||
      (bucUsage as { max_ads_insights_cputime_pct: number }).max_ads_insights_cputime_pct >= META_BUDGET_THRESHOLD_PCT ||
      (bucUsage as { max_ads_insights_time_pct: number }).max_ads_insights_time_pct >= META_BUDGET_THRESHOLD_PCT
    );
  })();

  // If pre-flight gates Meta, record freshness for all 4 scopes and enqueue
  // a synthetic failure for the routing logic below.
  //
  // P1-32 (2026-06-10): these side effects (4 freshness writes + notify) run
  // inside their OWN step.run. Previously they executed at function top level
  // between steps → Inngest re-executed them on EVERY subsequent step replay
  // (seen_count inflated ~10× per logical skip, ~40 duplicate upserts).
  // step.run memoizes the result so they fire exactly once per run.
  if (metaSkipDueToBudget) {
    await step.run(`meta-budget-skip-side-effects-${storeId}`, async () => {
    const skipMsg =
      'cron-daily: Meta BUC ≥ 80% within last 15 min; deferred to next cron-daily tick';
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
      recordFreshness({
        storeId,
        platform: 'meta',
        scope: 'kpi_daily',
        tableName: 'data_daily',
        status: 'budget_skip',
        errorCode: 'META_BUDGET_HIGH',
        errorMessage: skipMsg,
        budgetSkip: true,
      }),
    ]);
    // Notify operator via WhatsApp-suppressed budget_skip channel (Task 11).
    await notifyTokenFailure({
      provider: 'meta',
      storeId: storeId as 'uzoshop' | 'zolplus' | 'usmile360',
      operation: 'cron_daily_budget_skip',
      errorMsg: 'META_BUDGET_HIGH: pre-flight skip; max BUC ≥ 80% within last 15 min',
      advice:
        'Meta BUC reached 80% threshold; cron-daily pre-flight gate skipped Meta fetch. ' +
        'No operator action — cron-daily will retry next tick once usage decays.',
    }).catch(() => {});
    });
  }

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
  // Phase 13.4 — split the monolithic fetch-shopify step into 3 smaller
  // steps that run in parallel. Each retries independently; Inngest
  // memoizes per step so a retry doesn't have to refetch siblings that
  // already succeeded. Step count: 6 → 8 (still well under free-tier).
  // The Shopify auth-alert wrapping is preserved on the day-rows fetcher
  // — day-rows is what calls the heavy Admin REST orders endpoint where
  // Shopify enforces tokens most strictly, so an auth failure there is
  // the canonical signal. orders-attribution and catalog use the same
  // token; a separate auth failure on those alone is rare and would be
  // subsumed by the day-rows alert anyway.
  async function fetchShopifyDayWithAuthAlert(): Promise<Awaited<ReturnType<typeof fetchShopifyDayRows>>> {
    try {
      return await fetchShopifyDayRows(storeId, dateStr);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (isAuthError('shopify', errMsg)) {
        await notifyTokenFailure({
          provider: 'shopify',
          storeId: storeId as 'uzoshop' | 'zolplus' | 'usmile360',
          operation: 'fetch_day_rows',
          errorMsg: errMsg,
          advice:
            'Re-mint the Shopify Admin API access token (Shopify Partners → ' +
            'app → revoke + reinstall) and update ' +
            `${storeId.toUpperCase()}_SHOPIFY_ACCESS_TOKEN in Vercel + redeploy.`,
        }).catch(() => {});
      }
      throw e;
    }
  }

  // Explicit per-step types: step.run<T> inference through Promise.all's
  // tuple sometimes degrades to `unknown` (depends on the @inngest types
  // version). Cast each result to its source-function's return type so the
  // downstream code (productRows.map, orders.map, catalog.map) sees the
  // proper shape.
  const [dayUnk, ordersUnk, catalogUnk] = await Promise.all([
    step.run('fetch-shopify-day', () => fetchShopifyDayWithAuthAlert()),
    step.run('fetch-shopify-orders', () => fetchShopifyOrdersAttribution(storeId, dateStr)),
    step.run('fetch-shopify-catalog', () => fetchShopifyProductsCatalog(storeId)),
  ]);
  const day = dayUnk as Awaited<ReturnType<typeof fetchShopifyDayRows>>;
  const orders = ordersUnk as Awaited<ReturnType<typeof fetchShopifyOrdersAttribution>>;
  const catalog = catalogUnk as Awaited<ReturnType<typeof fetchShopifyProductsCatalog>>;
  const shopify = { ...day, orders, catalog };

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
  // Audit fix 2026-05-23 (HG-01 pipeline): each platform's fetch is now
  // wrapped in try/catch returning a zero-spend sentinel. Pre-fix, a
  // single platform's token expiry threw → Inngest retried 4× → final
  // failure killed the ENTIRE runDailyForStore (Shopify + Meta + Google
  // + TikTok all skipped for that store/day). Now a Meta 401 only zeros
  // Meta's contribution; Google + TikTok + Shopify still land.
  //
  // The silent-zero is intentionally paired with the token-failure alert
  // path (notifyTokenFailure / token_failure_alert WhatsApp template) so
  // the operator still gets a signal — once Meta approves that template
  // and the fetchers call notifyTokenFailure, the warn below becomes
  // operator-visible. Until then it lands in Inngest run logs.
  const meta = (await step.run('fetch-meta', async () => {
    // Phase A 2026-05-29 (Task 13): pre-flight gate — return empty sentinel
    // without calling any Meta API when BUC >= 80% within last 15 min.
    // The synthetic failure + recordFreshness calls were already made above.
    if (metaSkipDueToBudget) {
      return {
        spend: { storeId, date: dateStr, spend: 0, currency: 'ILS', impressions: 0 },
        adsetRows: [],
        adRows: [],
        budgets: { currency: 'ILS', campaigns: {}, adSets: {} },
      };
    }
    // ads-off Phase 3 (2026-06-06): per-store/platform gate. Returns the same
    // zero sentinel shape so persist-batch writes nothing for this platform
    // (spend=0 + empty arrays). data_freshness is worker-owned; no write here.
    if (!isAdsEnabled(adStateMap, storeId, 'meta')) {
      return {
        spend: { storeId, date: dateStr, spend: 0, currency: 'ILS', impressions: 0 },
        adsetRows: [],
        adRows: [],
        budgets: { currency: 'ILS', campaigns: {}, adSets: {} },
      };
    }
    try {
      const [spend, adsetRows, adRows, budgets] = await Promise.all([
        fetchMetaSpendForDay(storeId, dateStr),
        fetchMetaAdSetInsights(storeId, dateStr),
        fetchMetaAdInsights(storeId, dateStr),
        fetchMetaBudgets(storeId),
      ]);
      return { spend, adsetRows, adRows, budgets };
    } catch (e) {
      // Phase 13.2 P0-D — capture to Sentry + dedup-throttled WhatsApp.
      // Replaces the prior isAuthError-only branch — ANY non-auth Meta error
      // (5xx, network, parse) now fires both signals. Dedup Set scoped to
      // this cron invocation; existing 1/6h throttle in tokenFailures.ts is
      // the second-line dedupe across runs.
      await captureCronFetchError(
        {
          storeId: storeId as 'uzoshop' | 'zolplus' | 'usmile360',
          platform: 'meta',
          dedup: fetchErrorDedup,
        },
        e,
        `Refresh the Meta access token in Vercel (${storeId.toUpperCase()}_META_ACCESS_TOKEN) and redeploy, OR check Meta's status page if recurrent.`,
      );
      // Phase 13.4.1 — Fallback shape must match the real fetchMetaBudgets
      // return shape (Record-of-id, not Map). Map crosses the step.run
      // boundary and Inngest JSON-serializes it to `{}` after memoization,
      // so downstream `meta.budgets.campaigns[id]` reads were structurally
      // empty regardless. Now an honest `{}` + currency the cadFor path
      // can safely consume (no-op since campaigns/adSets are empty).
      return {
        spend: { storeId, date: dateStr, spend: 0, currency: 'ILS', impressions: 0 },
        adsetRows: [],
        adRows: [],
        budgets: { currency: 'ILS', campaigns: {}, adSets: {} },
      };
    }
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
  // Audit fix 2026-05-23 (HG-01 pipeline): same soft-fail wrap as Meta above.
  const google = (await step.run('fetch-google', async () => {
    // ads-off Phase 3 (2026-06-06): per-store/platform gate.
    if (!isAdsEnabled(adStateMap, storeId, 'google')) {
      return {
        spend: { storeId, date: dateStr, spend: 0, currency: 'CAD', impressions: 0 },
        adGroupRows: [],
        adRows: [],
      };
    }
    try {
      const [spend, adGroupRows, adRows] = await Promise.all([
        fetchGoogleAdsSpendForDay(storeId, dateStr),
        fetchGoogleAdsAdGroupInsights(storeId, dateStr),
        fetchGoogleAdsAdInsights(storeId, dateStr),
      ]);
      return { spend, adGroupRows, adRows };
    } catch (e) {
      // Phase 13.2 P0-D — same dedup-throttled capture+alert for Google Ads.
      await captureCronFetchError(
        {
          storeId: storeId as 'uzoshop' | 'zolplus' | 'usmile360',
          platform: 'google',
          dedup: fetchErrorDedup,
        },
        e,
        'Re-run the OAuth Playground flow to mint a fresh GOOGLEADS_REFRESH_TOKEN. ' +
          'Update Vercel env vars + redeploy. See docs/PROPS-MAP.md rows 28-32.',
      );
      return {
        spend: { storeId, date: dateStr, spend: 0, currency: 'CAD', impressions: 0 },
        adGroupRows: [],
        adRows: [],
      };
    }
  })) as {
    spend: Awaited<ReturnType<typeof fetchGoogleAdsSpendForDay>>;
    adGroupRows: Awaited<ReturnType<typeof fetchGoogleAdsAdGroupInsights>>;
    adRows: Awaited<ReturnType<typeof fetchGoogleAdsAdInsights>>;
  };

  // ---- Step 3.5: TikTok (spend + ad-level insights) — uzoshop only --------
  // Phase 05.7.7: TikTok integration. Other stores short-circuit to zero/empty
  // so the step ID stays stable across stores (jobs-table uniformity) and the
  // step counts as 1 exec regardless of whether a fetch happened.
  // Audit fix 2026-05-23 (HG-01 pipeline): same soft-fail wrap as Meta/Google.
  // The pre-fix behavior was especially painful here: a single uzoshop
  // TikTok token expiry failed the ENTIRE cron-daily run for uzoshop —
  // Shopify revenue + Meta + Google all rolled back too.
  const tiktok = (await step.run('fetch-tiktok', async () => {
    // ads-off Phase 3 (2026-06-06): account-level gate. TikTok is a shared
    // account (uzoshop + usmile360); skip the fetch only when ALL shared stores
    // have TikTok off — one store still ON means the account fetch must run.
    if (!STORES_WITH_TIKTOK.has(storeId) || !tiktokAccountFetchEnabled(adStateMap)) {
      return {
        spend: {
          storeId,
          date: dateStr,
          spend: 0,
          currency: 'USD',
          impressions: 0,
        } as TikTokDaySpend,
        adRows: [] as TikTokAdRow[],
      };
    }
    try {
      const [spend, adRows] = await Promise.all([
        fetchTikTokSpendForDay(storeId, dateStr),
        fetchTikTokAdInsights(storeId, dateStr),
      ]);
      return { spend, adRows };
    } catch (e) {
      // Phase 13.2 P0-D — same dedup-throttled capture+alert for TikTok.
      await captureCronFetchError(
        {
          storeId: storeId as 'uzoshop' | 'zolplus' | 'usmile360',
          platform: 'tiktok',
          dedup: fetchErrorDedup,
        },
        e,
        'Re-authorize TikTok via /api/oauth/tiktok/callback to refresh the ' +
          `${storeId.toUpperCase()}_TIKTOK_ACCESS_TOKEN. Update Vercel env + redeploy.`,
      );
      return {
        spend: { storeId, date: dateStr, spend: 0, currency: 'USD', impressions: 0 } as TikTokDaySpend,
        adRows: [] as TikTokAdRow[],
      };
    }
  })) as {
    spend: TikTokDaySpend;
    adRows: TikTokAdRow[];
  };

  // ---- Step 4: Manual overrides + FX → CAD totals -------------------------
  // mergeOverridesFromSupabase reads the manual_overrides table for
  // (date, storeId) and REPLACES (not adds) the fb/ga/tt spend if any rows
  // exist, then converts to CAD via getFxRate (Frankfurter). Returns
  // { fbSpendCad, gaSpendCad, ttSpendCad, totalSpendCad, overridesApplied }.
  //
  // TikTok (2026-06-02): we pass the fetched per-store TikTok spend in so the
  // merge can REPLACE it with the operator's typed override when one exists for
  // (date, storeId, 'tiktok'). The override is keyed by store_id, so it only
  // ever replaces THIS store's mapped TikTok share — never the raw shared
  // account. `overridesApplied.tiktok` then decides whether the override value
  // (authoritative) or the fetched/FX'd value wins at persist (Step 5 below).
  const merged = (await step.run('apply-manual-overrides', () =>
    mergeOverridesFromSupabase({
      storeId,
      date: dateStr,
      metaSpend: meta.spend, // { spend, currency:'ILS' }
      googleSpend: google.spend, // { spend, currency:'CAD' } or zero
      tiktokSpend: tiktok.spend, // { spend, currency:'USD' } or zero-sentinel
    }),
  )) as Awaited<ReturnType<typeof mergeOverridesFromSupabase>>;

  // ---- Step 5: Persist batch (3 tables, all writes in one step) -----------
  // Batched per RESEARCH §Pitfall 4: one step.run for all writes keeps the
  // exec count low. ON CONFLICT idempotency means a retry re-runs all
  // writes safely (D-B5).
  //
  // Audit fix 2026-05-24 (AUDIT INN-01, Phase 12.1.1): capture the persisted
  // row values so RunDailyResult.roas/grossProfitCad/netProfitCad/totalSpendCad
  // match what was actually written to disk (including TikTok). Pre-fix the
  // return value used merged.totalSpendCad which EXCLUDES TikTok — for uzoshop
  // (the TikTok store) operator saw inconsistent numbers in jobs table vs
  // dashboard. Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
  //   inngest_cronDaily.json (INN-01).
  let persistedTotalSpendCad: number | null = null;
  let persistedRoas = 0;
  let persistedGrossProfitCad = 0;
  let persistedNetProfitCad = 0;
  let persistedCogsCad = 0;

  await step.run('persist-batch', async () => {
    const admin = getSupabaseAdmin();
    // Phase 05.7.7: TikTok spend → CAD. Other stores have tt.spend=0 from
    // the short-circuit in the fetch-tiktok step above, so this is a no-op
    // FX call for them (cadFor returns 0 when amount is 0).
    //
    // Audit fix 2026-05-23 (CRIT-5 / O4-CR-01): TikTok FX failure must not
    // crash the entire persist-batch step. Pre-fix, a Frankfurter outage
    // here threw BEFORE any DB write, rolling back the whole daily run —
    // Shopify revenue + Meta + Google + orders + catalog all lost for that
    // (store, day). Now: on FX failure, `ttSpendCad` stays `null` and the
    // data_daily payload omits `tt_spend_cad` → Supabase ON CONFLICT
    // preserves the prior value. Mirrors v2 cron-LIVE a/WARN-3 pattern.
    //
    // The other 5 columns (revenue_cad, gross_revenue_cad, etc.) are still
    // written, so refunds and revenue updates still land. The total_spend_cad
    // recomputation also skips the failed platform so it stays consistent
    // with whichever spend columns were actually persisted this tick.
    let fetchedTtSpendCad: number | null = null;
    if (tiktok.spend.spend > 0) {
      try {
        const cur = (tiktok.spend.currency || 'USD').toUpperCase();
        if (cur === 'CAD') {
          fetchedTtSpendCad = tiktok.spend.spend;
        } else {
          const rate = await getFxRate(cur, 'CAD', dateStr);
          fetchedTtSpendCad = tiktok.spend.spend * rate;
        }
      } catch (e) {
        console.warn(
          `cron-daily ${storeId} ${dateStr}: TikTok FX failed — omitting tt_spend_cad from data_daily upsert; ON CONFLICT preserves prior value. Error: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        fetchedTtSpendCad = null;
      }
    } else {
      fetchedTtSpendCad = 0;
    }
    // TikTok manual-override (2026-06-02): when the operator typed a TikTok
    // override for (store, date), `mergeOverridesFromSupabase` already FX'd it
    // to CAD (merged.ttSpendCad) and flagged merged.overridesApplied.tiktok.
    // The operator value is authoritative — it wins over the fetched/FX'd value
    // and even over a null fetched value (the override exists precisely because
    // the TikTok account errored and the auto-pull is empty/wrong). Otherwise
    // the fetched value (possibly null on FX failure) stands. `?? false` keeps
    // this robust when a caller/mock supplies a merge result without the tiktok
    // flag.
    const ttSpendCad: number | null = chooseTikTokSpendCad({
      overrideApplied: merged.overridesApplied.tiktok ?? false,
      overrideCad: merged.ttSpendCad ?? 0,
      fetchedCad: fetchedTtSpendCad,
    });
    // total_spend_cad consistency: only include TikTok in the rolled-up
    // total when its CAD value was successfully computed. If TikTok FX
    // failed (ttSpendCad === null), we omit total_spend_cad from the upsert
    // payload too — preserving the prior consistent value rather than
    // writing a fb+ga sum that contradicts the (untouched) tt column.
    //
    // NOTE (2026-06-02): build the total from the persisted fb/ga + the CHOSEN
    // ttSpendCad (override-or-fetched). We deliberately do NOT use
    // merged.totalSpendCad here — that already folds in the merge's own TikTok
    // figure, so reusing it would double-count TikTok. fb/ga are identical
    // between merged.* and the persisted columns, so this stays consistent with
    // the fb_spend_cad / ga_spend_cad / tt_spend_cad actually written below.
    // P1-11 (2026-06-10): merged.fbSpendCad / merged.gaSpendCad can now be
    // null too (merge-layer FX failure on the no-override path — see
    // manualOverrides.spendToCad). Any null component → null total, so we
    // never persist a partial sum that contradicts the preserved columns.
    const totalSpendCadAll =
      ttSpendCad === null || merged.fbSpendCad === null || merged.gaSpendCad === null
        ? null
        : merged.fbSpendCad + merged.gaSpendCad + ttSpendCad;
    const roas =
      totalSpendCadAll !== null && totalSpendCadAll > 0
        ? shopify.revenueCad / totalSpendCadAll
        : 0;
    const grossProfitCad =
      totalSpendCadAll === null ? 0 : shopify.revenueCad - totalSpendCadAll;
    // Audit fix 2026-05-23 (MR-01): per-store COGS rate replaces the
    // hardcoded 0.25 default. See `getCogsRateForStore` for the env-var
    // convention.
    const cogsRate = getCogsRateForStore(storeId);
    const cogsCad = shopify.revenueCad * cogsRate;
    const netProfitCad =
      totalSpendCadAll === null ? 0 : grossProfitCad - cogsCad;

    // Audit fix 2026-05-24 (AUDIT INN-01, Phase 12.1.1): mirror the
    // computed values into the outer-scope captured vars so the
    // RunDailyResult return value (built after this step.run completes)
    // uses the SAME numbers actually persisted to data_daily.
    persistedTotalSpendCad = totalSpendCadAll;
    persistedRoas = roas;
    persistedGrossProfitCad = grossProfitCad;
    persistedNetProfitCad = netProfitCad;
    persistedCogsCad = cogsCad;

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
    //
    // Audit fix 2026-05-23 (CRIT-5 / O4-CR-01): cadFor returns `null` on
    // FX failure instead of throwing. Per-row builders detect `null` and
    // OMIT the spend_cad / conversion_value_cad / budget_cad keys from
    // the upsert payload; Supabase ON CONFLICT only updates payload keys
    // → prior CAD value preserved. The previous behavior (throwing from
    // cadFor) corrupted every persist-batch run that touched a single
    // failed FX row: data_daily + products_daily had ALREADY been
    // committed before the throw, leaving partial-state writes
    // (Shopify revenue persisted, Meta/Google/TikTok campaigns rolled
    // back via the throw). Mirrors v2 cron-LIVE a/WARN-3 pattern.
    //
    // Cache failures too (null sentinel) so we don't hammer Frankfurter
    // with retries inside the same persist-batch.
    const fxCache = new Map<string, number | null>();
    const cadFor = async (
      amount: number,
      currency: string,
    ): Promise<number | null> => {
      if (!Number.isFinite(amount) || amount === 0) return 0;
      const cur = (currency || 'ILS').toUpperCase();
      if (cur === 'CAD') return amount;
      let rate = fxCache.get(cur);
      if (rate === undefined) {
        try {
          rate = await getFxRate(cur, 'CAD', dateStr);
        } catch (e) {
          console.warn(
            `cron-daily ${storeId} ${dateStr}: FX ${cur}→CAD failed — omitting CAD-denominated columns this tick; ON CONFLICT preserves prior values. Error: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          rate = null;
        }
        fxCache.set(cur, rate);
      }
      if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
      return amount * rate;
    };

    // 5a. data_daily UPSERT — PK (date, store_id)
    // 2026-05-21 (Phase 05.7.3): also populate gross_revenue_cad +
    // refund_deduction_cad so the dashboard can show "before/after refunds"
    // and the refund-day indicator chip + tooltip. Invariant:
    // revenue_cad = gross_revenue_cad − refund_deduction_cad.
    //
    // Audit fix 2026-05-23 (CRIT-5 / O4-CR-01): tt_spend_cad and
    // total_spend_cad / roas / gross_profit_cad / net_profit_cad are
    // ABSENT from the payload when TikTok FX failed (`ttSpendCad === null`)
    // so ON CONFLICT preserves the prior consistent values. revenue_cad +
    // gross_revenue_cad + refund_deduction_cad + fb_spend_cad +
    // ga_spend_cad still update (their FX path either succeeded or used
    // already-CAD values from the merger). cogs_cad still updates because
    // it's a function of revenue_cad alone (no FX involved).
    {
      type DataDailyRow = {
        date: string;
        store_id: string;
        store_name: string;
        // P1-11 (2026-06-10): fb/ga spend columns are OPTIONAL — absent when
        // the merge-layer FX conversion failed (merged.* === null) so ON
        // CONFLICT preserves the prior value, mirroring tt_spend_cad below.
        fb_spend_cad?: number;
        ga_spend_cad?: number;
        revenue_cad: number;
        gross_revenue_cad: number;
        refund_deduction_cad: number;
        cogs_cad: number;
        tt_spend_cad?: number;
        total_spend_cad?: number;
        roas?: number;
        gross_profit_cad?: number;
        net_profit_cad?: number;
        // Phase 13.8 (2026-05-26) — per-platform impressions, written here
        // by the nightly run so historical days carry the full per-platform
        // (spend, impressions) pair. cron-live tops this off live.
        fb_impressions?: number;
        ga_impressions?: number;
        tt_impressions?: number;
        // Phase A 2026-05-29 (Task 13) — finalization fields.
        source: string;
        is_finalized: boolean;
        reconciled_at: string;
      };
      const dataDailyRow: DataDailyRow = {
        date: dateStr,
        store_id: storeId,
        store_name: shopify.storeName,
        revenue_cad: shopify.revenueCad,
        gross_revenue_cad: shopify.grossRevenueCad,
        refund_deduction_cad: shopify.refundDeductionCad,
        cogs_cad: cogsCad,
        // Phase A 2026-05-29 (Task 13) — finalization fields.
        source: 'daily_reconcile',
        is_finalized: isFinalized,
        reconciled_at: reconciledAt,
      };
      // P1-11: per-platform spend + impressions pairs land together or not
      // at all (mirrors the tt_spend_cad / tt_impressions gating below) so a
      // preserved spend column never sits next to a contradicting fresh
      // impressions count. Phase 13.8 note: impressions come directly from
      // the platform fetcher (manual overrides only affect spend, not reach);
      // the soft-fail fetch path carries `impressions: 0` so the column
      // resets rather than hanging onto a stale prior value.
      if (merged.fbSpendCad !== null) {
        dataDailyRow.fb_spend_cad = merged.fbSpendCad;
        dataDailyRow.fb_impressions = meta.spend.impressions;
      }
      if (merged.gaSpendCad !== null) {
        dataDailyRow.ga_spend_cad = merged.gaSpendCad;
        dataDailyRow.ga_impressions = google.spend.impressions;
      }
      if (ttSpendCad !== null && totalSpendCadAll !== null) {
        dataDailyRow.tt_spend_cad = ttSpendCad;
        dataDailyRow.total_spend_cad = totalSpendCadAll;
        dataDailyRow.roas = roas;
        dataDailyRow.gross_profit_cad = grossProfitCad;
        dataDailyRow.net_profit_cad = netProfitCad;
        // Mirror the tt_spend_cad gating: when TikTok FX failed (above) we
        // can't write a tt_impressions count either, so we leave it absent
        // and ON CONFLICT preserves whatever cron-live or the prior nightly
        // run already had.
        dataDailyRow.tt_impressions = tiktok.spend.impressions;
      }
      const { error } = await admin.from('data_daily').upsert(dataDailyRow, {
        onConflict: 'date,store_id',
      });
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
        // Phase A 2026-05-29 (Task 13) — finalization fields.
        source: 'daily_reconcile',
        is_finalized: isFinalized,
        reconciled_at: reconciledAt,
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
    //
    // 2026-05-23 comment refresh (Codex-NEW-3): the prior paragraph here
    // said "spend_cad is null for Meta because per-adset FX is deferred"
    // — that was true through 2026-05-20 but the 2026-05-21 FX fix made
    // it stale and dangerous (future fixes might "restore" the obsolete
    // null-write thinking they were preserving intent).
    //
    // CURRENT behavior: per-row spend_cad + conversion_value_cad (plus
    // campaign_budget_cad + ad_set_budget_cad when budget > 0) are
    // FX-converted in-place via the `cadFor` closure defined a few lines
    // above. cadFor caches one Frankfurter call per (store, date, currency)
    // tuple inside this single persist-batch step.
    //
    // Audit 2026-05-23 (CRIT-5 / O4-CR-01): cadFor returns `null` on FX
    // outage and the per-row builder OMITS the affected CAD key from the
    // payload → Supabase ON CONFLICT preserves the prior CAD value (only
    // payload keys go into the SET clause). The other columns
    // (impressions, clicks, conversions, budget_type, effective_status)
    // are FX-independent and always update.
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
      // Audit fix 2026-05-23 (CRIT-5 / O4-CR-01): cadFor returns `null` on
      // FX failure. Build the per-row payload conditionally: when a CAD
      // conversion failed, OMIT that key so ON CONFLICT preserves the
      // prior value rather than NULL-ing it out.
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
          // Phase 05.7.x — pick the most specific effective_status:
          // ad-set first (an ACTIVE Meta campaign can hold an
          // ADSET_PAUSED ad-set; the operator's "this is off" intuition
          // tracks the ad-set state), fall back to campaign level.
          const adSetStatus = aBud?.effectiveStatus ?? null;
          const campaignStatus = cBud?.effectiveStatus ?? null;
          const effectiveStatus = adSetStatus ?? campaignStatus;
          const spendCad = await cadFor(r.spend, r.currency);
          const convValueCad = await cadFor(r.conversionValue, r.currency);
          const campaignBudgetCad =
            campaignBudgetRaw > 0
              ? await cadFor(campaignBudgetRaw, meta.budgets.currency)
              : null;
          const adSetBudgetCad =
            adSetBudgetRaw > 0
              ? await cadFor(adSetBudgetRaw, meta.budgets.currency)
              : null;
          type MetaCampaignRow = {
            date: string;
            store_id: string;
            platform: 'meta';
            campaign_id: string;
            campaign_name: string;
            ad_set_id: string;
            ad_set_name: string;
            impressions: number;
            clicks: number;
            conversions: number;
            roas: null;
            budget_type: 'CBO' | 'ABO' | '';
            effective_status: string | null;
            spend_cad?: number;
            conversion_value_cad?: number;
            // Budget columns are always present (null is the legitimate
            // "no budget set" value); we just don't write a wrong CAD value
            // when FX failed for a non-CAD budget.
            campaign_budget_cad?: number | null;
            ad_set_budget_cad?: number | null;
            // Phase A 2026-05-29 (Task 13) — finalization fields.
            source: string;
            is_finalized: boolean;
            reconciled_at: string;
          };
          const row: MetaCampaignRow = {
            date: dateStr,
            store_id: storeId,
            platform: 'meta',
            campaign_id: r.campaignId,
            campaign_name: r.campaignName,
            ad_set_id: r.adSetId,
            ad_set_name: r.adSetName,
            impressions: Math.round(r.impressions),
            clicks: Math.round(r.clicks),
            conversions: Math.round(r.conversions),
            roas: null,
            // Empty string '' stays in the DB; `postgresReaders.fetchCampaigns`
            // already normalizes '' / null / undefined → '' (campaigns.ts:135).
            budget_type: bt,
            // Phase 05.7.x — Meta effective_status (PAUSED / ACTIVE / etc).
            // Migration 20260522180000 added the column; NULL when the
            // budgets fetch soft-failed.
            effective_status: effectiveStatus,
            // Phase A 2026-05-29 (Task 13) — finalization fields.
            source: 'daily_reconcile',
            is_finalized: isFinalized,
            reconciled_at: reconciledAt,
          };
          if (spendCad !== null) row.spend_cad = spendCad;
          if (convValueCad !== null) row.conversion_value_cad = convValueCad;
          // For budget columns, distinguish "no budget configured" (raw=0,
          // write null) from "FX failed" (raw>0 but cad=null, omit key so
          // prior value is preserved).
          if (campaignBudgetRaw === 0) {
            row.campaign_budget_cad = null;
          } else if (campaignBudgetCad !== null) {
            row.campaign_budget_cad = campaignBudgetCad;
          }
          if (adSetBudgetRaw === 0) {
            row.ad_set_budget_cad = null;
          } else if (adSetBudgetCad !== null) {
            row.ad_set_budget_cad = adSetBudgetCad;
          }
          return row;
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
        // Phase 05.7.x — Google Ads status (ENABLED / PAUSED / REMOVED).
        // Fetcher prefers ad_group.status, falls back to campaign.status
        // (for Shopping/PMax campaign-level aggregates). NULL only when
        // both fields were missing on the wire (defensive).
        effective_status: r.effectiveStatus ?? null,
        // Phase A 2026-05-29 (Task 13) — finalization fields.
        source: 'daily_reconcile',
        is_finalized: isFinalized,
        reconciled_at: reconciledAt,
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
      // Audit fix 2026-05-23 (CRIT-5 / O4-CR-01): omit spend_cad /
      // conversion_value_cad when cadFor returned `null` (FX failed) so
      // ON CONFLICT preserves the prior CAD values.
      type MetaAdRow = {
        date: string;
        store_id: string;
        platform: 'meta';
        campaign_id: string;
        campaign_name: string;
        ad_set_id: string;
        ad_set_name: string;
        ad_id: string;
        ad_name: string;
        impressions: number;
        clicks: number;
        conversions: number;
        reach: number | null;
        roas: null;
        spend_cad?: number;
        conversion_value_cad?: number;
        // Phase A 2026-05-29 (Task 13) — finalization fields.
        source: string;
        is_finalized: boolean;
        reconciled_at: string;
      };
      const metaAdsRows: MetaAdRow[] = await Promise.all(
        meta.adRows.map(async (r) => {
          const spendCad = await cadFor(r.spend, r.currency);
          const convValueCad = await cadFor(r.conversionValue, r.currency);
          const row: MetaAdRow = {
            date: r.date,
            store_id: r.storeId,
            platform: r.platform, // 'meta'
            campaign_id: r.campaignId,
            campaign_name: r.campaignName,
            ad_set_id: r.adSetId,
            ad_set_name: r.adSetName,
            ad_id: r.adId,
            ad_name: r.adName,
            // BIGINT-safe: see comment on metaCampaignRows above.
            impressions: Math.round(r.impressions),
            clicks: Math.round(r.clicks),
            conversions: Math.round(r.conversions),
            reach: r.reach ?? null,
            roas: null,
            // Phase A 2026-05-29 (Task 13) — finalization fields.
            source: 'daily_reconcile',
            is_finalized: isFinalized,
            reconciled_at: reconciledAt,
          };
          if (spendCad !== null) row.spend_cad = spendCad;
          if (convValueCad !== null) row.conversion_value_cad = convValueCad;
          return row;
        }),
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
        // Phase A 2026-05-29 (Task 13) — finalization fields.
        source: 'daily_reconcile',
        is_finalized: isFinalized,
        reconciled_at: reconciledAt,
      }));
      // Phase 05.7.7: TikTok rows. Same shape as Meta/Google but flagged
      // platform='tiktok'. TikTok ads return per-ad spend in account
      // currency (USD for uzoshop), so we FX-convert via cadFor.
      // Audit fix 2026-05-23 (CRIT-5): cadFor omits CAD keys on FX failure
      // → ON CONFLICT preserves prior values.
      type TiktokAdRowShape = {
        date: string;
        store_id: string;
        platform: 'tiktok';
        campaign_id: string;
        campaign_name: string;
        ad_set_id: string;
        ad_set_name: string;
        ad_id: string;
        ad_name: string;
        impressions: number;
        clicks: number;
        conversions: number;
        reach: number | null;
        roas: null;
        spend_cad?: number;
        conversion_value_cad?: number;
        // Phase A 2026-05-29 (Task 13) — finalization fields.
        source: string;
        is_finalized: boolean;
        reconciled_at: string;
      };
      const tiktokAdsRows: TiktokAdRowShape[] = await Promise.all(
        tiktok.adRows.map(async (r) => {
          const spendCad = await cadFor(r.spend, r.currency);
          const convValueCad = await cadFor(r.conversionValue, r.currency);
          const row: TiktokAdRowShape = {
            date: dateStr,
            store_id: r.storeId ?? storeId,
            platform: 'tiktok',
            campaign_id: r.campaignId,
            campaign_name: r.campaignName,
            ad_set_id: r.adGroupId,
            ad_set_name: r.adGroupName,
            ad_id: r.adId,
            ad_name: r.adName,
            impressions: Math.round(r.impressions),
            clicks: Math.round(r.clicks),
            conversions: Math.round(r.conversions),
            reach: r.reach ?? null,
            roas: null,
            // Phase A 2026-05-29 (Task 13) — finalization fields.
            source: 'daily_reconcile',
            is_finalized: isFinalized,
            reconciled_at: reconciledAt,
          };
          if (spendCad !== null) row.spend_cad = spendCad;
          if (convValueCad !== null) row.conversion_value_cad = convValueCad;
          return row;
        }),
      );
      // Phase A.5 v2 — DELETE other-store TikTok ads_daily rows for the ad_ids
      // being written this tick. Mirrors the campaigns_daily DELETE pattern.
      if (tiktokAdsRows.length > 0) {
        const ttAdIds = [...new Set(tiktokAdsRows.map(r => r.ad_id as string))];
        const ttTargetStoreIds = [...new Set(tiktokAdsRows.map(r => r.store_id as string))];
        const { error: delErr } = await admin
          .from('ads_daily')
          .delete()
          .eq('date', dateStr)
          .eq('platform', 'tiktok')
          .in('ad_id', ttAdIds)
          .not('store_id', 'in', `(${ttTargetStoreIds.map(s => `"${s}"`).join(',')})`);
        if (delErr) {
          console.warn(
            `cron-daily ${storeId} ${dateStr}: ads_daily tt DELETE failed: ${delErr.message}`,
          );
        }
      }

      const adsRows = [...metaAdsRows, ...googleAdsRows, ...tiktokAdsRows];
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

    // 5d-tiktok. campaigns_daily UPSERT (TikTok rows) — same PK as 5c.
    // TikTok per-ad insights include campaign_id + ad_group_id; we
    // aggregate to the (campaign, ad_group) level to match the unified
    // schema (campaigns_daily PK includes ad_set_id, which maps to
    // ad_group_id on TikTok's side — same convention as Google in 5d).
    if (tiktok.adRows.length > 0) {
      type CampaignAggKey = string; // `${campaignId}__${adGroupId}`
      type CampaignAgg = {
        campaign_id: string;
        campaign_name: string;
        ad_set_id: string;
        ad_set_name: string;
        spend: number;
        impressions: number;
        clicks: number;
        conversions: number;
        conversionValue: number;
        currency: string;
        /** Phase 05.7.x — TikTok ad-group secondary_status (all rows of
         *  the same ad-group carry the same status; we keep the first
         *  non-null seen while folding). */
        effectiveStatus: string | null;
        /** Phase A.5 v2 — store_id resolved from campaign-store-map. */
        storeId: string;
      };
      const byCampaign = new Map<CampaignAggKey, CampaignAgg>();
      for (const ad of tiktok.adRows) {
        const key = `${ad.campaignId}__${ad.adGroupId}`;
        const existing = byCampaign.get(key);
        if (existing) {
          existing.spend += ad.spend;
          existing.impressions += ad.impressions;
          existing.clicks += ad.clicks;
          existing.conversions += ad.conversions;
          existing.conversionValue += ad.conversionValue;
          // Status is ad-group-level; first non-null wins (all ads of
          // the same ad-group share the value, so picking later wouldn't
          // change anything in practice — first-wins is just simpler).
          if (!existing.effectiveStatus && ad.effectiveStatus) {
            existing.effectiveStatus = ad.effectiveStatus;
          }
        } else {
          byCampaign.set(key, {
            campaign_id: ad.campaignId,
            campaign_name: ad.campaignName,
            ad_set_id: ad.adGroupId,
            ad_set_name: ad.adGroupName,
            spend: ad.spend,
            impressions: ad.impressions,
            clicks: ad.clicks,
            conversions: ad.conversions,
            conversionValue: ad.conversionValue,
            currency: ad.currency,
            effectiveStatus: ad.effectiveStatus,
            storeId: ad.storeId,
          });
        }
      }
      // Audit fix 2026-05-23 (CRIT-5): omit CAD keys on FX failure.
      type TiktokCampaignRow = {
        date: string;
        store_id: string;
        platform: 'tiktok';
        campaign_id: string;
        campaign_name: string;
        ad_set_id: string;
        ad_set_name: string;
        impressions: number;
        clicks: number;
        conversions: number;
        roas: null;
        campaign_budget_cad: null;
        ad_set_budget_cad: null;
        budget_type: null;
        effective_status: string | null;
        spend_cad?: number;
        conversion_value_cad?: number;
        // Phase A 2026-05-29 (Task 13) — finalization fields.
        source: string;
        is_finalized: boolean;
        reconciled_at: string;
      };
      const tiktokCampaignRows: TiktokCampaignRow[] = await Promise.all(
        Array.from(byCampaign.values()).map(async (agg) => {
          const spendCad = await cadFor(agg.spend, agg.currency);
          const convValueCad = await cadFor(agg.conversionValue, agg.currency);
          const row: TiktokCampaignRow = {
            date: dateStr,
            store_id: agg.storeId ?? storeId,
            platform: 'tiktok',
            campaign_id: agg.campaign_id,
            campaign_name: agg.campaign_name,
            ad_set_id: agg.ad_set_id,
            ad_set_name: agg.ad_set_name,
            impressions: Math.round(agg.impressions),
            clicks: Math.round(agg.clicks),
            conversions: Math.round(agg.conversions),
            roas: null,
            campaign_budget_cad: null,
            ad_set_budget_cad: null,
            budget_type: null,
            // Phase 05.7.x — TikTok ad-group status (ADGROUP_STATUS_DISABLE,
            // ADGROUP_STATUS_DELIVERY_OK, etc). Source: /open_api/v1.3/adgroup/get/
            // via fetchTikTokAdGroupStatuses, merged into TikTokAdRow by adGroupId.
            effective_status: agg.effectiveStatus,
            // Phase A 2026-05-29 (Task 13) — finalization fields.
            source: 'daily_reconcile',
            is_finalized: isFinalized,
            reconciled_at: reconciledAt,
          };
          if (spendCad !== null) row.spend_cad = spendCad;
          if (convValueCad !== null) row.conversion_value_cad = convValueCad;
          return row;
        }),
      );
      // Phase A.5 v2 — DELETE other-store TikTok rows for the campaigns being
      // written this tick. Mirrors persistCampaignsLive (Task 3); the same
      // duplicate-row root cause applies to cron-daily's nightly reconcile.
      if (tiktokCampaignRows.length > 0) {
        const ttCampaignIds = [...new Set(tiktokCampaignRows.map(r => r.campaign_id as string))];
        const ttTargetStoreIds = [...new Set(tiktokCampaignRows.map(r => r.store_id as string))];
        const { error: delErr } = await admin
          .from('campaigns_daily')
          .delete()
          .eq('date', dateStr)
          .eq('platform', 'tiktok')
          .in('campaign_id', ttCampaignIds)
          .not('store_id', 'in', `(${ttTargetStoreIds.map(s => `"${s}"`).join(',')})`);
        if (delErr) {
          console.warn(
            `cron-daily ${storeId} ${dateStr}: campaigns_daily tt DELETE failed: ${delErr.message}`,
          );
        }
      }

      const { error } = await admin
        .from('campaigns_daily')
        .upsert(tiktokCampaignRows, {
          onConflict: 'date,store_id,platform,campaign_id,ad_set_id',
        });
      if (error) {
        throw new Error(
          `campaigns_daily (tiktok) upsert for ${storeId} ${dateStr}: ${error.message}`,
        );
      }
      // Phase A.5 v2 — re-aggregate data_daily TikTok columns per store from
      // the freshly-written per-row campaigns_daily slices. The duplicate-row
      // root cause is now prevented by the DELETE-then-UPSERT above, so the
      // RPC can run safely. Soft-fail: the per-row campaigns_daily data is
      // correct on its own; only the data_daily aggregate is stale on failure
      // (which the next tick fixes).
      //
      // TikTok manual-override guard (2026-06-02): the RPC re-derives
      // data_daily.tt_spend_cad FROM campaigns_daily — which would silently
      // CLOBBER the operator's authoritative override we just persisted above.
      // An override exists precisely to correct an account outage where
      // campaigns_daily is empty/wrong, so we MUST NOT let the agg overwrite it.
      // Skip the re-aggregation for this date when this store's TikTok override
      // is applied; the operator's value stays authoritative. (The RPC is
      // date-global + idempotent and re-runs every tick, so any other store's
      // aggregate self-heals on the next override-free tick.)
      if (merged.overridesApplied.tiktok) {
        console.warn(
          `cron-daily ${storeId} ${dateStr}: TikTok manual-override applied — skipping agg_tiktok_spend_per_store_for_date so the operator value stays authoritative.`,
        );
      } else {
        const { error: aggErr } = await admin.rpc('agg_tiktok_spend_per_store_for_date', { d: dateStr });
        if (aggErr) {
          console.warn(`cron-daily ${storeId} ${dateStr}: tt agg RPC failed: ${aggErr.message}`);
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
      const orderRows = shopify.orders.map((o) => toOrdersAttributionRow(o));
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

    // Phase 3 (2026-06-02) — refresh first-order-EVER flags for this store
    // over its FULL history (the RPC is unfiltered; a newly-arrived earlier
    // order can demote a later one). Soft-fail: the orders_attribution rows
    // are correct on their own; only is_first_order is stale on failure (the
    // next tick re-runs it). Unconditional — runs even when no orders landed
    // today (a prior day's order may still need flagging).
    const { error: foErr } = await admin.rpc('recompute_first_order_flags', {
      p_store_id: storeId,
    });
    if (foErr) {
      console.warn(
        `cron-daily ${storeId} ${dateStr}: recompute_first_order_flags failed: ${foErr.message}`,
      );
    }
  });

  // Audit fix 2026-05-24 (AUDIT INN-01, Phase 12.1.1): return value now
  // mirrors the persisted data_daily row (which INCLUDES TikTok when
  // ttSpendCad was successfully computed). Pre-fix the return used
  // merged.totalSpendCad which EXCLUDES TikTok — for uzoshop (the only
  // TikTok store) operator saw inconsistent ROAS in the jobs table vs
  // the dashboard. When TikTok FX fails (persistedTotalSpendCad === null
  // because cronDaily.ts:435-436 set it to null), fall back to
  // merged.totalSpendCad in the return shape so the operator still sees
  // a non-null usable number — but roas/grossProfit/netProfit stay at
  // their persisted 0-fallback so they match what the dashboard renders.
  return {
    storeId,
    date: dateStr,
    shopifyRevenueCad: shopify.revenueCad,
    fbSpendCad: merged.fbSpendCad,
    gaSpendCad: merged.gaSpendCad,
    totalSpendCad: persistedTotalSpendCad ?? merged.totalSpendCad,
    roas: persistedRoas,
    grossProfitCad: persistedGrossProfitCad,
    cogsCad: persistedCogsCad,
    netProfitCad: persistedNetProfitCad,
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

// ===========================================================================
// Self-serve stores Phase 4b (Task 8) — scheduler→worker FOLD.
//
// The per-store factory above (`makeCronDaily` + `cronDailyFunctions`) is KEPT
// on disk as a revert lever. The pair below replaces it once T9 registers them
// in serve(); until then these functions are INERT (Inngest only runs what is
// passed to serve()).
//
// Shape: ONE static-trigger scheduler (keeps the factory's EXACT cron) loads
// the active store list at runtime and emits one `cron/daily.store.requested`
// event per store; ONE event-driven worker (concurrency-keyed by store) calls
// the unchanged `runDailyForStore` handler — so a store added via the DB enters
// the daily cron with no deploy.
//
// NOTE: `step.sendEvent` is at the OUTER function level, NEVER inside step.run
// (Inngest rejects nested steps — that nesting caused a prod 60s timeout in the
// orchestrator on 2026-05-29). The store-list load + plan build happens inside
// `step.run` (idempotent + retry-safe); only the emit is outer.
// ===========================================================================

export const cronDailyScheduler = inngest.createFunction(
  {
    id: 'cron-daily-scheduler',
    // Identical trigger to the factory's `cron-daily-{store}` functions.
    triggers: [{ cron: 'TZ=Asia/Jerusalem 5 0 * * *' }],
  },
  async ({ step }) => {
    const jobs = await step.run('load-stores', async () => {
      const stores = await loadActiveStoreIds();
      return planStoreJobs(stores, { family: 'daily', date: yesterdayJerusalem() });
    });
    if (jobs.length > 0) {
      await step.sendEvent(
        'fan-out-daily',
        jobs.map((j) => ({ name: j.eventName, id: j.id, data: j.data })),
      );
    }
    return { enqueued: jobs.length };
  },
);

/**
 * Pure worker core — exported so vitest can assert the worker threads
 * `event.data` into the handler without the co-located mock-resolution problem
 * (a `vi.mock` of this module does NOT intercept the binding's in-module call
 * to `runDailyForStore`). Mirrors metaWorker.runMetaWorkerJob's injectable
 * shape: the Inngest binding passes the real `runDailyForStore`; tests pass a
 * `vi.fn()`. `runDailyForStore` itself is UNCHANGED.
 */
export async function runCronDailyWorker(
  event: { data: { storeId: string; date?: string } },
  step: RunDailyStep,
  handler: typeof runDailyForStore = runDailyForStore,
): Promise<RunDailyResult> {
  // Untyped event payload (no EventSchemas on the client) — cast at the
  // boundary. planStoreJobs always emits `{ storeId, date }` for the daily
  // family.
  return handler(event.data.storeId as StoreId, event.data.date as string, { step });
}

export const cronDailyWorker = inngest.createFunction(
  {
    id: 'cron-daily-worker',
    triggers: [{ event: 'cron/daily.store.requested' }],
    // Concurrency key matches the planStoreJobs payload field (`data.storeId`).
    // limit:1 per store preserves the factory's implicit single-flight.
    concurrency: [{ key: 'event.data.storeId', limit: 1 }],
    retries: 1,
  },
  // The `step` cast narrows Inngest's full step API to the `RunDailyStep` subset
  // runDailyForStore consumes (Inngest's step.run returns Jsonify<T>; for the
  // handler's plain-record return Jsonify<T> ≡ T, so the cast is sound).
  async ({ event, step }) =>
    runCronDailyWorker(
      event as unknown as { data: { storeId: string; date?: string } },
      step as unknown as RunDailyStep,
    ),
);
