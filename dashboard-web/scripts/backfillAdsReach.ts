#!/usr/bin/env node
// dashboard-web/scripts/backfillAdsReach.ts
//
// One-off / re-runnable: populate ads_daily.reach (Meta + TikTok) over history
// so the creative-fatigue early-warning has frequency data immediately (not just
// going forward). Reuses the nightly ad fetchers (which now return `reach`) and
// UPDATEs the reach column keyed on (date, store_id, ad_id). Read-only toward
// the ad platforms; ZERO writes to pixels/CAPI. Google is skipped (no frequency).
//
// RUN (from repo root, NOT dashboard-web — map the dotted .env keys first):
//   cd /Users/dorperetz/script-roas
//   export SUPABASE_URL="$(grep -E '^supabase\.url=' .env | cut -d= -f2-)"
//   export SUPABASE_SERVICE_ROLE_KEY="$(grep -E '^supabase\.service\.role\.key=' .env | cut -d= -f2-)"
//   export UZOSHOP_META_ACCESS_TOKEN="$(grep -E '^uzoshop\.meta\.accessToken=' .env | cut -d= -f2-)"
//   export UZOSHOP_META_AD_ACCOUNT_ID="$(grep -E '^uzoshop\.meta\.adAccountId=' .env | cut -d= -f2-)"
//   export ZOLPLUS_META_ACCESS_TOKEN="$(grep -E '^zolplus\.meta\.accessToken=' .env | cut -d= -f2-)"
//   export ZOLPLUS_META_AD_ACCOUNT_ID="$(grep -E '^zolplus\.meta\.adAccountId=' .env | cut -d= -f2-)"
//   export USMILE360_META_ACCESS_TOKEN="$(grep -E '^usmile360\.meta\.accessToken=' .env | cut -d= -f2-)"
//   export USMILE360_META_AD_ACCOUNT_ID="$(grep -E '^usmile360\.meta\.adAccountId=' .env | cut -d= -f2-)"
//   export UZOSHOP_TIKTOK_ACCESS_TOKEN="$(grep -E '^uzoshop\.tiktok\.accessToken=' .env | cut -d= -f2-)"
//   export UZOSHOP_TIKTOK_ADVERTISER_ID="$(grep -E '^uzoshop\.tiktok\.advertiserId=' .env | cut -d= -f2-)"
//
// DRY-RUN first (prints per-date row counts, NO writes):
//   DRY_RUN=1 FROM=2026-05-01 TO=2026-06-05 npx tsx dashboard-web/scripts/backfillAdsReach.ts
//
// Then for real:
//   FROM=2026-05-01 TO=2026-06-05 npx tsx dashboard-web/scripts/backfillAdsReach.ts

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchMetaAdInsights } from '@/lib/fetchers/meta';
import { fetchTikTokAdInsights } from '@/lib/fetchers/tiktok';

const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
type StoreId = (typeof STORES)[number];
/** Only uzoshop has a TikTok account; the campaign-store-map remaps rows to the
 *  correct store_id inside the fetcher, so the backfill still honours per-store
 *  granularity even though we only call the fetcher once per date. */
const TT_STORES: StoreId[] = ['uzoshop'];

const DRY_RUN = process.env.DRY_RUN === '1';

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

/** All calendar dates (YYYY-MM-DD) from `from` through `to` inclusive, oldest first. */
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

async function main(): Promise<void> {
  const sb = getAdminClient();
  const from = process.env.FROM ?? '2026-05-01';
  const to = process.env.TO ?? new Date().toISOString().slice(0, 10);
  const dates = eachDate(from, to);
  console.log(
    `backfillAdsReach — ${dates.length} dates (${from}..${to}), DRY_RUN=${DRY_RUN}`,
  );

  let updated = 0;

  for (const date of dates) {
    // ── Meta (all 3 stores) ──────────────────────────────────────────────────
    for (const storeId of STORES) {
      const rows = await fetchMetaAdInsights(storeId, date).catch((e: unknown) => {
        console.warn(`meta ${storeId} ${date}: ${(e as Error).message}`);
        return [];
      });
      for (const r of rows) {
        if (r.reach == null) continue;
        if (DRY_RUN) {
          updated++;
          continue;
        }
        const { error } = await sb
          .from('ads_daily')
          .update({ reach: r.reach })
          .eq('date', date)
          .eq('store_id', storeId)
          .eq('ad_id', r.adId)
          .eq('platform', 'meta');
        if (error) {
          console.warn(`upd meta ${storeId} ${date} ${r.adId}: ${error.message}`);
        } else {
          updated++;
        }
      }
    }

    // ── TikTok (uzoshop account; campaign-store-map resolves actual store_id) ─
    for (const storeId of TT_STORES) {
      const rows = await fetchTikTokAdInsights(storeId, date).catch((e: unknown) => {
        console.warn(`tiktok ${storeId} ${date}: ${(e as Error).message}`);
        return [];
      });
      for (const r of rows) {
        if (r.reach == null) continue;
        // r.storeId is resolved by the campaign-store-map inside the fetcher;
        // use it so the UPDATE hits the correct store row.
        const target = r.storeId ?? storeId;
        if (DRY_RUN) {
          updated++;
          continue;
        }
        const { error } = await sb
          .from('ads_daily')
          .update({ reach: r.reach })
          .eq('date', date)
          .eq('store_id', target)
          .eq('ad_id', r.adId)
          .eq('platform', 'tiktok');
        if (error) {
          console.warn(`upd tiktok ${target} ${date} ${r.adId}: ${error.message}`);
        } else {
          updated++;
        }
      }
    }

    console.log(
      `${date} — running total reach rows ${DRY_RUN ? 'matched' : 'updated'}: ${updated}`,
    );
  }

  console.log(
    `\nDONE — ${updated} rows ${DRY_RUN ? 'would be updated (DRY_RUN)' : 'updated'}.`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
