// Phase A.5 v2 evening hotfix #7 (2026-05-29 night) — historical TikTok
// campaign↔store mapping backfill.
//
// Background: persistCampaignsLive + cronDaily DELETE-then-UPSERT the
// per-row campaigns_daily / ads_daily slices only for the (date, store_id)
// being persisted this tick (today + yesterday for cron-live-heavy; today
// + yesterday for cron-daily). Older rows under the pre-mapping store_id
// stay in place after the operator changes a campaign's effective store
// → the agg_tiktok_spend_per_store_for_date RPC sums them under both the
// stale store_id AND the new one, double-counting in the data_daily
// monthly tables.
//
// Backfill plan: read the campaign-store-map blob from dashboard_state,
// reduce it to per-campaign target store_id steps, then have the runner
// UPDATE campaigns_daily + ads_daily for all historical dates AND re-run
// the agg RPC for the affected dates.

export type BackfillStep = {
  campaignId: string;
  targetStoreId: string;
};

/**
 * Pure helper — converts the campaign-store-map blob (stored in
 * dashboard_state.value as `Record<storeMapKey, storeId>`) into the
 * list of per-campaign backfill steps for the TikTok platform.
 *
 * Map key shape: `${platform}::${advertiserId}::${campaignId}`. We only
 * touch TikTok rows because Meta + Google advertisers are 1:1 with stores
 * (no historical store_id divergence is possible).
 *
 * Defensive against:
 *   - Malformed keys (< 3 parts, empty parts)
 *   - Empty target storeId values
 *   - Duplicate `(campaignId, targetStoreId)` pairs across different
 *     advertiserIds in the same map (collapsed to one step — the UPDATE
 *     filter ignores advertiserId so running twice is wasted work).
 */
export type StaleRow = {
  date: string;
  store_id: string;
  ad_set_id?: string;
  ad_id?: string;
};

export type ClassifiedStaleRows<R extends StaleRow> = {
  toDelete: R[];
  toUpdate: R[];
};

/**
 * Splits the set of stale (non-target store_id) rows into two buckets:
 *
 *   toDelete — rows whose `(date, conflictKey)` already exists at the
 *              target store. UPDATE-to-target would violate the PK
 *              (date, store_id, ..., conflictKey); the right move is to
 *              DELETE the stale duplicate. cron-live-heavy / cron-daily
 *              already wrote the correct row at the target store.
 *
 *   toUpdate — rows with no counterpart at the target store. UPDATE is
 *              safe: it moves the historical row to the new store_id
 *              without colliding. (Typical for dates older than the
 *              rolling 2-day window of cron-live-heavy.)
 *
 * Pure: no DB calls. Caller does the SELECTs and passes both arrays in.
 *
 * `conflictKey` is the per-table PK component that's not date or
 * store_id: `'ad_set_id'` for campaigns_daily, `'ad_id'` for ads_daily.
 */
export function classifyStaleRows<R extends StaleRow>(
  stale: R[],
  target: R[],
  conflictKey: 'ad_set_id' | 'ad_id',
): ClassifiedStaleRows<R> {
  const targetSet = new Set<string>();
  for (const t of target) {
    const k = t[conflictKey];
    if (k === undefined) continue;
    targetSet.add(`${t.date}::${k}`);
  }
  const toDelete: R[] = [];
  const toUpdate: R[] = [];
  for (const s of stale) {
    const k = s[conflictKey];
    if (k === undefined) {
      toUpdate.push(s);
      continue;
    }
    if (targetSet.has(`${s.date}::${k}`)) {
      toDelete.push(s);
    } else {
      toUpdate.push(s);
    }
  }
  return { toDelete, toUpdate };
}

export function extractTikTokMappingSteps(
  storeMap: Record<string, string>,
): BackfillStep[] {
  const seen = new Set<string>();
  const out: BackfillStep[] = [];
  for (const [key, targetStoreId] of Object.entries(storeMap)) {
    if (!targetStoreId) continue;
    const parts = key.split('::');
    if (parts.length !== 3) continue;
    const [platform, advertiserId, campaignId] = parts;
    if (platform !== 'tiktok') continue;
    if (!advertiserId || !campaignId) continue;
    const dedupeKey = `${campaignId}::${targetStoreId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ campaignId, targetStoreId });
  }
  return out;
}
