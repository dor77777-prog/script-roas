// dashboard-web/src/inngest/functions/cronCohortRefresh.ts
//
// Wave 2 (2026-06-03) — WEEKLY cron-cohort-refresh.
//
// WHY WEEKLY
// ----------
// Cohort / LTV is a slow-moving STRATEGIC metric. A full re-aggregate of the
// Shopify Bulk order history (per store, full replace) once a week keeps
// customer_cohort_monthly fresh without incremental double-counting (a daily
// incremental would have to reconcile partial-month deltas — error-prone for
// no real benefit here). Fires Monday 04:00 Israel-local, off-peak, DST-safe
// (TZ= prefix — RESEARCH §Pitfall 1: a raw `M H * * *` drifts 2-3h twice a
// year).
//
// PIPELINE (same building blocks reused for DRY — scripts/backfillCohortMonthly.ts
// + src/lib/fetchers/shopifyBulkCohort.ts):
//   per store:
//     1. startBulkCohortExport → step.sleep-driven poll (checkBulkCohortStatus)
//        → downloadBulkCohortRows — FULL order history in NATIVE currency.
//     2. CAD-convert each line via the FX rate (FX-fail → null): convert gross
//        + refund; net_cad = gross_cad − refund_cad. If EITHER leg fails the
//        line is OMITTED ("stale > wrong": a bad CAD number would corrupt the
//        whole cohort cell). FX lookups are MEMOIZED per (currency, date) so a
//        store's tens-of-thousands of orders collapse to ~#distinct-dates
//        network calls instead of two-per-order (see "60s budget" below).
//     3. Load firstOrderMonthByCustomer from customer_first_order.
//     4. aggregateCohortCells → distinct-customer cohort cells.
//     5. Full replace: DELETE the store's rows, then INSERT the fresh cells.
//
// 60s maxDuration BUDGET (FIX 2026-06-03)
// ---------------------------------------
// The Inngest route is capped at `maxDuration = 60` (src/app/api/inngest/
// route.ts) and EACH step.run is a single Vercel serverless invocation subject
// to that cap. ARCHITECTURE §"Phase B" documents a real prod incident where
// work exceeding 60s inside a step "hangs the Vercel runtime to the 60s
// timeout" — and a Vercel timeout KILLS the process, defeating any in-step
// try/catch soft-fail. The ORIGINAL wrapper packed all 3 stores' Bulk exports
// (each pollBulkCohortUrl ≈ up to 600s) + tens of thousands of SEQUENTIAL FX
// awaits into ONE step.run — a guaranteed timeout + dead-letter.
//
// The fix decomposes the work so NO single invocation can exceed 60s:
//   • Each STORE gets its OWN step.run set (own 60s budget; memoized across the
//     function-level retry so a retry resumes, not restarts).
//   • The Bulk export is polled via step.sleep at the OUTER function level —
//     each poll is a tiny checkBulkCohortStatus invocation, the WAIT happens
//     in durable Inngest sleep (zero runtime cost), so the export can take
//     minutes server-side without any one invocation nearing 60s.
//   • FX is memoized per (currency, date) — the ingest step's conversion of a
//     full history is bounded by #distinct-dates, not #orders.
//
// SOFT-FAIL PER STORE: one store's Bulk error must NOT kill the others — each
// store's step pipeline is wrapped in its own try/catch and recorded in
// `failures`. Because the long wait is a durable step.sleep (not in-process),
// a thrown step error is a clean throw the try/catch can catch — not a killed
// runtime. The pure core `runCohortRefreshOnce` (no steps) is retained for the
// backfill-shaped path + unit tests; `runCohortRefreshStepped` is the
// production step-decomposed orchestrator (both unit-tested with injected deps).
//
// READ-ONLY toward Shopify; ZERO writes to ad platforms / pixels / CAPI
// (CAPI-safe). Only the opaque customer.id is read (no PII).

import { inngest } from '@/inngest/client';
import {
  aggregateCohortCells,
  type BulkCohortLine,
  type CohortCell,
} from '@/lib/cohorts/cohortAggregate';
import {
  startBulkCohortExport,
  checkBulkCohortStatus,
  downloadBulkCohortRows,
  type BulkCohortRow,
} from '@/lib/fetchers/shopifyBulkCohort';
import { getFxRate } from '@/lib/fetchers/fx';
import { type CadConvert } from '@/lib/inngest/cadConvert';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { captureStepError } from '@/lib/sentry/capture';
import { recordFreshness } from '@/lib/inngest/freshness';

const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;

// Bulk poll budget for the step.sleep loop: 15s between checks × 40 attempts
// = up to 10 min of durable wait per store (full-history exports complete well
// within this). Each individual check is a sub-second invocation.
const POLL_SLEEP = '15s';
const POLL_MAX_ATTEMPTS = 40;

/** A Shopify→CAD FX rate fetcher (from, to='CAD', dateStr) → rate. */
export type GetFxRateFn = (from: string, to: 'CAD', dateStr: string) => Promise<number>;

// ────────────────────────────────────────────────────────────────────────
// Injectable dependency types — keep the core pure/testable.
// ────────────────────────────────────────────────────────────────────────

export type FetchBulkRowsFn = (store: string) => Promise<BulkCohortRow[]>;
export type LoadFirstOrderMonthsFn = (store: string) => Promise<Map<string, string>>;
export type ReplaceCohortCellsFn = (store: string, cells: CohortCell[]) => Promise<void>;

export interface CohortRefreshResult {
  refreshed: number;
  failures: Array<{ store: string; error: string }>;
}

/**
 * Pure-ish orchestrator core. Iterates the stores, soft-failing each so one
 * store's Bulk error cannot abort the rest. Returns a per-run summary.
 */
export async function runCohortRefreshOnce(input: {
  stores: readonly string[];
  fetchBulkRows: FetchBulkRowsFn;
  loadFirstOrderMonths: LoadFirstOrderMonthsFn;
  replaceCohortCells: ReplaceCohortCellsFn;
  cadConvert: CadConvert;
}): Promise<CohortRefreshResult> {
  const { stores, fetchBulkRows, loadFirstOrderMonths, replaceCohortCells, cadConvert } = input;
  let refreshed = 0;
  const failures: Array<{ store: string; error: string }> = [];

  for (const store of stores) {
    try {
      const rows = await fetchBulkRows(store);
      const lines = await toCadLines(rows, cadConvert);
      const firstOrderMonthByCustomer = await loadFirstOrderMonths(store);
      const cells = aggregateCohortCells(store, lines, firstOrderMonthByCustomer);
      await replaceCohortCells(store, cells);
      refreshed += 1;
    } catch (e) {
      failures.push({ store, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { refreshed, failures };
}

/**
 * CAD-convert native gross/refund per line → BulkCohortLine[]. net_cad =
 * gross_cad − refund_cad. FX-fail on EITHER leg → OMIT the line ("stale >
 * wrong"). Conversion is keyed on the order's createdAt date so historical
 * orders use their period's rate.
 */
async function toCadLines(
  rows: BulkCohortRow[],
  cadConvert: CadConvert,
): Promise<BulkCohortLine[]> {
  const lines: BulkCohortLine[] = [];
  for (const r of rows) {
    const dateStr = String(r.createdAt).slice(0, 10);
    const cur = r.currency ?? 'CAD';
    const grossCad = await cadConvert(r.grossNative, cur, dateStr);
    const refundCad = await cadConvert(r.refundNative, cur, dateStr);
    if (grossCad === null || refundCad === null) continue; // FX outage → drop
    lines.push({
      orderId: r.orderId,
      createdAt: r.createdAt,
      customerId: r.customerId,
      grossCad,
      netCad: grossCad - refundCad,
    });
  }
  return lines;
}

/**
 * FX-MEMOIZED CAD conversion (60s-budget fix). `getFxRate` (lib/fetchers/fx.ts)
 * has NO cache — every non-CAD lookup is a live Frankfurter fetch. The cron's
 * `toCadLines` awaited it TWICE PER ORDER, so a full history (~40k orders) was
 * ~80k sequential network round-trips — guaranteed to blow the 60s step budget
 * (and hammer Frankfurter). Here we memoize the rate per (currency, date): for
 * a store the currency is fixed and dates repeat heavily, so the count collapses
 * to ~#distinct-dates fetches. Semantics are otherwise identical to
 * makeCadConvert (CAD passthrough, amount 0 → 0, non-finite → null, FX
 * throw/null → OMIT the line). Returns the omitted-line count for logging.
 */
export async function toCadLinesMemoized(
  rows: BulkCohortRow[],
  getFx: GetFxRateFn,
): Promise<{ lines: BulkCohortLine[]; omittedFx: number }> {
  const rateCache = new Map<string, number | null>();
  // Resolve a (currency, date) → CAD rate once; null when FX is unavailable.
  async function rateFor(currency: string, dateStr: string): Promise<number | null> {
    const cur = (currency || 'CAD').toUpperCase();
    if (cur === 'CAD') return 1;
    const key = `${cur}|${dateStr}`;
    const hit = rateCache.get(key);
    if (hit !== undefined) return hit;
    let rate: number | null;
    try {
      const r = await getFx(cur, 'CAD', dateStr);
      rate = Number.isFinite(r) && r > 0 ? r : null;
    } catch {
      rate = null;
    }
    rateCache.set(key, rate);
    return rate;
  }
  // Convert one native amount using a resolved rate (mirrors makeCadConvert).
  function convert(amount: number, rate: number | null): number | null {
    if (!Number.isFinite(amount)) return null;
    if (amount === 0) return 0;
    if (rate === null) return null;
    return amount * rate;
  }

  const lines: BulkCohortLine[] = [];
  let omittedFx = 0;
  for (const r of rows) {
    const dateStr = String(r.createdAt).slice(0, 10);
    const cur = r.currency ?? 'CAD';
    const rate = await rateFor(cur, dateStr);
    const grossCad = convert(r.grossNative, rate);
    const refundCad = convert(r.refundNative, rate);
    if (grossCad === null || refundCad === null) {
      omittedFx += 1; // FX outage / unknown currency → drop the line
      continue;
    }
    lines.push({
      orderId: r.orderId,
      createdAt: r.createdAt,
      customerId: r.customerId,
      grossCad,
      netCad: grossCad - refundCad,
    });
  }
  return { lines, omittedFx };
}

// ────────────────────────────────────────────────────────────────────────
// Production dependency wiring (Shopify Bulk + Supabase admin).
// ────────────────────────────────────────────────────────────────────────

/** Load firstOrderMonthByCustomer from the customer_first_order ledger (paged). */
async function loadFirstOrderMonths(store: string): Promise<Map<string, string>> {
  const admin = getSupabaseAdmin();
  const out = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('customer_first_order')
      .select('customer_id, first_created_at')
      .eq('store_id', store)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`select customer_first_order(${store}): ${error.message}`);
    const batch = (data ?? []) as Array<{ customer_id: string; first_created_at: string }>;
    for (const r of batch) out.set(String(r.customer_id), String(r.first_created_at).slice(0, 7));
    if (batch.length < PAGE) break;
  }
  return out;
}

/** Full replace per store: DELETE the store's rows, then INSERT the fresh cells (batched). */
async function replaceCohortCells(store: string, cells: CohortCell[]): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error: delErr } = await admin
    .from('customer_cohort_monthly')
    .delete()
    .eq('store_id', store);
  if (delErr) throw new Error(`DELETE customer_cohort_monthly(${store}): ${delErr.message}`);

  const BATCH = 1000;
  for (let i = 0; i < cells.length; i += BATCH) {
    const slice = cells.slice(i, i + BATCH);
    const { error } = await admin.from('customer_cohort_monthly').insert(slice);
    if (error) {
      throw new Error(
        `INSERT customer_cohort_monthly (${store}, rows ${i}..${i + slice.length}): ${error.message}`,
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Step-decomposed orchestrator (60s-budget fix).
// ────────────────────────────────────────────────────────────────────────

/**
 * The subset of Inngest StepTools this cron uses. Injected so the step layout
 * (per-store steps + step.sleep poll) is unit-testable with a mock recorder
 * instead of the live Inngest runtime (mirrors cronDaily's makeMockStep).
 *
 * `run` is typed loosely (`Promise<unknown>`) so the real Inngest `step` (whose
 * `run` returns a Jsonified result type) is structurally assignable; the
 * orchestrator narrows each step's return at the call site. Values that cross
 * the step boundary here are JSON-safe (string, plain BulkCohortRow[] | null,
 * void), so the cast is sound.
 */
export interface CohortStep {
  run(id: string, cb: () => Promise<unknown>): Promise<unknown>;
  sleep(id: string, time: string): Promise<void>;
}

/**
 * Production step-decomposed cohort refresh. Each STORE runs as its own set of
 * steps so no single Vercel invocation can exceed the 60s maxDuration:
 *
 *   step.run('start-bulk-{store}')         — kick off the Bulk export (fast)
 *   [ step.run('poll-bulk-{store}-{i}')    — one status check (sub-second)
 *     step.sleep('wait-bulk-{store}-{i}')  — durable wait (zero runtime) ] × N
 *   step.run('ingest-cohorts-{store}')     — download + MEMOIZED FX + aggregate
 *                                            + full-replace write
 *
 * Per-store try/catch keeps one store's Bulk error from aborting the others;
 * because the long wait is a durable step.sleep (not in-process), thrown step
 * errors are clean throws the catch can record — not killed runtimes.
 *
 * `pollBulkRows(store)` returns BulkCohortRow[] when the export is COMPLETED, or
 * `null` when still running (caller sleeps + retries). This lets the test inject
 * a "pending → ready" sequence without faking the Inngest sleep.
 */
export async function runCohortRefreshStepped(input: {
  stores: readonly string[];
  step: CohortStep;
  startExport: (store: string) => Promise<string>;
  pollBulkRows: (store: string) => Promise<BulkCohortRow[] | null>;
  loadFirstOrderMonths: (store: string) => Promise<Map<string, string>>;
  replaceCohortCells: (store: string, cells: CohortCell[]) => Promise<void>;
  getRate: GetFxRateFn;
}): Promise<CohortRefreshResult> {
  const { stores, step, startExport, pollBulkRows, loadFirstOrderMonths, replaceCohortCells, getRate } =
    input;
  let refreshed = 0;
  const failures: Array<{ store: string; error: string }> = [];

  for (const store of stores) {
    try {
      // 1. Start the Bulk export (its own invocation; memoized on retry).
      await step.run(`start-bulk-${store}`, async () => startExport(store));

      // 2. Poll via step.sleep — each check is a tiny invocation, the WAIT is
      //    durable Inngest sleep, so a multi-minute export never nears 60s.
      let rows: BulkCohortRow[] | null = null;
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        rows = (await step.run(`poll-bulk-${store}-${attempt}`, async () =>
          pollBulkRows(store),
        )) as BulkCohortRow[] | null;
        if (rows !== null) break;
        await step.sleep(`wait-bulk-${store}-${attempt}`, POLL_SLEEP);
      }
      if (rows === null) {
        throw new Error(`bulk cohort ${store}: not COMPLETED after ${POLL_MAX_ATTEMPTS} polls`);
      }
      const bulkRows = rows;

      // 3. Ingest: download is already done (rows in hand); convert (memoized
      //    FX), join the ledger, aggregate, full-replace — one bounded step.
      await step.run(`ingest-cohorts-${store}`, async () => {
        const { lines } = await toCadLinesMemoized(bulkRows, getRate);
        const firstOrderMonthByCustomer = await loadFirstOrderMonths(store);
        const cells = aggregateCohortCells(store, lines, firstOrderMonthByCustomer);
        await replaceCohortCells(store, cells);
      });

      refreshed += 1;

      // DQ-6 (2026-06-04): record a successful cohort_monthly refresh so the
      // cohort/LTV surface can show a "data as of" timestamp (fetchCohortAsOf
      // reads max(last_success_at) for scope='cohort_monthly'). recordFreshness
      // swallows its own errors, so this never breaks the per-store success.
      // `store` is one of STORES ('uzoshop' | 'zolplus' | 'usmile360').
      await recordFreshness({
        storeId: store as 'uzoshop' | 'zolplus' | 'usmile360',
        platform: 'shopify',
        scope: 'cohort_monthly',
        tableName: 'customer_cohort_monthly',
        status: 'success',
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ store, error: message });
      // DQ-6: mirror the success record on failure so a stale cohort surfaces
      // in data_freshness (preserves the prior last_success_at; only the
      // status/lag flip). recordFreshness swallows its own errors.
      await recordFreshness({
        storeId: store as 'uzoshop' | 'zolplus' | 'usmile360',
        platform: 'shopify',
        scope: 'cohort_monthly',
        tableName: 'customer_cohort_monthly',
        status: 'transient_error',
        errorMessage: message,
      });
    }
  }

  return { refreshed, failures };
}

// ────────────────────────────────────────────────────────────────────────
// Production poll dep: one status check → rows when COMPLETED, else null.
// ────────────────────────────────────────────────────────────────────────

/**
 * One non-blocking poll: check the store's Bulk operation status; when
 * COMPLETED, download + parse the NDJSON and return the rows; while still
 * running, return null (the stepped orchestrator sleeps + re-checks). Reuses
 * the shared shopifyBulkCohort helpers (DRY — no re-implementation of the
 * start/poll/download flow that runBulkCohortExport already composes).
 */
async function pollBulkCohortRows(store: string): Promise<BulkCohortRow[] | null> {
  const op = await checkBulkCohortStatus(store);
  if (op.status === 'running') return null;
  return downloadBulkCohortRows(store, op.url);
}

// ────────────────────────────────────────────────────────────────────────
// Inngest weekly cron — Monday 04:00 Israel-local (DST-safe).
// ────────────────────────────────────────────────────────────────────────

export const cronCohortRefresh = inngest.createFunction(
  {
    id: 'cron-cohort-refresh',
    name: 'Weekly cohort/LTV re-aggregate (Shopify Bulk)',
    retries: 1,
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 4 * * 1' }],
  },
  async ({ step }) => {
    // Per-store step decomposition (NOT one mega-step) so each store's Bulk
    // export + FX conversion stays under the 60s maxDuration. step.sleep
    // handles the multi-minute Bulk wait durably; the per-store soft-fail loop
    // is idempotent (full replace), so a function-level retry resumes via step
    // memoization rather than restarting completed stores.
    const result = await runCohortRefreshStepped({
      stores: STORES,
      step,
      startExport: startBulkCohortExport,
      pollBulkRows: pollBulkCohortRows,
      loadFirstOrderMonths,
      replaceCohortCells,
      getRate: getFxRate,
    });

    // Surface partial failures to Sentry without failing the whole run — the
    // stores that DID refresh stay fresh; a single store's Bulk outage is
    // visible but not fatal.
    if (result.failures.length > 0) {
      captureStepError(
        { fnId: 'cron-cohort-refresh', stepName: 'refresh-cohorts' },
        new Error(
          `cohort refresh partial failure: ${result.failures
            .map((f) => `${f.store}: ${f.error}`)
            .join('; ')}`,
        ),
      );
    }

    return result;
  },
);

export const cronCohortRefreshFunctions = [cronCohortRefresh];
