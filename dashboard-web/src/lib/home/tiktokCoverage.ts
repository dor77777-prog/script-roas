// dashboard-web/src/lib/home/tiktokCoverage.ts
//
// DQ-7 — TikTok account-vs-per-campaign coverage (pure helper).
//
// TikTok runs a single shared ad account. Its campaigns are attributed to
// individual stores via the campaign-store-map (see campaignStoreMap.ts):
// a campaign is keyed by `tiktok::<advertiserId>::<campaignId>` and the
// default store is 'uzoshop', remappable per campaign (ARCHITECTURE §A.5).
//
// This deterministic helper surfaces two data-quality signals for the Home
// view:
//   1. unmappedCampaignIds — campaigns with NO store-map entry AND no
//      default-store fallback applied (i.e. they would be dropped from
//      per-store rollups).
//   2. unattributedSpendCad — the account-level total spend that is NOT
//      covered by any per-campaign row. Mirrors the INV-7 invariant
//      (audit/reconcile.ts): for TikTok the account-level figure can exceed
//      Σ per-campaign (lag) OR per-campaign can over-report vs the account
//      total. We only flag the account-EXCEEDS-Σ case and CLAMP to ≥ 0 so a
//      campaign over-report never yields a negative "unattributed" number.
//
// Pure: no network, no DB, no React, no mutation of inputs.

import { campaignStoreKey } from '@/lib/campaignStoreMap';

export interface TiktokCoverageInput {
  /** Account-level total spend (CAD) for the period — data_daily TikTok column. */
  accountTotalCad: number;
  /** Per-campaign rows pulled from campaigns_daily (TikTok). */
  campaigns: Array<{ campaignId: string; advertiserId: string; spendCad: number }>;
  /** campaign-store-map blob: `tiktok::<advertiserId>::<campaignId>` → storeId. */
  storeMap: Record<string, string>;
  /**
   * Optional default store. When provided, a campaign with no explicit map
   * entry still counts as "mapped" (mirrors resolveStoreForCampaign's
   * `?? defaultStoreId`). Production passes 'uzoshop'.
   */
  defaultStoreId?: string;
}

export interface TiktokCoverageResult {
  /** Campaign ids with no store-map entry and no default-store fallback. */
  unmappedCampaignIds: string[];
  /** Σ spend of campaigns that resolved to a store. */
  mappedSpendCad: number;
  /** max(0, accountTotalCad − Σ all-campaign spend) — never negative. */
  unattributedSpendCad: number;
}

export function tiktokCoverage(input: TiktokCoverageInput): TiktokCoverageResult {
  const { accountTotalCad, campaigns, storeMap, defaultStoreId } = input;

  const unmappedCampaignIds: string[] = [];
  let mappedSpendCad = 0;
  let totalCampaignSpendCad = 0;

  for (const c of campaigns) {
    totalCampaignSpendCad += c.spendCad;
    const key = campaignStoreKey('tiktok', c.advertiserId, c.campaignId);
    const isMapped =
      typeof storeMap[key] === 'string' || typeof defaultStoreId === 'string';
    if (isMapped) {
      mappedSpendCad += c.spendCad;
    } else {
      unmappedCampaignIds.push(c.campaignId);
    }
  }

  // INV-7 tolerance: account-level can lag or lead Σ per-campaign. Only the
  // account-EXCEEDS-Σ surplus is "unattributed"; clamp the over-report case
  // (Σ > account) to 0 so we never report a negative figure.
  const unattributedSpendCad = Math.max(0, accountTotalCad - totalCampaignSpendCad);

  return { unmappedCampaignIds, mappedSpendCad, unattributedSpendCad };
}
