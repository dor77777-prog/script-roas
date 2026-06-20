/**
 * Self-serve stores — end-to-end proof that a 4th ACTIVE store from getStores()
 * flows through the rendering / name-mapping / TikTok-gating layers:
 *   (a) toPerStoreData produces a per-store CARD for it,
 *   (b) the TikTok gating honors its has_tiktok (via the dynamic name set),
 *   (c) the name resolver returns its DISPLAY name (not the slug) for its id.
 *
 * This is the feature-level guard: it would fail if any layer regressed to a
 * hardcoded-3 gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ data: null as null | unknown[], error: null as null | { message: string } }));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: () => ({ select: () => Promise.resolve({ data: db.data, error: db.error }) }) }),
}));

import { getStores } from '@/lib/getStores';
import {
  storeIdToName,
  getStoresWithTikTokNameSet,
  __resetPlatformsByStoreCache,
} from '@/lib/platformsByStore';
import { toPerStoreData } from '@/lib/home/adapters';
import type { StoreAgg } from '@/lib/analytics';
import type { CampaignsResponse } from '@/app/api/campaigns/route';

const SEEDED_4 = [
  { id: 'uzoshop',   name: 'uzoshop',   brand_color: 'var(--store-uzo)', is_headless: false, has_tiktok: true,  status: 'active', display_order: 1 },
  { id: 'zolplus',   name: 'Zol Plus',  brand_color: 'var(--store-3)',   is_headless: false, has_tiktok: false, status: 'active', display_order: 2 },
  { id: 'usmile360', name: '360usmile', brand_color: 'var(--store-usm)', is_headless: true,  has_tiktok: true,  status: 'active', display_order: 3 },
  { id: 'pdrn-skin', name: 'pdrn skin', brand_color: 'var(--store-7)',   is_headless: true,  has_tiktok: true,  status: 'active', display_order: 4 },
];

beforeEach(() => {
  db.data = SEEDED_4;
  db.error = null;
  __resetPlatformsByStoreCache();
});

function makeRow(o: Partial<CampaignsResponse['rows'][number]>): CampaignsResponse['rows'][number] {
  return {
    date: '2026-05-10', storeName: 'pdrn skin', storeId: 'pdrn-skin', platform: 'Meta',
    spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, ...o,
  } as unknown as CampaignsResponse['rows'][number];
}
function agg(o: Partial<StoreAgg> & { store: string }): StoreAgg {
  return {
    revenue: 0, grossRevenue: 0, spend: 0, fbSpend: 0, gaSpend: 0, ttSpend: 0,
    roas: 0, grossProfit: 0, cogs: 0, netProfit: 0, transactionFees: 0, fixedCosts: 0, salaries: 0,
    storeCount: 1, daysCovered: 1, trueNetProfit: 0, trueMargin: 0, ...o,
  } as unknown as StoreAgg;
}

describe('self-serve 4th store — end-to-end flow', () => {
  it('getStores returns the 4th active store with has_tiktok', async () => {
    const stores = await getStores();
    const pdrn = stores.find((s) => s.storeId === 'pdrn-skin');
    expect(pdrn).toBeDefined();
    expect(pdrn!.storeName).toBe('pdrn skin');
    expect(pdrn!.hasTikTok).toBe(true);
  });

  it('(c) name resolver returns the DISPLAY name for the 4th store id', async () => {
    expect(await storeIdToName('pdrn-skin')).toBe('pdrn skin');
  });

  it('(a)+(b) toPerStoreData produces a card with its TikTok CPM honoring has_tiktok', async () => {
    const tiktokNames = await getStoresWithTikTokNameSet();
    expect(tiktokNames.has('pdrn skin')).toBe(true); // (b) gating honors has_tiktok

    const storeAggs: StoreAgg[] = [agg({ store: 'pdrn skin', revenue: 4000, grossRevenue: 4000, spend: 1200, roas: 3.3 })];
    const rows: CampaignsResponse['rows'] = [
      makeRow({ platform: 'TikTok', spend: 500, impressions: 100_000 }),
      makeRow({ platform: 'Meta',   spend: 700, impressions: 140_000 }),
    ];
    const result = toPerStoreData(
      storeAggs, rows, { from: '2026-05-01', to: '2026-05-31' },
      { 'pdrn skin': 40 }, { 'pdrn skin': 'pdrn-skin' },
      null, undefined, undefined, {}, {}, undefined, tiktokNames,
    );
    expect(result.length).toBe(1); // (a) a card exists
    expect(result[0].storeId).toBe('pdrn-skin');
    expect(result[0].storeName).toBe('pdrn skin');
    expect(result[0].perPlatformCpm.tiktok?.spend).toBe(500);
  });
});
