/**
 * Self-serve stores — fetchShopifyDayRows must stamp each row's storeName with
 * the store's DISPLAY name (from getStores → stores DB), NOT its slug, so a 4th
 * store's data_daily rows group under the same name the dashboard cards key on.
 *
 * Regression net for the legacy 3: shopify.test.ts Test 5 asserts
 * storeName='uzoshop' for storeId='uzoshop' (no DB mock → hardcoded fallback).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stage a 4th active store in getStores so the async name resolver can map the
// slug 'pdrn-skin' → display 'pdrn skin'.
vi.mock('@/lib/getStores', () => ({
  getStores: vi.fn(async () => [
    { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: null, isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1, enableCustomerJourney: false },
    { storeId: 'pdrn-skin', storeName: 'pdrn skin', brandColor: null, isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 4, enableCustomerJourney: false },
  ]),
  loadActiveStoreIds: vi.fn(async () => ['uzoshop', 'pdrn-skin']),
}));

import * as shopifyAuth from '@/lib/fetchers/shopifyAuth';
import { fetchShopifyDayRows } from '../shopify';
import { __resetPlatformsByStoreCache } from '@/lib/platformsByStore';

const DATE_STR = '2026-05-19';

beforeEach(() => {
  __resetPlatformsByStoreCache();
  vi.stubEnv('PDRN-SKIN_SHOPIFY_DOMAIN', 'pdrn-skin.myshopify.com');
  vi.stubEnv('PDRN-SKIN_SHOPIFY_CLIENT_ID', 'test_client_id');
  vi.stubEnv('PDRN-SKIN_SHOPIFY_CLIENT_SECRET', 'shpss_test_secret');
  shopifyAuth._resetShopifyAuthCacheForTesting();
  vi.spyOn(shopifyAuth, 'getShopifyAccessToken').mockResolvedValue('shpat_test_TOKEN');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ orders: [] }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __resetPlatformsByStoreCache();
});

describe('fetchShopifyDayRows — self-serve store name resolution', () => {
  it("stamps a 4th store's rows with its DISPLAY name, not the slug", async () => {
    const result = await fetchShopifyDayRows('pdrn-skin', DATE_STR);
    expect(result.storeId).toBe('pdrn-skin');
    expect(result.storeName).toBe('pdrn skin'); // DISPLAY name, not 'pdrn-skin'
  });
});
