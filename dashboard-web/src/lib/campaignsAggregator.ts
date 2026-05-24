// TEST-03 (5.2.2.1): extracted from CampaignsTable.tsx for testability.
// Preserve the existing FIX-06 second-pass normalization and FIX-13 strict > policy.
import type { CampaignRow } from './campaigns';
import type { DateRange } from './dateRange';

export type AggregateMode = 'campaign' | 'adset';
export type AggregatePlatformFilter = 'all' | 'Meta' | 'Google' | 'TikTok';

/**
 * Phase 12.5.x (2026-05-24) — "parent-disabled" marker statuses. These can
 * ONLY appear on an ad-set when its parent CAMPAIGN is paused / disabled at
 * the parent level. Even a single ad-set showing this status is authoritative:
 * the parent is paused, period.
 *
 * Operator-reported (2026-05-24): when an operator pauses a Meta campaign at
 * the campaign level, cron-live's UPDATE pass refreshes the ad-set rows over
 * a few ticks. During the transient, some ad-sets show `CAMPAIGN_PAUSED` and
 * others still show stale `ACTIVE`. The campaign-mode roll-up was picking
 * `ACTIVE` ("any active wins"), missing the operator's intent. Same pattern
 * on TikTok with `ADGROUP_STATUS_CAMPAIGN_DISABLE`.
 *
 * Fix: when ANY ad-set has a parent-disabled status, surface that status as
 * the campaign-level effectiveStatus (so the off-chip fires). This beats the
 * "any active wins" rule because parent-disabled is platform-authoritative
 * — Meta/TikTok would NOT emit it unless the parent is actually paused.
 *
 * Google doesn't have an analogous child marker (ad-group `status` stays
 * ENABLED even when the parent campaign is paused — Google requires a
 * separate campaign-level fetch). For now Google's campaign-level off is
 * detected only when the ad-group itself is paused.
 */
function isParentDisabled(platform: string, status: string): boolean {
  const platformNorm = platform.toLowerCase();
  const norm = status.trim().toUpperCase();
  if (platformNorm === 'meta') return norm === 'CAMPAIGN_PAUSED';
  if (platformNorm === 'tiktok') return norm === 'ADGROUP_STATUS_CAMPAIGN_DISABLE';
  return false;
}

/**
 * Phase 12.5.x (2026-05-24, operator clarification) — platform-canonical
 * "active" status, used to force the campaign-mode off-chip OFF when no
 * parent-disabled marker is present. Returns null for unknown platforms
 * (caller leaves the in-range latest value untouched).
 */
function activeMarkerForPlatform(platform: string): string | null {
  const platformNorm = platform.toLowerCase();
  if (platformNorm === 'meta') return 'ACTIVE';
  if (platformNorm === 'google') return 'ENABLED';
  if (platformNorm === 'tiktok') return 'ADGROUP_STATUS_DELIVERY_OK';
  return null;
}

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
  /**
   * Phase 05.7.x — platform-native effective status (Meta PAUSED / ACTIVE,
   * Google ENABLED / PAUSED, TikTok ADGROUP_STATUS_DISABLE / DELIVERY_OK).
   * Surfaced into the aggregate as the LATEST non-null value across rows
   * by date — status is current-at-fetch-time and doesn't actually vary
   * per day, but late-arriving rows from cronDaily can backfill a NULL.
   * Used by CampaignsTableRow to drive the "כבוי" chip on real status
   * instead of the 2-day lastActiveDate heuristic; falls back to the
   * heuristic when this is null (old data / fetcher soft-failed).
   */
  effectiveStatus: string | null;
};

export function aggregate(
  rows: CampaignRow[],
  mode: AggregateMode,
  storeFilter: string,
  platformFilter: AggregatePlatformFilter,
  range: DateRange,
  /**
   * Phase 12.5.x (2026-05-24) — optional map of CURRENT platform-native
   * statuses, keyed by `${storeId}::${Platform}::${campaignId}::${adSetId}`.
   * Returned by /api/campaigns (`fetchCurrentCampaignStatuses`) and reflects
   * the absolute-latest status DB-wide, NOT bounded by `range`. When supplied,
   * the post-pass below overrides each aggregate's `effectiveStatus` with
   * this map's value. Decouples the "כבוי" chip from cron-live latency: a
   * campaign paused yesterday shows the chip even on last-month views,
   * regardless of whether cron-live has refreshed the in-range historical
   * rows yet. Omitted → existing in-range-latest behavior, fully backwards
   * compatible.
   */
  currentEffectiveStatus?: Record<string, string>,
): Aggregated[] {
  const map = new Map<string, Aggregated>();
  // Per-key "latest budget date" trackers so overwrite depends on the row's
  // `date`, NOT iteration order (#IN-02 — backfilled past dates appended to
  // sheet end would otherwise stamp stale budgets as current).
  const latestBudgetDate = new Map<string, string>();
  const latestAdSetBudgetDate = new Map<string, string>();
  const latestBudgetTypeDate = new Map<string, string>();
  // Phase 05.7.x — same chronologically-latest-wins policy as the
  // budget trackers above, for effective_status. Status is current-at-
  // fetch-time so the LATEST date's row is the authoritative state.
  const latestEffectiveStatusDate = new Map<string, string>();
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
        effectiveStatus: r.effectiveStatus,
      });
      if (r.campaignBudgetCad != null) latestBudgetDate.set(key, r.date);
      if (mode === 'adset' && r.adSetBudgetCad != null) latestAdSetBudgetDate.set(key, r.date);
      if (r.budgetType) latestBudgetTypeDate.set(key, r.date);
      if (r.effectiveStatus) latestEffectiveStatusDate.set(key, r.date);
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
    // Phase 05.7.x — chronologically-latest effective_status wins.
    // Skip null rows so a late-arriving NULL can't clobber a known
    // status from an earlier write (the column was added by migration
    // 20260522180000; rows persisted before that day return null).
    if (r.effectiveStatus) {
      const prev = latestEffectiveStatusDate.get(key);
      if (!prev || r.date > prev) {
        a.effectiveStatus = r.effectiveStatus;
        latestEffectiveStatusDate.set(key, r.date);
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
  // Phase 12.5.x (2026-05-24) — override effectiveStatus with the absolute-
  // latest DB status (per `currentEffectiveStatus`), so the "כבוי" chip
  // reflects "currently off in the platform", not "the in-range status as
  // of when the rows were last written". See param JSDoc above for the
  // operator-reported TikTok case this fixes.
  //
  // Mode handling:
  //   - 'adset': direct lookup by `storeId::Platform::campaignId::adSetId`.
  //   - 'campaign': roll up the campaign's ad-sets. The campaign is "active"
  //     if ANY ad-set is currently delivering; otherwise "off" (use the
  //     first non-null status as the off-marker for the chip).
  //
  // If no entry exists for the key/campaign, we leave the in-range
  // status unchanged (handles 60-day-old paused campaigns + soft-fail).
  if (currentEffectiveStatus && Object.keys(currentEffectiveStatus).length > 0) {
    if (mode === 'adset') {
      for (const a of map.values()) {
        const key = `${a.storeId}::${a.platform}::${a.campaignId}::${a.adSetId ?? ''}`;
        const cur = currentEffectiveStatus[key];
        if (cur) a.effectiveStatus = cur;
      }
    } else {
      // Index the map by campaign prefix so each campaign rolls up in O(M)
      // total rather than O(N×M) per-aggregate scans.
      const byCampaign = new Map<string, string[]>();
      for (const [k, status] of Object.entries(currentEffectiveStatus)) {
        const parts = k.split('::');
        if (parts.length !== 4) continue;
        const campKey = `${parts[0]}::${parts[1]}::${parts[2]}`;
        let bucket = byCampaign.get(campKey);
        if (!bucket) {
          bucket = [];
          byCampaign.set(campKey, bucket);
        }
        bucket.push(status);
      }
      for (const a of map.values()) {
        const campKey = `${a.storeId}::${a.platform}::${a.campaignId}`;
        const statuses = byCampaign.get(campKey);
        if (!statuses || statuses.length === 0) continue;
        // Phase 12.5.x (2026-05-24, operator clarification):
        //   "Ad-set off ≠ campaign off. Even if an ad-set is on, a paused
        //    PARENT is stronger and forces no delivery."
        //
        // The off chip on a CAMPAIGN row reflects the parent campaign's
        // pause state — NOT an aggregate of its ad-sets' states. Rule:
        //
        //   1. ANY child has a "parent-disabled" status (Meta:
        //      CAMPAIGN_PAUSED, TikTok: ADGROUP_STATUS_CAMPAIGN_DISABLE)
        //      → operator paused at the campaign level → off chip.
        //      Authoritative even if other children still report ACTIVE
        //      (cron-live's UPDATE pass propagates ad-set-by-ad-set;
        //      one stale ACTIVE child should not mask the campaign pause).
        //
        //   2. Otherwise → campaign is RUNNING (per the platform). Some
        //      ad-sets might be individually paused (status='PAUSED' on
        //      Meta, 'ADGROUP_STATUS_DISABLE' on TikTok), but that does
        //      not mean the campaign is off — the operator paused those
        //      ad-sets, not the campaign. Force an active marker so the
        //      off chip does not fire in campaign mode.
        //
        // In ad-set mode each row has its OWN status (not rolled up), so
        // the off chip there continues to reflect the ad-set's own pause
        // — that's the right level of granularity for that view.
        const parentDisabled = statuses.find(s => isParentDisabled(a.platform, s));
        if (parentDisabled) {
          a.effectiveStatus = parentDisabled;
        } else {
          const activeMarker = activeMarkerForPlatform(a.platform);
          if (activeMarker) a.effectiveStatus = activeMarker;
        }
      }
    }
  }
  return Array.from(map.values());
}
