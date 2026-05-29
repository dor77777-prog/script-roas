// dashboard-web/src/lib/fetchers/__tests__/fetchMeta.test.ts
//
// TDD tests for fetchMeta.ts (Task 8 — Freshness Phase A)
//
// Covers all 17 specified test cases:
//   1.  parses x-business-use-case-usage (Shape 2)
//   2.  parses x-fb-ads-insights-throttle (Shape 3) when BUC absent
//   3.  parses x-app-usage (Shape 1) when both others absent
//   4.  prefers BUC over throttle when both present
//   5.  prefers throttle over x-app-usage when BUC absent but both present
//   6.  logs Sentry warning when NO known shape present
//   7.  logs Sentry warning when BUC JSON is malformed
//   8.  throws MetaBudgetHighError when ads_insights call_count >= 80 AND /insights url
//   9.  does NOT throw when ads_insights >= 80 BUT url is /campaigns (management endpoint)
//   10. throws MetaBudgetHighError when ads_management call_count >= 80 AND /campaigns url
//   11. does NOT throw when both BUCs < 80
//   12. MetaBudgetHighError.message contains literal substring "META_BUDGET_HIGH"
//   13. extractAdAccountIdFromUrl: act_123/insights → '123', URL without act_ → null
//   14. lookupStoreByAdAccount: env match → store id, no match → null
//   15. recordMetaBucUsage called with correct payload when storeId + accountId resolved
//   16. recordMetaBucUsage NOT called when accountId can't be extracted from URL
//   17. passes through fetchWithBackoff with provider: 'meta'

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const fetchWithBackoffMock = vi.fn();
const recordMetaBucUsageMock = vi.fn();
const sentryCaptureMessageMock = vi.fn();

vi.mock('../withBackoff', () => ({
  fetchWithBackoff: (...args: unknown[]) => fetchWithBackoffMock(...args),
}));

vi.mock('@/lib/notifications/metaBucUsage', () => ({
  recordMetaBucUsage: (...args: unknown[]) => recordMetaBucUsageMock(...args),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => sentryCaptureMessageMock(...args),
}));

import {
  fetchMeta,
  extractAdAccountIdFromUrl,
  lookupStoreByAdAccount,
  MetaBudgetHighError,
  META_BUDGET_THRESHOLD_PCT,
} from '../fetchMeta';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Response-like object with custom headers. */
function buildMockResponse(headers: Record<string, string> = {}, body = '{}'): Response {
  const headerMap = new Map(Object.entries(headers));
  return {
    ok: true,
    status: 200,
    headers: {
      get: (key: string) => headerMap.get(key) ?? null,
      forEach: (cb: (value: string, key: string) => void) => headerMap.forEach(cb),
    },
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response;
}

const BASE_URL_INSIGHTS = 'https://graph.facebook.com/v25.0/act_123/insights?access_token=tok';
const BASE_URL_CAMPAIGNS = 'https://graph.facebook.com/v25.0/act_123/campaigns?access_token=tok';

// Shape 2 — x-business-use-case-usage
const BUC_HEADER_NORMAL = JSON.stringify({
  '123': [
    { type: 'ads_insights', call_count: 40, total_cputime: 30, total_time: 35, estimated_time_to_regain_access: 0, ads_api_access_tier: 'standard_access' },
    { type: 'ads_management', call_count: 12, total_cputime: 14, total_time: 11, estimated_time_to_regain_access: 0, ads_api_access_tier: 'standard_access' },
  ],
});

const BUC_HEADER_HIGH_INSIGHTS = JSON.stringify({
  '123': [
    { type: 'ads_insights', call_count: 85, total_cputime: 30, total_time: 35, estimated_time_to_regain_access: 19, ads_api_access_tier: 'standard_access' },
    { type: 'ads_management', call_count: 12, total_cputime: 14, total_time: 11, estimated_time_to_regain_access: 0, ads_api_access_tier: 'standard_access' },
  ],
});

const BUC_HEADER_HIGH_MANAGEMENT = JSON.stringify({
  '123': [
    { type: 'ads_insights', call_count: 12, total_cputime: 14, total_time: 11, estimated_time_to_regain_access: 0, ads_api_access_tier: 'standard_access' },
    { type: 'ads_management', call_count: 85, total_cputime: 14, total_time: 11, estimated_time_to_regain_access: 0, ads_api_access_tier: 'standard_access' },
  ],
});

// Shape 3 — x-fb-ads-insights-throttle
const THROTTLE_HEADER_NORMAL = JSON.stringify({ app_id_util_pct: 10, acc_id_util_pct: 40, ads_api_access_tier: 'standard_access' });

// Shape 1 — x-app-usage
const APP_USAGE_HEADER_NORMAL = JSON.stringify({ call_count: 28, total_time: 25, total_cputime: 25 });

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  fetchWithBackoffMock.mockReset();
  recordMetaBucUsageMock.mockReset();
  sentryCaptureMessageMock.mockReset();
  process.env.UZOSHOP_META_AD_ACCOUNT_ID = '123';
});

afterEach(() => {
  delete process.env.UZOSHOP_META_AD_ACCOUNT_ID;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchMeta', () => {
  // -----------------------------------------------------------------------
  // Test 1 — Shape 2 (x-business-use-case-usage) parsing
  // -----------------------------------------------------------------------
  it('1. parses x-business-use-case-usage Shape 2 — extracts ads_insights and ads_management pcts correctly', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-business-use-case-usage': BUC_HEADER_NORMAL }),
    );

    await fetchMeta(BASE_URL_INSIGHTS);

    expect(recordMetaBucUsageMock).toHaveBeenCalledOnce();
    const call = recordMetaBucUsageMock.mock.calls[0][0];
    expect(call.ads_insights_call_pct).toBe(40);
    expect(call.ads_insights_cputime_pct).toBe(30);
    expect(call.ads_insights_time_pct).toBe(35);
    expect(call.ads_insights_eta_minutes).toBe(0);
    expect(call.ads_management_call_pct).toBe(12);
    expect(call.ads_management_cputime_pct).toBe(14);
    expect(call.ads_management_time_pct).toBe(11);
    expect(call.ads_management_eta_minutes).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Test 2 — Shape 3 (x-fb-ads-insights-throttle)
  // -----------------------------------------------------------------------
  it('2. parses x-fb-ads-insights-throttle Shape 3 when BUC absent — uses acc_id_util_pct as ads_insights_call/cputime/time_pct', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-fb-ads-insights-throttle': THROTTLE_HEADER_NORMAL }),
    );

    await fetchMeta(BASE_URL_INSIGHTS);

    expect(recordMetaBucUsageMock).toHaveBeenCalledOnce();
    const call = recordMetaBucUsageMock.mock.calls[0][0];
    expect(call.ads_insights_call_pct).toBe(40);
    expect(call.ads_insights_cputime_pct).toBe(40);
    expect(call.ads_insights_time_pct).toBe(40);
    expect(call.ads_insights_eta_minutes).toBe(0);
    // management fields default to 0
    expect(call.ads_management_call_pct).toBe(0);
    expect(call.ads_management_cputime_pct).toBe(0);
    expect(call.ads_management_time_pct).toBe(0);
    expect(call.ads_management_eta_minutes).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Test 3 — Shape 1 (x-app-usage)
  // -----------------------------------------------------------------------
  it('3. parses x-app-usage Shape 1 when BUC and throttle absent — writes to BOTH BUC pools', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-app-usage': APP_USAGE_HEADER_NORMAL }),
    );

    await fetchMeta(BASE_URL_INSIGHTS);

    expect(recordMetaBucUsageMock).toHaveBeenCalledOnce();
    const call = recordMetaBucUsageMock.mock.calls[0][0];
    // insights gets the same values as management (conservative, app-wide)
    expect(call.ads_insights_call_pct).toBe(28);
    expect(call.ads_insights_cputime_pct).toBe(25);
    expect(call.ads_insights_time_pct).toBe(25);
    expect(call.ads_management_call_pct).toBe(28);
    expect(call.ads_management_cputime_pct).toBe(25);
    expect(call.ads_management_time_pct).toBe(25);
  });

  // -----------------------------------------------------------------------
  // Test 4 — priority: BUC wins over throttle
  // -----------------------------------------------------------------------
  it('4. prefers BUC over throttle when both present', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({
        'x-business-use-case-usage': BUC_HEADER_NORMAL,
        'x-fb-ads-insights-throttle': THROTTLE_HEADER_NORMAL,
      }),
    );

    await fetchMeta(BASE_URL_INSIGHTS);

    expect(recordMetaBucUsageMock).toHaveBeenCalledOnce();
    const call = recordMetaBucUsageMock.mock.calls[0][0];
    // BUC-derived call_pct for insights is 40 (not throttle's 40 - same by coincidence, check management too)
    // BUC-derived management call_pct is 12 (throttle would have given 0)
    expect(call.ads_management_call_pct).toBe(12);
  });

  // -----------------------------------------------------------------------
  // Test 5 — priority: throttle wins over x-app-usage when BUC absent
  // -----------------------------------------------------------------------
  it('5. prefers throttle over x-app-usage when BUC absent but both throttle and x-app-usage present', async () => {
    const throttleHeader = JSON.stringify({ app_id_util_pct: 5, acc_id_util_pct: 55, ads_api_access_tier: 'standard_access' });
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({
        'x-fb-ads-insights-throttle': throttleHeader,
        'x-app-usage': APP_USAGE_HEADER_NORMAL,
      }),
    );

    await fetchMeta(BASE_URL_INSIGHTS);

    expect(recordMetaBucUsageMock).toHaveBeenCalledOnce();
    const call = recordMetaBucUsageMock.mock.calls[0][0];
    // throttle-derived: acc_id_util_pct = 55
    expect(call.ads_insights_call_pct).toBe(55);
    // management should be 0 (not 28 from x-app-usage)
    expect(call.ads_management_call_pct).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Test 6 — Sentry warning when no known shape present
  // -----------------------------------------------------------------------
  it('6. logs Sentry warning when NO known shape present', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-some-unknown-header': 'foo' }),
    );

    await fetchMeta(BASE_URL_INSIGHTS);

    expect(sentryCaptureMessageMock).toHaveBeenCalledOnce();
    const [msg] = sentryCaptureMessageMock.mock.calls[0];
    expect(msg).toContain('no known usage header');
    expect(recordMetaBucUsageMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 7 — Sentry warning when BUC JSON is malformed
  // -----------------------------------------------------------------------
  it('7. logs Sentry warning when BUC JSON is malformed', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-business-use-case-usage': 'not-valid-json{{' }),
    );

    await fetchMeta(BASE_URL_INSIGHTS);

    expect(sentryCaptureMessageMock).toHaveBeenCalledOnce();
    const [msg] = sentryCaptureMessageMock.mock.calls[0];
    expect(msg).toContain('failed to parse usage header');
    expect(recordMetaBucUsageMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 8 — throws MetaBudgetHighError when ads_insights >= 80 AND /insights url
  // -----------------------------------------------------------------------
  it('8. throws MetaBudgetHighError when ads_insights call_count >= 80 AND url contains /insights', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-business-use-case-usage': BUC_HEADER_HIGH_INSIGHTS }),
    );

    await expect(fetchMeta(BASE_URL_INSIGHTS)).rejects.toThrow(MetaBudgetHighError);
  });

  // -----------------------------------------------------------------------
  // Test 9 — does NOT throw when ads_insights >= 80 BUT url is /campaigns
  // -----------------------------------------------------------------------
  it('9. does NOT throw when ads_insights call_count >= 80 BUT url is /campaigns (management endpoint)', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-business-use-case-usage': BUC_HEADER_HIGH_INSIGHTS }),
    );

    // /campaigns endpoint → management heuristic, insights BUC high is irrelevant
    await expect(fetchMeta(BASE_URL_CAMPAIGNS)).resolves.toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Test 10 — throws MetaBudgetHighError when ads_management >= 80 AND /campaigns url
  // -----------------------------------------------------------------------
  it('10. throws MetaBudgetHighError when ads_management call_count >= 80 AND url is /campaigns', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-business-use-case-usage': BUC_HEADER_HIGH_MANAGEMENT }),
    );

    await expect(fetchMeta(BASE_URL_CAMPAIGNS)).rejects.toThrow(MetaBudgetHighError);
  });

  // -----------------------------------------------------------------------
  // Test 11 — does NOT throw when both BUCs < 80
  // -----------------------------------------------------------------------
  it('11. does NOT throw when both BUCs < 80', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-business-use-case-usage': BUC_HEADER_NORMAL }),
    );

    await expect(fetchMeta(BASE_URL_INSIGHTS)).resolves.toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Test 12 — MetaBudgetHighError.message contains "META_BUDGET_HIGH"
  // -----------------------------------------------------------------------
  it('12. MetaBudgetHighError.message contains literal substring "META_BUDGET_HIGH"', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-business-use-case-usage': BUC_HEADER_HIGH_INSIGHTS }),
    );

    let caught: unknown;
    try {
      await fetchMeta(BASE_URL_INSIGHTS);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(MetaBudgetHighError);
    expect((caught as MetaBudgetHighError).message).toContain('META_BUDGET_HIGH');
  });

  // -----------------------------------------------------------------------
  // Test 13 — extractAdAccountIdFromUrl
  // -----------------------------------------------------------------------
  it('13. extractAdAccountIdFromUrl: act_123/insights → "123", URL without act_ → null', () => {
    expect(extractAdAccountIdFromUrl('https://graph.facebook.com/v25.0/act_123456789/insights?foo=bar')).toBe('123456789');
    expect(extractAdAccountIdFromUrl('https://graph.facebook.com/v25.0/act_123456789/campaigns?fields=name')).toBe('123456789');
    expect(extractAdAccountIdFromUrl('https://graph.facebook.com/v25.0/act_123456789?fields=currency')).toBe('123456789');
    expect(extractAdAccountIdFromUrl('https://graph.facebook.com/v25.0/?include_headers=false&access_token=tok')).toBeNull();
    expect(extractAdAccountIdFromUrl('https://example.com/no-act-pattern')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Test 14 — lookupStoreByAdAccount
  // -----------------------------------------------------------------------
  it('14. lookupStoreByAdAccount: when env matches → store id, when no match → null', () => {
    process.env.UZOSHOP_META_AD_ACCOUNT_ID = 'act_999';
    process.env.ZOLPLUS_META_AD_ACCOUNT_ID = '888';

    expect(lookupStoreByAdAccount('999')).toBe('uzoshop');     // strips act_ from env var
    expect(lookupStoreByAdAccount('888')).toBe('zolplus');     // env without act_ prefix
    expect(lookupStoreByAdAccount('000')).toBeNull();          // no match
    expect(lookupStoreByAdAccount(null)).toBeNull();           // null input

    delete process.env.ZOLPLUS_META_AD_ACCOUNT_ID;
  });

  // -----------------------------------------------------------------------
  // Test 15 — recordMetaBucUsage called with correct payload
  // -----------------------------------------------------------------------
  it('15. recordMetaBucUsage called with correct payload (composite key + pcts) when storeId + accountId resolved', async () => {
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-business-use-case-usage': BUC_HEADER_NORMAL }),
    );

    await fetchMeta(BASE_URL_INSIGHTS);

    expect(recordMetaBucUsageMock).toHaveBeenCalledOnce();
    const payload = recordMetaBucUsageMock.mock.calls[0][0];
    expect(payload.store_id).toBe('uzoshop');
    expect(payload.ad_account_id).toBe('123');
    expect(payload.ads_insights_call_pct).toBe(40);
    expect(payload.ads_management_call_pct).toBe(12);
    expect(payload.last_url).toBe('https://graph.facebook.com/v25.0/act_123/insights'); // no query string
  });

  // -----------------------------------------------------------------------
  // Test 16 — recordMetaBucUsage NOT called when accountId can't be extracted
  // -----------------------------------------------------------------------
  it('16. recordMetaBucUsage NOT called when accountId can\'t be extracted from URL', async () => {
    const urlWithoutActPattern = 'https://graph.facebook.com/v25.0/?include_headers=false&access_token=tok';
    fetchWithBackoffMock.mockResolvedValueOnce(
      buildMockResponse({ 'x-business-use-case-usage': BUC_HEADER_NORMAL }),
    );

    // Should not throw (pct is 40, below 80), and should not call recordMetaBucUsage
    await fetchMeta(urlWithoutActPattern);

    expect(recordMetaBucUsageMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 17 — passes through fetchWithBackoff with provider: 'meta'
  // -----------------------------------------------------------------------
  it('17. passes through fetchWithBackoff with provider: "meta"', async () => {
    const mockResponse = buildMockResponse({});
    fetchWithBackoffMock.mockResolvedValueOnce(mockResponse);

    const init: RequestInit = { method: 'GET' };
    const result = await fetchMeta(BASE_URL_INSIGHTS, init);

    expect(fetchWithBackoffMock).toHaveBeenCalledOnce();
    expect(fetchWithBackoffMock).toHaveBeenCalledWith(BASE_URL_INSIGHTS, init, { provider: 'meta' });
    expect(result).toBe(mockResponse);
  });
});

// ---------------------------------------------------------------------------
// Standalone unit tests for META_BUDGET_THRESHOLD_PCT + MetaBudgetHighError
// ---------------------------------------------------------------------------
describe('MetaBudgetHighError', () => {
  it('exposes pct property and has name MetaBudgetHighError', () => {
    const err = new MetaBudgetHighError(85);
    expect(err.pct).toBe(85);
    expect(err.name).toBe('MetaBudgetHighError');
    expect(err.message).toContain('META_BUDGET_HIGH');
    expect(err.message).toContain('85');
    expect(err.message).toContain(String(META_BUDGET_THRESHOLD_PCT));
  });
});
