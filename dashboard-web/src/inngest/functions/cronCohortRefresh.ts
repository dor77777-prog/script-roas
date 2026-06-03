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
// PIPELINE (identical to scripts/backfillCohortMonthly.ts — same building
// blocks reused for DRY):
//   per store:
//     1. startBulkCohortExport → pollBulkCohortUrl → download →
//        parseBulkCohortNdjson — FULL order history in NATIVE currency.
//     2. CAD-convert each line via cadConvert (FX-fail → null): convert gross
//        + refund; net_cad = gross_cad − refund_cad. If EITHER leg fails the
//        line is OMITTED ("stale > wrong": a bad CAD number would corrupt the
//        whole cohort cell).
//     3. Load firstOrderMonthByCustomer from customer_first_order.
//     4. aggregateCohortCells → distinct-customer cohort cells.
//     5. Full replace: DELETE the store's rows, then INSERT the fresh cells.
//
// SOFT-FAIL PER STORE: one store's Bulk error must NOT kill the others — each
// store is wrapped in its own try/catch and recorded in `failures`. The
// orchestrator core `runCohortRefreshOnce` is extracted (mirrors
// cronTickOrchestrator.runTickOnce) so tests drive it with injected
// dependencies instead of stubbing the Shopify network + Supabase.
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
  pollBulkCohortUrl,
  parseBulkCohortNdjson,
  type BulkCohortRow,
} from '@/lib/fetchers/shopifyBulkCohort';
import { fetchWithBackoff } from '@/lib/fetchers/withBackoff';
import { getFxRate } from '@/lib/fetchers/fx';
import { makeCadConvert, type CadConvert } from '@/lib/inngest/cadConvert';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { captureStepError } from '@/lib/sentry/capture';

const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;

/** Production CAD converter: FX-fail → null → caller OMITS the line. */
const prodCadConvert: CadConvert = makeCadConvert((from, to, dateStr) =>
  getFxRate(from, to, dateStr),
);

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

// ────────────────────────────────────────────────────────────────────────
// Production dependency wiring (Shopify Bulk + Supabase admin).
// ────────────────────────────────────────────────────────────────────────

/** Download the FULL Shopify order history for one store in native currency. */
async function fetchBulkCohortRows(store: string): Promise<BulkCohortRow[]> {
  await startBulkCohortExport(store);
  const url = await pollBulkCohortUrl(store);
  if (!url) return []; // store had 0 orders / COMPLETED with no file
  const res = await fetchWithBackoff(url, { method: 'GET' }, { provider: 'shopify' });
  if (!res.ok) throw new Error(`bulk cohort ${store} download failed (${res.status})`);
  const ndjson = await res.text();
  return parseBulkCohortNdjson(ndjson);
}

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
    // Single step.run: the per-store soft-fail loop is idempotent (full
    // replace), so a function-level retry just re-runs the whole pass.
    const result = await step.run('refresh-cohorts', async () =>
      runCohortRefreshOnce({
        stores: STORES,
        fetchBulkRows: fetchBulkCohortRows,
        loadFirstOrderMonths,
        replaceCohortCells,
        cadConvert: prodCadConvert,
      }),
    );

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
