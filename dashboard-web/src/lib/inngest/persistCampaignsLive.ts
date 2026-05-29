/**
 * Phase 13.9 (2026-05-27) — Persist per-campaign + per-ad metrics for one
 * (store, date) tuple. Called by the new `cron-live-heavy` Inngest
 * function every 30 min during the day to keep `campaigns_daily` +
 * `ads_daily` warm without waiting for cron-daily's 01:00 nightly run.
 *
 * Column shape is identical to cron-daily's inline writer (cronDaily.ts
 * persist-batch step). Both rely on `ON CONFLICT DO UPDATE` against the
 * same PK so concurrent runs reconcile per-column (last writer wins
 * for the columns it touches; absent payload keys are preserved).
 *
 * The function is pure (no Inngest step.run, no fetches) — caller pre-
 * fetches the per-platform data and pre-resolves the FX `getFx`
 * closure. This keeps it trivially testable and reusable between
 * cron-daily and cron-live-heavy if a future refactor wants to DRY
 * the writer.
 *
 * cadFor preserve semantics (CRIT-5 / O4-CR-01): when FX fails for a
 * (currency, date) pair, `getFx` returns `null` and `cadFor` propagates
 * null. Per-row builders OMIT the affected CAD key so Supabase's
 * payload-key-only SET clause leaves the prior value intact.
 *
 * Input-type shape note: the caller (cron-live-heavy) is expected to
 * pass a *normalized* per-platform row shape — not the raw fetcher
 * outputs. Specifically:
 *   - TikTok uses `adSetId`/`adSetName` (mapped from the fetcher's
 *     `adGroupId`/`adGroupName`) so the unified schema's ad_set_id
 *     column gets the right value with no inline rename in the helper.
 *   - Google ad rows use pre-CAD `spend`/`conversionValue` so the
 *     helper can pass them through (Google is CAD-native for uzoshop,
 *     so the caller writes the same number into `spend` that the
 *     fetcher emits as `spendCad`).
 *   - All ad-level rows carry an optional `effectiveStatus` (currently
 *     unused by the ads_daily writer but accepted so cron-live-heavy
 *     can pass through the same row objects it shows to operators).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MetaAdSetRow, MetaBudgets } from '@/lib/fetchers/meta';

/**
 * Normalized Meta ad-level row consumed by persistCampaignsLive. Strips
 * the redundant `storeId`/`date`/`platform` carried by the raw
 * `MetaAdRow` fetcher type — the helper already knows those from the
 * top-level `storeId`/`dateStr` input.
 */
export type MetaAdLiveRow = {
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  adId: string;
  adName: string;
  spend: number;
  currency: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
};

/**
 * Normalized Google ad-group row consumed by persistCampaignsLive. Mirrors
 * `GoogleAdsAdGroupRow` from `@/lib/fetchers/googleAds`; kept local because
 * the caller may synthesise rows from a different fetcher in the future.
 */
export type GoogleAdGroupLiveRow = {
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  effectiveStatus?: string | null;
};

/**
 * Normalized Google ad row consumed by persistCampaignsLive. Pre-CAD
 * fields (`spend`, `conversionValue`) so the helper writes them through to
 * `spend_cad` / `conversion_value_cad` columns unchanged (Google is
 * CAD-native for uzoshop — the only store with a Google Ads account).
 */
export type GoogleAdLiveRow = {
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  adId: string;
  adName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  effectiveStatus?: string | null;
};

/**
 * Normalized TikTok ad row consumed by persistCampaignsLive. Mapped from
 * `TikTokAdRow` (`@/lib/fetchers/tiktok`) by renaming `adGroupId`→`adSetId`
 * and `adGroupName`→`adSetName` at the caller. `currency` is omitted
 * because TikTok is USD-native for uzoshop and the helper hardcodes the
 * conversion to USD; if a future store uses a different TikTok account
 * currency this type will need a `currency` field.
 */
export type TikTokAdLiveRow = {
  /** Phase A.5 — store_id resolved from campaign-store-map by the fetcher.
   *  persistCampaignsLive writes store_id: r.storeId ?? storeId (function-arg
   *  fallback) so multi-store TikTok advertisers upsert under the correct store. */
  storeId: string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  adId: string;
  adName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  effectiveStatus?: string | null;
};

export type PersistCampaignsLiveInput = {
  storeId: string;
  dateStr: string;
  admin: SupabaseClient;
  /**
   * (amount, currency) → CAD value. Caller wires this to either a real
   * `getFxRate` call or a mock. Returns `null` to signal FX outage —
   * the corresponding CAD column is then omitted from the UPSERT
   * payload to preserve the prior value.
   */
  getFx: (amount: number, currency: string) => Promise<number | null>;
  meta: {
    adsetRows: MetaAdSetRow[];
    adRows: MetaAdLiveRow[];
    budgets: MetaBudgets;
  };
  google: {
    adGroupRows: GoogleAdGroupLiveRow[];
    adRows: GoogleAdLiveRow[];
  };
  tiktok: {
    adRows: TikTokAdLiveRow[];
  };
};

export async function persistCampaignsLive(
  input: PersistCampaignsLiveInput,
): Promise<void> {
  const { storeId, dateStr, admin, getFx, meta, google, tiktok } = input;

  // Phase A Task 14 (2026-05-29): single timestamp for this call so all
  // rows in the same upsert share the same last_live_tick_at value.
  // Mirrors cron-daily's reconciled_at invariant: within one call, all
  // rows in every table share the same timestamp for auditability.
  const liveTickAt = new Date().toISOString();

  // FX adapter: passes through CAD currencies, calls getFx for the rest.
  // null result → caller skips writing the CAD column.
  async function cadFor(amount: number, currency: string): Promise<number | null> {
    if (!Number.isFinite(amount)) return null;
    if (amount === 0) return 0;
    const cur = (currency || 'CAD').toUpperCase();
    if (cur === 'CAD') return amount;
    const rate = await getFx(amount, cur);
    if (rate === null || !Number.isFinite(rate)) return null;
    return amount * rate;
  }

  // ---------- campaigns_daily — Meta rows ----------
  type MetaCampaignRow = {
    date: string; store_id: string; platform: 'meta';
    campaign_id: string; campaign_name: string;
    ad_set_id: string; ad_set_name: string;
    impressions: number; clicks: number; conversions: number;
    roas: null;
    budget_type: 'CBO' | 'ABO' | '';
    effective_status: string | null;
    last_live_tick_at: string;
    spend_cad?: number;
    conversion_value_cad?: number;
    campaign_budget_cad?: number | null;
    ad_set_budget_cad?: number | null;
  };
  const metaRows: MetaCampaignRow[] = [];
  for (const r of meta.adsetRows) {
    const cBud = meta.budgets.campaigns[r.campaignId];
    const aBud = meta.budgets.adSets[r.adSetId];
    const cDaily = cBud?.dailyBudget ?? 0;
    const cLifetime = cBud?.lifetimeBudget ?? 0;
    const aDaily = aBud?.dailyBudget ?? 0;
    const aLifetime = aBud?.lifetimeBudget ?? 0;
    const campaignBudgetRaw = cDaily > 0 ? cDaily : cLifetime;
    const adSetBudgetRaw = aDaily > 0 ? aDaily : aLifetime;
    let bt: 'CBO' | 'ABO' | '' = '';
    if (campaignBudgetRaw > 0) bt = 'CBO';
    else if (adSetBudgetRaw > 0) bt = 'ABO';
    const effectiveStatus = aBud?.effectiveStatus ?? cBud?.effectiveStatus ?? null;
    const spendCad = await cadFor(r.spend, r.currency);
    const convValueCad = await cadFor(r.conversionValue, r.currency);
    const campaignBudgetCad = campaignBudgetRaw > 0
      ? await cadFor(campaignBudgetRaw, meta.budgets.currency)
      : null;
    const adSetBudgetCad = adSetBudgetRaw > 0
      ? await cadFor(adSetBudgetRaw, meta.budgets.currency)
      : null;
    const row: MetaCampaignRow = {
      date: dateStr,
      store_id: storeId,
      platform: 'meta',
      campaign_id: r.campaignId,
      campaign_name: r.campaignName,
      ad_set_id: r.adSetId,
      ad_set_name: r.adSetName,
      impressions: Math.round(r.impressions),
      clicks: Math.round(r.clicks),
      conversions: Math.round(r.conversions),
      roas: null,
      budget_type: bt,
      effective_status: effectiveStatus,
      last_live_tick_at: liveTickAt,
    };
    if (spendCad !== null) row.spend_cad = spendCad;
    if (convValueCad !== null) row.conversion_value_cad = convValueCad;
    if (campaignBudgetRaw === 0) row.campaign_budget_cad = null;
    else if (campaignBudgetCad !== null) row.campaign_budget_cad = campaignBudgetCad;
    if (adSetBudgetRaw === 0) row.ad_set_budget_cad = null;
    else if (adSetBudgetCad !== null) row.ad_set_budget_cad = adSetBudgetCad;
    metaRows.push(row);
  }

  // ---------- campaigns_daily — Google rows ----------
  const googleRows = google.adGroupRows.map((r) => ({
    date: dateStr,
    store_id: storeId,
    platform: 'google' as const,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    ad_set_id: r.adSetId,
    ad_set_name: r.adSetName,
    spend_cad: r.spend,
    impressions: Math.round(r.impressions),
    clicks: Math.round(r.clicks),
    conversions: Math.round(r.conversions),
    conversion_value_cad: r.conversionValue,
    roas: null,
    campaign_budget_cad: null,
    ad_set_budget_cad: null,
    budget_type: null,
    effective_status: r.effectiveStatus ?? null,
    last_live_tick_at: liveTickAt,
  }));

  // ---------- campaigns_daily — TikTok rows ----------
  type TikTokCampaignRow = {
    date: string; store_id: string; platform: 'tiktok';
    campaign_id: string; campaign_name: string;
    ad_set_id: string; ad_set_name: string;
    impressions: number; clicks: number; conversions: number;
    roas: null;
    budget_type: null;
    campaign_budget_cad: null;
    ad_set_budget_cad: null;
    effective_status: string | null;
    last_live_tick_at: string;
    spend_cad?: number;
    conversion_value_cad?: number;
  };
  // TikTok aggregates per (campaign, adset) by summing the ad-level rows.
  // Matches cron-daily's aggregation (TikTok doesn't have a level=adset
  // endpoint that returns budgets the same way Meta does).
  const ttGroups = new Map<string, {
    storeId: string;
    campaignId: string; campaignName: string; adSetId: string; adSetName: string;
    spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number;
    currency: string; effectiveStatus: string | null;
  }>();
  for (const r of tiktok.adRows) {
    const k = `${r.campaignId}::${r.adSetId}`;
    let g = ttGroups.get(k);
    if (!g) {
      g = {
        storeId: r.storeId ?? storeId,
        campaignId: r.campaignId, campaignName: r.campaignName,
        adSetId: r.adSetId, adSetName: r.adSetName,
        spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
        currency: 'USD', effectiveStatus: r.effectiveStatus ?? null,
      };
      ttGroups.set(k, g);
    }
    g.spend += r.spend;
    g.impressions += r.impressions;
    g.clicks += r.clicks;
    g.conversions += r.conversions;
    g.conversionValue += r.conversionValue;
  }
  const ttRows: TikTokCampaignRow[] = [];
  for (const g of ttGroups.values()) {
    const spendCad = await cadFor(g.spend, g.currency);
    const convValueCad = await cadFor(g.conversionValue, g.currency);
    const row: TikTokCampaignRow = {
      date: dateStr,
      store_id: g.storeId,
      platform: 'tiktok',
      campaign_id: g.campaignId,
      campaign_name: g.campaignName,
      ad_set_id: g.adSetId,
      ad_set_name: g.adSetName,
      impressions: Math.round(g.impressions),
      clicks: Math.round(g.clicks),
      conversions: Math.round(g.conversions),
      roas: null,
      budget_type: null,
      campaign_budget_cad: null,
      ad_set_budget_cad: null,
      effective_status: g.effectiveStatus,
      last_live_tick_at: liveTickAt,
    };
    if (spendCad !== null) row.spend_cad = spendCad;
    if (convValueCad !== null) row.conversion_value_cad = convValueCad;
    ttRows.push(row);
  }

  // ---------- campaigns_daily UPSERT (mixed-platform array; supabase handles it) ----------
  const allCampaignRows: unknown[] = [...metaRows, ...googleRows, ...ttRows];
  if (allCampaignRows.length > 0) {
    const { error } = await admin
      .from('campaigns_daily')
      .upsert(allCampaignRows, { onConflict: 'date,store_id,platform,campaign_id,ad_set_id' });
    if (error) {
      throw new Error(`campaigns_daily upsert ${storeId} ${dateStr}: ${error.message}`);
    }
  }

  // ---------- ads_daily — all three platforms in one UPSERT ----------
  type MetaAdsRow = {
    date: string; store_id: string; platform: 'meta';
    campaign_id: string; campaign_name: string;
    ad_set_id: string; ad_set_name: string;
    ad_id: string; ad_name: string;
    impressions: number; clicks: number; conversions: number;
    last_live_tick_at: string;
    spend_cad?: number;
    conversion_value_cad?: number;
  };
  const metaAdRows: MetaAdsRow[] = [];
  for (const r of meta.adRows) {
    const spendCad = await cadFor(r.spend, r.currency);
    const convValueCad = await cadFor(r.conversionValue, r.currency);
    const row: MetaAdsRow = {
      date: dateStr,
      store_id: storeId,
      platform: 'meta',
      campaign_id: r.campaignId,
      campaign_name: r.campaignName,
      ad_set_id: r.adSetId,
      ad_set_name: r.adSetName,
      ad_id: r.adId,
      ad_name: r.adName,
      impressions: Math.round(r.impressions),
      clicks: Math.round(r.clicks),
      conversions: Math.round(r.conversions),
      last_live_tick_at: liveTickAt,
    };
    if (spendCad !== null) row.spend_cad = spendCad;
    if (convValueCad !== null) row.conversion_value_cad = convValueCad;
    metaAdRows.push(row);
  }
  const googleAdRows = google.adRows.map((r) => ({
    date: dateStr,
    store_id: storeId,
    platform: 'google' as const,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    ad_set_id: r.adSetId,
    ad_set_name: r.adSetName,
    ad_id: r.adId,
    ad_name: r.adName,
    spend_cad: r.spend,
    impressions: Math.round(r.impressions),
    clicks: Math.round(r.clicks),
    conversions: Math.round(r.conversions),
    conversion_value_cad: r.conversionValue,
    last_live_tick_at: liveTickAt,
  }));
  const tiktokAdRows = await Promise.all(
    tiktok.adRows.map(async (r) => {
      const spendCad = await cadFor(r.spend, 'USD');
      const convValueCad = await cadFor(r.conversionValue, 'USD');
      const row: Record<string, unknown> = {
        date: dateStr,
        store_id: r.storeId ?? storeId,
        platform: 'tiktok' as const,
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        ad_set_id: r.adSetId,
        ad_set_name: r.adSetName,
        ad_id: r.adId,
        ad_name: r.adName,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        conversions: Math.round(r.conversions),
        last_live_tick_at: liveTickAt,
      };
      if (spendCad !== null) row.spend_cad = spendCad;
      if (convValueCad !== null) row.conversion_value_cad = convValueCad;
      return row;
    }),
  );
  const allAdRows: unknown[] = [...metaAdRows, ...googleAdRows, ...tiktokAdRows];
  if (allAdRows.length > 0) {
    const { error } = await admin
      .from('ads_daily')
      .upsert(allAdRows, { onConflict: 'date,store_id,ad_id' });
    if (error) {
      throw new Error(`ads_daily upsert ${storeId} ${dateStr}: ${error.message}`);
    }
  }

  // Phase A.5 — re-aggregate data_daily TikTok columns per store + recompute
  // dependents from the freshly-written campaigns_daily slices. Without this,
  // today's data_daily shows legacy single-store-arg TikTok values until
  // tomorrow's cron-daily reconciliation.
  try {
    const { error: aggErr } = await admin.rpc('agg_tiktok_spend_per_store_for_date', { d: dateStr });
    if (aggErr) {
      console.warn(`persistCampaignsLive ${storeId} ${dateStr}: tt_spend_cad agg failed: ${aggErr.message}`);
    }
  } catch (e) {
    console.warn(`persistCampaignsLive ${storeId} ${dateStr}: tt_spend_cad agg threw: ${e instanceof Error ? e.message : e}`);
  }
}
