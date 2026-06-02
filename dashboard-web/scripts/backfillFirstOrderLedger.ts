#!/usr/bin/env node
// Phase 3 (2026-06-02) — one-time FULL-HISTORY first-order LEDGER backfill.
//
// WHY
// ---
// orders_attribution is a ROLLING WINDOW (only the recent ~weeks of orders are
// retained — ~1.2k rows — while a store like uzoshop has ~40k+ orders in
// Shopify history). Deriving is_first_order via a window-MIN over that table is
// WRONG for any customer whose true first order predates the window: it
// mislabels a RETURNING customer's recent order as "first".
//
// This script SEEDS the durable per-(store, customer) ledger
// `customer_first_order` (migration 20260602140000) from FULL Shopify history
// via Bulk Operations, then calls recompute_first_order_flags(store) so
// orders_attribution.is_first_order is re-derived from the now-complete ledger.
// The recompute RPC only ever LOWERS the ledger min (older candidate wins), so
// re-running it after this seed can refine but never clobber the full-history
// truth.
//
// READ-ONLY toward Shopify; ZERO writes to ad platforms / pixels / CAPI. The
// only requested customer field is the opaque customer.id (no PII).
//
// PER STORE (uzoshop, zolplus, usmile360):
//   1. startBulkFirstOrderExport(store)  — kick off the Bulk export
//   2. pollBulkFirstOrderUrl(store)      — poll until COMPLETED, get NDJSON url
//   3. download + parseBulkNdjson        — NDJSON text → BulkOrderLine[]
//   4. resolveCustomerFirstOrders        — earliest order per customer
//   5. UPSERT rows into customer_first_order (onConflict 'store_id,customer_id')
//   6. supabase.rpc('recompute_first_order_flags', { p_store_id: store })
//
// The UPSERT is a plain insert-or-overwrite (the @supabase/supabase-js client
// can't express the "only-lower-min" WHERE clause). That is fine here: this is
// the FULL-history seed, so its values ARE the lifetime minima — there is no
// older candidate to protect against. The only-lower-min guard lives in the
// recompute RPC (migration 20260602150000), which runs afterward and on every
// subsequent cron tick.
//
// RUN COMMAND (from the repo root, NOT dashboard-web)
// ---------------------------------------------------
// The root .env stores credentials under DOTTED keys; getShopifyAccessToken()
// and requireDomain() (in shopifyBulkFirstOrder.ts) read STANDARD UPPER_SNAKE
// env vars. Map them on the command line before invoking:
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
// then DRY-RUN first (computes + logs per-store ledger row counts, NO writes):
//   DRY_RUN=1 npx tsx dashboard-web/scripts/backfillFirstOrderLedger.ts
//
// then for real (UPSERT ledger + run recompute RPC):
//   npx tsx dashboard-web/scripts/backfillFirstOrderLedger.ts
//
// NOTE: this script does NOT auto-load .env itself (it relies on the standard
// env vars being exported as above), mirroring how the Shopify fetcher helpers
// read process.env directly. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are read
// the same way.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  startBulkFirstOrderExport,
  pollBulkFirstOrderUrl,
  parseBulkNdjson,
  resolveCustomerFirstOrders,
} from '@/lib/fetchers/shopifyBulkFirstOrder';
import { fetchWithBackoff } from '@/lib/fetchers/withBackoff';

const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
type StoreId = (typeof STORES)[number];

const DRY_RUN = process.env.DRY_RUN === '1';

/** One row shaped for the customer_first_order ledger. */
type LedgerRow = {
  store_id: string;
  customer_id: string;
  first_order_id: string;
  first_created_at: string;
};

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

/** "gid://shopify/Order/123" → "123" (matches orders_attribution.order_id tails). */
function gidTail(gid: string): string {
  const i = gid.lastIndexOf('/');
  return i >= 0 ? gid.slice(i + 1) : gid;
}

type BulkResult = {
  ledgerRows: LedgerRow[];
  /** order_id tail → customer_id tail, for EVERY non-guest order in history. */
  orderToCustomer: Map<string, string>;
};

/**
 * Export FULL Shopify order history for one store via Bulk Operations, then
 * (a) resolve the earliest order per customer into ledger-shaped rows, and
 * (b) build the per-order → customer map used to backfill customer_id onto the
 * existing orders_attribution rows (which are May+ only and mostly NULL).
 *
 * Empty url (store had 0 orders, or COMPLETED with no file) → empty result.
 */
async function computeBulkResultForStore(store: StoreId): Promise<BulkResult> {
  await startBulkFirstOrderExport(store);
  const url = await pollBulkFirstOrderUrl(store);
  if (!url) return { ledgerRows: [], orderToCustomer: new Map() };
  const res = await fetchWithBackoff(url, { method: 'GET' }, { provider: 'shopify' });
  if (!res.ok) {
    throw new Error(`bulk ${store} download failed (${res.status})`);
  }
  const ndjson = await res.text();
  const lines = parseBulkNdjson(ndjson);
  const resolved = resolveCustomerFirstOrders(lines);
  const ledgerRows = resolved.map((r) => ({
    store_id: store,
    customer_id: r.customerId,
    first_order_id: r.firstOrderId,
    first_created_at: r.firstCreatedAt,
  }));
  const orderToCustomer = new Map<string, string>();
  for (const l of lines) {
    const cust = l.customer?.id ? gidTail(l.customer.id) : null;
    if (cust) orderToCustomer.set(gidTail(l.id), cust);
  }
  return { ledgerRows, orderToCustomer };
}

/**
 * Backfill orders_attribution.customer_id for the EXISTING (May+) rows from the
 * full-history Bulk map, so the recompute RPC can JOIN them to the ledger.
 * Surgical: a plain .update() sets ONLY customer_id (never touches total_cad /
 * source / utm_* / etc.) — no data_daily re-aggregation, no ad re-fetch. Guest
 * orders (not in the map) are left NULL (correctly unclassifiable). Grouped by
 * customer so it's one UPDATE per customer, not per order. Returns #rows updated.
 */
async function backfillCustomerIds(
  admin: SupabaseClient,
  store: StoreId,
  orderToCustomer: Map<string, string>,
  dryRun: boolean,
): Promise<number> {
  // Which orders does orders_attribution actually hold for this store?
  const present: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('orders_attribution')
      .select('order_id')
      .eq('store_id', store)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`select orders_attribution(${store}): ${error.message}`);
    const batch = (data ?? []) as Array<{ order_id: string }>;
    for (const r of batch) present.push(String(r.order_id));
    if (batch.length < PAGE) break;
  }
  // Group present order_ids by their (full-history) customer.
  const byCustomer = new Map<string, string[]>();
  for (const oid of present) {
    const cust = orderToCustomer.get(oid);
    if (!cust) continue; // guest / not in history → leave NULL
    const arr = byCustomer.get(cust);
    if (arr) arr.push(oid); else byCustomer.set(cust, [oid]);
  }
  let updated = 0;
  for (const [cust, oids] of byCustomer) {
    if (!dryRun) {
      const { error } = await admin
        .from('orders_attribution')
        .update({ customer_id: cust })
        .eq('store_id', store)
        .in('order_id', oids);
      if (error) throw new Error(`update customer_id(${store}, cust ${cust}): ${error.message}`);
    }
    updated += oids.length;
  }
  return updated;
}

/** UPSERT ledger rows in batches (onConflict store_id,customer_id). */
async function upsertLedgerRows(admin: SupabaseClient, rows: LedgerRow[]): Promise<void> {
  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await admin
      .from('customer_first_order')
      .upsert(slice, { onConflict: 'store_id,customer_id' });
    if (error) {
      throw new Error(
        `UPSERT customer_first_order (rows ${i}..${i + slice.length}): ${error.message}`,
      );
    }
  }
}

async function recomputeFlags(admin: SupabaseClient, store: StoreId): Promise<void> {
  const { error } = await admin.rpc('recompute_first_order_flags', { p_store_id: store });
  if (error) {
    throw new Error(`RPC recompute_first_order_flags(${store}): ${error.message}`);
  }
}

async function main(): Promise<void> {
  const mode = DRY_RUN ? 'DRY-RUN' : 'APPLY';
  console.log(`=== First-order LEDGER full-history backfill — ${mode} ===\n`);

  // Supabase is needed for the customer_id count (read) in dry-run AND for the
  // writes in apply. If creds are missing during dry-run we still report ledger
  // sizes (Shopify-only); apply requires creds (getAdminClient throws).
  let admin: SupabaseClient | null = null;
  try {
    admin = getAdminClient();
  } catch (e) {
    if (!DRY_RUN) throw e;
    console.log('(no Supabase creds — dry-run will report ledger sizes only)\n');
  }

  let grandLedger = 0;
  let grandUpdated = 0;
  for (const store of STORES) {
    console.log(`--- ${store} ---`);
    const { ledgerRows, orderToCustomer } = await computeBulkResultForStore(store);
    grandLedger += ledgerRows.length;
    console.log(`  ledger rows (earliest order per customer): ${ledgerRows.length}`);
    console.log(`  full-history orders with a customer:       ${orderToCustomer.size}`);

    if (admin) {
      const n = await backfillCustomerIds(admin, store, orderToCustomer, DRY_RUN);
      grandUpdated += n;
      console.log(`  ${DRY_RUN ? 'would set' : '✓ set'} customer_id on ${n} existing orders_attribution rows`);
    }

    if (DRY_RUN) {
      console.log('');
      continue;
    }

    if (ledgerRows.length > 0) {
      await upsertLedgerRows(admin!, ledgerRows);
      console.log(`  ✓ upserted ${ledgerRows.length} ledger rows`);
    } else {
      console.log(`  (no ledger rows to upsert)`);
    }
    await recomputeFlags(admin!, store);
    console.log(`  ✓ recompute_first_order_flags(${store})`);
    console.log('');
  }

  console.log(`=== Summary ===`);
  console.log(`Stores processed:           ${STORES.length}`);
  console.log(`Total ledger rows:          ${grandLedger}`);
  console.log(`orders_attribution updated: ${grandUpdated}`);
  if (DRY_RUN) {
    console.log(`\nDRY-RUN. Re-run WITHOUT DRY_RUN=1 to upsert + backfill customer_id + recompute.`);
  } else {
    console.log(`\nAPPLIED (ledger seeded + customer_id backfilled + flags recomputed).`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
