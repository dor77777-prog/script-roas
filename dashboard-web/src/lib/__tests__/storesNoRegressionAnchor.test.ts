import { describe, it, expect, vi, beforeEach } from 'vitest';
const db = vi.hoisted(() => ({ data: null as null | unknown[], error: null as null | { message: string } }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: () => ({ select: () => Promise.resolve({ data: db.data, error: db.error }) }) }) }));
import { getStores } from '@/lib/getStores';
import { STORE_ID_TO_NAME } from '@/lib/platformsByStore';
import { STORE_COLORS } from '@/lib/storeColors';
import { TIKTOK_SHARED_STORES } from '@/lib/adState';

// NOTE on `hasTikTok`: it means "advertises on TikTok (incl. via the shared
// account)" and aligns with TIKTOK_SHARED_STORES (['uzoshop','usmile360']) +
// the shipped ads-off `applicablePlatforms`. This is a DIFFERENT concept from
// `STORES_WITH_TIKTOK_IDS` (uzoshop-only = "has its OWN TikTok cron fetch").
// Phases 3/4 must NOT derive STORES_WITH_TIKTOK_IDS from hasTikTok.

const SEEDED = [
  { id: 'uzoshop',   name: 'uzoshop',   brand_color: 'var(--store-uzo)', is_headless: false, has_tiktok: true,  status: 'active', display_order: 1 },
  { id: 'zolplus',   name: 'Zol Plus',  brand_color: 'var(--store-3)',   is_headless: false, has_tiktok: false, status: 'active', display_order: 2 },
  { id: 'usmile360', name: '360usmile', brand_color: 'var(--store-usm)', is_headless: true,  has_tiktok: true,  status: 'active', display_order: 3 },
];
beforeEach(() => { db.data = SEEDED; db.error = null; });

describe('getStores — zero-regression equality anchor (DB == hardcoded for the 3)', () => {
  it('storeName matches STORE_ID_TO_NAME for each of the 3', async () => {
    for (const s of await getStores()) expect(s.storeName).toBe(STORE_ID_TO_NAME[s.storeId as keyof typeof STORE_ID_TO_NAME]);
  });
  it('brandColor matches STORE_COLORS (keyed by display name) for each of the 3', async () => {
    for (const s of await getStores()) expect(s.brandColor).toBe(STORE_COLORS[s.storeName]);
  });
  it('hasTikTok matches TIKTOK_SHARED_STORES (advertises-on-TikTok set) for each of the 3', async () => {
    const shared = new Set<string>(TIKTOK_SHARED_STORES);
    for (const s of await getStores()) expect(s.hasTikTok).toBe(shared.has(s.storeId));
  });
});
