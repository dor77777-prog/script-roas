// dashboard-web/src/app/api/store-meta/__tests__/route.test.ts
//
// Phase A.5 — verify the route enriches each StoreMetaRow with
// `tiktokAdvertiserId`. The postgres reader returns null; the route resolves
// the value (trimmed) or keeps null when unset.
//
// Phase 3B (Task 8) — the source switched from a direct env read
// (`${STORE.toUpperCase()}_TIKTOK_ADVERTISER_ID`) to getStoreSecret (per-store
// DB→env dual-read). These tests now drive a mocked getStoreSecret keyed by
// `${storeId}|${key}`; the `?.trim() || null` semantics + response shape are
// unchanged (client-facing value identical).
//
// Critical for the CampaignDrawer's TikTok store-mapping section —
// without the enrichment, the dropdown is permanently disabled and
// the operator cannot tag campaigns.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/postgresReaders', () => ({
  fetchStoreMetaFromPostgres: vi.fn(),
}));
vi.mock('@/lib/sentry/capture', () => ({
  captureRouteError: vi.fn(),
}));

// In-test secret map keyed by `${storeId}|${key}`, mirroring getStoreSecret's
// resolved-string-or-null contract.
const secretMap = new Map<string, string>();
vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: vi.fn(
    async (storeId: string, key: string): Promise<string | null> =>
      secretMap.get(`${storeId}|${key}`) ?? null,
  ),
}));

import { GET } from '../route';
import { fetchStoreMetaFromPostgres } from '@/lib/postgresReaders';
import { getStoreSecret } from '@/lib/storeSecretsReader';

function baseRow(storeId: string) {
  return {
    storeId,
    storeName: storeId,
    planDisplayName: '',
    shopifyPlus: false,
    partnerDevelopment: false,
    updatedAt: null,
    lastError: null,
    metaAdAccountId: null,
    googleAdsCustomerId: null,
    tiktokAdvertiserId: null, // reader returns null per Phase A.5 design
  };
}

describe('/api/store-meta enrichment (Phase A.5)', () => {
  beforeEach(() => {
    (fetchStoreMetaFromPostgres as ReturnType<typeof vi.fn>).mockReset();
    secretMap.clear();
    vi.mocked(getStoreSecret).mockClear();
  });
  afterEach(() => {
    secretMap.clear();
  });

  it('enriches tiktokAdvertiserId via getStoreSecret(storeId, "TIKTOK_ADVERTISER_ID")', async () => {
    (fetchStoreMetaFromPostgres as ReturnType<typeof vi.fn>).mockResolvedValue([
      baseRow('uzoshop'),
      baseRow('usmile360'),
    ]);
    secretMap.set('uzoshop|TIKTOK_ADVERTISER_ID', '7123456789');
    // usmile360 has no secret — should stay null

    const res = await GET();
    const body = await res.json();

    expect(body.rows).toHaveLength(2);
    const uzo = body.rows.find((r: { storeId: string }) => r.storeId === 'uzoshop');
    const usm = body.rows.find((r: { storeId: string }) => r.storeId === 'usmile360');
    expect(uzo.tiktokAdvertiserId).toBe('7123456789');
    expect(usm.tiktokAdvertiserId).toBeNull();
    expect(getStoreSecret).toHaveBeenCalledWith('uzoshop', 'TIKTOK_ADVERTISER_ID');
    expect(getStoreSecret).toHaveBeenCalledWith('usmile360', 'TIKTOK_ADVERTISER_ID');
  });

  it('trims whitespace from the resolved secret value', async () => {
    (fetchStoreMetaFromPostgres as ReturnType<typeof vi.fn>).mockResolvedValue([
      baseRow('uzoshop'),
    ]);
    secretMap.set('uzoshop|TIKTOK_ADVERTISER_ID', '  7123456789  \n');

    const res = await GET();
    const body = await res.json();
    expect(body.rows[0].tiktokAdvertiserId).toBe('7123456789');
  });

  it('treats an empty-string secret as null (not "")', async () => {
    (fetchStoreMetaFromPostgres as ReturnType<typeof vi.fn>).mockResolvedValue([
      baseRow('uzoshop'),
    ]);
    secretMap.set('uzoshop|TIKTOK_ADVERTISER_ID', '');

    const res = await GET();
    const body = await res.json();
    expect(body.rows[0].tiktokAdvertiserId).toBeNull();
  });

  it('preserves all other StoreMetaRow fields verbatim from the reader (shape unchanged)', async () => {
    const row = {
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      planDisplayName: 'Shopify Plus',
      shopifyPlus: true,
      partnerDevelopment: false,
      updatedAt: '2026-05-29T00:00:00Z',
      lastError: null,
      metaAdAccountId: '26442930835313109',
      googleAdsCustomerId: '4014537400',
      tiktokAdvertiserId: null,
    };
    (fetchStoreMetaFromPostgres as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    secretMap.set('uzoshop|TIKTOK_ADVERTISER_ID', '7123456789');

    const res = await GET();
    const body = await res.json();
    expect(body.rows[0]).toEqual({ ...row, tiktokAdvertiserId: '7123456789' });
  });

  it('returns 200 with empty rows on reader error (does not break the dashboard)', async () => {
    (fetchStoreMetaFromPostgres as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('connection refused'),
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.error).toBeTruthy();
  });
});
