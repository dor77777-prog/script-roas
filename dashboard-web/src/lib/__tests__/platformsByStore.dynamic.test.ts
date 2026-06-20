import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the `stores` DB read that getStores() sits on top of, so we can stage a
// 4th active store (pdrn-skin) and prove the dynamic resolvers surface it.
const db = vi.hoisted(() => ({
  data: null as null | unknown[],
  error: null as null | { message: string },
}));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({ select: () => Promise.resolve({ data: db.data, error: db.error }) }),
  }),
}));

import {
  storeIdToName,
  getStoresWithTikTokIdSet,
  getStoresWithTikTokNameSet,
  storeHasTikTok,
  STORE_ID_TO_NAME,
  __resetPlatformsByStoreCache,
} from '@/lib/platformsByStore';

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

describe('storeIdToName — dynamic display-name resolution', () => {
  it('returns the DISPLAY name (not the slug) for a 4th active DB store', async () => {
    expect(await storeIdToName('pdrn-skin')).toBe('pdrn skin');
  });

  it('still returns the canonical names for the existing 3', async () => {
    expect(await storeIdToName('uzoshop')).toBe('uzoshop');
    expect(await storeIdToName('zolplus')).toBe('Zol Plus');
    expect(await storeIdToName('usmile360')).toBe('360usmile');
  });

  it('falls back to the static map for the 3 when the DB read fails (byte-identical)', async () => {
    db.error = { message: 'down' };
    __resetPlatformsByStoreCache();
    expect(await storeIdToName('uzoshop')).toBe('uzoshop');
    expect(await storeIdToName('zolplus')).toBe('Zol Plus');
    expect(await storeIdToName('usmile360')).toBe('360usmile');
  });

  it('falls back to the id itself for an unknown store not in the DB', async () => {
    expect(await storeIdToName('ghost-store')).toBe('ghost-store');
  });
});

describe('dynamic TikTok membership — derived from stores.has_tiktok', () => {
  it('getStoresWithTikTokIdSet includes the 4th store (has_tiktok=true) by id', async () => {
    const set = await getStoresWithTikTokIdSet();
    expect(set.has('pdrn-skin')).toBe(true);
    expect(set.has('uzoshop')).toBe(true);
    expect(set.has('usmile360')).toBe(true);
    expect(set.has('zolplus')).toBe(false);
  });

  it('getStoresWithTikTokNameSet includes the 4th store by DISPLAY name', async () => {
    const set = await getStoresWithTikTokNameSet();
    expect(set.has('pdrn skin')).toBe(true);
    expect(set.has('uzoshop')).toBe(true);
    expect(set.has('360usmile')).toBe(true);
    expect(set.has('Zol Plus')).toBe(false);
  });

  it('storeHasTikTok honors an explicit dynamic set (by name)', async () => {
    const set = await getStoresWithTikTokNameSet();
    expect(storeHasTikTok('pdrn skin', set)).toBe(true);
    expect(storeHasTikTok('Zol Plus', set)).toBe(false);
  });
});

describe('zero-regression — static fallback map for the legacy 3', () => {
  it('STORE_ID_TO_NAME static map is unchanged for the 3', () => {
    expect(STORE_ID_TO_NAME.uzoshop).toBe('uzoshop');
    expect(STORE_ID_TO_NAME.zolplus).toBe('Zol Plus');
    expect(STORE_ID_TO_NAME.usmile360).toBe('360usmile');
  });
});
