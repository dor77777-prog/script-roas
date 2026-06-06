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
import { fetchDailyDataFromPostgres } from '@/lib/postgresReaders';

describe('/api/data attaches ad-state', () => {
  it('returns adStateMap + storeApplicablePlatforms', async () => {
    const res = await GET(new Request('http://x/api/data?from=2026-06-01&to=2026-06-06'));
    const body = await res.json();
    expect(body.adStateMap).toEqual({ 'zolplus:meta': false });
    expect([...body.storeApplicablePlatforms.uzoshop].sort()).toEqual(['google', 'meta', 'tiktok']);
    expect(body.storeApplicablePlatforms.zolplus).toEqual(['meta']);
  });

  it('degraded-error path still returns the two fields as empty (never undefined)', async () => {
    vi.mocked(fetchDailyDataFromPostgres).mockRejectedValueOnce(new Error('boom'));
    const res = await GET(new Request('http://x/api/data?from=2026-06-01&to=2026-06-06'));
    expect(res.status).toBe(200); // graceful 200-with-empty-rows
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.error).toBeTruthy();
    expect(body.adStateMap).toEqual({});
    expect(body.storeApplicablePlatforms).toEqual({});
  });
});
