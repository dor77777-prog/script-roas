// dashboard-web/src/lib/campaignStoreMap.ts
//
// Phase A.5 ROLLED BACK 2026-05-29 — TikTok campaign↔store mapping helpers
// (dormant). Originally mirrored campaignProductMap.ts. After rollback the
// cloud-sync push was removed (the key is off the STATE_KEYS allowlist) so
// only localStorage writes remain. Kept in the codebase for Phase A.5 v2.

const STORAGE_KEY = 'roas-dashboard:campaign-store-map' as const;
const CHANGE_EVENT = 'roas-campaign-store-map-changed' as const;

export type CampaignStoreMap = Record<string, string>;

export function campaignStoreKey(
  platform: 'meta' | 'google' | 'tiktok',
  advertiserId: string,
  campaignId: string,
): string {
  return `${platform}::${advertiserId}::${campaignId}`;
}

export function readCampaignStoreMap(): CampaignStoreMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const clean: CampaignStoreMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') clean[k] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

// Phase A.5 ROLLED BACK 2026-05-29 — pushCloudKey call removed because
// 'roas-dashboard:campaign-store-map' is no longer in cloudSync.STATE_KEYS
// (would type-fail). writeCampaignStoreMap still writes localStorage +
// dispatches the window event so any open browser tab clears its state
// without crashing if a stale caller exists.
export function writeCampaignStoreMap(map: CampaignStoreMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // quota / private mode — ignore
  }
}

export function resolveStoreForCampaign(
  map: CampaignStoreMap,
  platform: 'meta' | 'google' | 'tiktok',
  advertiserId: string,
  campaignId: string,
  defaultStoreId: string,
): string {
  return map[campaignStoreKey(platform, advertiserId, campaignId)] ?? defaultStoreId;
}
