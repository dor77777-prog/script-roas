#!/usr/bin/env node
// Wave 2 (2026-06-03) — one-time / re-runnable cohort-monthly SEED runner.
//
// WHY
// ---
// The customer-value (cohorts / LTV) tab needs a full-history per-cohort
// aggregate: store × first-order-month × months-since (0..11). The orders
// history is FULL (Shopify Bulk, 40k+/store) so retention + LTV can go back the
// entire history — even though ad-spend history (data_daily) only starts May
// 2026. This script seeds the durable aggregate `customer_cohort_monthly`
// (migration 20260603*_customer_cohort_monthly) from FULL Shopify history via
// Bulk Operations, joined to the existing `customer_first_order` ledger.
//
// READ-ONLY toward Shopify; ZERO writes to ad platforms / pixels / CAPI. The
// only requested customer field is the opaque customer.id (no PII).
//
// PER STORE (uzoshop, zolplus, usmile360):
//   1. startBulkCohortExport(store) → pollBulkCohortUrl(store) → download →
//      parseBulkCohortNdjson    — FULL order history in NATIVE currency
//      (id, createdAt, customerId, grossNative, refundNative, currency)
//   2. CAD-convert each line via cadConvert (FX-fail → null): convert gross and
//      refund to CAD, derive net_cad = gross_cad − refund_cad. If EITHER
//      conversion returns null (FX outage / unknown currency), the line is
//      OMITTED entirely — "stale > wrong": one bad CAD number would corrupt the
//      whole cohort cell, so dropping the order is safer than guessing. Omitted
//      lines are counted + logged.
//   3. Load firstOrderMonthByCustomer from customer_first_order
//      (SELECT store_id, customer_id, first_created_at → 'YYYY-MM').
//   4. aggregateCohortCells(store, lines, firstOrderMonthByCustomer) — buckets
//      by first_order_month × months-since with distinct-customer counts.
//   5. Full replace per store: DELETE existing rows for the store, then INSERT
//      the freshly computed cells (batched). DRY_RUN prints counts only.
//
// Full-replace (not upsert) is correct here: the Bulk export IS the complete
// truth for the store, so any stale cell must disappear, not linger. The weekly
// cron (cron-cohort-refresh) re-runs the same pipeline.
//
// RUN COMMAND (from the repo root, NOT dashboard-web)
// ---------------------------------------------------
// The root .env stores credentials under DOTTED keys; getShopifyAccessToken()
// and requireDomain() (in shopifyBulkCohort.ts) read STANDARD UPPER_SNAKE env
// vars. Map them on the command line before invoking:
//
//   cd /Users/dorperetz/script-roas
//   set -a
//   . ./.env                                         # loads dotted keys is NOT
//   set +a                                           # enough — they have dots;
//   # ...so export the standard names explicitly from the dotted .env values:
//   export SUPABASE_URL="$(grep -E '^supabase\.url=' .env | cut -d= -f2-)"
//   export SUPABASE_SERVICE_ROLE_KEY="$(grep -E '^supabase\.service\.role\.key=' .env | cut -d= -f2-)"
//   export UZOSHOP_SHOPIFY_DOMAIN="$(grep -E '^uzoshop\.shopify\.domain=' .env | cut -d= -f2-)"
//   export UZOSHOP_SHOPIFY_CLIENT_ID="$(grep -E '^uzoshop\.shopify\.clientId=' .env | cut -d= -f2-)"
//   export UZOSHOP_SHOPIFY_CLIENT_SECRET="$(grep -E '^uzoshop\.shopify\.clientSecret=' .env | cut -d= -f2-)"
//   export ZOLPLUS_SHOPIFY_DOMAIN="$(grep -E '^zolplus\.shopify\.domain=' .env | cut -d= -f2-)"
//   export ZOLPLUS_SHOPIFY_CLIENT_ID="$(grep -E '^zolplus\.shopify\.clientId=' .env | cut -d= -f2-)"
//   export ZOLPLUS_SHOPIFY_CLIENT_SECRET="$(grep -E '^zolplus\.shopify\.clientSecret=' .env | cut -d= -f2-)"
//   export USMILE360_SHOPIFY_DOMAIN="$(grep -E '^usmile360\.shopify\.domain=' .env | cut -d= -f2-)"
//   export USMILE360_SHOPIFY_CLIENT_ID="$(grep -E '^usmile360\.shopify\.clientId=' .env | cut -d= -f2-)"
//   export USMILE360_SHOPIFY_CLIENT_SECRET="$(grep -E '^usmile360\.shopify\.clientSecret=' .env | cut -d= -f2-)"
//
// then DRY-RUN first (computes + logs per-store cell counts, NO writes):
//   DRY_RUN=1 npx tsx dashboard-web/scripts/backfillCohortMonthly.ts
//
// then for real (DELETE + INSERT cohort cells per store):
//   npx tsx dashboard-web/scripts/backfillCohortMonthly.ts
//
// NOTE: this script does NOT auto-load .env itself (it relies on the standard
// env vars being exported as above), mirroring how the Shopify fetcher helpers
// read process.env directly. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are read
// the same way.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
import { makeCadConvert } from '@/lib/inngest/cadConvert';

const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
type StoreId = (typeof STORES)[number];

const DRY_RUN = process.env.DRY_RUN === '1';

/** Production CAD converter: FX-fail → null → caller OMITS the line. */
const cadConvert = makeCadConvert((from, to, dateStr) => getFxRate(from, to, dateStr));

function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Export it (and SUPABASE_URL) from ' +
        'the root .env dotted keys supabase.service.role.key / supabase.url — ' +
        'see the run-command comment at the top of this file.',
    );
  }
  if (!url) {
    throw new Error(
      'SUPABASE_URL is not set. Export it from the root .env dotted key ' +
        'supabase.url — see the run-command comment at the top of this file.',
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Download the FULL Shopify order history for one store in native currency. */
async function fetchBulkCohortRows(store: StoreId): Promise<BulkCohortRow[]> {
  await startBulkCohortExport(store);
  const url = await pollBulkCohortUrl(store);
  if (!url) return []; // store had 0 orders / COMPLETED with no file
  const res = await fetchWithBackoff(url, { method: 'GET' }, { provider: 'shopify' });
  if (!res.ok) {
    throw new Error(`bulk cohort ${store} download failed (${res.status})`);
  }
  const ndjson = await res.text();
  return parseBulkCohortNdjson(ndjson);
}

/**
 * CAD-convert native gross/refund per line → BulkCohortLine[] for the
 * aggregator. net_cad = gross_cad − refund_cad. FX-fail on EITHER leg → the
 * line is OMITTED (counted) — "stale > wrong": a bad CAD number would corrupt
 * the whole cohort cell. Conversion is keyed on the order's createdAt date so
 * historical orders use their period's rate (Frankfurter).
 */
async function toCadLines(
  rows: BulkCohortRow[],
): Promise<{ lines: BulkCohortLine[]; omittedFx: number }> {
  const lines: BulkCohortLine[] = [];
  let omittedFx = 0;
  for (const r of rows) {
    const dateStr = String(r.createdAt).slice(0, 10);
    const cur = r.currency ?? 'CAD';
    const grossCad = await cadConvert(r.grossNative, cur, dateStr);
    const refundCad = await cadConvert(r.refundNative, cur, dateStr);
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

/**
 * Load firstOrderMonthByCustomer from the customer_first_order ledger:
 * SELECT store_id, customer_id, first_created_at → 'YYYY-MM' per customer.
 * Paged so a 40k+ ledger doesn't hit the 1000-row default cap.
 */
async function loadFirstOrderMonths(
  admin: SupabaseClient,
  store: StoreId,
): Promise<Map<string, string>> {
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
    for (const r of batch) {
      out.set(String(r.customer_id), String(r.first_created_at).slice(0, 7));
    }
    if (batch.length < PAGE) break;
  }
  return out;
}

/**
 * Full replace per store: DELETE all existing rows for the store, then INSERT
 * the freshly computed cells (batched). The Bulk export is the complete truth,
 * so a stale cell must disappear rather than linger.
 */
async function replaceCohortCells(
  admin: SupabaseClient,
  store: StoreId,
  cells: CohortCell[],
): Promise<void> {
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

async function main(): Promise<void> {
  const mode = DRY_RUN ? 'DRY-RUN' : 'APPLY';
  console.log(`=== Cohort-monthly full-history SEED — ${mode} ===\n`);

  // Supabase is needed for the ledger read (firstOrderMonthByCustomer) in BOTH
  // dry-run and apply, AND for the DELETE/INSERT in apply. Without creds we
  // cannot join orders to cohorts, so creds are required even for dry-run.
  const admin = getAdminClient();

  let grandCells = 0;
  let grandOmitted = 0;
  for (const store of STORES) {
    console.log(`--- ${store} ---`);
    const rows = await fetchBulkCohortRows(store);
    console.log(`  bulk order lines:                ${rows.length}`);

    const { lines, omittedFx } = await toCadLines(rows);
    grandOmitted += omittedFx;
    console.log(`  CAD-converted lines:             ${lines.length}`);
    if (omittedFx > 0) console.log(`  omitted (FX-fail / unknown cur): ${omittedFx}`);

    const firstOrderMonthByCustomer = await loadFirstOrderMonths(admin, store);
    console.log(`  ledger customers (first-month):  ${firstOrderMonthByCustomer.size}`);

    const cells = aggregateCohortCells(store, lines, firstOrderMonthByCustomer);
    grandCells += cells.length;
    console.log(`  cohort cells:                    ${cells.length}`);

    if (DRY_RUN) {
      console.log('');
      continue;
    }

    await replaceCohortCells(admin, store, cells);
    console.log(`  ✓ replaced ${cells.length} cohort cells (DELETE + INSERT)`);
    console.log('');
  }

  console.log(`=== Summary ===`);
  console.log(`Stores processed:        ${STORES.length}`);
  console.log(`Total cohort cells:      ${grandCells}`);
  console.log(`Total omitted (FX-fail): ${grandOmitted}`);
  if (DRY_RUN) {
    console.log(`\nDRY-RUN. Re-run WITHOUT DRY_RUN=1 to DELETE + INSERT cohort cells.`);
  } else {
    console.log(`\nAPPLIED (cohort cells replaced per store).`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
