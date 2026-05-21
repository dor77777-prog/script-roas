/**
 * Phase 05.6-04 — Meta fetcher tests (RED-then-GREEN, port of MetaAds.gs:19-98).
 *
 * Covers:
 *   1. Response → MetaAdSetRow[] field mapping (10 fields per row)
 *   2. Conversion-priority chain: omni_purchase → purchase → fb_pixel_purchase
 *      (matches MetaAds.gs:85-98 exactly; D-C4 algorithm parity)
 *   3. Empty-row filter: spend=0 AND impressions=0 AND conversions=0 → skip
 *      (matches MetaAds.gs:57)
 *   4. Pagination follows body.paging.next; cap at 50 pages → console.warn
 *      (matches MetaAds.gs:39 + :74-80)
 *   5. Missing token / ad-account env vars throw with storeId in the message
 *      (matches MetaAds.gs:21-25 + RESEARCH §Pattern 3 lines 527-533)
 *
 * Env-var convention (mirrors PROPS-MAP destination column + RESEARCH §Pattern 3):
 *   META_${storeId.toUpperCase()}_TOKEN           (preferred)
 *   META_GLOBAL_TOKEN                              (fallback)
 *   META_${storeId.toUpperCase()}_AD_ACCOUNT_ID    (numeric; `act_` prefix is stripped)
 *
 * The uzoshop ad account id (26442930835313109) matches the Phase 05.5-01 seed
 * row in supabase/migrations/20260521063301_seed_stores.sql:7.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchMetaAdSetInsights,
  fetchMetaSpendForDay,
  META_API_VERSION,
} from '../meta';

// Helper — build a minimal-but-valid Meta /insights response payload.
type ActionEntry = { action_type: string; value: string };
type MetaRow = {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: ActionEntry[];
  action_values?: ActionEntry[];
  account_currency?: string;
};
function buildResponse(rows: MetaRow[], next?: string) {
  const body: { data: MetaRow[]; paging?: { next?: string } } = { data: rows };
  if (next) body.paging = { next };
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
function buildErrorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
    text: async () => JSON.stringify({ error: { message } }),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Test-suite shared env setup.
//
// We use the plain `process.env` mutation pattern that the rest of the codebase
// adopts (see featureFlags.test.ts) instead of vi.stubEnv: in Node's vitest
// process, mutating process.env is reflected immediately by the SUT and
// process.env is the single source of truth — stubEnv adds an indirection
// without changing semantics.
// ---------------------------------------------------------------------------
const STORE_ID = 'uzoshop';
const TOKEN_KEY = `META_${STORE_ID.toUpperCase()}_TOKEN`;
const ACCT_KEY = `META_${STORE_ID.toUpperCase()}_AD_ACCOUNT_ID`;
const AD_ACCOUNT_ID = '26442930835313109'; // Phase 05.5-01 seed row
const DATE = '2026-05-15';

describe('Phase 05.6-04 — meta.ts fetchMetaAdSetInsights (port of MetaAds.gs)', () => {
  const originalToken = process.env[TOKEN_KEY];
  const originalAcct = process.env[ACCT_KEY];
  const originalGlobal = process.env.META_GLOBAL_TOKEN;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env[TOKEN_KEY] = 'test-token-uzoshop';
    process.env[ACCT_KEY] = AD_ACCOUNT_ID;
    delete process.env.META_GLOBAL_TOKEN;
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env[TOKEN_KEY];
    else process.env[TOKEN_KEY] = originalToken;
    if (originalAcct === undefined) delete process.env[ACCT_KEY];
    else process.env[ACCT_KEY] = originalAcct;
    if (originalGlobal === undefined) delete process.env.META_GLOBAL_TOKEN;
    else process.env.META_GLOBAL_TOKEN = originalGlobal;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------------
  // Test 1 — field mapping
  // ------------------------------------------------------------------------
  it('parses /insights response data[] into MetaAdSetRow[] with correct field mapping', async () => {
    fetchSpy.mockResolvedValueOnce(
      buildResponse([
        {
          campaign_id: 'camp-1',
          campaign_name: 'Camp One',
          adset_id: 'adset-1',
          adset_name: 'AdSet One',
          spend: '123.45',
          impressions: '6789',
          clicks: '321',
          account_currency: 'ILS',
          actions: [{ action_type: 'purchase', value: '7' }],
          action_values: [{ action_type: 'purchase', value: '999.00' }],
        },
      ]),
    );

    const rows = await fetchMetaAdSetInsights(STORE_ID, DATE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      campaignId: 'camp-1',
      campaignName: 'Camp One',
      adSetId: 'adset-1',
      adSetName: 'AdSet One',
      spend: 123.45,
      currency: 'ILS',
      impressions: 6789,
      clicks: 321,
      conversions: 7,
      conversionValue: 999,
    });

    // URL invariants — Meta API version is current (NOT v20.0) and uses the
    // single-day time_range pattern matching MetaAds.gs:28.
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain(`graph.facebook.com/${META_API_VERSION}`);
    expect(calledUrl).toContain(`act_${AD_ACCOUNT_ID}/insights`);
    expect(calledUrl).toContain('level=adset');
    expect(calledUrl).toContain('limit=500');
    // time_range JSON is URL-encoded
    expect(calledUrl).toContain(encodeURIComponent(JSON.stringify({ since: DATE, until: DATE })));
  });

  // ------------------------------------------------------------------------
  // Test 2 — conversion priority chain (omni_purchase > purchase > fb_pixel_purchase)
  // ------------------------------------------------------------------------
  it('extracts purchases in priority order: omni_purchase wins when all three present', async () => {
    fetchSpy.mockResolvedValueOnce(
      buildResponse([
        {
          campaign_id: 'c',
          adset_id: 'a',
          spend: '10',
          impressions: '100',
          actions: [
            { action_type: 'offsite_conversion.fb_pixel_purchase', value: '5' },
            { action_type: 'purchase', value: '7' },
            { action_type: 'omni_purchase', value: '9' }, // priority 1 — should win
          ],
          action_values: [
            { action_type: 'offsite_conversion.fb_pixel_purchase', value: '500' },
            { action_type: 'purchase', value: '700' },
            { action_type: 'omni_purchase', value: '900' }, // priority 1 — should win
          ],
          account_currency: 'ILS',
        },
      ]),
    );

    const rows = await fetchMetaAdSetInsights(STORE_ID, DATE);
    expect(rows[0].conversions).toBe(9);
    expect(rows[0].conversionValue).toBe(900);
  });

  it('falls back to purchase when omni_purchase absent', async () => {
    fetchSpy.mockResolvedValueOnce(
      buildResponse([
        {
          campaign_id: 'c',
          adset_id: 'a',
          spend: '10',
          impressions: '100',
          actions: [
            { action_type: 'offsite_conversion.fb_pixel_purchase', value: '5' },
            { action_type: 'purchase', value: '7' },
          ],
          action_values: [
            { action_type: 'offsite_conversion.fb_pixel_purchase', value: '500' },
            { action_type: 'purchase', value: '700' },
          ],
          account_currency: 'ILS',
        },
      ]),
    );

    const rows = await fetchMetaAdSetInsights(STORE_ID, DATE);
    expect(rows[0].conversions).toBe(7);
    expect(rows[0].conversionValue).toBe(700);
  });

  it('falls back to offsite_conversion.fb_pixel_purchase only if first two absent', async () => {
    fetchSpy.mockResolvedValueOnce(
      buildResponse([
        {
          campaign_id: 'c',
          adset_id: 'a',
          spend: '10',
          impressions: '100',
          actions: [
            { action_type: 'offsite_conversion.fb_pixel_purchase', value: '5' },
            { action_type: 'add_to_cart', value: '99' }, // unrelated action — must be ignored
          ],
          action_values: [
            { action_type: 'offsite_conversion.fb_pixel_purchase', value: '500' },
          ],
          account_currency: 'ILS',
        },
      ]),
    );

    const rows = await fetchMetaAdSetInsights(STORE_ID, DATE);
    expect(rows[0].conversions).toBe(5);
    expect(rows[0].conversionValue).toBe(500);
  });

  it('returns 0 conversions when no purchase action_type present', async () => {
    fetchSpy.mockResolvedValueOnce(
      buildResponse([
        {
          campaign_id: 'c',
          adset_id: 'a',
          spend: '10',
          impressions: '100',
          actions: [{ action_type: 'add_to_cart', value: '99' }],
          action_values: [{ action_type: 'add_to_cart', value: '9900' }],
          account_currency: 'ILS',
        },
      ]),
    );

    const rows = await fetchMetaAdSetInsights(STORE_ID, DATE);
    expect(rows[0].conversions).toBe(0);
    expect(rows[0].conversionValue).toBe(0);
  });

  // ------------------------------------------------------------------------
  // Test 3 — empty-row filter (MetaAds.gs:57)
  // ------------------------------------------------------------------------
  it('filters out rows where spend=0 AND impressions=0 AND conversions=0', async () => {
    fetchSpy.mockResolvedValueOnce(
      buildResponse([
        // keep — has spend
        {
          campaign_id: 'c1',
          adset_id: 'a1',
          spend: '5',
          impressions: '0',
          clicks: '0',
          actions: [],
          action_values: [],
          account_currency: 'ILS',
        },
        // drop — all three zero
        {
          campaign_id: 'c2',
          adset_id: 'a2',
          spend: '0',
          impressions: '0',
          clicks: '0',
          actions: [],
          action_values: [],
          account_currency: 'ILS',
        },
        // keep — has late-attributed conversion even though spend/impressions are 0
        // (MetaAds.gs:54-56 comment: "Meta routinely attributes late conversions to
        // already-paused ad sets — keep them so we don't lose revenue").
        {
          campaign_id: 'c3',
          adset_id: 'a3',
          spend: '0',
          impressions: '0',
          clicks: '0',
          actions: [{ action_type: 'omni_purchase', value: '1' }],
          action_values: [{ action_type: 'omni_purchase', value: '50' }],
          account_currency: 'ILS',
        },
      ]),
    );

    const rows = await fetchMetaAdSetInsights(STORE_ID, DATE);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.adSetId).sort()).toEqual(['a1', 'a3']);
  });

  // ------------------------------------------------------------------------
  // Test 4 — pagination + cap-at-50 console.warn
  // ------------------------------------------------------------------------
  it('follows body.paging.next across pages', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        buildResponse(
          [
            {
              campaign_id: 'p1',
              adset_id: 'as1',
              spend: '1',
              impressions: '10',
              actions: [],
              action_values: [],
              account_currency: 'ILS',
            },
          ],
          'https://graph.facebook.com/page-2',
        ),
      )
      .mockResolvedValueOnce(
        buildResponse([
          {
            campaign_id: 'p2',
            adset_id: 'as2',
            spend: '2',
            impressions: '20',
            actions: [],
            action_values: [],
            account_currency: 'ILS',
          },
        ]),
      );

    const rows = await fetchMetaAdSetInsights(STORE_ID, DATE);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(rows.map((r) => r.adSetId)).toEqual(['as1', 'as2']);
    // Page 2 URL came verbatim from body.paging.next (MetaAds.gs:71 / RESEARCH §Pattern 3 line 580).
    expect(String(fetchSpy.mock.calls[1][0])).toBe('https://graph.facebook.com/page-2');
  });

  it('caps pagination at 50 pages and emits a warning mentioning the cap', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Every page returns a paging.next so the cap is the only termination.
    fetchSpy.mockImplementation(async () =>
      buildResponse(
        [
          {
            campaign_id: 'loop',
            adset_id: `as-${Math.random()}`,
            spend: '0.01',
            impressions: '1',
            actions: [],
            action_values: [],
            account_currency: 'ILS',
          },
        ],
        'https://graph.facebook.com/next',
      ),
    );

    await fetchMetaAdSetInsights(STORE_ID, DATE);

    expect(fetchSpy).toHaveBeenCalledTimes(50);
    expect(warnSpy).toHaveBeenCalled();
    const warningMsg = warnSpy.mock.calls.map((c) => String(c[0])).join('|');
    expect(warningMsg.toLowerCase()).toContain('pagination cap');
  });

  // ------------------------------------------------------------------------
  // Test 5 — env-var error handling
  // ------------------------------------------------------------------------
  it('throws a clear error including storeId when neither META_<STORE>_TOKEN nor META_GLOBAL_TOKEN is set', async () => {
    delete process.env[TOKEN_KEY];
    delete process.env.META_GLOBAL_TOKEN;

    await expect(fetchMetaAdSetInsights(STORE_ID, DATE)).rejects.toThrow(/uzoshop/i);
    await expect(fetchMetaAdSetInsights(STORE_ID, DATE)).rejects.toThrow(/token/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to META_GLOBAL_TOKEN when per-store token missing', async () => {
    delete process.env[TOKEN_KEY];
    process.env.META_GLOBAL_TOKEN = 'global-token';
    fetchSpy.mockResolvedValueOnce(buildResponse([]));

    await fetchMetaAdSetInsights(STORE_ID, DATE);
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('access_token=global-token');
  });

  it('throws a clear error including storeId when ad-account env var missing', async () => {
    delete process.env[ACCT_KEY];

    await expect(fetchMetaAdSetInsights(STORE_ID, DATE)).rejects.toThrow(/uzoshop/i);
    await expect(fetchMetaAdSetInsights(STORE_ID, DATE)).rejects.toThrow(/ad[_ ]?account/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('strips a leading "act_" from META_<STORE>_AD_ACCOUNT_ID before building the URL', async () => {
    process.env[ACCT_KEY] = `act_${AD_ACCOUNT_ID}`;
    fetchSpy.mockResolvedValueOnce(buildResponse([]));

    await fetchMetaAdSetInsights(STORE_ID, DATE);
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    // Exactly one `act_` prefix in the URL — not `act_act_`
    expect(calledUrl).toContain(`act_${AD_ACCOUNT_ID}`);
    expect(calledUrl).not.toContain(`act_act_`);
  });

  it('throws with status code + body when Meta returns non-200', async () => {
    fetchSpy.mockResolvedValueOnce(buildErrorResponse(400, 'Invalid OAuth access token'));

    await expect(fetchMetaAdSetInsights(STORE_ID, DATE)).rejects.toThrow(/400/);
    await expect(fetchMetaAdSetInsights(STORE_ID, DATE)).rejects.toThrow(/uzoshop/i);
  });

  // ------------------------------------------------------------------------
  // META_API_VERSION constant lock — explicit guard against accidental revert
  // to v20.0 (Apps Script value, deprecates Sept 24 2026; all <v24.0 deprecate
  // June 9 2026).
  // ------------------------------------------------------------------------
  it('META_API_VERSION is current (NOT v20.0)', () => {
    expect(META_API_VERSION).not.toBe('v20.0');
    expect(META_API_VERSION).toMatch(/^v(2[3-9]|[3-9]\d)\.\d+$/);
  });
});

describe('Phase 05.6-04 — meta.ts fetchMetaSpendForDay (per-day store-level aggregate)', () => {
  const originalToken = process.env[TOKEN_KEY];
  const originalAcct = process.env[ACCT_KEY];
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env[TOKEN_KEY] = 'test-token-uzoshop';
    process.env[ACCT_KEY] = AD_ACCOUNT_ID;
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env[TOKEN_KEY];
    else process.env[TOKEN_KEY] = originalToken;
    if (originalAcct === undefined) delete process.env[ACCT_KEY];
    else process.env[ACCT_KEY] = originalAcct;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('aggregates ad-set spend into a per-day store total + currency from first row', async () => {
    fetchSpy.mockResolvedValueOnce(
      buildResponse([
        {
          campaign_id: 'c1',
          adset_id: 'a1',
          spend: '12.50',
          impressions: '100',
          actions: [],
          action_values: [],
          account_currency: 'ILS',
        },
        {
          campaign_id: 'c2',
          adset_id: 'a2',
          spend: '7.25',
          impressions: '50',
          actions: [],
          action_values: [],
          account_currency: 'ILS',
        },
      ]),
    );

    const res = await fetchMetaSpendForDay(STORE_ID, DATE);
    expect(res).toEqual({
      storeId: STORE_ID,
      date: DATE,
      spend: 19.75,
      currency: 'ILS',
    });
  });

  it('returns spend=0 + default ILS currency when ad-set list is empty', async () => {
    fetchSpy.mockResolvedValueOnce(buildResponse([]));

    const res = await fetchMetaSpendForDay(STORE_ID, DATE);
    expect(res.spend).toBe(0);
    expect(res.currency).toBe('ILS');
    expect(res.storeId).toBe(STORE_ID);
    expect(res.date).toBe(DATE);
  });
});
