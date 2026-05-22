// TEST-03 (5.2.2.1): extracted from CampaignsTable.tsx for testability.
// Preserve the existing FIX-06 second-pass normalization and FIX-13 strict > policy.
import type { CampaignRow } from './campaigns';
import type { DateRange } from './dateRange';

export type AggregateMode = 'campaign' | 'adset';
export type AggregatePlatformFilter = 'all' | 'Meta' | 'Google' | 'TikTok';

export type Aggregated = {
  key: string;
  storeId: string;
  storeName: string;
  platform: string;
  campaignId: string;
  campaignName: string;
  adSetId?: string;
  adSetName?: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  campaignBudgetCad: number | null;
  adSetBudgetCad: number | null;
  budgetType: 'CBO' | 'ABO' | '';
  /**
   * FIX-26: latest YYYY-MM-DD inside the selected range where this campaign
   * actually ran (spend>0). Used by CampaignsTableRow to render the "currently
   * off" chip when the row's last-active day is older than a recency threshold.
   * Null when the campaign has zero spend across the entire range (the row
   * still appears because impressions/conversions/value alone are enough to
   * survive existing filters, but we can't infer "was active" from those).
   */
  lastActiveDate: string | null;
};

export function aggregate(
  rows: CampaignRow[],
  mode: AggregateMode,
  storeFilter: string,
  platformFilter: AggregatePlatformFilter,
  range: DateRange,
): Aggregated[] {
  const map = new Map<string, Aggregated>();
  // Per-key "latest budget date" trackers so overwrite depends on the row's
  // `date`, NOT iteration order (#IN-02 — backfilled past dates appended to
  // sheet end would otherwise stamp stale budgets as current).
  const latestBudgetDate = new Map<string, string>();
  const latestAdSetBudgetDate = new Map<string, string>();
  const latestBudgetTypeDate = new Map<string, string>();
  for (const r of rows) {
    if (r.date < range.from || r.date > range.to) continue;
    // IN-07 (5.2.2.1, deferred): storeFilter is matched by DISPLAY NAME
    // (`r.storeName`), not store id. STORE_TAB_CONFIG in lib/campaigns.ts
    // currently keeps all names unique ('uzoshop', 'Zol Plus', '360usmile'),
    // so the filter is correct today. If a future store with a duplicate
    // display name is added, rows from both stores would aggregate together.
    // FIX-03 already migrated the DRILLDOWN to storeId; the toolbar filter
    // pipeline needs the same migration (thread storeId through Filters →
    // CampaignsTable → here). Tracked as a future-phase refactor.
    if (storeFilter !== 'All' && r.storeName !== storeFilter) continue;
    if (platformFilter !== 'all' && r.platform !== platformFilter) continue;

    const key =
      mode === 'campaign'
        ? `${r.storeId}::${r.platform}::${r.campaignId}`
        : `${r.storeId}::${r.platform}::${r.campaignId}::${r.adSetId}`;

    if (!map.has(key)) {
      map.set(key, {
        key,
        storeId: r.storeId,
        storeName: r.storeName,
        platform: r.platform,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        adSetId: mode === 'adset' ? r.adSetId : undefined,
        adSetName: mode === 'adset' ? r.adSetName : undefined,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
        // Seed budgets with this row's values; loop below picks the latest.
        campaignBudgetCad: r.campaignBudgetCad,
        adSetBudgetCad: mode === 'adset' ? r.adSetBudgetCad : null,
        budgetType: r.budgetType,
        lastActiveDate: null,
      });
      if (r.campaignBudgetCad != null) latestBudgetDate.set(key, r.date);
      if (mode === 'adset' && r.adSetBudgetCad != null) latestAdSetBudgetDate.set(key, r.date);
      if (r.budgetType) latestBudgetTypeDate.set(key, r.date);
    }
    const a = map.get(key)!;
    a.spend += r.spend;
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    a.conversions += r.conversions;
    a.conversionValue += r.conversionValue;
    // FIX-26: track the latest day with actual spend so the row can render
    // "currently off · last DD/MM" when this date is older than today−N days.
    // Strict > matches the FIX-13 tie-break policy (first-write-wins on
    // duplicate dates). We gate on spend>0 specifically because a row can
    // appear with impressions/conversions but zero spend (refund-only days
    // after the campaign was paused).
    if (r.spend > 0) {
      if (!a.lastActiveDate || r.date > a.lastActiveDate) {
        a.lastActiveDate = r.date;
      }
    }
    // Budget = chronologically latest row's value (#IN-02 — see above).
    // FIX-13 (5.2.2.1): strict > (not >=) so duplicate-date rows preserve the
    // first-observed budget per write order; later writes for the same date are
    // ignored. The previous comment claimed the policy decoupled from write
    // order entirely, which it doesn't — write order still breaks ties when
    // two rows share a date; strict > just picks the FIRST of those rather
    // than the LAST. Both choices are deterministic; "first" matches what
    // Apps Script's `appendRow` semantics would naturally produce.
    if (r.campaignBudgetCad != null) {
      const prev = latestBudgetDate.get(key);
      if (!prev || r.date > prev) {
        a.campaignBudgetCad = r.campaignBudgetCad;
        latestBudgetDate.set(key, r.date);
      }
    }
    if (mode === 'adset' && r.adSetBudgetCad != null) {
      const prev = latestAdSetBudgetDate.get(key);
      if (!prev || r.date > prev) {
        a.adSetBudgetCad = r.adSetBudgetCad;
        latestAdSetBudgetDate.set(key, r.date);
      }
    }
    if (r.budgetType) {
      const prev = latestBudgetTypeDate.get(key);
      if (!prev || r.date > prev) {
        a.budgetType = r.budgetType;
        latestBudgetTypeDate.set(key, r.date);
      }
    }
  }
  // FIX-06 (5.2.2.1): normalize budget shape to match the chronologically-latest budgetType.
  // Must run as a SECOND PASS — inlining inside the per-row loop would produce wrong results for mixed-type rows mid-iteration.
  // Row component renders `null` cleanly as `—`, so no UI change needed.
  for (const a of map.values()) {
    if (a.budgetType === 'ABO') a.campaignBudgetCad = null;
    if (a.budgetType === 'CBO') a.adSetBudgetCad = null;
  }
  return Array.from(map.values());
}
