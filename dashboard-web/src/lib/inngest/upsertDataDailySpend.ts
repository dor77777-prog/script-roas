/**
 * Phase E1.6 (2026-05-30) — partial-column UPSERT to data_daily for one
 * platform's spend + impressions on one (store, date).
 *
 * Workers (metaWorker / googleWorker / tiktokWorker hot_metrics) call
 * this after the account-aggregate fetch. cron-live writes the disjoint
 * columns (revenue + derived) via its own persist step.
 *
 * Race-mitigation: payload contains only the platform's own 2 columns
 * (fb_spend_cad + fb_impressions for Meta, ga_* for Google, tt_* for
 * TikTok) plus the PK (date, store_id). Supabase's payload-key-only
 * SET clause means our UPSERT never overwrites Shopify revenue/derived
 * columns owned by cron-live.
 *
 * FX-failure preservation: if either spendCad or impressions is null
 * (the cadConvert helper returned null), we OMIT that column from the
 * payload so Supabase preserves the prior value.
 *
 * Both-null short-circuit: if BOTH values are null, we skip the UPSERT
 * entirely (no DB call). Equivalent to "this fetch produced nothing
 * worth writing".
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type DataDailyPlatform = 'meta' | 'google' | 'tiktok';

type Input = {
  admin: SupabaseClient;
  storeId: string;
  date: string;
  platform: DataDailyPlatform;
  spendCad: number | null;
  impressions: number | null;
};

const SPEND_COL: Record<DataDailyPlatform, string> = {
  meta: 'fb_spend_cad',
  google: 'ga_spend_cad',
  tiktok: 'tt_spend_cad',
};

const IMPRESSIONS_COL: Record<DataDailyPlatform, string> = {
  meta: 'fb_impressions',
  google: 'ga_impressions',
  tiktok: 'tt_impressions',
};

export async function upsertDataDailySpend(input: Input): Promise<void> {
  const { admin, storeId, date, platform, spendCad, impressions } = input;
  if (spendCad === null && impressions === null) return;
  const row: Record<string, unknown> = { date, store_id: storeId };
  if (spendCad !== null) row[SPEND_COL[platform]] = spendCad;
  if (impressions !== null) row[IMPRESSIONS_COL[platform]] = impressions;
  const { error } = await admin
    .from('data_daily')
    .upsert(row, { onConflict: 'date,store_id' });
  if (error) {
    throw new Error(
      `data_daily upsert ${platform} ${storeId} ${date}: ${error.message}`,
    );
  }
  // Phase E1.6.2 (2026-05-30 evening) — re-derive total_spend_cad + roas
  // + gross_profit_cad + net_profit_cad atomically from the fresh spend
  // we just wrote + the revenue column owned by cron-live. Pre-fix,
  // cron-live computed these derived values inline at persist time
  // using a priorSpend SELECT it cached at the start of the tick —
  // a race window between the SELECT and the UPSERT silently froze
  // derived values for ~10 min when workers wrote spend in between.
  // The recompute RPC fixes this at the DB layer; idempotent.
  //
  // Soft-fail by re-throw so the worker's outer try/catch records
  // data_freshness.transient_error and Inngest retries. Without
  // re-deriving, the next data_daily read would mix fresh spend with
  // stale total/roas — worse than failing loudly.
  const { error: deriveErr } = await admin
    .rpc('recompute_data_daily_derived', { d: date });
  if (deriveErr) {
    throw new Error(
      `recompute_data_daily_derived(${date}) for ${platform} ${storeId}: ${deriveErr.message}`,
    );
  }
}
