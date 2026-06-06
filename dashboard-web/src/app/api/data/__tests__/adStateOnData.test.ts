import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/postgresReaders', () => ({
  fetchDailyDataFromPostgres: vi.fn(async () => []),
  fetchDataDailyLastWriteAt: vi.fn(async () => null),
  fetchAdStateFromPostgres: vi.fn(async () => ({ 'zolplus:meta': false })),
  fetchStoreMetaFromPostgres: vi.fn(async () => [
    { storeId: 'uzoshop', storeName: 'uzoshop', metaAdAccountId: '1', googleAdsCustomerId: '2', tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
    { storeId: 'zolplus', storeName: 'Zol Plus', metaAdAccountId: '1', googleAdsCustomerId: null, tiktokAdvertiserId: null, planDisplayName: '', shopifyPlus: false, partnerDevelopment: false, updatedAt: null, lastError: null },
  ]),
}));
vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch);

import { GET } from '@/app/api/data/route';

describe('/api/data attaches ad-state', () => {
  it('returns adStateMap + storeApplicablePlatforms', async () => {
    const res = await GET(new Request('http://x/api/data?from=2026-06-01&to=2026-06-06'));
    const body = await res.json();
    expect(body.adStateMap).toEqual({ 'zolplus:meta': false });
    expect([...body.storeApplicablePlatforms.uzoshop].sort()).toEqual(['google', 'meta', 'tiktok']);
    expect(body.storeApplicablePlatforms.zolplus).toEqual(['meta']);
  });
});
