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
  // 2026-06-03: tightened 300/900 → 60/120 to MATCH `data` so the Home cards
  // sourced from orders-attribution (order counts, NC-ROAS, attribution
  // coverage, per-store counts) refresh in lock-step with revenue/spend
  // instead of lagging up to 5-15 min. cron-live now writes today's orders
  // every ~10 min, so a 60s server window is appropriate (not "written daily").
  ordersAttribution: { revalidate: 60, swr: 120 },
  // Wave 2 (2026-06-03) cohort/LTV aggregate. The customer_cohort_monthly
  // table is a weekly full-replace (cron-cohort-refresh) of slow-moving
  // strategic data — a 5-min server ISR window + 15-min CDN swr is plenty
  // fresh and keeps the customer-value tab from burning Supabase quota on
  // every poll. Mirrors the ordersAttribution window.
  cohorts: { revalidate: 300, swr: 900 },
  // תשלומים (2026-06-03) payment-method (gateway) per-month aggregate. Sources
  // orders_attribution.payment_gateway — the SAME table that backs
  // ordersAttribution — so it refreshes in lock-step (cron-live writes today's
  // orders every ~10 min). Mirror the ordersAttribution window (60/120).
  paymentMethods: { revalidate: 60, swr: 120 },
  storeMeta: { revalidate: 3600, swr: 86400 },
  // ads-off: the toggle changes rarely (operator action) → same cadence as storeMeta.
  adState: { revalidate: 3600, swr: 86400 },
  // self-serve stores: the store list changes rarely (add/archive) → short ISR.
  stores: { revalidate: 60, swr: 300 },
  productCatalog: { revalidate: 60, swr: 300 },
  // dashboardState revalidate raised from 10s → 30s (WR-05). With 3 partners
  // × 2 tabs polling + Vercel edge fan-out, a 10s window could push us past
  // Google Sheets' default 60 reads/min quota. CDN coalescing only dedupes
  // within s-maxage (the revalidate value), not within the swr window, so
  // raising revalidate is what actually cuts read pressure. State changes
  // are user-driven (no background mutation), so 30s still feels instant
  // for cloud-sync; swr stays at 60 to keep stale-content tolerance high.
  dashboardState: { revalidate: 30, swr: 60 },
  // Phase 05.5 D-D3: health endpoint pings sheets + supabase every 30s
  // (SWR refreshInterval on the client). Server-side ISR window is 10s so
  // the response can be fresher than the dashboardState route. swr=60
  // covers the gap between client polls + CDN coalescing.
  health: { revalidate: 10, swr: 60 },
  // Phase 05.6-15 operator console CRUD. NOTE: the actual route uses
  // `dynamic = 'force-dynamic'` (no `revalidate`) because the operator is
  // editing rows in real time and any cached list would surface stale data
  // immediately after an add/delete (Pitfall 11 — never combine
  // force-dynamic with revalidate). This entry exists so the cache
  // contract is documented centrally — a future plan that adds a separate
  // read-only "live overrides" surface (e.g. for the main dashboard's
  // /api/data path to pre-fetch the overrides used in spend reconciliation)
  // can pull `cacheControl('manualOverrides')` from here without
  // re-deciding the window. revalidate=0 / swr=0 makes any accidental
  // use of `cacheControl('manualOverrides')` on the CRUD route a no-op
  // rather than a silent staleness bug.
  manualOverrides: { revalidate: 0, swr: 0 },
  // Phase 05.6-13 operator console Inngest jobs proxy. Client polls
  // /api/operator/jobs every 15s (D-D3). Server caches 5s so concurrent
  // tabs / SWR mutate() bursts get coalesced by the CDN within the
  // polling window without serving stale-by-more-than-one-tick data.
  // swr=30 covers the gap when the operator opens a tab after a brief
  // idle and lets the CDN return the previous payload while
  // re-fetching. Together these match RESEARCH §Pattern 6 lines 766-832
  // and the threat-model mitigation T-05.6-13-D3 (CDN coalescing across
  // multiple tabs to avoid Inngest REST quota burn).
  operatorJobs: { revalidate: 5, swr: 30 },
} as const;

export type CacheKey = keyof typeof CACHE_CONFIG;

export function cacheControl(key: CacheKey): string {
  const { revalidate, swr } = CACHE_CONFIG[key];
  return `public, s-maxage=${revalidate}, stale-while-revalidate=${swr}`;
}
