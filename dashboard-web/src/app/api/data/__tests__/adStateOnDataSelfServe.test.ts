/**
 * Self-serve stores — /api/data must derive TikTok applicability from
 * stores.has_tiktok (getStores), NOT the hardcoded TIKTOK_SHARED_STORES, so a
 * 4th store with has_tiktok=true gets 'tiktok' in storeApplicablePlatforms.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/postgresReaders', () => ({
  fetchDailyDataFromPostgres: vi.fn(async () => []),
  fetchDataDailyLastWriteAt: vi.fn(async () => null),
  fetchAdSpendFreshness: vi.fn(async () => ({ meta: null, google: null, tiktok: null })),
  fetchAdStateFromPostgres: vi.fn(async () => ({})),
  fetchStoreMetaFromPostgres: vi.fn(async () => [
    { storeId: 'pdrn-skin', storeName: 'pdrn skin', metaAdAccountId: '9', googleAdsCustomerId: null, tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
  ]),
}));
vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));
vi.mock('@/lib/getStores', () => ({
  getStores: vi.fn(async () => [
    { storeId: 'pdrn-skin', storeName: 'pdrn skin', brandColor: 'var(--store-7)', isHeadless: true, hasTikTok: true, status: 'active', displayOrder: 4, enableCustomerJourney: false },
  ]),
  loadActiveStoreIds: vi.fn(async () => ['pdrn-skin']),
}));
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch);

import { GET } from '@/app/api/data/route';
import { __resetPlatformsByStoreCache } from '@/lib/platformsByStore';

describe('/api/data — self-serve TikTok applicability', () => {
  it("includes 'tiktok' for a 4th store with has_tiktok=true (meta+tiktok)", async () => {
    __resetPlatformsByStoreCache();
    const res = await GET(new Request('http://x/api/data?from=2026-06-01&to=2026-06-06'));
    const body = await res.json();
    expect([...body.storeApplicablePlatforms['pdrn-skin']].sort()).toEqual(['meta', 'tiktok']);
  });
});
