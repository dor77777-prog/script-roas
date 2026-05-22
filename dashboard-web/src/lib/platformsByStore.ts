/**
 * Phase 05.7.x — single source of truth for "which ad platforms are
 * configured on each store". The backend cron pipelines + the dashboard
 * UI both consume this so a new platform integration (or de-integration)
 * only has to be wired in one place.
 *
 * Currently TikTok is uzoshop-only — matches `STORES_WITH_TIKTOK` in
 * cronDaily.ts and cronLive.ts. Meta + Google are universal (all three
 * stores have them).
 *
 * `store` here matches the human-readable store NAME (the same string
 * that flows through `DailyRow.storeName` and into the dashboard's
 * per-store cards). The backend uses the storeId variant in the Set;
 * both literals are listed in `STORE_ID_TO_NAME` below for cases where
 * the caller has the ID but needs the name (or vice versa).
 */

export const STORE_NAMES = ['uzoshop', 'Zol Plus', '360usmile'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

/**
 * Stores with an active TikTok Ads integration (advertiser + access
 * token configured in Vercel env vars + writer enabled in cron-daily +
 * cron-live). Other stores have `tt_spend_cad = 0` indefinitely and
 * shouldn't render a TikTok column at all (it would always show 0).
 */
export const STORES_WITH_TIKTOK: ReadonlySet<StoreName> = new Set([
  'uzoshop',
]);

/**
 * Convenience predicate so callers don't have to import the Set
 * directly. Returns true when the store has TikTok wired up — meaning
 * a TikTok metric column should be rendered (even if today's value is
 * zero, the column header still appears, the same way Google renders
 * with a '—' on zero days).
 */
export function storeHasTikTok(store: string | undefined | null): boolean {
  if (!store) return false;
  return STORES_WITH_TIKTOK.has(store as StoreName);
}
