// dashboard-web/src/lib/getStores.ts
// THE single source for the store list. Reads active stores from the `stores`
// table; FALLS BACK to the canonical hardcoded 3 if the read fails/empty — so a
// DB blip never changes behavior. Consumed (Phase 2+) by every store-list site.
import { getSupabase } from '@/lib/supabase';

export type StoreStatus = 'active' | 'archived';
export interface StoreInfo {
  storeId: string;
  storeName: string;
  brandColor: string | null;
  isHeadless: boolean;
  hasTikTok: boolean;
  status: StoreStatus;
  displayOrder: number;
}

/** Canonical fallback — matches the seeded DB rows exactly (zero-regression). */
const HARDCODED: StoreInfo[] = [
  { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: 'var(--store-uzo)', isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1 },
  { storeId: 'zolplus',   storeName: 'Zol Plus',  brandColor: 'var(--store-3)',   isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 2 },
  { storeId: 'usmile360', storeName: '360usmile', brandColor: 'var(--store-usm)', isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 3 },
];

export async function getStores(opts?: { includeArchived?: boolean }): Promise<StoreInfo[]> {
  try {
    const { data, error } = await getSupabase()
      .from('stores')
      .select('id, name, brand_color, is_headless, has_tiktok, status, display_order');
    if (error) throw new Error(error.message);
    if (data && data.length) {
      const rows: StoreInfo[] = (data as Record<string, unknown>[]).map((r) => ({
        storeId: String(r.id),
        storeName: String(r.name ?? ''),
        brandColor: (r.brand_color as string) ?? null,
        isHeadless: r.is_headless === true,
        hasTikTok: r.has_tiktok === true,
        status: (r.status === 'archived' ? 'archived' : 'active') as StoreStatus,
        displayOrder: Number(r.display_order ?? 999),
      })).sort((a, b) => a.displayOrder - b.displayOrder || a.storeId.localeCompare(b.storeId));
      const filtered = opts?.includeArchived ? rows : rows.filter((s) => s.status === 'active');
      if (filtered.length) return filtered;
    }
  } catch (e) {
    console.warn('getStores: DB read failed, using hardcoded fallback:', e instanceof Error ? e.message : e);
  }
  return opts?.includeArchived ? HARDCODED : HARDCODED.filter((s) => s.status === 'active');
}

/** Cron-side convenience: just the active store ids (DB → hardcoded fallback). */
export async function loadActiveStoreIds(): Promise<string[]> {
  return (await getStores()).map((s) => s.storeId);
}
