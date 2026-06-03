#!/usr/bin/env node
// One-shot history backfill for orders_attribution.payment_gateway (תשלומים).
//
// WHY
// ---
// The payment-method breakdown stores each order's RAW primary Shopify gateway
// on orders_attribution.payment_gateway (migration
// 20260603*_orders_attribution_payment_gateway.sql). Go-forward writes are
// handled by the crons (cronDaily / cronLive), but every historical row already
// in orders_attribution has payment_gateway = NULL. This runner re-fetches the
// orders we already have — by store × date — from Shopify and fills the column.
//
// WHAT
// ----
// For each store, find the distinct dates in orders_attribution that still have
// at least one row with payment_gateway IS NULL (so a re-run skips months that
// are already complete). For each such date, call fetchShopifyOrdersAttribution
// (which now returns row.paymentGateway via primaryGateway()) and UPDATE
// orders_attribution SET payment_gateway WHERE store_id, order_id AND
// payment_gateway IS NULL — idempotent: already-set rows are never touched and a
// row only flips NULL → value. READ-ONLY toward Shopify (read_orders only — the
// gateway field is NOT blocked by the read_customers gap); ZERO writes to ad
// platforms / pixels / CAPI. Logs a per-store classified / credit / paypal /
// other tally (categories via categorizePaymentGateway, the same code the reader
// uses). A --dry-run / DRY_RUN=1 preview makes no writes.
//
// RANGE
// -----
// Default: the full date span present in orders_attribution (oldest..newest
// NULL-gateway date per store). Override with --from / --to (or FROM / TO env),
// inclusive, 'YYYY-MM-DD'.
//
// RUN (from repo root, NOT dashboard-web — map the dotted .env keys first):
//   cd /Users/dorperetz/script-roas
//   export SUPABASE_URL="$(grep -E '^supabase\.url=' .env | cut -d= -f2-)"
//   export SUPABASE_SERVICE_ROLE_KEY="$(grep -E '^supabase\.service\.role\.key=' .env | cut -d= -f2-)"
//   for S in UZOSHOP ZOLPLUS USMILE360; do s=$(echo $S | tr A-Z a-z);
//     export ${S}_SHOPIFY_DOMAIN="$(grep -E "^${s}\.shopify\.domain=" .env | cut -d= -f2-)";
//     export ${S}_SHOPIFY_CLIENT_ID="$(grep -E "^${s}\.shopify\.clientId=" .env | cut -d= -f2-)";
//     export ${S}_SHOPIFY_CLIENT_SECRET="$(grep -E "^${s}\.shopify\.clientSecret=" .env | cut -d= -f2-)";
//   done
//   npx tsx dashboard-web/scripts/backfillPaymentGateway.ts --dry-run     # preview
//   npx tsx dashboard-web/scripts/backfillPaymentGateway.ts               # apply
// Optional: --from 2025-01-01 --to 2025-12-31  (or FROM=… TO=… env).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchShopifyOrdersAttribution } from '@/lib/fetchers/shopify';
import { categorizePaymentGateway } from '@/lib/payments';

const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;

/** Parse `--flag value` / `--flag=value` (and DRY_RUN/FROM/TO env fallbacks). */
function getArg(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === `--${flag}` || a.startsWith(`--${flag}=`));
  if (i === -1) return undefined;
  const eq = argv[i].indexOf('=');
  if (eq !== -1) return argv[i].slice(eq + 1);
  return argv[i + 1];
}

const DRY_RUN =
  process.env.DRY_RUN === '1' ||
  process.argv.slice(2).includes('--dry-run');

const FROM = getArg('from') ?? process.env.FROM;
const TO = getArg('to') ?? process.env.TO;

function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — export them from the ' +
        'root .env dotted keys (see the run-command comment at the top).',
    );
  }
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Distinct dates ('YYYY-MM-DD', oldest first) for `store` that still have at
 * least one orders_attribution row with payment_gateway IS NULL, within the
 * [FROM, TO] window when provided. Paginates because `.select` caps at 1000.
 */
async function pendingDatesForStore(
  admin: SupabaseClient,
  store: string,
): Promise<string[]> {
  const seen = new Set<string>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let q = admin
      .from('orders_attribution')
      .select('date')
      .eq('store_id', store)
      .is('payment_gateway', null)
      .order('date', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (FROM) q = q.gte('date', FROM);
    if (TO) q = q.lte('date', TO);
    const { data, error } = await q;
    if (error) throw new Error(`pendingDates ${store}: ${error.message}`);
    const rows = (data ?? []) as Array<{ date: string }>;
    for (const r of rows) if (r.date) seen.add(r.date.slice(0, 10));
    if (rows.length < PAGE) break;
  }
  return [...seen].sort();
}

async function main(): Promise<void> {
  console.log(`[${DRY_RUN ? 'DRY-RUN' : 'APPLY'}] payment_gateway backfill`);
  console.log(`range: ${FROM ?? '(earliest NULL)'} .. ${TO ?? '(latest NULL)'}`);
  const admin = getAdminClient();

  let grandUpdated = 0;
  for (const store of STORES) {
    const dates = await pendingDatesForStore(admin, store);
    if (dates.length === 0) {
      console.log(`${store}: no rows with payment_gateway IS NULL — nothing to do`);
      continue;
    }
    console.log(
      `${store}: ${dates.length} date(s) pending ` +
        `(${dates[0]} .. ${dates[dates.length - 1]})`,
    );

    let classified = 0;
    let updated = 0;
    let credit = 0;
    let paypal = 0;
    let other = 0;
    for (const date of dates) {
      const rows = await fetchShopifyOrdersAttribution(store, date);
      for (const o of rows) {
        if (o.paymentGateway == null) continue;
        classified += 1;
        const cat = categorizePaymentGateway(o.paymentGateway);
        if (cat === 'credit') credit += 1;
        else if (cat === 'paypal') paypal += 1;
        else other += 1;
        if (!DRY_RUN) {
          // Idempotent: only flip rows still NULL — never overwrite a prior fill.
          const { error } = await admin
            .from('orders_attribution')
            .update({ payment_gateway: o.paymentGateway })
            .eq('store_id', store)
            .eq('order_id', o.orderId)
            .is('payment_gateway', null);
          if (error) {
            throw new Error(`update ${store} ${o.orderId}: ${error.message}`);
          }
        }
        updated += 1;
      }
    }
    console.log(
      `${store}: ${DRY_RUN ? 'would set' : 'set'} ${updated} row(s) — ` +
        `classified ${classified} (credit ${credit} / paypal ${paypal} / other ${other})`,
    );
    grandUpdated += updated;
  }

  console.log(
    `\n${DRY_RUN ? 'DRY-RUN complete — no writes.' : 'DONE.'} ` +
      `${DRY_RUN ? 'would set' : 'set'} ${grandUpdated} row(s) total.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('backfillPaymentGateway FAILED:', e);
    process.exit(1);
  });
