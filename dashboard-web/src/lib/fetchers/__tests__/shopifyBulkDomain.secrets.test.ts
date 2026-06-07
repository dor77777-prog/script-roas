/**
 * Phase 3B — Shopify bulk-export utilities resolve the SHOPIFY_DOMAIN via
 * getStoreSecret (DB→env dual-read), with ZERO behavior change.
 *
 * Both secondary read points (shopifyBulkFirstOrder.requireDomain at the old
 * line ~248 and shopifyBulkCohort.requireDomain at ~254) previously read
 * `process.env[`${STORE}_SHOPIFY_DOMAIN`]` directly. This suite verifies:
 *   (a) the domain now resolves through getStoreSecret(storeId,'SHOPIFY_DOMAIN')
 *       — asserted via the mock call AND via the bulk POST hitting that domain;
 *   (b) when the secret resolves to null, the EXACT same missing-domain error
 *       string as before is thrown, byte-for-byte.
 *
 * getShopifyAccessToken is mocked (the token leg is already cut over + tested
 * in shopifyAuth.secrets.test.ts); fetch is mocked so no real network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// In-test secret map: keyed by `${storeId}|${key}` → value (or undefined → null).
const secretMap = new Map<string, string>();

vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: vi.fn(
    async (storeId: string, key: string): Promise<string | null> =>
      secretMap.get(`${storeId}|${key}`) ?? null,
  ),
}));

vi.mock('@/lib/fetchers/shopifyAuth', () => ({
  getShopifyAccessToken: vi.fn(async () => 'shpat_TEST_TOKEN'),
}));

import { startBulkFirstOrderExport } from '../shopifyBulkFirstOrder';
import { startBulkCohortExport } from '../shopifyBulkCohort';
import { getStoreSecret } from '@/lib/storeSecretsReader';

const STORE = 'uzoshop';
const DOMAIN = 'uzoshop.myshopify.com';

function okBulkStartResponse(): Response {
  return new Response(
    JSON.stringify({
      data: {
        bulkOperationRunQuery: {
          bulkOperation: { id: 'gid://shopify/BulkOperation/1' },
          userErrors: [],
        },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

beforeEach(() => {
  secretMap.clear();
  vi.mocked(getStoreSecret).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shopifyBulkFirstOrder — domain via getStoreSecret', () => {
  it('resolves SHOPIFY_DOMAIN via getStoreSecret and POSTs the bulk start to that domain', async () => {
    secretMap.set(`${STORE}|SHOPIFY_DOMAIN`, DOMAIN);
    const fetchMock = vi.fn(async () => okBulkStartResponse());
    vi.stubGlobal('fetch', fetchMock);

    const id = await startBulkFirstOrderExport(STORE);
    expect(id).toBe('gid://shopify/BulkOperation/1');

    expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'SHOPIFY_DOMAIN');
    const url = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0][0];
    expect(url).toContain(`https://${DOMAIN}/admin/api/`);
  });

  it('throws the EXACT missing-domain error when the secret resolves to null', async () => {
    // secretMap empty → getStoreSecret returns null.
    await expect(startBulkFirstOrderExport(STORE)).rejects.toThrow(
      'shopifyBulkFirstOrder: missing env UZOSHOP_SHOPIFY_DOMAIN',
    );
    expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'SHOPIFY_DOMAIN');
  });
});

describe('shopifyBulkCohort — domain via getStoreSecret', () => {
  it('resolves SHOPIFY_DOMAIN via getStoreSecret and POSTs the bulk start to that domain', async () => {
    secretMap.set(`${STORE}|SHOPIFY_DOMAIN`, DOMAIN);
    const fetchMock = vi.fn(async () => okBulkStartResponse());
    vi.stubGlobal('fetch', fetchMock);

    const id = await startBulkCohortExport(STORE);
    expect(id).toBe('gid://shopify/BulkOperation/1');

    expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'SHOPIFY_DOMAIN');
    const url = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0][0];
    expect(url).toContain(`https://${DOMAIN}/admin/api/`);
  });

  it('throws the EXACT missing-domain error when the secret resolves to null', async () => {
    // secretMap empty → getStoreSecret returns null.
    await expect(startBulkCohortExport(STORE)).rejects.toThrow(
      'shopifyBulkCohort: missing env UZOSHOP_SHOPIFY_DOMAIN',
    );
    expect(getStoreSecret).toHaveBeenCalledWith(STORE, 'SHOPIFY_DOMAIN');
  });
});
