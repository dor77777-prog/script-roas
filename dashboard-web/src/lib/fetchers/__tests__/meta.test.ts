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
 * Env-var convention (mirrors PROPS-MAP destination column rows 26 + 27 + 33 + 34 + 39 + 40):
 *   ${storeId.toUpperCase()}_META_ACCESS_TOKEN     (preferred — per-store)
 *   META_GLOBAL_TOKEN                              (fallback — dev-only convenience)
 *   ${storeId.toUpperCase()}_META_AD_ACCOUNT_ID    (numeric; `act_` prefix is stripped)
 *
 * The uzoshop ad account id (26442930835313109) matches the Phase 05.5-01 seed
 * row in supabase/migrations/20260521063301_seed_stores.sql:7.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchMetaAdSetInsights,
  fetchMetaAdInsights,
  fetchMetaSpendForDay,
  fetchMetaBudgets,
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
// PROPS-MAP convention (rows 26 + 27): `${STORE}_META_ACCESS_TOKEN` + `${STORE}_META_AD_ACCOUNT_ID`
const TOKEN_KEY = `${STORE_ID.toUpperCase()}_META_ACCESS_TOKEN`;
const ACCT_KEY = `${STORE_ID.toUpperCase()}_META_AD_ACCOUNT_ID`;
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
  it('throws a clear error including storeId when neither <STORE>_META_ACCESS_TOKEN nor META_GLOBAL_TOKEN is set', async () => {
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
    // Both `expect(...).rejects.toThrow()` calls below invoke the SUT, so the
    // mock must yield the same error response twice.
    fetchSpy.mockResolvedValue(buildErrorResponse(400, 'Invalid OAuth access token'));

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

// ===========================================================================
// Phase 05.6.1 — fetchMetaAdInsights (level=ad port of fetchMetaAdSetInsights)
// ===========================================================================

// Wire-row type for the level=ad endpoint — adds ad_id + ad_name to MetaRow.
type MetaAdRowWire = MetaRow & { ad_id?: string; ad_name?: string };
function buildAdResponse(rows: MetaAdRowWire[], next?: string) {
  const body: { data: MetaAdRowWire[]; paging?: { next?: string } } = { data: rows };
  if (next) body.paging = { next };
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('Phase 05.6.1 — meta.ts fetchMetaAdInsights (level=ad port)', () => {
  const originalToken = process.env[TOKEN_KEY];
  const originalAcct = process.env[ACCT_KEY];
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Ad Test 1: builds URL with level=ad and ad_id/ad_name in fields list', async () => {
    fetchSpy.mockResolvedValueOnce(buildAdResponse([]));

    await fetchMetaAdInsights(STORE_ID, DATE);

    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('level=ad');
    expect(calledUrl).not.toContain('level=adset');
    // Both fields must appear in the URL's fields= param.
    expect(calledUrl).toMatch(/fields=[^&]*ad_id/);
    expect(calledUrl).toMatch(/fields=[^&]*ad_name/);
    // Preserves the canonical query convention.
    expect(calledUrl).toContain(`graph.facebook.com/${META_API_VERSION}`);
    expect(calledUrl).toContain(`act_${AD_ACCOUNT_ID}/insights`);
    expect(calledUrl).toContain('limit=500');
  });

  it('Ad Test 2: maps response to MetaAdRow shape exposing raw spend + currency + conversionValue', async () => {
    // 2026-05-21: changed from `spendCad/conversionValueCad: null` to
    // raw-currency `spend/currency/conversionValue`. Per-row FX is now done
    // by the cronDaily.ts writer (one rate per (store, date)) so the
    // ads_daily.spend_cad column actually populates instead of staying null.
    // See MetaAdRow type docstring for the new shape rationale.
    fetchSpy.mockResolvedValueOnce(
      buildAdResponse([
        {
          campaign_id: 'cmp-1',
          campaign_name: 'Camp 1',
          adset_id: 'as-1',
          adset_name: 'AdSet 1',
          ad_id: 'ad-1',
          ad_name: 'Ad 1',
          spend: '42.50', // ILS, surfaces raw — writer FX-converts
          impressions: '1000',
          clicks: '20',
          actions: [{ action_type: 'purchase', value: '3' }],
          action_values: [{ action_type: 'purchase', value: '120' }],
          account_currency: 'ILS',
        },
      ]),
    );

    const out = await fetchMetaAdInsights(STORE_ID, DATE);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      storeId: STORE_ID,
      date: DATE,
      platform: 'meta',
      campaignId: 'cmp-1',
      campaignName: 'Camp 1',
      adSetId: 'as-1',
      adSetName: 'AdSet 1',
      adId: 'ad-1',
      adName: 'Ad 1',
      impressions: 1000,
      clicks: 20,
      conversions: 3,
      spend: 42.5,
      currency: 'ILS',
      conversionValue: 120,
    });
  });

  it('Ad Test 3: reuses the same conversion priority chain (omni_purchase wins, fb_pixel_purchase falls through)', async () => {
    fetchSpy.mockResolvedValueOnce(
      buildAdResponse([
        // omni_purchase present → priority 1 wins, conversions=5.
        {
          campaign_id: 'c1',
          adset_id: 'as1',
          ad_id: 'ad-omni',
          spend: '10',
          impressions: '100',
          actions: [
            { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' },
            { action_type: 'purchase', value: '4' },
            { action_type: 'omni_purchase', value: '5' },
          ],
          action_values: [],
          account_currency: 'ILS',
        },
        // Only fb_pixel_purchase → priority 3, conversions=2.
        {
          campaign_id: 'c2',
          adset_id: 'as2',
          ad_id: 'ad-fbp',
          spend: '10',
          impressions: '100',
          actions: [
            { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' },
          ],
          action_values: [],
          account_currency: 'ILS',
        },
      ]),
    );

    const out = await fetchMetaAdInsights(STORE_ID, DATE);
    const byAd = new Map(out.map((r) => [r.adId, r.conversions]));
    expect(byAd.get('ad-omni')).toBe(5);
    expect(byAd.get('ad-fbp')).toBe(2);
  });

  it('Ad Test 4: drops rows where spend=0 AND impressions=0 AND conversions=0; keeps late-attributed rows', async () => {
    fetchSpy.mockResolvedValueOnce(
      buildAdResponse([
        // Drop — fully inactive.
        {
          campaign_id: 'c',
          adset_id: 'as',
          ad_id: 'inactive',
          spend: '0',
          impressions: '0',
          clicks: '0',
          actions: [],
          action_values: [],
          account_currency: 'ILS',
        },
        // Keep — late-attributed conversion on a paused ad.
        {
          campaign_id: 'c',
          adset_id: 'as',
          ad_id: 'late-attr',
          spend: '0',
          impressions: '0',
          clicks: '0',
          actions: [{ action_type: 'omni_purchase', value: '1' }],
          action_values: [{ action_type: 'omni_purchase', value: '60' }],
          account_currency: 'ILS',
        },
      ]),
    );

    const out = await fetchMetaAdInsights(STORE_ID, DATE);
    expect(out).toHaveLength(1);
    expect(out[0].adId).toBe('late-attr');
    expect(out[0].conversions).toBe(1);
  });
});

// ===========================================================================
// Phase 05.7.2 — fetchMetaBudgets (port of MetaAds.gs:157-289)
//
// Covers:
//   1. Happy path — 2 campaigns, 3 adsets, currency=ILS, minor→major.
//   2. Pagination follows body.paging.next on BOTH campaigns + adsets loops.
//   3. Missing budget fields default to 0 (no NaN, no crash).
//   4. Account-currency fetch failure falls back to ILS without throwing.
//   5. Minor→major conversion is exact (5000 agorot → 50.00 ILS).
//   6. Per-page non-200 in campaigns/adsets is soft-failure (warn + return
//      partial map), not a thrown error — operators get partial data instead
//      of a cron-blocking outage.
// ===========================================================================

type CampaignWireRow = {
  id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  status?: string;
  effective_status?: string;
};
type AdSetWireRow = {
  id?: string;
  campaign_id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  status?: string;
  effective_status?: string;
};

/** Build an account-currency response (`act_{id}?fields=currency`). */
function buildAccountCurrencyResponse(currency: string | undefined): Response {
  const body = currency === undefined ? {} : { currency };
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function buildCampaignsBudgetsResponse(rows: CampaignWireRow[], next?: string): Response {
  const body: { data: CampaignWireRow[]; paging?: { next?: string } } = { data: rows };
  if (next) body.paging = { next };
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function buildAdSetsBudgetsResponse(rows: AdSetWireRow[], next?: string): Response {
  const body: { data: AdSetWireRow[]; paging?: { next?: string } } = { data: rows };
  if (next) body.paging = { next };
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('Phase 05.7.2 — meta.ts fetchMetaBudgets (port of MetaAds.gs getMetaBudgets)', () => {
  const originalToken = process.env[TOKEN_KEY];
  const originalAcct = process.env[ACCT_KEY];
  let fetchSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env[TOKEN_KEY] = 'test-token-uzoshop';
    process.env[ACCT_KEY] = AD_ACCOUNT_ID;
    delete process.env.META_GLOBAL_TOKEN;
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // Silence the expected warn() calls so the test output stays clean; we
    // assert against `warnSpy.mock.calls` directly where the test cares.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env[TOKEN_KEY];
    else process.env[TOKEN_KEY] = originalToken;
    if (originalAcct === undefined) delete process.env[ACCT_KEY];
    else process.env[ACCT_KEY] = originalAcct;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    warnSpy.mockRestore();
  });

  it('Budgets Test 1: happy path — currency, 2 campaigns, 3 adsets, minor→major conversion', async () => {
    // 1st call: account currency. 2nd: campaigns page 1 (no next). 3rd: adsets page 1 (no next).
    fetchSpy
      .mockResolvedValueOnce(buildAccountCurrencyResponse('ILS'))
      .mockResolvedValueOnce(
        buildCampaignsBudgetsResponse([
          { id: 'c-cbo', daily_budget: '5000', lifetime_budget: '0', bid_strategy: 'LOWEST_COST_WITHOUT_CAP' },
          { id: 'c-abo', daily_budget: '0', lifetime_budget: '0' }, // ABO — adset owns budget
        ]),
      )
      .mockResolvedValueOnce(
        buildAdSetsBudgetsResponse([
          { id: 'as-1', campaign_id: 'c-cbo', daily_budget: '0', lifetime_budget: '0' },
          { id: 'as-2', campaign_id: 'c-abo', daily_budget: '3000', lifetime_budget: '0' },
          { id: 'as-3', campaign_id: 'c-abo', daily_budget: '0', lifetime_budget: '12000' },
        ]),
      );

    const out = await fetchMetaBudgets(STORE_ID);

    expect(out.currency).toBe('ILS');
    // Campaign minor→major: 5000 agorot → 50.00 ILS.
    expect(out.campaigns['c-cbo']).toEqual({
      dailyBudget: 50,
      lifetimeBudget: 0,
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
      // Phase 05.7.x — Meta fixture omits effective_status so the
      // fetcher normalises it to null. (Real responses include
      // ACTIVE/PAUSED/CAMPAIGN_PAUSED here.)
      effectiveStatus: null,
    });
    expect(out.campaigns['c-abo']).toEqual({
      dailyBudget: 0,
      lifetimeBudget: 0,
      bidStrategy: null,
      effectiveStatus: null,
    });
    // AdSet minor→major: 3000 → 30.00; 12000 → 120.00.
    expect(out.adSets['as-1']).toEqual({
      dailyBudget: 0,
      lifetimeBudget: 0,
      campaignId: 'c-cbo',
      effectiveStatus: null,
    });
    expect(out.adSets['as-2']).toEqual({
      dailyBudget: 30,
      lifetimeBudget: 0,
      campaignId: 'c-abo',
      effectiveStatus: null,
    });
    expect(out.adSets['as-3']).toEqual({
      dailyBudget: 0,
      lifetimeBudget: 120,
      campaignId: 'c-abo',
      effectiveStatus: null,
    });

    // URL invariants — all 3 calls use the META_API_VERSION constant and target
    // the correct ad account.
    const urls = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls[0]).toMatch(/act_\d+\?fields=currency/);
    expect(urls[1]).toContain(`/act_${AD_ACCOUNT_ID}/campaigns`);
    expect(urls[1]).toContain('daily_budget');
    expect(urls[1]).toContain('lifetime_budget');
    expect(urls[1]).toContain('bid_strategy');
    expect(urls[2]).toContain(`/act_${AD_ACCOUNT_ID}/adsets`);
    expect(urls[2]).toContain('campaign_id');
    for (const url of urls) {
      expect(url).toContain(`graph.facebook.com/${META_API_VERSION}`);
    }
  });

  it('Budgets Test 2: pagination follows body.paging.next on BOTH loops', async () => {
    fetchSpy
      .mockResolvedValueOnce(buildAccountCurrencyResponse('ILS'))
      // Campaigns: page 1 → next URL → page 2 (terminal).
      .mockResolvedValueOnce(
        buildCampaignsBudgetsResponse(
          [{ id: 'c1', daily_budget: '1000', lifetime_budget: '0' }],
          'https://graph.facebook.com/campaigns-page-2',
        ),
      )
      .mockResolvedValueOnce(
        buildCampaignsBudgetsResponse([{ id: 'c2', daily_budget: '2000', lifetime_budget: '0' }]),
      )
      // AdSets: page 1 → next URL → page 2 (terminal).
      .mockResolvedValueOnce(
        buildAdSetsBudgetsResponse(
          [{ id: 'as1', campaign_id: 'c1', daily_budget: '500', lifetime_budget: '0' }],
          'https://graph.facebook.com/adsets-page-2',
        ),
      )
      .mockResolvedValueOnce(
        buildAdSetsBudgetsResponse([{ id: 'as2', campaign_id: 'c2', daily_budget: '700', lifetime_budget: '0' }]),
      );

    const out = await fetchMetaBudgets(STORE_ID);

    expect(Object.keys(out.campaigns).sort()).toEqual(['c1', 'c2']);
    expect(Object.keys(out.adSets).sort()).toEqual(['as1', 'as2']);
    expect(out.campaigns['c1'].dailyBudget).toBe(10); // 1000/100
    expect(out.campaigns['c2'].dailyBudget).toBe(20);
    expect(out.adSets['as1'].dailyBudget).toBe(5);
    expect(out.adSets['as2'].dailyBudget).toBe(7);

    // Verify the paging.next URLs were actually followed verbatim.
    const urls = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls[2]).toBe('https://graph.facebook.com/campaigns-page-2');
    expect(urls[4]).toBe('https://graph.facebook.com/adsets-page-2');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('Budgets Test 3: missing budget fields default to 0 (no NaN)', async () => {
    fetchSpy
      .mockResolvedValueOnce(buildAccountCurrencyResponse('ILS'))
      .mockResolvedValueOnce(
        buildCampaignsBudgetsResponse([
          // No daily/lifetime/bid_strategy at all.
          { id: 'c-empty' },
          // Empty string daily, null lifetime via undefined.
          { id: 'c-empty-str', daily_budget: '' },
        ]),
      )
      .mockResolvedValueOnce(
        buildAdSetsBudgetsResponse([
          { id: 'as-empty', campaign_id: '' },
          // Missing id → must be skipped (no `''` key in adSets).
          { campaign_id: 'cX', daily_budget: '100' },
        ]),
      );

    const out = await fetchMetaBudgets(STORE_ID);

    expect(out.campaigns['c-empty']).toEqual({
      dailyBudget: 0,
      lifetimeBudget: 0,
      bidStrategy: null,
      effectiveStatus: null,
    });
    expect(out.campaigns['c-empty-str']).toEqual({
      dailyBudget: 0,
      lifetimeBudget: 0,
      bidStrategy: null,
      effectiveStatus: null,
    });
    expect(out.adSets['as-empty']).toEqual({
      dailyBudget: 0,
      lifetimeBudget: 0,
      campaignId: '',
      effectiveStatus: null,
    });
    // Missing id ⇒ no row created (we don't want '' as a real key).
    expect(out.adSets['']).toBeUndefined();

    // No NaN anywhere — confirms the parseFloat('') guard works.
    for (const c of Object.values(out.campaigns)) {
      expect(Number.isFinite(c.dailyBudget)).toBe(true);
      expect(Number.isFinite(c.lifetimeBudget)).toBe(true);
    }
    for (const a of Object.values(out.adSets)) {
      expect(Number.isFinite(a.dailyBudget)).toBe(true);
      expect(Number.isFinite(a.lifetimeBudget)).toBe(true);
    }
  });

  it('Budgets Test 4: account-currency fetch failure falls back to ILS (warn but don\'t throw)', async () => {
    // 1st call (currency): HTTP 500. 2nd: campaigns. 3rd: adsets.
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'server error' } }),
        text: async () => 'server error',
      } as unknown as Response)
      .mockResolvedValueOnce(buildCampaignsBudgetsResponse([{ id: 'c1', daily_budget: '1000' }]))
      .mockResolvedValueOnce(buildAdSetsBudgetsResponse([{ id: 'a1', campaign_id: 'c1', daily_budget: '500' }]));

    const out = await fetchMetaBudgets(STORE_ID);

    // Defaulted to ILS — the explicit fallback per MetaAds.gs:194.
    expect(out.currency).toBe('ILS');
    // Other data still returned despite the currency fetch failing.
    expect(out.campaigns['c1'].dailyBudget).toBe(10);
    expect(out.adSets['a1'].dailyBudget).toBe(5);
    // A warning was emitted so operators see it in the Inngest log.
    const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('|');
    expect(warned.toLowerCase()).toContain('currency');
    expect(warned).toContain('uzoshop');
  });

  it('Budgets Test 5: minor→major conversion exactness (string units → divide by 100)', async () => {
    fetchSpy
      .mockResolvedValueOnce(buildAccountCurrencyResponse('ILS'))
      .mockResolvedValueOnce(
        buildCampaignsBudgetsResponse([
          // 10000 agorot = ₪100.00 exact.
          { id: 'c-exact', daily_budget: '10000', lifetime_budget: '0' },
          // 1 agora = ₪0.01 (edge case).
          { id: 'c-cent', daily_budget: '1' },
        ]),
      )
      .mockResolvedValueOnce(buildAdSetsBudgetsResponse([]));

    const out = await fetchMetaBudgets(STORE_ID);

    expect(out.campaigns['c-exact'].dailyBudget).toBe(100);
    expect(out.campaigns['c-cent'].dailyBudget).toBe(0.01);
  });

  it('Budgets Test 6: per-page non-200 on campaigns is a soft-fail (warn + return partial)', async () => {
    // currency OK, campaigns HTTP 500, adsets OK with one row.
    fetchSpy
      .mockResolvedValueOnce(buildAccountCurrencyResponse('ILS'))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'oops',
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce(
        buildAdSetsBudgetsResponse([{ id: 'a1', campaign_id: 'c-unknown', daily_budget: '500' }]),
      );

    const out = await fetchMetaBudgets(STORE_ID);

    // Campaigns map empty (no crash, no throw).
    expect(out.campaigns).toEqual({});
    // AdSets still populated — the campaigns failure must NOT abort the adsets loop.
    expect(out.adSets['a1'].dailyBudget).toBe(5);
    // Warning surfaces the storeId + status.
    const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('|');
    expect(warned).toContain('uzoshop');
    expect(warned).toContain('500');
  });
});
