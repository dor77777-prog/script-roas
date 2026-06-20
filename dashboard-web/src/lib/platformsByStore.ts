/**
 * Phase 05.7.x — single source of truth for "which ad platforms are
 * configured on each store". The backend cron pipelines + the dashboard
 * UI both consume this so a new platform integration (or de-integration)
 * only has to be wired in one place.
 *
 * Self-serve stores (Phase 2+): the canonical store enumeration now lives in
 * the `stores` DB table (read via `getStores()`); a store added there appears
 * everywhere with no deploy. The static maps/sets below are kept ONLY as a
 * zero-regression fallback for the legacy 3 (uzoshop / zolplus / usmile360) so
 * a DB blip is byte-identical to the pre-self-serve behavior. The DYNAMIC
 * resolvers (`storeIdToName`, `getStoresWithTikTok*`) are what new code should
 * call; they fall back to the static maps when the DB read fails.
 *
 * `store` here matches the human-readable store NAME (the same string
 * that flows through `DailyRow.storeName` and into the dashboard's
 * per-store cards). The backend uses the storeId variant in the Set;
 * both literals are listed in `STORE_ID_TO_NAME` below for cases where
 * the caller has the ID but needs the name (or vice versa).
 */

import { getStores } from '@/lib/getStores';

export const STORE_NAMES = ['uzoshop', 'Zol Plus', '360usmile'] as const;
export type StoreName = string;

/**
 * Backend StoreId. Widened to `string` for self-serve stores (Phase 2) —
 * runtime identity comes from `getStores()`. Re-exported from the single
 * canonical definition in `registries/types.ts` so there is exactly ONE
 * `StoreId` type across the codebase.
 */
export type { StoreId } from '@/lib/registries/types';
import type { StoreId } from '@/lib/registries/types';

/**
 * StoreId → display StoreName STATIC fallback map. Covers the legacy 3 only.
 * The DYNAMIC resolver `storeIdToName(id)` (below) reads `getStores()` first so
 * a self-serve store gets its DB display name; this map is the fallback when
 * the DB read fails AND for the synchronous legacy call-sites that still index
 * it directly. The cron name-write path (shopify.ts) uses the async resolver so
 * a new store's `data_daily` rows carry its DISPLAY name, not its slug.
 */
export const STORE_ID_TO_NAME: Record<string, string> = {
  uzoshop: 'uzoshop',
  zolplus: 'Zol Plus',
  usmile360: '360usmile',
};

/**
 * Stores with an active TikTok Ads integration (advertiser + access
 * token configured in Vercel env vars + writer enabled in cron-daily +
 * cron-live). Other stores have `tt_spend_cad = 0` indefinitely and
 * shouldn't render a TikTok column at all (it would always show 0).
 *
 * NOTE (zero-regression anchor): this STATIC set is the "has its OWN TikTok
 * cron fetch" membership (uzoshop-only). It is INTENTIONALLY distinct from the
 * "advertises on TikTok incl. via the shared account" membership
 * (`getStoresWithTikTok*` / `stores.has_tiktok`), which also includes usmile360
 * (shared account) and any self-serve store with `has_tiktok=true`. See
 * `storesNoRegressionAnchor.test.ts` — do NOT derive this set from has_tiktok.
 */
export const STORES_WITH_TIKTOK: ReadonlySet<StoreName> = new Set([
  'uzoshop',
]);

/**
 * Backend (StoreId) counterpart to `STORES_WITH_TIKTOK`. Used by cron
 * functions whose handlers operate on the lowercase storeId — kept in
 * sync with `STORES_WITH_TIKTOK` above (both must list the same physical
 * stores; they only differ in the literal form).
 */
export const STORES_WITH_TIKTOK_IDS: ReadonlySet<StoreId> = new Set<StoreId>([
  'uzoshop',
]);

// ───────────────────────────────────────────────────────────────────────────
// Dynamic resolvers (self-serve stores). These read getStores() (DB → hardcoded
// fallback) and cache the result per process so cron/server callers can resolve
// a new store's DISPLAY name + TikTok membership without a hardcoded list.
// ───────────────────────────────────────────────────────────────────────────

let _storesCache: Awaited<ReturnType<typeof getStores>> | null = null;

async function loadStoresCached(): Promise<Awaited<ReturnType<typeof getStores>>> {
  if (_storesCache) return _storesCache;
  const stores = await getStores();
  _storesCache = stores;
  return stores;
}

/** Test-only: clear the per-process store cache between cases. */
export function __resetPlatformsByStoreCache(): void {
  _storesCache = null;
}

/**
 * Resolve a store's DISPLAY name from its id, DB-first.
 *
 * Resolution order:
 *   1. `getStores()` (DB → hardcoded fallback) — a self-serve store gets its
 *      operator-chosen `stores.name` (e.g. 'pdrn skin', not the slug
 *      'pdrn-skin').
 *   2. `STORE_ID_TO_NAME` static map — byte-identical fallback for the legacy 3
 *      if the store somehow isn't in the loaded list.
 *   3. the id itself — never throws / never writes 'unknown'.
 */
export async function storeIdToName(id: string): Promise<string> {
  try {
    const stores = await loadStoresCached();
    const hit = stores.find((s) => s.storeId === id);
    if (hit && hit.storeName) return hit.storeName;
  } catch {
    // fall through to the static map — DB blip stays byte-identical for the 3.
  }
  return STORE_ID_TO_NAME[id] ?? id;
}

/**
 * Set of store IDS that advertise on TikTok (incl. via the shared account),
 * derived from `stores.has_tiktok`. This is the "advertises on TikTok"
 * membership — distinct from the static `STORES_WITH_TIKTOK_IDS` ("has its own
 * cron fetch", uzoshop-only). Used by UI gates (ad-state matrix, per-store CPM)
 * so a self-serve store with `has_tiktok=true` (e.g. pdrn) renders TikTok.
 */
export async function getStoresWithTikTokIdSet(): Promise<Set<string>> {
  try {
    const stores = await loadStoresCached();
    return new Set(stores.filter((s) => s.hasTikTok).map((s) => s.storeId));
  } catch {
    return new Set<string>(STORES_WITH_TIKTOK_IDS);
  }
}

/** Name-keyed counterpart of `getStoresWithTikTokIdSet` (keyed by DISPLAY name,
 *  matching the strings that flow through `DailyRow.storeName`). */
export async function getStoresWithTikTokNameSet(): Promise<Set<string>> {
  try {
    const stores = await loadStoresCached();
    return new Set(stores.filter((s) => s.hasTikTok).map((s) => s.storeName));
  } catch {
    return new Set<string>(STORES_WITH_TIKTOK);
  }
}

/**
 * Convenience predicate so callers don't have to import the Set
 * directly. Returns true when the store has TikTok wired up — meaning
 * a TikTok metric column should be rendered (even if today's value is
 * zero, the column header still appears, the same way Google renders
 * with a '—' on zero days).
 *
 * Pass an explicit `tiktokStores` set (from `getStoresWithTikTokNameSet()`) to
 * honor self-serve stores; without it, falls back to the static legacy set so
 * existing synchronous callers stay byte-identical.
 */
export function storeHasTikTok(
  store: string | undefined | null,
  tiktokStores?: ReadonlySet<string>,
): boolean {
  if (!store) return false;
  if (tiktokStores) return tiktokStores.has(store);
  return STORES_WITH_TIKTOK.has(store);
}
