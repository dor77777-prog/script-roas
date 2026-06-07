// dashboard-web/src/lib/secretsRegistry.ts
// Single source of truth for WHICH secret keys exist, per platform/scope. Used by
// the backfill route to know what env vars to encrypt into store_secrets. The
// `key` IS the store_secrets.secret_key AND the env-var suffix (${STORE}_${key}).
// Readers reference specific keys inline; this registry is the backfill's contract.

export type SecretScope = 'all' | string[];

export interface PerStoreSecretKey {
  platform: 'shopify' | 'meta' | 'google' | 'tiktok';
  key: string;
  appliesTo: SecretScope; // 'all' = every active store; or an explicit store-id list
}

// Per-store secret keys. Backfill SKIPS any whose env var is absent, so 'all' is
// safe for google (only uzoshop has the vars today). TikTok is restricted to
// uzoshop because it is the shared-account owner — never write TikTok rows for
// the tenant stores (would shadow the env fallback with an empty/foreign value).
export const PER_STORE_SECRET_KEYS: PerStoreSecretKey[] = [
  { platform: 'shopify', key: 'SHOPIFY_DOMAIN', appliesTo: 'all' },
  { platform: 'shopify', key: 'SHOPIFY_CLIENT_ID', appliesTo: 'all' },
  { platform: 'shopify', key: 'SHOPIFY_CLIENT_SECRET', appliesTo: 'all' },
  { platform: 'meta', key: 'META_ACCESS_TOKEN', appliesTo: 'all' },
  { platform: 'meta', key: 'META_AD_ACCOUNT_ID', appliesTo: 'all' },
  { platform: 'google', key: 'GOOGLEADS_CUSTOMER_ID', appliesTo: 'all' },
  { platform: 'google', key: 'GOOGLEADS_REFRESH_TOKEN', appliesTo: 'all' },
  { platform: 'tiktok', key: 'TIKTOK_ADVERTISER_ID', appliesTo: ['uzoshop'] },
  { platform: 'tiktok', key: 'TIKTOK_ACCESS_TOKEN', appliesTo: ['uzoshop'] },
];

// Shared/global secrets, stored under store_id '__global__' (unprefixed env name).
export const GLOBAL_SECRET_KEYS: string[] = [
  'GOOGLEADS_DEVELOPER_TOKEN',
  'GOOGLEADS_CLIENT_ID',
  'GOOGLEADS_CLIENT_SECRET',
  'GOOGLEADS_LOGIN_CUSTOMER_ID',
  'GOOGLEADS_REFRESH_TOKEN',
  'META_GLOBAL_TOKEN',
];

export function perStoreKeysForStore(storeId: string): string[] {
  return PER_STORE_SECRET_KEYS
    .filter((k) => k.appliesTo === 'all' || k.appliesTo.includes(storeId))
    .map((k) => k.key);
}
