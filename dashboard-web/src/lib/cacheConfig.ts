/**
 * Single source of truth for API route cache settings. Each entry pairs
 * `revalidate` (server-side ISR window in seconds) with `swr` (CDN
 * stale-while-revalidate window). The `cacheControl(key)` helper returns
 * the corresponding `Cache-Control` header value.
 *
 * Adding a new route: extend `CACHE_CONFIG`, then use both
 * `CACHE_CONFIG[key].revalidate` for `export const revalidate` and
 * `cacheControl(key)` for the response header.
 */

export const CACHE_CONFIG = {
  data: { revalidate: 60, swr: 120 },
  campaigns: { revalidate: 60, swr: 120 },
  products: { revalidate: 60, swr: 120 },
  ads: { revalidate: 300, swr: 900 },
  ordersAttribution: { revalidate: 300, swr: 900 },
  storeMeta: { revalidate: 3600, swr: 86400 },
  productCatalog: { revalidate: 60, swr: 300 },
  // dashboardState revalidate raised from 10s → 30s (WR-05). With 3 partners
  // × 2 tabs polling + Vercel edge fan-out, a 10s window could push us past
  // Google Sheets' default 60 reads/min quota. CDN coalescing only dedupes
  // within s-maxage (the revalidate value), not within the swr window, so
  // raising revalidate is what actually cuts read pressure. State changes
  // are user-driven (no background mutation), so 30s still feels instant
  // for cloud-sync; swr stays at 60 to keep stale-content tolerance high.
  dashboardState: { revalidate: 30, swr: 60 },
} as const;

export type CacheKey = keyof typeof CACHE_CONFIG;

export function cacheControl(key: CacheKey): string {
  const { revalidate, swr } = CACHE_CONFIG[key];
  return `public, s-maxage=${revalidate}, stale-while-revalidate=${swr}`;
}
