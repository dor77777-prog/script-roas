#!/usr/bin/env node
// One-off (re-runnable, DRY-RUN by default): re-apply the classify-v2 ruleset
// (commit 837899f) to EXISTING orders_attribution rows IN PLACE — no Shopify
// re-fetch.
//
// WHY
// ---
// classify-v2 broadened the canonical Shopify order→source classifier
// (`classifyOrderAttribution`) with 6 diag-driven precision rules:
//   1. email          — utm_medium=email OR utm_source ~ /(^|_)(email|newsletter|klaviyo|mailchimp)/
//                        (catches shopify_email + *_email that were hiding in 'other-paid')
//   2. google-paid    — utm_medium=product_sync (Google Merchant feed)
//   3. self-referral  — referring_site host == landing_site host → 'direct'
//   4. tiktok-organic — tiktok.com referrer (was 'other-referral')
//   5. search-organic — bing/duckduckgo/ecosia/search.yahoo referrer (was 'other-referral')
//   6. app-referral   — android-app:/ios-app: referrer (was 'other-referral')
//
// The shared classifier fixes the FORWARD path (new orders via cron/webhook)
// automatically. But the already-materialized orders_attribution.source /
// first_touch_source for PAST orders keep their OLD value. Every read-time
// consumer (NC-ROAS, unknown bucket, reconciliation, product-channel, AI report,
// attribution-diag panel) reads this column live, so re-classifying it in place
// propagates classify-v2 to ALL of them at once — making the dashboard +
// attribution-diag panel consistent over history.
//
// WHY IN-PLACE (not a Shopify re-fetch)
// -------------------------------------
// orders_attribution does NOT store landing_site or source_name — only the
// already-parsed utm_* fields + the trimmed `referrer`. So we RECONSTRUCT the
// classifier inputs from stored columns:
//   - synthetic landing_site = '?utm_source=…&utm_medium=…&utm_campaign=…&utm_id=…&utm_term=…'
//     (re-parses to the same utm_* the live classifier would see)
//   - referring_site = stored `referrer` (drives the referrer-based rules)
// then re-run `classifyOrderAttribution` and compare to the stored source.
//
// COVERAGE (honest)
// -----------------
// RE-DERIVABLE from stored data (this runner reclassifies them):
//   ✓ email           — utm_source + utm_medium are stored
//   ✓ google-paid (product_sync) — utm_medium is stored
//   ✓ tiktok-organic  — stored `referrer` carries the host
//   ✓ search-organic  — stored `referrer` carries the host
//   ✓ app-referral    — stored `referrer` preserves android-app:/ios-app: schemes
//                       (the write-time trim only strips http(s)://, see refTrimmed)
//   ✓ all PRE-EXISTING rules (meta/google/tiktok-paid via utm_source, organic, etc.)
//
// NOT re-derivable (rows KEEP their old source — documented limitation):
//   ✗ self-referral → direct — needs the landing_site HOST to compare against
//     the referrer host. landing_site is NOT stored, and a synthetic landing
//     reconstructed from utm_* has no host, so isSelfReferral() can never fire
//     here. New orders going forward DO get self-referral right (forward path
//     has the real landing_site). Historical self-referral rows currently sit
//     as 'other-referral' and will stay that way until a Shopify re-fetch
//     backfill (out of scope — see backfillRecentAttribution.ts for the
//     re-fetch shape if a future deep re-classify is wanted).
//
// SCOPE: reclassifies BOTH last-touch `source` and first-click `first_touch_source`.
// For first_touch_source the referrer-based rules are N/A (the ft_* chain is
// UTM-only by design), so only email + product_sync apply there — matching the
// live classifier's symmetric ft branch.
//
// READ/WRITE: reads + writes ONLY orders_attribution.{source,first_touch_source}
// (Supabase). Zero Shopify / ad-platform / pixel / CAPI calls. Never destructive
// beyond those two columns. Idempotent — only rows whose recomputed value DIFFERS
// from the stored value are updated, so a second run is a no-op.
//
// RUN (from repo root — map the dotted .env keys first):
//   cd /Users/dorperetz/script-roas
//   export SUPABASE_URL="$(grep -E '^supabase\.url=' .env | cut -d= -f2-)"
//   export SUPABASE_SERVICE_ROLE_KEY="$(grep -E '^supabase\.service\.role\.key=' .env | cut -d= -f2-)"
//   DRY_RUN=1 npx tsx dashboard-web/scripts/reclassifyHistoricalAttribution.ts   # preview (default)
//   APPLY=1  npx tsx dashboard-web/scripts/reclassifyHistoricalAttribution.ts    # actually write
// Optional scoping:
//   STORES="uzoshop,zolplus"          # comma list (default: all stores)
//   FROM=2026-01-01 TO=2026-06-07     # inclusive date range on orders_attribution.date
//
// SAFETY: DRY-RUN is the DEFAULT. You must pass APPLY=1 (or --apply) to write.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { classifyOrderAttribution } from '@/lib/attribution/classifyOrderSource';

// ---------------------------------------------------------------------------
// Run-mode flags. DRY-RUN by default; require an explicit opt-in to write.
// Accept both APPLY=1 env and a --apply CLI flag (mirrors house dry-run style;
// the previous backfill keyed off DRY_RUN=1, but classify-v2 mutates a far
// larger row set, so we INVERT the default to fail-safe: nothing writes unless
// the operator is explicit).
// ---------------------------------------------------------------------------
const APPLY =
  process.env.APPLY === '1' || process.argv.includes('--apply');
const DRY_RUN = !APPLY;
const PAGE = 1000;
const UPDATE_LOG_EVERY = 500;

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

// ---------------------------------------------------------------------------
// PURE, UNIT-TESTABLE reclassification core.
//
// Given the columns we actually STORE for one orders_attribution row, recompute
// what classify-v2 would label it. Reconstructs synthetic classifier inputs:
//   - landing_site from the stored utm_* (re-parses to the same utm_* the live
//     classifier sees on the forward path)
//   - referring_site from the stored `referrer`
// Returns the recomputed { source, firstTouchSource } plus a `changed*` flag for
// each so the caller can update ONLY what differs (idempotent).
// ---------------------------------------------------------------------------
export type StoredAttributionRow = {
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_id: string | null;
  utm_term: string | null;
  referrer: string | null;
  first_touch_source: string | null;
  first_utm_source: string | null;
  first_utm_medium: string | null;
};

export type ReclassifyResult = {
  /** Recomputed last-touch source. */
  newSource: string;
  /** Recomputed first-touch source (null = no first-click signal). */
  newFirstTouchSource: string | null;
  /** newSource differs from the stored source. */
  sourceChanged: boolean;
  /** newFirstTouchSource differs from the stored first_touch_source. */
  firstTouchChanged: boolean;
};

/** Build a synthetic landing_site query string from stored utm_* columns, so
 *  classifyOrderAttribution re-parses the SAME utm_* it would on the live path.
 *  Each present param is URL-encoded; absent params are omitted (an empty value
 *  is treated as absent so we don't fabricate `utm_source=`). */
function syntheticLandingSite(row: StoredAttributionRow): string {
  const pairs: string[] = [];
  const add = (k: string, v: string | null) => {
    if (v != null && v !== '') pairs.push(`${k}=${encodeURIComponent(v)}`);
  };
  add('utm_source', row.utm_source);
  add('utm_medium', row.utm_medium);
  add('utm_campaign', row.utm_campaign);
  add('utm_id', row.utm_id);
  add('utm_term', row.utm_term);
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/** Reconstruct ft_* note_attributes from the stored first-touch utm columns so
 *  the classifier's first-click chain (email + product_sync only — UTM-only by
 *  design) re-derives correctly. Returns [] when no first-touch signal is
 *  stored, leaving first_touch_source null ("no first-click signal"). */
function syntheticFirstTouchNoteAttrs(
  row: StoredAttributionRow,
): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  if (row.first_utm_source != null && row.first_utm_source !== '') {
    out.push({ name: 'ft_utm_source', value: row.first_utm_source });
  }
  if (row.first_utm_medium != null && row.first_utm_medium !== '') {
    out.push({ name: 'ft_utm_medium', value: row.first_utm_medium });
  }
  return out;
}

/**
 * Recompute classify-v2 source + first_touch_source for one stored row.
 *
 * IMPORTANT — self-referral CANNOT be re-derived here: landing_site (with a
 * host) is not stored, so isSelfReferral() never fires. Such rows keep their
 * old source (no change emitted). Documented limitation; forward path is correct.
 */
export function reclassifyStoredRow(row: StoredAttributionRow): ReclassifyResult {
  const landing = syntheticLandingSite(row);
  const ftNotes = syntheticFirstTouchNoteAttrs(row);

  const result = classifyOrderAttribution({
    landing_site: landing,
    referring_site: row.referrer ?? undefined,
    note_attributes: ftNotes,
    // source_name is NOT stored — omitted. (Live path uses it only for the
    // platform channel-app branch, which already wrote {platform}-paid; those
    // rows recompute to the same {platform}-paid via utm_source anyway, and a
    // missing source_name never DOWNGRADES a stored value here.)
  });

  const newSource = result.source;
  const newFirstTouchSource = result.firstTouchSource;

  const storedSource = row.source ?? '';
  const storedFirst = row.first_touch_source;

  return {
    newSource,
    newFirstTouchSource,
    sourceChanged: newSource !== storedSource,
    // Only count a first-touch change when the row actually carried a stored
    // first_touch_source (or we recompute a non-null one). null===null = no change.
    firstTouchChanged: (newFirstTouchSource ?? null) !== (storedFirst ?? null),
  };
}

// ---------------------------------------------------------------------------
// Runner — batched, resumable scan over orders_attribution.
// ---------------------------------------------------------------------------
type DbRow = StoredAttributionRow & { store_id: string; order_id: string };

const SELECT_COLS =
  'store_id, order_id, source, utm_source, utm_medium, utm_campaign, utm_id, ' +
  'utm_term, referrer, first_touch_source, first_utm_source, first_utm_medium';

async function main(): Promise<void> {
  const stores = process.env.STORES
    ? process.env.STORES.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const from = process.env.FROM?.trim() || null;
  const to = process.env.TO?.trim() || null;

  console.log(`[${DRY_RUN ? 'DRY-RUN' : 'APPLY'}] reclassify-history (classify-v2)`);
  console.log(
    `scope: stores=${stores ? stores.join(',') : 'ALL'} | ` +
      `date=${from ?? '-∞'}..${to ?? '+∞'}`,
  );
  const admin = getAdminClient();

  // Recomputed updates we'd write: source and/or first_touch_source.
  const updates: Array<{
    store_id: string;
    order_id: string;
    source?: string;
    first_touch_source?: string | null;
  }> = [];
  // before→after tallies, keyed `${old}→${new}`.
  const sourceTally: Record<string, number> = {};
  const firstTally: Record<string, number> = {};

  let scanned = 0;
  let offset = 0;
  for (;;) {
    let q = admin
      .from('orders_attribution')
      .select(SELECT_COLS)
      .order('store_id', { ascending: true })
      .order('order_id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (stores) q = q.in('store_id', stores);
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);

    const { data, error } = await q;
    if (error) throw new Error(`select: ${error.message}`);
    // Cast via unknown: chaining the optional .in()/.gte()/.lte() filters above
    // widens supabase-js's inferred row type to a union with its error-row shape,
    // so a direct cast to DbRow[] is rejected. The runtime rows ARE DbRow[].
    const rows = (data ?? []) as unknown as DbRow[];
    if (rows.length === 0) break;
    scanned += rows.length;

    for (const r of rows) {
      const res = reclassifyStoredRow(r);
      const upd: { store_id: string; order_id: string; source?: string; first_touch_source?: string | null } = {
        store_id: r.store_id,
        order_id: r.order_id,
      };
      let any = false;
      if (res.sourceChanged) {
        upd.source = res.newSource;
        const key = `${r.source ?? '(null)'}→${res.newSource}`;
        sourceTally[key] = (sourceTally[key] ?? 0) + 1;
        any = true;
      }
      if (res.firstTouchChanged) {
        upd.first_touch_source = res.newFirstTouchSource;
        const key = `${r.first_touch_source ?? '(null)'}→${res.newFirstTouchSource ?? '(null)'}`;
        firstTally[key] = (firstTally[key] ?? 0) + 1;
        any = true;
      }
      if (any) updates.push(upd);
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`\nscanned ${scanned} rows; ${updates.length} rows to reclassify.`);
  console.log('  source (last-touch) before→after:');
  printTally(sourceTally);
  console.log('  first_touch_source before→after:');
  printTally(firstTally);

  if (DRY_RUN) {
    console.log(
      '\nDRY-RUN — no writes. Re-run with APPLY=1 (or --apply) to apply.',
    );
    return;
  }

  let done = 0;
  for (const u of updates) {
    const patch: { source?: string; first_touch_source?: string | null } = {};
    if ('source' in u) patch.source = u.source;
    if ('first_touch_source' in u) patch.first_touch_source = u.first_touch_source;
    const { error } = await admin
      .from('orders_attribution')
      .update(patch)
      .eq('store_id', u.store_id)
      .eq('order_id', u.order_id);
    if (error) throw new Error(`update ${u.store_id}/${u.order_id}: ${error.message}`);
    done++;
    if (done % UPDATE_LOG_EVERY === 0) {
      console.log(`  updated ${done}/${updates.length}`);
    }
  }
  console.log(`\nDONE — updated ${done} rows.`);
}

function printTally(t: Record<string, number>): void {
  const keys = Object.keys(t).sort((a, b) => t[b] - t[a]);
  if (keys.length === 0) {
    console.log('    (none)');
    return;
  }
  for (const k of keys) console.log(`    ${k}: ${t[k]}`);
}

// Run only when invoked directly (`npx tsx scripts/reclassifyHistoricalAttribution.ts`),
// NOT when imported by a unit test for the pure `reclassifyStoredRow` core.
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /reclassifyHistoricalAttribution(\.ts)?$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('reclassifyHistoricalAttribution FAILED:', e);
      process.exit(1);
    });
}
