#!/usr/bin/env node
// One-off (re-runnable): apply the BROADENED utm_source→platform classification
// to existing orders_attribution rows IN PLACE — no Shopify re-fetch.
//
// WHY
// ---
// classifyOrderAttribution was broadened (detectAdPlatform) so messy real-world
// ad utm_source values — Facebook_Mobile_Feed, Instagram_Stories, meta, ig, an
// (Audience Network), goog, Hebrew פייסבוק, ... — map to meta/google/tiktok-paid
// instead of the catch-all 'other-paid' (shown as "ישיר"). The shared classifier
// fixes the FORWARD path (new orders via cron/webhook) automatically, but the
// already-materialized orders_attribution.source / first_touch_source for past
// orders keep their old value. Every read-time consumer (NC-ROAS, unknown
// bucket, reconciliation, product-channel, AI report) reads this column live, so
// re-classifying it propagates the broadening to ALL of them at once.
//
// WHY IN-PLACE (not a Shopify re-fetch)
// -------------------------------------
// The broadening ONLY promotes rows currently bucketed 'other-paid' whose
// utm_source is now recognized: a row with a click-id / source_name already
// classifies as meta/google/tiktok-paid, and direct/organic/email rows have no
// platform utm_source. So source='other-paid' (or first_touch_source='other-paid')
// is the exact, complete set the broadening can change — recomputable from the
// stored utm_source / first_utm_source columns alone. No 46k-order re-fetch.
//
// SCOPE GUARD: only PROMOTES other-paid → {platform}-paid. Never demotes an
// existing meta/google/tiktok-paid row (e.g. historical copyToPasteBoard=meta-paid
// from the Apps Script era) — that's a separate decision, out of this change.
//
// READ/WRITE: reads + writes ONLY orders_attribution (Supabase). Zero Shopify /
// ad-platform / pixel / CAPI calls.
//
// RUN (from repo root):
//   export SUPABASE_URL="$(grep -E '^supabase\.url=' .env | cut -d= -f2-)"
//   export SUPABASE_SERVICE_ROLE_KEY="$(grep -E '^supabase\.service\.role\.key=' .env | cut -d= -f2-)"
//   DRY_RUN=1 npx tsx dashboard-web/scripts/backfillBroadenedAttributionSource.ts  # preview
//   npx tsx dashboard-web/scripts/backfillBroadenedAttributionSource.ts            # apply

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { detectAdPlatform } from '@/lib/attribution/classifyOrderSource';

const DRY_RUN = process.env.DRY_RUN === '1';
const PAGE = 1000;

function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (map from root .env dotted keys).');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

type Row = {
  store_id: string;
  order_id: string;
  source: string | null;
  utm_source: string | null;
  first_touch_source: string | null;
  first_utm_source: string | null;
};

async function main(): Promise<void> {
  const admin = getAdminClient();
  console.log(`mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);

  const updates: Array<{ store_id: string; order_id: string; source: string; first_touch_source: string | null }> = [];
  let scanned = 0;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('orders_attribution')
      .select('store_id, order_id, source, utm_source, first_touch_source, first_utm_source')
      .or('source.eq.other-paid,first_touch_source.eq.other-paid')
      .order('store_id', { ascending: true })
      .order('order_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`select: ${error.message}`);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;
    scanned += rows.length;
    for (const r of rows) {
      let changed = false;
      let newSource = r.source ?? '';
      let newFirst = r.first_touch_source;
      if (r.source === 'other-paid') {
        const p = detectAdPlatform(r.utm_source);
        if (p) { newSource = `${p}-paid`; changed = true; }
      }
      if (r.first_touch_source === 'other-paid') {
        const p = detectAdPlatform(r.first_utm_source);
        if (p) { newFirst = `${p}-paid`; changed = true; }
      }
      if (changed) updates.push({ store_id: r.store_id, order_id: r.order_id, source: newSource, first_touch_source: newFirst });
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  const byNew: Record<string, number> = {};
  for (const u of updates) byNew[u.source] = (byNew[u.source] ?? 0) + 1;
  console.log(`scanned ${scanned} 'other-paid' candidate rows; ${updates.length} to promote`);
  console.log('  promoted source breakdown:', JSON.stringify(byNew));

  if (DRY_RUN) {
    console.log('DRY-RUN — no writes. Re-run without DRY_RUN=1 to apply.');
    return;
  }

  let done = 0;
  for (const u of updates) {
    const { error } = await admin
      .from('orders_attribution')
      .update({ source: u.source, first_touch_source: u.first_touch_source })
      .eq('store_id', u.store_id)
      .eq('order_id', u.order_id);
    if (error) throw new Error(`update ${u.store_id}/${u.order_id}: ${error.message}`);
    done++;
    if (done % 500 === 0) console.log(`  updated ${done}/${updates.length}`);
  }
  console.log(`done — updated ${done} rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
