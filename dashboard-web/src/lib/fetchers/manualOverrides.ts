// dashboard-web/src/lib/fetchers/manualOverrides.ts
//
// Reads the Supabase `manual_overrides` table and merges into per-day spend
// values BEFORE persist. Replaces (does not add to) the fetched spend for any
// platform that has an override row — mirrors ManualOverrides.gs:71-99.
//
// Data source: Supabase `manual_overrides` table (Phase 05.5-01 schema).
// The TS port deliberately does NOT read from the legacy Sheets tab the
// Apps Script ManualOverrides.gs uses (per D-F2). Reading from Postgres
// keeps the trust boundary on the same service_role client used by all
// writers in the new system.
//
// Uses `getSupabaseAdmin()` (service_role) because:
//   - The migration grants SELECT only to anon, but service_role bypasses
//     RLS and works uniformly for both reads and the eventual write path
//     (operator console plan 15). Keeping reads + writes on the same client
//     simplifies the trust-boundary surface.
//   - Inngest functions (plans 08-09) call this from server context only;
//     `getSupabaseAdmin` is server-only (see supabaseAdmin.ts).
//
// Merge semantics (per ManualOverrides.gs:71-99):
//   - For each (date, store_id, platform), if a row exists in
//     `manual_overrides`, its `spend` value REPLACES the upstream fetcher's
//     spend for that platform on that day.
//   - The override's `currency` is converted to CAD via `getFxRate` (Frankfurter,
//     see fetchers/fx.ts) when not already CAD.
//   - Rows are operator-typed via the plan 15 CRUD UI; CHECK constraints on
//     `platform IN ('meta', 'google', 'tiktok')` block invalid values at
//     write-time. Defensive read-side guard logs a warning if a genuinely
//     unexpected platform value ever appears (would indicate constraint
//     bypass / corruption).
//
// TikTok (2026-06-02): the override row is keyed by `(date, store_id,
//   platform)`. Because it is resolved per `store_id`, a TikTok override for
//   store X replaces ONLY X's mapped TikTok spend — never the raw shared
//   account total and never another store's mapped share. This keeps the
//   override on the SAME per-store axis the agg uses. We do NOT touch
//   campaignStoreMap / the TikTok fetcher / the agg RPC, so all mapping
//   suites stay green.
//
// Return shape — CAD-only:
//   - All four numbers (`fbSpendCad`, `gaSpendCad`, `ttSpendCad`,
//     `totalSpendCad`) are in CAD ready for direct write to
//     `data_daily.fb_spend_cad` / `data_daily.ga_spend_cad` /
//     `data_daily.tt_spend_cad` / `data_daily.total_spend_cad`.
//   - `overridesApplied` is returned for observability — plans 08-09 surface
//     it on the Inngest step.run result so the operator console jobs table
//     shows which days had operator-typed overrides applied.

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getFxRate } from '@/lib/fetchers/fx';

export type SpendInput = { spend: number; currency: string };

export type MergeInput = {
  storeId: string;
  date: string; // YYYY-MM-DD
  metaSpend: SpendInput;
  googleSpend: SpendInput;
  /** Mapping-resolved TikTok spend for THIS store (already split per store by
   *  the fetcher/agg). Optional: omitted for non-TikTok stores → treated as 0. */
  tiktokSpend?: SpendInput;
};

export type MergeResult = {
  fbSpendCad: number;
  gaSpendCad: number;
  ttSpendCad: number;
  totalSpendCad: number;
  overridesApplied: { meta: boolean; google: boolean; tiktok: boolean };
};

type OverrideRow = {
  date: string;
  store_id: string;
  platform: string; // CHECK-constrained to 'meta' | 'google' | 'tiktok' at the DB
  // NUMERIC(14, 4) — supabase-js may decode as `number` or `string` depending
  // on the column precision; handle both.
  spend: number | string;
  currency: string;
};

async function spendToCad(input: SpendInput, dateStr: string): Promise<number> {
  if (input.currency === 'CAD') return input.spend;
  const rate = await getFxRate(input.currency, 'CAD', dateStr);
  return input.spend * rate;
}

async function overrideToCad(row: OverrideRow, dateStr: string): Promise<number> {
  const amount = typeof row.spend === 'string' ? parseFloat(row.spend) : row.spend;
  if (!Number.isFinite(amount)) {
    throw new Error(
      `manual_overrides spend not numeric for ${row.store_id} ${row.date} ${row.platform}`,
    );
  }
  if (row.currency === 'CAD') return amount;
  const rate = await getFxRate(row.currency, 'CAD', dateStr);
  return amount * rate;
}

export async function mergeOverridesFromSupabase(
  input: MergeInput,
): Promise<MergeResult> {
  const { storeId, date, metaSpend, googleSpend, tiktokSpend } = input;

  const { data, error } = await getSupabaseAdmin()
    .from('manual_overrides')
    .select('date,store_id,platform,spend,currency')
    .eq('store_id', storeId)
    .eq('date', date);

  if (error) {
    throw new Error(
      `manual_overrides lookup failed for ${storeId} ${date}: ${error.message}`,
    );
  }

  const rows = (data ?? []) as OverrideRow[];
  const overridesApplied = { meta: false, google: false, tiktok: false };

  // Resolve Meta side first, then Google. `.find` is fine — at most one row
  // per (date, store_id, platform) thanks to the UNIQUE constraint.
  let fbSpendCad: number;
  const metaRow = rows.find((r) => r.platform === 'meta');
  if (metaRow) {
    fbSpendCad = await overrideToCad(metaRow, date);
    overridesApplied.meta = true;
  } else {
    fbSpendCad = await spendToCad(metaSpend, date);
  }

  let gaSpendCad: number;
  const googleRow = rows.find((r) => r.platform === 'google');
  if (googleRow) {
    gaSpendCad = await overrideToCad(googleRow, date);
    overridesApplied.google = true;
  } else {
    gaSpendCad = await spendToCad(googleSpend, date);
  }

  // TikTok branch (2026-06-02). The row is keyed by store_id, so this replaces
  // ONLY this store's mapped TikTok spend — never the raw shared account, never
  // another store's split. `tiktokSpend` is optional (non-TikTok stores omit
  // it) → falls back to 0 when absent and no override exists.
  //
  // FX-failure policy (preserves CRIT-5 / O4-CR-01): when an override exists we
  // FX-convert it here (overrideToCad) — the operator value is authoritative
  // and the run SHOULD surface an error if its currency can't be converted.
  // But for the NON-override fallback we deliberately do NOT call external FX
  // (getFxRate) on a throwing path: a TikTok-FX outage must stay survivable
  // (Shopify revenue + Meta + Google still persist; tt_spend_cad is preserved
  // via ON CONFLICT). We CAD-passthrough only; any non-CAD fetched value is
  // left to cronDaily's own graceful persist-batch FX block (which catches the
  // outage and omits tt_spend_cad). cronDaily ignores this fallback unless the
  // currency is already CAD, so this never under-reports the persisted total.
  let ttSpendCad: number;
  const tiktokRow = rows.find((r) => r.platform === 'tiktok');
  if (tiktokRow) {
    ttSpendCad = await overrideToCad(tiktokRow, date);
    overridesApplied.tiktok = true;
  } else if (tiktokSpend && tiktokSpend.currency === 'CAD') {
    ttSpendCad = tiktokSpend.spend;
  } else {
    ttSpendCad = 0;
  }

  // Defensive: the CHECK constraint blocks platform values outside
  // meta/google/tiktok at write time, so this branch should never trigger.
  // If it does, the DB constraint was bypassed (or the table was corrupted) —
  // log loudly so the operator sees it in jobs-table errors. NOTE: 'tiktok' is
  // now a SUPPORTED, operator-typed value (handled above), so it is excluded
  // here — only a genuinely unknown platform reaches this warning.
  for (const r of rows) {
    if (
      r.platform !== 'meta' &&
      r.platform !== 'google' &&
      r.platform !== 'tiktok'
    ) {
      console.warn(
        `manual_overrides row with unexpected platform '${r.platform}' for ${storeId} ${date} — skipped`,
      );
    }
  }

  const totalSpendCad = fbSpendCad + gaSpendCad + ttSpendCad;
  return { fbSpendCad, gaSpendCad, ttSpendCad, totalSpendCad, overridesApplied };
}
