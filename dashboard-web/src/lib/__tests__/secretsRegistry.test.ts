import { describe, it, expect } from 'vitest';
import { PER_STORE_SECRET_KEYS, GLOBAL_SECRET_KEYS, perStoreKeysForStore } from '@/lib/secretsRegistry';

describe('secretsRegistry', () => {
  it('lists the per-store secret keys with their env suffix == secret_key', () => {
    const keys = PER_STORE_SECRET_KEYS.map((k) => k.key);
    expect(keys).toEqual(expect.arrayContaining([
      'SHOPIFY_DOMAIN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET',
      'META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID',
      'GOOGLEADS_CUSTOMER_ID', 'GOOGLEADS_REFRESH_TOKEN',
      'TIKTOK_ADVERTISER_ID', 'TIKTOK_ACCESS_TOKEN',
    ]));
  });
  it('lists the global secret keys', () => {
    expect(GLOBAL_SECRET_KEYS).toEqual(expect.arrayContaining([
      'GOOGLEADS_DEVELOPER_TOKEN', 'GOOGLEADS_CLIENT_ID', 'GOOGLEADS_CLIENT_SECRET',
      'GOOGLEADS_LOGIN_CUSTOMER_ID', 'GOOGLEADS_REFRESH_TOKEN', 'META_GLOBAL_TOKEN',
    ]));
  });
  it('TikTok keys apply to uzoshop ONLY (shared-account owner)', () => {
    expect(perStoreKeysForStore('uzoshop')).toEqual(expect.arrayContaining(['TIKTOK_ADVERTISER_ID', 'TIKTOK_ACCESS_TOKEN']));
    expect(perStoreKeysForStore('zolplus')).not.toContain('TIKTOK_ADVERTISER_ID');
    expect(perStoreKeysForStore('usmile360')).not.toContain('TIKTOK_ACCESS_TOKEN');
  });
  it('Shopify + Meta keys apply to every store', () => {
    for (const s of ['uzoshop', 'zolplus', 'usmile360']) {
      expect(perStoreKeysForStore(s)).toEqual(expect.arrayContaining(['SHOPIFY_DOMAIN', 'META_ACCESS_TOKEN']));
    }
  });
});
