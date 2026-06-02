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

/**
 * Export FULL Shopify order history for one store via Bulk Operations, then
 * resolve the earliest order per customer into ledger-shaped rows.
 *
 * Empty url (store had 0 orders, or COMPLETED with no file) → empty array.
 */
async function computeLedgerRowsForStore(store: StoreId): Promise<LedgerRow[]> {
  await startBulkFirstOrderExport(store);
  const url = await pollBulkFirstOrderUrl(store);
  if (!url) return [];
  const res = await fetchWithBackoff(url, { method: 'GET' }, { provider: 'shopify' });
  if (!res.ok) {
    throw new Error(`bulk ${store} download failed (${res.status})`);
  }
  const ndjson = await res.text();
  const lines = parseBulkNdjson(ndjson);
  const resolved = resolveCustomerFirstOrders(lines);
  return resolved.map((r) => ({
    store_id: store,
    customer_id: r.customerId,
    first_order_id: r.firstOrderId,
    first_created_at: r.firstCreatedAt,
  }));
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

  // Validate Supabase creds up-front (clear error) UNLESS dry-run, which never
  // touches Supabase. In dry-run we still need Shopify creds, which the fetcher
  // helpers validate per store as they run.
  const admin = DRY_RUN ? null : getAdminClient();

  let grandTotal = 0;
  for (const store of STORES) {
    console.log(`--- ${store} ---`);
    const rows = await computeLedgerRowsForStore(store);
    grandTotal += rows.length;
    console.log(`  ledger rows (earliest order per customer): ${rows.length}`);

    if (DRY_RUN) {
      console.log(`  DRY-RUN: skipping UPSERT + recompute_first_order_flags`);
      console.log('');
      continue;
    }

    if (rows.length > 0) {
      await upsertLedgerRows(admin!, rows);
      console.log(`  ✓ upserted ${rows.length} ledger rows`);
    } else {
      console.log(`  (no rows to upsert)`);
    }
    await recomputeFlags(admin!, store);
    console.log(`  ✓ recompute_first_order_flags(${store})`);
    console.log('');
  }

  console.log(`=== Summary ===`);
  console.log(`Stores processed:        ${STORES.length}`);
  console.log(`Total ledger rows:       ${grandTotal}`);
  if (DRY_RUN) {
    console.log(`\nDRY-RUN. Re-run WITHOUT DRY_RUN=1 to upsert + recompute.`);
  } else {
    console.log(`\nAPPLIED (ledger seeded + flags recomputed).`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
