#!/usr/bin/env node
// One-shot repair for the 2026-06-03 stale-scope-token incident.
//
// WHY
// ---
// While warm Vercel/Inngest instances held a Shopify token minted BEFORE the
// `read_customers` grant, fetchShopifyOrdersAttribution threw on the `customer`
// field (400) and cron-live skipped the whole orders_attribution write. So the
// recent rows (June 2-3) sit with customer_id / order_created_at / is_first_order
// / first_* all NULL — unclassified for new-vs-returning AND first-click.
//
// WHAT
// ----
// Re-fetch the recent window (default: last 3 Israel days) for every store with
// the FIXED fetch (now self-heals the stale token → carries customer.id,
// created_at, and the first_* first-click keys parsed from note_attributes),
// UPSERT into orders_attribution (PK store_id,order_id — idempotent), then call
// recompute_first_order_flags(store) so is_first_order is re-derived from the
// durable customer_first_order ledger (additively folding any brand-new June
// customers into the ledger). READ-ONLY toward Shopify (only the opaque
// customer.id is read — never PII); ZERO writes to ad platforms / pixels / CAPI.
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
//   DRY_RUN=1 npx tsx dashboard-web/scripts/backfillRecentAttribution.ts   # preview
//   npx tsx dashboard-web/scripts/backfillRecentAttribution.ts            # apply
// Optional: DATES="2026-06-01,2026-06-02,2026-06-03" to override the window.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchShopifyOrdersAttribution } from '@/lib/fetchers/shopify';
import { toOrdersAttributionRow } from '@/inngest/functions/cronDaily';

const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;

const DRY_RUN = process.env.DRY_RUN === '1';

/** Last N calendar days in Asia/Jerusalem, newest first, as 'YYYY-MM-DD'. */
function lastNIsraelDays(n: number): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  return Array.from({ length: n }, (_, i) =>
    fmt.format(new Date(now.getTime() - i * dayMs)),
  );
}

/** Every day from `from`..`to` inclusive ('YYYY-MM-DD'), oldest first. For the
 *  deep historical backfill (FROM/TO env) — e.g. uzoshop from its 2023 launch. */
function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

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

async function main(): Promise<void> {
  // Date selection (precedence): explicit DATES list › FROM/TO range (deep
  // historical backfill) › default last-3-Israel-days window.
  const dates = process.env.DATES
    ? process.env.DATES.split(',').map((s) => s.trim()).filter(Boolean)
    : process.env.FROM && process.env.TO
      ? daysInRange(process.env.FROM, process.env.TO)
      : lastNIsraelDays(3);

  // Optional STORES env (comma list) to scope a run to one store — e.g. the
  // deep uzoshop (2023+) backfill, separate from the newer stores.
  const storesToRun = process.env.STORES
    ? process.env.STORES.split(',').map((s) => s.trim()).filter(Boolean)
    : [...STORES];

  console.log(`[${DRY_RUN ? 'DRY-RUN' : 'APPLY'}] recent-attribution backfill`);
  console.log(`stores: ${storesToRun.join(', ')} | dates: ${dates.length} (${dates[0]} .. ${dates[dates.length - 1]})`);
  const admin = getAdminClient();

  let grand = 0;
  for (const store of storesToRun) {
    let upserted = 0;
    let withCustomer = 0;
    let withFirstClick = 0;
    for (const date of dates) {
      const rows = await fetchShopifyOrdersAttribution(store, date);
      if (rows.length === 0) {
        console.log(`  ${store} ${date}: 0 orders`);
        continue;
      }
      withCustomer += rows.filter((r) => r.customerId != null).length;
      withFirstClick += rows.filter((r) => r.firstTouchSource != null).length;
      const upsertRows = rows.map((o) => toOrdersAttributionRow(o));
      if (!DRY_RUN) {
        const { error } = await admin
          .from('orders_attribution')
          .upsert(upsertRows, { onConflict: 'store_id,order_id' });
        if (error) throw new Error(`upsert ${store} ${date}: ${error.message}`);
      }
      upserted += rows.length;
      console.log(
        `  ${store} ${date}: ${rows.length} orders ` +
          `(${rows.filter((r) => r.customerId != null).length} w/ customer, ` +
          `${rows.filter((r) => r.firstTouchSource != null).length} w/ first-click)`,
      );
    }
    if (!DRY_RUN && upserted > 0) {
      const { error } = await admin.rpc('recompute_first_order_flags', {
        p_store_id: store,
      });
      if (error) throw new Error(`recompute ${store}: ${error.message}`);
      console.log(`  ✓ recompute_first_order_flags(${store})`);
    }
    console.log(
      `${store}: ${DRY_RUN ? 'would upsert' : 'upserted'} ${upserted} rows ` +
        `(${withCustomer} w/ customer, ${withFirstClick} w/ first-click)`,
    );
    grand += upserted;
  }

  console.log(
    `\n${DRY_RUN ? 'DRY-RUN complete — no writes.' : 'DONE.'} ` +
      `${DRY_RUN ? 'would upsert' : 'upserted'} ${grand} rows total.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('backfillRecentAttribution FAILED:', e);
    process.exit(1);
  });
