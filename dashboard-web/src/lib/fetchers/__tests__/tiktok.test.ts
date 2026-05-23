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
      // Phase 05.7.x — /adgroup/get/ statuses call. fetchTikTokAdInsights
      // kicks this off in parallel with the report fetch (statusesPromise),
      // so canneds are consumed in this order: info → adgroup/get → report.
      // Two adgroup statuses returned so we can assert merge into rows.
      {
        body: {
          code: 0,
          message: 'OK',
          data: {
            list: [
              { adgroup_id: 'AG1', secondary_status: 'ADGROUP_STATUS_DELIVERY_OK' },
              { adgroup_id: 'AG2', secondary_status: 'ADGROUP_STATUS_DISABLE' },
            ],
            page_info: { total_page: 1, page: 1 },
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
                  complete_payment: '2',
                  value_per_complete_payment: '25.00',
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
                  complete_payment: '1',
                  value_per_complete_payment: '25.00',
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
                  complete_payment: '0',
                  value_per_complete_payment: '0',
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
    // Phase 05.7.x — adgroup statuses merged into rows by adgroup_id.
    // AG1 → DELIVERY_OK (active), AG2 → DISABLE (paused by operator).
    const ad1 = rows.find((r) => r.adId === 'AD1');
    expect(ad1?.effectiveStatus).toBe('ADGROUP_STATUS_DELIVERY_OK');
    expect(lateRow?.effectiveStatus).toBe('ADGROUP_STATUS_DISABLE');
  });
});

// ===========================================================================
// AUDIT C-04 backfill — code !== 0 envelope surface area
// ===========================================================================
//
// Per .planning/AUDIT.md surface 7: TikTok was the thinnest-tested
// fetcher (only 5 happy-path tests pre-backfill) AND is the most
// operator-volatile platform (BUDGET_EXCEED daily, AUDIT on every
// creative change, account-level auth expiries). The single existing
// envelope error test (Test 3) covered ONE failure code on ONE entry
// point.
//
// Pre-fix coverage gap: any future change that swallowed the throw
// (e.g. wrapping tiktokGet's envelope check in a try/catch that
// returned 0) would silently revert the dashboard to the
// Phase 05.7.8 root-cause bug — TikTok spend stuck at 0 for every
// day, with no operator-visible signal.
//
// These additional tests pin:
//   - 40002 (Missing data — common in API contract drift) throws.
//   - 50000 (Server error — TikTok's 5xx envelope class) throws.
//   - The throw surfaces from BOTH entry points the cron pipeline
//     calls: fetchTikTokAdvertiserInfo (used first to cache currency)
//     AND fetchTikTokSpendForDay (where the report fetch can also
//     return code !== 0 after the info call succeeds).
//   - code: 0 with empty data.list returns the "success path with no
//     rows" shape — spend=0, currency populated from advertiser/info.

describe('tiktok fetcher — code !== 0 envelope surface (AUDIT C-04)', () => {
  beforeEach(() => {
    _resetAdvertiserInfoCacheForTesting();
    vi.stubEnv('UZOSHOP_TIKTOK_ADVERTISER_ID', '7012345678901234567');
    vi.stubEnv('UZOSHOP_TIKTOK_ACCESS_TOKEN', 'tok');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('Test 6: fetchTikTokAdvertiserInfo throws on code=40002 "Missing data"', async () => {
    const { fn } = makeFetchMock([
      {
        body: {
          code: 40002,
          message: 'Missing data',
          request_id: 'req-40002',
          data: null,
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    // Pin: envelope error surfaces as a thrown Error (NOT silently
    // returning 0). Message must include the code, the API message, AND
    // the request_id for operator triage.
    await expect(fetchTikTokAdvertiserInfo(STORE)).rejects.toThrow(
      /TikTok \/advertiser\/info\/ code=40002.*Missing data.*request_id=req-40002/,
    );
  });

  it('Test 7: fetchTikTokAdvertiserInfo throws on code=50000 "Server error"', async () => {
    // 5xx-range envelope codes are TikTok's "server problem" surface —
    // these MUST throw so cron-live's outer .catch(() => null) can
    // gracefully soft-fail the TikTok day while letting Meta + Google
    // succeed. If the throw were swallowed, the day would write a
    // bogus spend=0 row instead of skipping the TikTok pillar.
    const { fn } = makeFetchMock([
      {
        body: {
          code: 50000,
          message: 'Server error',
          request_id: 'req-50000',
          data: null,
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    await expect(fetchTikTokAdvertiserInfo(STORE)).rejects.toThrow(
      /TikTok \/advertiser\/info\/ code=50000.*Server error.*request_id=req-50000/,
    );
  });

  it('Test 8: fetchTikTokSpendForDay throws when the REPORT call returns code !== 0 (info call succeeded first)', async () => {
    // Two-hop scenario: info call returns code=0 (cached cleanly), but
    // the subsequent report call returns code=40002. Pre-fix the report
    // failure could have been masked by a 0-spend fallback because the
    // cache contained valid currency data. Pin that the report path
    // ALSO surfaces the envelope error as a throw.
    const { fn } = makeFetchMock([
      // Hop 1: advertiser/info — success.
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
      // Hop 2: report/integrated/get — FAIL with code !== 0.
      {
        body: {
          code: 40002,
          message: 'Invalid date range',
          request_id: 'req-report-40002',
          data: null,
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    await expect(fetchTikTokSpendForDay(STORE, DATE_STR)).rejects.toThrow(
      /TikTok \/report\/integrated\/get\/ code=40002.*Invalid date range.*request_id=req-report-40002/,
    );
  });

  it('Test 9: fetchTikTokAdvertiserInfo throws when code=0 but data is missing (envelope-shape contract)', async () => {
    // Edge: TikTok returned code=0 (signaling success) but omitted the
    // data payload. tiktokGet throws a distinct "no data" error so the
    // caller can distinguish "auth failed" from "auth succeeded but
    // the response was malformed".
    const { fn } = makeFetchMock([
      {
        body: {
          code: 0,
          message: 'OK',
          // data omitted entirely.
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    await expect(fetchTikTokAdvertiserInfo(STORE)).rejects.toThrow(
      /TikTok \/advertiser\/info\/ returned envelope with code=0 but no data/,
    );
  });

  it('Test 10: fetchTikTokSpendForDay returns spend=0 on the empty-list success path (code=0, data.list=[])', async () => {
    // Distinct from Test 8 — here the SPEND report endpoint succeeds at
    // the envelope level (code=0, data present) but reports zero rows
    // for the day. The expected behavior is a clean { spend: 0,
    // currency: <from-info> } result — NOT a throw. Pins that empty
    // success is correctly distinguished from envelope failure.
    const { fn } = makeFetchMock([
      // Hop 1: advertiser/info — success, currency=USD.
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
      // Hop 2: report — success with empty list (no spend on this day).
      {
        body: {
          code: 0,
          message: 'OK',
          data: { list: [] },
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);

    const result = await fetchTikTokSpendForDay(STORE, DATE_STR);

    // Clean success: spend=0 (no row to parse), currency inherited
    // from the advertiser/info hop. Pins the "no rows but no error"
    // path — must NOT throw despite the empty list.
    expect(result.spend).toBe(0);
    expect(result.currency).toBe('USD');
    expect(result.storeId).toBe(STORE);
    expect(result.date).toBe(DATE_STR);
  });
});
