/**
 * Type-only re-export contract preserved post-Phase-11 cutover (READ_FROM=postgres permanent).
 *
 * The Google Sheets reader (`fetchCampaignsData`) was deleted in Phase 12.4
 * as dead-at-runtime code. The `CampaignRow` shape is still consumed by:
 *   - `/api/campaigns/route.ts`
 *   - `components/CampaignDrawer.tsx`
 *   - `components/MetaShopifyReconciliation.tsx`
 *   - `components/WhatsWorking.tsx`
 *   - `lib/hooks/useCampaignAttribution.ts`
 *   - `lib/hooks/useCampaignTrueRevenue.ts`
 *
 * Authoritative reader: `lib/postgresReaders.fetchCampaignsFromPostgres`.
 */

export type CampaignRow = {
  date: string;
  storeId: string;
  storeName: string;
  platform: 'Meta' | 'Google' | string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  spend: number;            // CAD
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;  // CAD — revenue attributed by the platform
  /** Daily budget at the campaign level (CAD). Populated only when the
   *  campaign uses CBO (Campaign Budget Optimization). null/0 means either
   *  the budget is at the ad-set level (ABO) or unknown. */
  campaignBudgetCad: number | null;
  /** Daily budget at the ad-set level (CAD). Populated only when the
   *  ad-set itself owns the budget (ABO). null/0 means CBO or unknown. */
  adSetBudgetCad: number | null;
  /** Budget allocation type. 'CBO' = campaign owns budget. 'ABO' = ad-set
   *  owns budget. '' / undefined = unknown (paused / lifetime-only / Google). */
  budgetType: 'CBO' | 'ABO' | '';
  /**
   * Phase 05.7.x — platform-native effective status fetched alongside
   * insights:
   *   Meta:   ACTIVE / PAUSED / CAMPAIGN_PAUSED / ARCHIVED / ADSET_PAUSED / ...
   *   Google: ENABLED / PAUSED / REMOVED
   *   TikTok: ADGROUP_STATUS_DELIVERY_OK / ADGROUP_STATUS_DISABLE / ...
   * NULL = unknown (older row written before the column existed, or the
   *   platform's status fetcher soft-failed). The dashboard's "כבוי" chip
   *   uses this when present and falls back to the 2-day lastActiveDate
   *   heuristic when null, so existing rows keep working until the next
   *   cron tick backfills the field.
   */
  effectiveStatus: string | null;
  /**
   * Phase A (2026-05-29) / Phase C (2026-05-30) — ISO timestamp of the
   * most recent live-tick that wrote this row. Populated by cron-live
   * (`cronLive.ts:persistCampaignsLive`) and Phase C's meta/google/tiktok
   * hot-metrics workers; NULL on rows persisted before the column was
   * added (migration 20260530100002) or by writers that don't tag rows
   * with a live tick (e.g. cron-daily nightly job).
   *
   * Consumed by the row's `CampaignFreshnessChip` to render an
   * at-a-glance "data is X minutes old" indicator next to the campaign
   * name. Optional on the type because every reader downstream of this
   * shape works fine with `undefined`, but `fetchCampaignsFromPostgres`
   * sets it explicitly to either the ISO string or null.
   */
  lastLiveTickAt?: string | null;
  /**
   * Phase D (2026-05-30) — registry-backed status fields. Joined server-side
   * via the `campaigns_enriched` VIEW. Always non-null in production after
   * Migration B's trigger guarantees coverage, but typed as nullable for
   * defensive parsing.
   */
  regConfiguredStatus: string | null;
  regEffectiveStatus: string | null;
  regDeliveryStatus: string | null;
  regFirstSeenAt: string | null;
  regStatusChangedAt: string | null;
  regLastStatusSuccessAt: string | null;
};
