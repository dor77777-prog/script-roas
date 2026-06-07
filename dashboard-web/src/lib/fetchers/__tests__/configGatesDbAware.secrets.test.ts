/**
 * Self-serve stores Phase 4b (Task 6) — DB-aware configured-gates.
 *
 * Two SYNC boolean feature-gates decide whether a store "is configured" for a
 * platform by reading `process.env`:
 *   - isTikTokConfiguredForStore  (tiktokAccountConfig.ts)
 *   - isGoogleConfiguredForStore  (googleAccountConfig.ts)
 *
 * A future Phase-6 store whose creds live ONLY in `store_secrets` (encrypted
 * DB), NOT in env, would make the sync gate return FALSE → the worker skips ALL
 * work AND records data_freshness='success' → a silent green panel with zero
 * data. These tests pin the NEW async DB-aware variants:
 *   - isTikTokConfiguredForStoreAsync(storeId): Promise<boolean>
 *   - isGoogleConfiguredForStoreAsync(storeId): Promise<boolean>
 *
 * Each tries `getStoreSecret` first (DB→env→null dual-read) and falls back to
 * the existing sync env check. INERT today: with env creds present the async
 * gate returns the SAME boolean as the sync gate (verified below).
 *
 * TikTok honors the shared-account model (TIKTOK_SHARED_STORES = uzoshop +
 * usmile360, ONE advertiser account): a store is TikTok-configured iff the
 * full TikTok cred pair (TIKTOK_ADVERTISER_ID + TIKTOK_ACCESS_TOKEN) resolves
 * via getStoreSecret. A DB-only shared-store tenant whose pair resolves is
 * configured even with env absent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// In-test secret map keyed by `${storeId}|${key}`. Mirrors getStoreSecret's
// resolved-string-or-null contract (callers see only the resolved value).
const secretMap = new Map<string, string>();

vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: vi.fn(
    async (storeId: string, key: string): Promise<string | null> =>
      secretMap.get(`${storeId}|${key}`) ?? null,
  ),
}));

import { getStoreSecret } from '@/lib/storeSecretsReader';
import { isTikTokConfiguredForStoreAsync } from '../tiktokAccountConfig';
import { isGoogleConfiguredForStoreAsync } from '../googleAccountConfig';

// Snapshot + restore env keys we toggle so tests don't leak into siblings.
const ENV_KEYS = [
  'USMILE360_TIKTOK_ADVERTISER_ID',
  'USMILE360_TIKTOK_ACCESS_TOKEN',
  'UZOSHOP_TIKTOK_ADVERTISER_ID',
  'UZOSHOP_TIKTOK_ACCESS_TOKEN',
  'ENVSTORE_TIKTOK_ADVERTISER_ID',
  'ENVSTORE_TIKTOK_ACCESS_TOKEN',
  'NOSTORE_TIKTOK_ADVERTISER_ID',
  'NOSTORE_TIKTOK_ACCESS_TOKEN',
  'SOMESTORE_GOOGLEADS_CUSTOMER_ID',
  'ENVSTORE_GOOGLEADS_CUSTOMER_ID',
  'NOSTORE_GOOGLEADS_CUSTOMER_ID',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  secretMap.clear();
  vi.mocked(getStoreSecret).mockClear();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------
describe('isTikTokConfiguredForStoreAsync — DB-aware, honors TIKTOK_SHARED_STORES', () => {
  it('TRUE for a DB-only shared-store tenant (usmile360) when getStoreSecret resolves the cred pair, env absent', async () => {
    // No USMILE360_TIKTOK_* env vars (deleted in beforeEach). DB has the pair.
    secretMap.set('usmile360|TIKTOK_ADVERTISER_ID', '7012345678901234567');
    secretMap.set('usmile360|TIKTOK_ACCESS_TOKEN', 'tok-db');

    await expect(isTikTokConfiguredForStoreAsync('usmile360')).resolves.toBe(true);
    expect(getStoreSecret).toHaveBeenCalledWith('usmile360', 'TIKTOK_ADVERTISER_ID');
    expect(getStoreSecret).toHaveBeenCalledWith('usmile360', 'TIKTOK_ACCESS_TOKEN');
  });

  it('TRUE for an env-cred store (no regression) even though DB is empty', async () => {
    // getStoreSecret returns null (DB empty in mock) → the gate falls back to
    // the sync env check, which sees the env pair.
    process.env.ENVSTORE_TIKTOK_ADVERTISER_ID = '7099999999999999999';
    process.env.ENVSTORE_TIKTOK_ACCESS_TOKEN = 'tok-env';

    await expect(isTikTokConfiguredForStoreAsync('envstore')).resolves.toBe(true);
  });

  it('FALSE when neither DB nor env has the cred pair', async () => {
    await expect(isTikTokConfiguredForStoreAsync('nostore')).resolves.toBe(false);
  });

  it('FALSE when only one of the pair resolves (advertiser id without access token)', async () => {
    secretMap.set('nostore|TIKTOK_ADVERTISER_ID', '7012345678901234567');
    await expect(isTikTokConfiguredForStoreAsync('nostore')).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------
describe('isGoogleConfiguredForStoreAsync — DB-aware', () => {
  it('TRUE for a DB-only store when getStoreSecret resolves GOOGLEADS_CUSTOMER_ID, env absent', async () => {
    secretMap.set('somestore|GOOGLEADS_CUSTOMER_ID', '123-456-7890');

    await expect(isGoogleConfiguredForStoreAsync('somestore')).resolves.toBe(true);
    expect(getStoreSecret).toHaveBeenCalledWith('somestore', 'GOOGLEADS_CUSTOMER_ID');
  });

  it('TRUE for an env-cred store (no regression) even though DB is empty', async () => {
    process.env.ENVSTORE_GOOGLEADS_CUSTOMER_ID = '111-222-3333';
    await expect(isGoogleConfiguredForStoreAsync('envstore')).resolves.toBe(true);
  });

  it('FALSE when neither DB nor env has the customer id', async () => {
    await expect(isGoogleConfiguredForStoreAsync('nostore')).resolves.toBe(false);
  });
});
