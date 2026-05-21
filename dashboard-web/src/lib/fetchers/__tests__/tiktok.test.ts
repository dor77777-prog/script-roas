/**
 * Phase 05.7.5-B (scaffold) — TikTok Marketing API fetcher tests.
 *
 * Same mock-fetch pattern as `meta.test.ts` / `googleAds.test.ts`. Each
 * test stubs global.fetch with a queue of canned responses and asserts:
 *   - the request URL (path, query string, headers)
 *   - the parsed return shape (numeric coercion, currency propagation, etc.)
 *   - error handling on TikTok's envelope { code, message } pattern
 *
 * NO live HTTP. Tests run on every commit; production fetches use the
 * same module via cronDaily (Phase B execution wires it up).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchTikTokAdvertiserInfo,
  fetchTikTokSpendForDay,
  fetchTikTokAdInsights,
  TIKTOK_API_VERSION,
  _resetAdvertiserInfoCacheForTesting,
} from '../tiktok';

const STORE = 'uzoshop';
const DATE_STR = '2026-05-22';

type Canned = { body: unknown; status?: number };

function makeFetchMock(responses: Canned[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [...responses];
  const fn = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`No more canned responses (call ${calls.length}: ${url})`);
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fn, calls };
}

describe('tiktok fetcher — auth + creds', () => {
  beforeEach(() => {
    _resetAdvertiserInfoCacheForTesting();
    vi.stubEnv('UZOSHOP_TIKTOK_ADVERTISER_ID', '7012345678901234567');
    vi.stubEnv('UZOSHOP_TIKTOK_ACCESS_TOKEN', 'tiktok-access-token-xyz');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('Test 1: throws clear error when UZOSHOP_TIKTOK_* env vars are missing', async () => {
    vi.unstubAllEnvs();
    // Re-stub only one — make sure BOTH missing errors surface in the message.
    vi.stubEnv('UZOSHOP_TIKTOK_ADVERTISER_ID', '');
    vi.stubEnv('UZOSHOP_TIKTOK_ACCESS_TOKEN', '');

    await expect(fetchTikTokSpendForDay(STORE, DATE_STR)).rejects.toThrow(
      /Missing TikTok creds.*UZOSHOP_TIKTOK_ADVERTISER_ID.*UZOSHOP_TIKTOK_ACCESS_TOKEN/,
    );
  });

  it('Test 2: request hits business-api.tiktok.com with v1.3 + Access-Token header', async () => {
    const { fn, calls } = makeFetchMock([
      // advertiser/info call (cached lookup before the spend call)
      {
        body: {
          code: 0,
          message: 'OK',
          data: {
            list: [
              {
                advertiser_id: '7012345678901234567',
                name: 'uzoshop',
                currency: 'USD',
                timezone: 'America/Los_Angeles',
              },
            ],
          },
        },
      },
      // report/integrated/get call
      {
        body: {
          code: 0,
          message: 'OK',
          data: { list: [{ metrics: { spend: '42.50' } }] },
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const result = await fetchTikTokSpendForDay(STORE, DATE_STR);

    expect(result.spend).toBe(42.5);
    expect(result.currency).toBe('USD');
    expect(result.storeId).toBe(STORE);
    expect(result.date).toBe(DATE_STR);

    // Verify URL shape + headers on the second (report) call.
    const reportCall = calls.find((c) => c.url.includes('/report/integrated/get/'));
    expect(reportCall).toBeDefined();
    expect(reportCall!.url).toContain(`/open_api/${TIKTOK_API_VERSION}/report/integrated/get/`);
    expect(reportCall!.url).toContain('advertiser_id=7012345678901234567');
    expect(reportCall!.url).toContain('data_level=AUCTION_ADVERTISER');
    expect(reportCall!.url).toContain('start_date=2026-05-22');
    expect(reportCall!.url).toContain('end_date=2026-05-22');

    const headers = reportCall!.init?.headers as Record<string, string>;
    expect(headers['Access-Token']).toBe('tiktok-access-token-xyz');
    // MUST NOT use Authorization Bearer (Meta-style mistake)
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('tiktok fetcher — envelope error handling', () => {
  beforeEach(() => {
    _resetAdvertiserInfoCacheForTesting();
    vi.stubEnv('UZOSHOP_TIKTOK_ADVERTISER_ID', '7012345678901234567');
    vi.stubEnv('UZOSHOP_TIKTOK_ACCESS_TOKEN', 'tok');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('Test 3: throws when TikTok envelope has code !== 0 (auth expired)', async () => {
    const { fn } = makeFetchMock([
      {
        body: {
          code: 40001,
          message: 'Access token has expired',
          request_id: 'req-abc',
          data: null,
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    await expect(fetchTikTokAdvertiserInfo(STORE)).rejects.toThrow(
      /code=40001.*Access token has expired.*request_id=req-abc/,
    );
  });

  it('Test 4: throws on non-2xx HTTP with trimmed body', async () => {
    const { fn } = makeFetchMock([
      {
        body: { error: 'Bad Gateway' },
        status: 502,
      },
    ]);
    vi.stubGlobal('fetch', fn);

    await expect(fetchTikTokAdvertiserInfo(STORE)).rejects.toThrow(
      /TikTok \/advertiser\/info\/ HTTP 502/,
    );
  });
});

describe('tiktok fetcher — fetchTikTokAdInsights row shape', () => {
  beforeEach(() => {
    _resetAdvertiserInfoCacheForTesting();
    vi.stubEnv('UZOSHOP_TIKTOK_ADVERTISER_ID', '7012345678901234567');
    vi.stubEnv('UZOSHOP_TIKTOK_ACCESS_TOKEN', 'tok');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('Test 5: parses per-ad rows; drops empty rows (spend=0 + impressions=0 + conversions=0)', async () => {
    const { fn } = makeFetchMock([
      // advertiser/info call (cached afterward, but this call uses a fresh process)
      {
        body: {
          code: 0,
          message: 'OK',
          data: {
            list: [
              {
                advertiser_id: '7012345678901234567',
                name: 'uzoshop',
                currency: 'USD',
                timezone: 'UTC',
              },
            ],
          },
        },
      },
      // report/integrated/get — 3 rows: real, late-attribution, drop-me
      {
        body: {
          code: 0,
          message: 'OK',
          data: {
            list: [
              {
                metrics: {
                  spend: '10.00',
                  impressions: '500',
                  clicks: '12',
                  conversion: '2',
                  conversion_value: '50.00',
                  campaign_id: 'C1',
                  campaign_name: 'Spring',
                  adgroup_id: 'AG1',
                  adgroup_name: 'AG-Spring',
                  ad_name: 'Ad-Hero',
                },
                dimensions: { ad_id: 'AD1' },
              },
              {
                // Late-attribution: spend=0, impressions=0, but conversion>0 → KEEP
                metrics: {
                  spend: '0',
                  impressions: '0',
                  clicks: '0',
                  conversion: '1',
                  conversion_value: '25.00',
                  campaign_id: 'C2',
                  campaign_name: 'Late',
                  adgroup_id: 'AG2',
                  adgroup_name: 'AG-Late',
                  ad_name: 'Ad-Late',
                },
                dimensions: { ad_id: 'AD2' },
              },
              {
                // Truly empty → DROP
                metrics: {
                  spend: '0',
                  impressions: '0',
                  clicks: '0',
                  conversion: '0',
                  conversion_value: '0',
                  campaign_id: 'C3',
                  campaign_name: 'Empty',
                  adgroup_id: 'AG3',
                  adgroup_name: 'AG-Empty',
                  ad_name: 'Ad-Empty',
                },
                dimensions: { ad_id: 'AD3' },
              },
            ],
            page_info: { total_page: 1, page: 1 },
          },
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const rows = await fetchTikTokAdInsights(STORE, DATE_STR);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.adId).sort()).toEqual(['AD1', 'AD2']);
    expect(rows[0].spend).toBe(10);
    expect(rows[0].impressions).toBe(500);
    expect(rows[0].conversions).toBe(2);
    expect(rows[0].currency).toBe('USD');
    expect(rows[0].campaignName).toBe('Spring');
    // Late-attribution row preserved
    const lateRow = rows.find((r) => r.adId === 'AD2');
    expect(lateRow?.spend).toBe(0);
    expect(lateRow?.conversions).toBe(1);
    expect(lateRow?.conversionValue).toBe(25);
  });
});
