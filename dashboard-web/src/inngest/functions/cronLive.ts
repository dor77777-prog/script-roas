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
import { fetchShopifyDayRows, type ShopifyDayRows } from '@/lib/fetchers/shopify';
import { fetchMetaSpendForDayLight } from '@/lib/fetchers/meta';
import { fetchGoogleAdsSpendForDay } from '@/lib/fetchers/googleAds';
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
 * COGS rate — fixed 25% of revenue per existing dashboard convention
 * (matches `dashboard-web/src/lib/sheets.ts` consumers + Apps Script's
 * `DailyUpdate.gs` rendering). Daily cron also uses 0.25; keeping the
 * constant aligned across cron-live and cron-daily prevents drift in the
 * `cogs_cad` column when the two crons interleave.
 *
 * NOTE: when stores receive an updated COGS ratio (per-store-per-product
 * via `product_cogs` table), Phase 05.7+ migrates this to a per-row lookup.
 */
const COGS_RATE = 0.25;

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
   * Phase 05.7.6 (2026-05-22): when cron-live fetches Meta+Google for
   * "today" (idx=0 of the rolling window), it passes the fresh CAD spend
   * here so we OVERWRITE the spend columns on data_daily. For yesterday +
   * day-before (idx=1, idx=2 of rolling window) callers omit this and
   * we preserve the spend that cron-daily wrote at 00:05.
   */
  spendOverride?: { fbSpendCad: number; gaSpendCad: number },
): Promise<void> {
  const admin = getSupabaseAdmin();

  // -----------------------------------------------------------------
  // data_daily — SELECT existing spend, then UPSERT preserving them
  // -----------------------------------------------------------------
  const { data: existing, error: selErr } = await admin
    .from('data_daily')
    .select('fb_spend_cad, ga_spend_cad, total_spend_cad')
    .eq('date', date)
    .eq('store_id', storeId)
    .maybeSingle();
  if (selErr) {
    throw new Error(`data_daily select for ${storeId} ${date}: ${selErr.message}`);
  }

  // Phase 05.7.6: if a spendOverride is supplied (cron-live fetched live
  // Meta+Google today), use it. Otherwise preserve whatever cron-daily
  // wrote previously (rolling-window backfill of yesterday / day-before
  // must not stomp Meta+Google totals).
  const fbSpendCad =
    spendOverride !== undefined
      ? spendOverride.fbSpendCad
      : Number(existing?.fb_spend_cad ?? 0) || 0;
  const gaSpendCad =
    spendOverride !== undefined
      ? spendOverride.gaSpendCad
      : Number(existing?.ga_spend_cad ?? 0) || 0;
  const totalSpendCad =
    spendOverride !== undefined
      ? fbSpendCad + gaSpendCad
      : Number(existing?.total_spend_cad ?? 0) || 0;

  const revenueCad = shopify.revenueCad;
  const cogs = revenueCad * COGS_RATE;
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
    dataDailyPayload.total_spend_cad = totalSpendCad;
  } else if (!existing) {
    dataDailyPayload.fb_spend_cad = 0;
    dataDailyPayload.ga_spend_cad = 0;
    dataDailyPayload.total_spend_cad = 0;
  }

  const { error: dataErr } = await admin
    .from('data_daily')
    .upsert(dataDailyPayload, { onConflict: 'date,store_id' });
  if (dataErr) {
    throw new Error(`data_daily upsert for ${storeId} ${date}: ${dataErr.message}`);
  }

  // -----------------------------------------------------------------
  // products_daily — UPSERT net_revenue_cad only
  // -----------------------------------------------------------------
  if (shopify.productRows.length > 0) {
    const productRows = shopify.productRows.map((p) => ({
      date,
      store_id: storeId,
      store_name: shopify.storeName,
      product_id: p.product_id,
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

  // ----- STEP 2: fetch today's Meta + Google spend (LIGHT + timed-out) -----
  const todaySpend = await step.run('fetch-meta-google-spend-light', async () => {
    const [metaToday, googleToday] = await Promise.all([
      withTimeout(fetchMetaSpendForDayLight(storeId, today), 12_000, 'Meta').catch(
        (e) => {
          console.warn(
            `cron-live: Meta light spend ${storeId} ${today} failed/timed-out: ${e instanceof Error ? e.message : e}`,
          );
          return null;
        },
      ),
      withTimeout(fetchGoogleAdsSpendForDay(storeId, today), 12_000, 'Google').catch(
        (e) => {
          console.warn(
            `cron-live: Google spend ${storeId} ${today} failed/timed-out: ${e instanceof Error ? e.message : e}`,
          );
          return null;
        },
      ),
    ]);
    const cadConvert = async (
      value: { spend: number; currency: string } | null,
    ): Promise<number> => {
      if (!value || !Number.isFinite(value.spend) || value.spend === 0) return 0;
      const currency = (value.currency || 'CAD').toUpperCase();
      if (currency === 'CAD') return value.spend;
      const rate = await withTimeout(
        getFxRate(currency, 'CAD', today),
        5_000,
        'FX',
      ).catch(() => 1);
      return value.spend * rate;
    };
    // If BOTH fetchers timed out (null), we don't have new spend data —
    // signal the persist step to preserve existing values.
    if (metaToday === null && googleToday === null) {
      return { fbSpendCad: null, gaSpendCad: null };
    }
    return {
      fbSpendCad: metaToday ? await cadConvert(metaToday) : null,
      gaSpendCad: googleToday ? await cadConvert(googleToday) : null,
    };
  });
  const { fbSpendCad, gaSpendCad } = todaySpend as {
    fbSpendCad: number | null;
    gaSpendCad: number | null;
  };

  // ----- STEP 3: persist (sequential, idempotent) -----
  //
  // Three write modes per date based on what succeeded:
  //
  //   1. Shopify OK + both ad platforms OK → write everything
  //      (revenue/gross/refund + fb/ga/total spend + derived cols)
  //   2. Shopify OK + ads partial/failed → write Shopify cols, preserve spend
  //      (persistDayForStore default behavior: omit spendOverride)
  //   3. Shopify FAILED → write NOTHING for this date
  //      (don't write 0 revenue + zero spend over good existing data;
  //       wait for next 10-min cron tick to retry Shopify)
  //
  // The today-only Meta+Google write happens only when BOTH ad platforms
  // succeeded AND Shopify succeeded (case 1). Otherwise we preserve
  // whatever cron-daily wrote earlier and just emit warnings.
  await step.run('persist-rolling-3day', async () => {
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const shopify = shopifyByDate[date];
      const isToday = i === 0;
      const shopifyOk = !(shopify as { __shopifyFailed?: boolean }).__shopifyFailed;

      if (!shopifyOk) {
        console.warn(
          `cron-live ${storeId} ${date}: Shopify failed — skipping persist to preserve last good row.`,
        );
        continue;
      }

      const haveBothSpend = fbSpendCad !== null && gaSpendCad !== null;
      await persistDayForStore(
        storeId,
        date,
        shopify,
        isToday && haveBothSpend
          ? { fbSpendCad: fbSpendCad as number, gaSpendCad: gaSpendCad as number }
          : undefined,
      );
    }
  });

  const perDayRevenue: Record<string, number> = {};
  for (const date of dates) {
    perDayRevenue[date] = shopifyByDate[date].revenueCad;
  }
  return {
    storeId,
    rollingDates: dates,
    perDayRevenue,
    todaySpendCad: { fb: fbSpendCad ?? 0, ga: gaSpendCad ?? 0 },
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
