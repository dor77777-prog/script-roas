/**
 * adSpendFreshness.ts — FIX #4 pure helpers.
 *
 * The main-dashboard "LIVE / fresh" chip + per-store/hero desaturation read a
 * single global `data_daily.updated_at` (max). cron-live BUMPS that timestamp
 * every ~10 min on its Shopify-only revenue write — so if the ad-spend workers
 * (meta/google/tiktok) stop while cron-live keeps writing, the chip stayed
 * green and the cards stayed full-saturation over hours-stale ROAS/profit/MER.
 *
 * These helpers fold the AD-SPEND freshness (data_freshness scope =
 * 'campaign_metrics' last_success_at, per platform) into the freshness signal,
 * so the Shopify-only write can never make the card look fresh when ad spend is
 * stale. Pure (no I/O) so they're trivially testable.
 */

import type { AdSpendFreshness } from '@/lib/postgresReaders';

/** Oldest (most-stale) non-null platform timestamp in the ad-spend map; null
 *  when every platform is null (no recorded ad-spend success). */
export function worstAdSpendFreshAt(map: AdSpendFreshness): string | null {
  let worst: { ts: string; ms: number } | null = null;
  for (const ts of [map.meta, map.google, map.tiktok]) {
    if (ts == null) continue;
    const ms = Date.parse(ts);
    if (Number.isNaN(ms)) continue;
    if (worst === null || ms < worst.ms) worst = { ts, ms };
  }
  return worst?.ts ?? null;
}

/**
 * The EFFECTIVE freshness timestamp to feed the chip / per-store desaturation:
 * the OLDEST (most stale) of `dataLastWriteAt` and the worst ad-spend platform.
 *
 * - When ad spend is stale, this returns the stale ad-spend timestamp even if
 *   `dataLastWriteAt` is recent — so a Shopify-only revenue write can never
 *   mask stale ad spend.
 * - When the ad-spend map is missing / all-null (cold start, read failure), it
 *   degrades to `dataLastWriteAt` (prior behavior).
 */
export function effectiveFreshnessAt(
  dataLastWriteAt: string | null,
  adSpendFreshness: AdSpendFreshness | undefined,
): string | null {
  const worstAd = adSpendFreshness ? worstAdSpendFreshAt(adSpendFreshness) : null;
  const candidates: string[] = [];
  if (dataLastWriteAt != null) candidates.push(dataLastWriteAt);
  if (worstAd != null) candidates.push(worstAd);
  if (candidates.length === 0) return null;

  let oldest = candidates[0];
  let oldestMs = Date.parse(oldest);
  for (const ts of candidates.slice(1)) {
    const ms = Date.parse(ts);
    if (Number.isNaN(ms)) continue;
    if (Number.isNaN(oldestMs) || ms < oldestMs) {
      oldest = ts;
      oldestMs = ms;
    }
  }
  return oldest;
}
