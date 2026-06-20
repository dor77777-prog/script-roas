// dashboard-web/src/lib/adState.ts
//
// ads-off (2026-06-06) — single source of truth for "is advertising ON for a
// (store, platform)". Pure helpers; consumed by crons, readers, UI, alerts,
// WhatsApp. See docs/superpowers/specs/2026-06-06-ads-off-state-design.md.
import type { StoreMetaRow } from '@/lib/postgresReaders';
import type { RoasBand } from '@/lib/format/useRoasBandGradient';

export type AdPlatform = 'meta' | 'google' | 'tiktok';

/** `${storeId}:${platform}` → enabled. Missing key ⇒ ON (true). */
export type AdStateMap = Record<string, boolean>;

/** Stores that share uzoshop's single TikTok ad account (Phase A.5 v2). The
 *  account is fetched once + split per-store via campaignStoreMap.
 *
 *  SCOPE (self-serve stores): this is the SHARED-ACCOUNT FETCH membership — a
 *  config fact about which stores live on uzoshop's ONE TikTok advertiser
 *  account. It is the ONLY thing `tiktokAccountFetchEnabled` gates on, and it is
 *  INTENTIONALLY static + distinct from the "advertises on TikTok" set
 *  (`getStoresWithTikTok*` in platformsByStore, derived from stores.has_tiktok).
 *  A self-serve store with has_tiktok=true (e.g. pdrn, with its OWN account) is
 *  in the "advertises" set but NOT here — it does not share uzoshop's account.
 *  Do NOT derive this from has_tiktok (see storesNoRegressionAnchor). */
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

export type AdDisplayState = 'normal' | 'organic' | 'off-empty' | 'off-negative';

/** A per-store surface counts as "off" only when ALL its applicable platforms
 *  are toggled off — a partially-off store still advertises (remaining spend),
 *  so it must render a normal ROAS. */
export function isStoreFullyOff(
  storeId: string,
  map: AdStateMap,
  applicable: readonly AdPlatform[],
): boolean {
  if (!applicable || applicable.length === 0) return false;
  return applicable.every((p) => !isAdsEnabled(map, storeId, p));
}

/** Off-display classifier. Off-state ONLY applies when intentionally off AND
 *  spend is 0 — so a historical row that carried real spend before the toggle
 *  (spend>0) stays 'normal' and is never retroactively rewritten. */
export function adDisplayState(opts: {
  revenue: number | null;
  spend: number | null;
  off: boolean;
}): AdDisplayState {
  const spend = opts.spend ?? 0;
  if (!opts.off || spend !== 0) return 'normal';
  const rev = opts.revenue ?? 0;
  if (rev > 0) return 'organic';
  if (rev < 0) return 'off-negative';
  return 'off-empty';
}

/** Returns true when an insight should be suppressed because its store/platform
 *  is currently off. Per-platform insights: suppressed when that specific
 *  (storeId, platform) is off. Store-level insights (no platform): suppressed
 *  only when ALL applicable platforms for that store are off. If the insight
 *  has no storeId, it is never suppressed (cross-platform / product insights). */
export function isInsightSuppressedByAdState(
  ins: { storeId?: string; platform?: AdPlatform | string },
  map: AdStateMap,
  applicable: Record<string, AdPlatform[]>,
): boolean {
  if (!ins.storeId) return false;
  if (ins.platform) {
    // Insight.platform is title-case ('Meta','Google','TikTok'); AdPlatform is
    // lowercase — normalise before the map lookup.
    return !isAdsEnabled(map, ins.storeId, ins.platform.toLowerCase() as AdPlatform);
  }
  return isStoreFullyOff(ins.storeId, map, applicable[ins.storeId] ?? []);
}

/** Off-state → band override (reusing existing AA-cleared bands). Returns null
 *  for 'normal' so callers keep their existing numeric-band logic. */
export function adDisplayBand(state: AdDisplayState): RoasBand | null {
  switch (state) {
    case 'organic':
      return 'blue';
    case 'off-empty':
    case 'off-negative':
      return 'gray';
    default:
      return null;
  }
}
