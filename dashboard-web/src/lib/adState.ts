// dashboard-web/src/lib/adState.ts
//
// ads-off (2026-06-06) — single source of truth for "is advertising ON for a
// (store, platform)". Pure helpers; consumed by crons, readers, UI, alerts,
// WhatsApp. See docs/superpowers/specs/2026-06-06-ads-off-state-design.md.
import type { StoreMetaRow } from '@/lib/postgresReaders';

export type AdPlatform = 'meta' | 'google' | 'tiktok';

/** `${storeId}:${platform}` → enabled. Missing key ⇒ ON (true). */
export type AdStateMap = Record<string, boolean>;

/** Stores that share uzoshop's single TikTok ad account (Phase A.5 v2). The
 *  account is fetched once + split per-store via campaignStoreMap. */
export const TIKTOK_SHARED_STORES = ['uzoshop', 'usmile360'] as const;

export function adStateKey(storeId: string, platform: AdPlatform): string {
  return `${storeId}:${platform}`;
}

/** ON unless an explicit `false` row exists. */
export function isAdsEnabled(map: AdStateMap, storeId: string, platform: AdPlatform): boolean {
  return map[adStateKey(storeId, platform)] !== false;
}

/** Platforms a store actually advertises on — derived from live config, never
 *  hardcoded. Meta: has a Meta ad account. Google: has a Google customer id.
 *  TikTok: member of the shared-account set (`tiktokStores`). */
export function applicablePlatforms(store: StoreMetaRow, tiktokStores: Set<string>): AdPlatform[] {
  const out: AdPlatform[] = [];
  if (store.metaAdAccountId) out.push('meta');
  if (store.googleAdsCustomerId) out.push('google');
  if (tiktokStores.has(store.storeId)) out.push('tiktok');
  return out;
}

/** The shared TikTok account fetch is needed unless TikTok is OFF for EVERY
 *  store on the account (otherwise an off store would kill the others' data). */
export function tiktokAccountFetchEnabled(map: AdStateMap): boolean {
  return TIKTOK_SHARED_STORES.some((s) => isAdsEnabled(map, s, 'tiktok'));
}
