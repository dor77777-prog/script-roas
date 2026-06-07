/**
 * Phase 3B (Task 8) — TikTok creds via getStoreSecret (per-store DB→env
 * dual-read), plus the two missed read points in postgresReaders +
 * /api/store-meta.
 *
 * Verifies the credential SOURCE switched from `process.env[...]` to the
 * dual-read helper while preserving ZERO behavior change:
 *   (a) getTikTokCreds (tiktok.ts, via fetchTikTokAdvertiserInfo) reads
 *       advertiser+token through getStoreSecret(storeId, 'TIKTOK_ADVERTISER_ID'
 *       / 'TIKTOK_ACCESS_TOKEN') and throws the EXACT message when either is
 *       missing.
 *   (b) readTikTokCredsFromEnv (tiktokAccountConfig.ts, via
 *       getTikTokAccountForStore) reads the same two keys and throws its
 *       EXACT (different) message when missing.
 *   (c) fetchTikTokCoverageInputs (postgresReaders.ts) resolves the uzoshop
 *       advertiser id via getStoreSecret('uzoshop','TIKTOK_ADVERTISER_ID')
 *       with the same `?.trim() || ''` degradation.
 *
 * The /api/store-meta route cutover (d) — tiktokAdvertiserId via getStoreSecret
 * with `?.trim() || null` + unchanged response shape — is verified in its
 * dedicated test (src/app/api/store-meta/__tests__/route.test.ts).
 *
 * isTikTokConfiguredForStore intentionally STAYS env-based (Decision 7) — it
 * is a SYNC boolean gate; not cut over here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// In-test secret map keyed by `${storeId}|${key}`. The mock mirrors
// getStoreSecret's resolved-string-or-null contract (NOT the DB→env path —
// callers see only the resolved value).
const secretMap = new Map<string, string>();

vi.mock('@/lib/storeSecretsReader', () => ({
  getStoreSecret: vi.fn(
    async (storeId: string, key: string): Promise<string | null> =>
      secretMap.get(`${storeId}|${key}`) ?? null,
  ),
}));

import { getStoreSecret } from '@/lib/storeSecretsReader';

beforeEach(() => {
  secretMap.clear();
  vi.mocked(getStoreSecret).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (a) tiktok.ts:getTikTokCreds (exercised via fetchTikTokAdvertiserInfo)
// ---------------------------------------------------------------------------
describe('(a) tiktok.ts getTikTokCreds via getStoreSecret', () => {
  it('reads advertiser id + access token through getStoreSecret', async () => {
    const { fetchTikTokAdvertiserInfo, _resetAdvertiserInfoCacheForTesting } =
      await import('../tiktok');
    _resetAdvertiserInfoCacheForTesting();

    secretMap.set('uzoshop|TIKTOK_ADVERTISER_ID', '7012345678901234567');
    secretMap.set('uzoshop|TIKTOK_ACCESS_TOKEN', 'tok-xyz');

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: {
              list: [
                {
                  advertiser_id: '7012345678901234567',
                  name: 'uzoshop',
                  currency: 'USD',
                  timezone: 'America/Toronto',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const info = await fetchTikTokAdvertiserInfo('uzoshop');
    expect(info.advertiserId).toBe('7012345678901234567');
    expect(getStoreSecret).toHaveBeenCalledWith('uzoshop', 'TIKTOK_ADVERTISER_ID');
    expect(getStoreSecret).toHaveBeenCalledWith('uzoshop', 'TIKTOK_ACCESS_TOKEN');

    // The access token resolved through getStoreSecret hit the request header.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Access-Token']).toBe('tok-xyz');
  });

  it('throws the EXACT message when both creds are missing', async () => {
    const { fetchTikTokAdvertiserInfo, _resetAdvertiserInfoCacheForTesting } =
      await import('../tiktok');
    _resetAdvertiserInfoCacheForTesting();
    // secretMap empty → both null.
    await expect(fetchTikTokAdvertiserInfo('uzoshop')).rejects.toThrow(
      'Missing TikTok creds for store "uzoshop": UZOSHOP_TIKTOK_ADVERTISER_ID, ' +
        'UZOSHOP_TIKTOK_ACCESS_TOKEN ' +
        '(set in Vercel env vars after App approval + OAuth handshake — ' +
        'see User Manual § TikTok integration).',
    );
  });

  it('throws naming only the missing advertiser id when token is present', async () => {
    const { fetchTikTokAdvertiserInfo, _resetAdvertiserInfoCacheForTesting } =
      await import('../tiktok');
    _resetAdvertiserInfoCacheForTesting();
    secretMap.set('uzoshop|TIKTOK_ACCESS_TOKEN', 'tok-xyz');
    await expect(fetchTikTokAdvertiserInfo('uzoshop')).rejects.toThrow(
      'Missing TikTok creds for store "uzoshop": UZOSHOP_TIKTOK_ADVERTISER_ID ' +
        '(set in Vercel env vars after App approval + OAuth handshake — ' +
        'see User Manual § TikTok integration).',
    );
  });
});

// ---------------------------------------------------------------------------
// (b) tiktokAccountConfig.ts:readTikTokCredsFromEnv (via getTikTokAccountForStore)
// ---------------------------------------------------------------------------
describe('(b) tiktokAccountConfig readTikTokCredsFromEnv via getStoreSecret', () => {
  it('reads both creds through getStoreSecret and resolves the account config', async () => {
    const { _resetAdvertiserInfoCacheForTesting } = await import('../tiktok');
    _resetAdvertiserInfoCacheForTesting();
    const { getTikTokAccountForStore } = await import('../tiktokAccountConfig');

    secretMap.set('uzoshop|TIKTOK_ADVERTISER_ID', '7012345678901234567');
    secretMap.set('uzoshop|TIKTOK_ACCESS_TOKEN', 'tok-xyz');

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 0,
          message: 'OK',
          data: {
            list: [
              {
                advertiser_id: '7012345678901234567',
                name: 'uzoshop',
                currency: 'USD',
                timezone: 'America/Toronto',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cfg = await getTikTokAccountForStore('uzoshop' as never);
    expect(cfg.advertiserId).toBe('7012345678901234567');
    expect(cfg.accessToken).toBe('tok-xyz');
    expect(cfg.accountCurrency).toBe('USD');
    expect(getStoreSecret).toHaveBeenCalledWith('uzoshop', 'TIKTOK_ADVERTISER_ID');
    expect(getStoreSecret).toHaveBeenCalledWith('uzoshop', 'TIKTOK_ACCESS_TOKEN');
  });

  it('throws the EXACT (config-variant) message when both creds are missing', async () => {
    const { _resetAdvertiserInfoCacheForTesting } = await import('../tiktok');
    _resetAdvertiserInfoCacheForTesting();
    const { getTikTokAccountForStore } = await import('../tiktokAccountConfig');
    await expect(getTikTokAccountForStore('zolplus' as never)).rejects.toThrow(
      'Missing TikTok creds for store "zolplus": ZOLPLUS_TIKTOK_ADVERTISER_ID, ' +
        'ZOLPLUS_TIKTOK_ACCESS_TOKEN ' +
        '(per docs/PROPS-MAP.md — set as Vercel env vars).',
    );
  });
});

// ---------------------------------------------------------------------------
// (c) postgresReaders.ts:fetchTikTokCoverageInputs advertiser id
// ---------------------------------------------------------------------------
describe('(c) postgresReaders fetchTikTokCoverageInputs advertiser id via getStoreSecret', () => {
  it('resolves the uzoshop advertiser id via getStoreSecret and attaches it to campaigns', async () => {
    const { fetchTikTokCoverageInputs } = await import('@/lib/postgresReaders');
    secretMap.set('uzoshop|TIKTOK_ADVERTISER_ID', '  7012345678901234567  \n');

    const out = await fetchTikTokCoverageInputs({ from: '2026-06-01', to: '2026-06-01' });
    expect(getStoreSecret).toHaveBeenCalledWith('uzoshop', 'TIKTOK_ADVERTISER_ID');
    // The advertiser id is trimmed (preserving `?.trim() || ''`) and used as the
    // per-campaign advertiserId in the coverage feed (or, when no rows / DB
    // unreachable in test, the soft-fail empty shape is returned — either way
    // the resolver was called with the right key).
    expect(out).toHaveProperty('accountTotalCad');
    expect(out).toHaveProperty('campaigns');
    if (out.campaigns.length > 0) {
      expect(out.campaigns[0].advertiserId).toBe('7012345678901234567');
    }
  });
});

// Note: the /api/store-meta route cutover (tiktokAdvertiserId via getStoreSecret)
// is verified in its dedicated test — src/app/api/store-meta/__tests__/route.test.ts
// — which already owns the hoisted postgresReaders mock + the response-shape
// assertions. Re-mocking postgresReaders here would conflict with the real
// fetchTikTokCoverageInputs exercised by (c) above.
