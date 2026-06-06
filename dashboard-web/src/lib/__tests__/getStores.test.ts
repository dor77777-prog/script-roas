import { describe, it, expect, vi, beforeEach } from 'vitest';
const db = vi.hoisted(() => ({ data: null as null | unknown[], error: null as null | { message: string } }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: () => ({ select: () => Promise.resolve({ data: db.data, error: db.error }) }) }) }));
import { getStores, loadActiveStoreIds } from '@/lib/getStores';
beforeEach(() => { db.data = null; db.error = null; });

describe('getStores — DB then hardcoded fallback', () => {
  it('falls back to the hardcoded 3 when the DB read fails', async () => {
    db.error = { message: 'down' };
    expect((await getStores()).map(x => x.storeId)).toEqual(['uzoshop', 'zolplus', 'usmile360']);
  });
  it('falls back to hardcoded when the DB returns empty', async () => {
    db.data = [];
    expect((await getStores()).length).toBe(3);
  });
  it('returns active DB stores sorted by display_order, excluding archived by default', async () => {
    db.data = [
      { id: 'b', name: 'B', brand_color: null, is_headless: false, has_tiktok: false, status: 'active', display_order: 2 },
      { id: 'a', name: 'A', brand_color: null, is_headless: false, has_tiktok: false, status: 'active', display_order: 1 },
      { id: 'z', name: 'Z', brand_color: null, is_headless: false, has_tiktok: false, status: 'archived', display_order: 3 },
    ];
    expect((await getStores()).map(x => x.storeId)).toEqual(['a', 'b']);
    expect((await getStores({ includeArchived: true })).map(x => x.storeId)).toEqual(['a', 'b', 'z']);
  });
  it('DB with only archived rows → returns [] (authoritative, NOT the hardcoded fallback)', async () => {
    db.data = [
      { id: 'a', name: 'A', brand_color: null, is_headless: false, has_tiktok: false, status: 'archived', display_order: 1 },
    ];
    expect(await getStores()).toEqual([]); // must NOT resurrect the hardcoded 3
    expect((await getStores({ includeArchived: true })).map(x => x.storeId)).toEqual(['a']);
  });
  it('loadActiveStoreIds returns just the ids (fallback path)', async () => {
    db.error = { message: 'down' };
    expect(await loadActiveStoreIds()).toEqual(['uzoshop', 'zolplus', 'usmile360']);
  });
  it('maps DB columns to the StoreInfo shape', async () => {
    db.data = [{ id: 'uzoshop', name: 'uzoshop', brand_color: 'var(--store-uzo)', is_headless: false, has_tiktok: true, status: 'active', display_order: 1 }];
    const s = (await getStores())[0];
    expect(s).toMatchObject({ storeId: 'uzoshop', storeName: 'uzoshop', brandColor: 'var(--store-uzo)', isHeadless: false, hasTikTok: true, status: 'active' });
  });
});
