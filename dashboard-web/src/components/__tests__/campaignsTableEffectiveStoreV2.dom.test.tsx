// dashboard-web/src/components/__tests__/campaignsTableEffectiveStoreV2.dom.test.tsx
//
// Phase A.5 v2 post-deploy fix (2026-05-29) — unit tests for the
// effectiveStoreByRowKey + mappedCampaignKeys logic added to CampaignsTable.
//
// Two bugs fixed:
//   Bug A: After tagging a TikTok campaign to a different store via the drawer,
//          the row still shows the OLD store name until cron-live-heavy migrates
//          campaigns_daily (~30 min). Fix: override storeId+storeName at the
//          row-prop level using effectiveStoreByRowKey.
//
//   Bug B: After mapping products via the drawer, the "🏷️ לא ממופה" chip stays
//          on because productMap is keyed by effectiveStoreId but the chip's
//          lookup uses the row's data-side storeId. Fix: same storeId swap above
//          makes the chip's lookup match the productMap key.
//
// Strategy: pure helper approach.
// The effectiveStoreByRowKey logic is extracted into a standalone function
// below that mirrors the useMemo in CampaignsTable exactly. We test ONLY that
// function — no DOM rendering, no SWR mocks, no Next.js stubs needed.
//
// Four cases covered:
//   1. TikTok tagged campaign → effective storeId + storeName returned.
//   2. TikTok untagged campaign → NO entry (passes through unchanged).
//   3. Meta campaign → NO entry (Meta advertisers are 1:1 with stores).
//   4. Google campaign → NO entry (Google advertisers are 1:1 with stores).

import { describe, it, expect } from 'vitest';
import { campaignStoreKey } from '@/lib/campaignStoreMap';

// ---------------------------------------------------------------------------
// Pure helper — mirrors the useMemo in CampaignsTable.tsx.
// If the logic in CampaignsTable changes, update this mirror too.
// ---------------------------------------------------------------------------
type AggRow = {
  key: string;
  platform: string;
  campaignId: string;
  storeId: string;
};

function buildEffectiveStoreByRowKey(
  aggregated: AggRow[],
  storeMap: Record<string, string>,
  adAccounts: Record<string, { tiktokAdvertiserId?: string | null }>,
  displayNames: Record<string, string>,
): Map<string, { storeId: string; storeName: string }> {
  const out = new Map<string, { storeId: string; storeName: string }>();
  for (const a of aggregated) {
    if (a.platform !== 'TikTok') continue;
    const advertiserId = adAccounts[a.storeId]?.tiktokAdvertiserId ?? '';
    if (!advertiserId) continue;
    const mapKey = campaignStoreKey('tiktok', advertiserId, a.campaignId);
    const mappedStore = storeMap[mapKey];
    if (mappedStore && mappedStore !== a.storeId) {
      out.set(a.key, {
        storeId: mappedStore,
        storeName: displayNames[mappedStore] ?? mappedStore,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Also mirrors the mappedCampaignKeys + effective-storeId-swap logic.
// In CampaignsTable the swap happens at the row-prop level (displayA),
// so we test the combined effect: chip lookup uses effective storeId.
// ---------------------------------------------------------------------------
function resolveChipVisible(
  row: AggRow,
  effectiveStoreByRowKey: Map<string, { storeId: string; storeName: string }>,
  productMap: Record<string, string[]>,
): boolean {
  // Mirrors CampaignsTableRow chip condition, but with the storeId swap
  // applied (as CampaignsTable now does before passing `a` to the row).
  const eff = effectiveStoreByRowKey.get(row.key);
  const effectiveStoreId = eff ? eff.storeId : row.storeId;
  const chipKey = `${effectiveStoreId}::${row.platform}::${row.campaignId}`;
  const productIds = productMap[chipKey];
  const isMapped = Array.isArray(productIds) && productIds.length > 0;
  return !isMapped;  // true → chip visible; false → chip hidden
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const DISPLAY_NAMES = { uzoshop: 'uzoshop', zolplus: 'Zol Plus', usmile360: '360usmile' };

const AD_ACCOUNTS = {
  uzoshop: { tiktokAdvertiserId: 'TT_ADV_UZO', metaAdAccountId: null, googleAdsCustomerId: null },
  usmile360: { tiktokAdvertiserId: 'TT_ADV_360', metaAdAccountId: null, googleAdsCustomerId: null },
  zolplus: { tiktokAdvertiserId: 'TT_ADV_ZOL', metaAdAccountId: null, googleAdsCustomerId: null },
};

const TIKTOK_TAGGED_ROW: AggRow = {
  key: 'uzoshop::TikTok::C1',
  platform: 'TikTok',
  campaignId: 'C1',
  storeId: 'uzoshop',  // data-side storeId (stale in campaigns_daily)
};

const TIKTOK_UNTAGGED_ROW: AggRow = {
  key: 'uzoshop::TikTok::C2',
  platform: 'TikTok',
  campaignId: 'C2',
  storeId: 'uzoshop',
};

const META_ROW: AggRow = {
  key: 'uzoshop::Meta::C3',
  platform: 'Meta',
  campaignId: 'C3',
  storeId: 'uzoshop',
};

const GOOGLE_ROW: AggRow = {
  key: 'zolplus::Google::C4',
  platform: 'Google',
  campaignId: 'C4',
  storeId: 'zolplus',
};

// storeMap reflects: TikTok campaign C1 (advertiser TT_ADV_UZO) tagged to usmile360
const STORE_MAP: Record<string, string> = {
  [campaignStoreKey('tiktok', 'TT_ADV_UZO', 'C1')]: 'usmile360',
};

// productMap reflects: operator mapped products for C1 under the EFFECTIVE store
const PRODUCT_MAP: Record<string, string[]> = {
  'usmile360::TikTok::C1': ['prod-abc', 'prod-def'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildEffectiveStoreByRowKey — Phase A.5 v2 post-deploy fix', () => {
  const aggregated = [TIKTOK_TAGGED_ROW, TIKTOK_UNTAGGED_ROW, META_ROW, GOOGLE_ROW];

  it('Case 1: TikTok tagged campaign → effective storeId + storeName returned', () => {
    const result = buildEffectiveStoreByRowKey(aggregated, STORE_MAP, AD_ACCOUNTS, DISPLAY_NAMES);

    expect(result.has(TIKTOK_TAGGED_ROW.key)).toBe(true);
    const eff = result.get(TIKTOK_TAGGED_ROW.key)!;
    expect(eff.storeId).toBe('usmile360');
    expect(eff.storeName).toBe('360usmile');
  });

  it('Case 2: TikTok untagged campaign → no entry (passes through unchanged)', () => {
    const result = buildEffectiveStoreByRowKey(aggregated, STORE_MAP, AD_ACCOUNTS, DISPLAY_NAMES);

    expect(result.has(TIKTOK_UNTAGGED_ROW.key)).toBe(false);
  });

  it('Case 3: Meta campaign → no entry (Meta advertisers are 1:1 with stores)', () => {
    const result = buildEffectiveStoreByRowKey(aggregated, STORE_MAP, AD_ACCOUNTS, DISPLAY_NAMES);

    expect(result.has(META_ROW.key)).toBe(false);
  });

  it('Case 4: Google campaign → no entry (Google advertisers are 1:1 with stores)', () => {
    const result = buildEffectiveStoreByRowKey(aggregated, STORE_MAP, AD_ACCOUNTS, DISPLAY_NAMES);

    expect(result.has(GOOGLE_ROW.key)).toBe(false);
  });
});

describe('resolveChipVisible — Bug B: chip hides after product mapping via drawer', () => {
  const aggregated = [TIKTOK_TAGGED_ROW, TIKTOK_UNTAGGED_ROW, META_ROW];
  const effectiveMap = buildEffectiveStoreByRowKey(aggregated, STORE_MAP, AD_ACCOUNTS, DISPLAY_NAMES);

  it('TikTok tagged + products mapped under effectiveStoreId → chip hidden', () => {
    // productMap has 'usmile360::TikTok::C1'; row's data-side storeId is 'uzoshop'
    // Without the storeId swap the chip would stay visible (key mismatch).
    // With the swap the chip lookup uses 'usmile360::TikTok::C1' → hidden.
    const visible = resolveChipVisible(TIKTOK_TAGGED_ROW, effectiveMap, PRODUCT_MAP);
    expect(visible).toBe(false);
  });

  it('TikTok tagged but no products mapped → chip stays visible', () => {
    const visible = resolveChipVisible(TIKTOK_TAGGED_ROW, effectiveMap, {});
    expect(visible).toBe(true);
  });

  it('Meta campaign: products mapped under data-side storeId → chip hidden (unaffected by fix)', () => {
    const metaProductMap: Record<string, string[]> = {
      'uzoshop::Meta::C3': ['prod-xyz'],
    };
    // Meta has no effectiveStoreByRowKey entry; lookup uses original storeId → correct
    const visible = resolveChipVisible(META_ROW, effectiveMap, metaProductMap);
    expect(visible).toBe(false);
  });

  it('Meta campaign: no products mapped → chip visible (unaffected by fix)', () => {
    const visible = resolveChipVisible(META_ROW, effectiveMap, {});
    expect(visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mirrors the mappedCampaignKeys useMemo in CampaignsTable (2026-06-23 ad-set
// fix): an entry with products marks its own key AS WELL AS — for a 4-segment
// ad-set key — its parent 3-segment campaign key, so the campaign row's
// "🏷️ לא ממופה" chip flips off once any of its ad-sets is mapped, even with no
// campaign-level mapping. If the component logic changes, update this mirror.
// ---------------------------------------------------------------------------
function buildMappedCampaignKeys(productMap: Record<string, string[]>): Set<string> {
  const set = new Set<string>();
  for (const [key, productIds] of Object.entries(productMap)) {
    if (!Array.isArray(productIds) || productIds.length === 0) continue;
    set.add(key);
    const parts = key.split('::');
    if (parts.length === 4) set.add(parts.slice(0, 3).join('::'));
  }
  return set;
}

describe('mappedCampaignKeys — ad-set mapping marks the parent campaign mapped (2026-06-23)', () => {
  const CAMP = 'uzoshop::Meta::RETARGETING';

  it('a campaign whose only mapping is at the AD-SET level counts as mapped (chip off)', () => {
    const set = buildMappedCampaignKeys({ [`${CAMP}::ADSET1`]: ['prod-1'] });
    expect(set.has(CAMP)).toBe(true);          // parent campaign → chip hidden
    expect(set.has(`${CAMP}::ADSET1`)).toBe(true);
  });

  it('multiple ad-sets mapped → parent campaign counted once', () => {
    const set = buildMappedCampaignKeys({
      [`${CAMP}::ADSET1`]: ['prod-1'],
      [`${CAMP}::ADSET2`]: ['prod-2'],
    });
    expect(set.has(CAMP)).toBe(true);
  });

  it('no mapping at all → parent campaign NOT in set (chip stays on)', () => {
    const set = buildMappedCampaignKeys({});
    expect(set.has(CAMP)).toBe(false);
  });

  it('an EMPTY ad-set mapping (no products) does not mark the parent', () => {
    const set = buildMappedCampaignKeys({ [`${CAMP}::ADSET1`]: [] });
    expect(set.has(CAMP)).toBe(false);
  });

  it('campaign-level mapping still counts (unchanged behavior)', () => {
    const set = buildMappedCampaignKeys({ [CAMP]: ['prod-1'] });
    expect(set.has(CAMP)).toBe(true);
  });
});
