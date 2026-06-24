// dashboard-web/src/lib/fetchers/__tests__/metaHotMetrics.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMetaHotMetricsForStore } from '@/lib/fetchers/metaHotMetrics';

// CRIT-E: rows include account_currency (production stores are ILS).
// IMP-A: rows include campaign_name / adset_name / ad_name so the
// fixture enforces the preserve-on-upsert contract.
const ADSET_INSIGHTS_BODY = JSON.stringify({
  data: [{
    campaign_id: 'C1', campaign_name: 'Campaign 1',
    adset_id: 'AS1', adset_name: 'AdSet 1',
    impressions: '500', clicks: '10',
    spend: '25.0', actions: [], action_values: [],
    account_currency: 'ILS',
    date_start: '2026-05-30', date_stop: '2026-05-30',
  }],
});

const AD_INSIGHTS_BODY = JSON.stringify({
  data: [{
    campaign_id: 'C1', campaign_name: 'Campaign 1',
    adset_id: 'AS1', adset_name: 'AdSet 1',
    ad_id: 'AD1', ad_name: 'Ad 1',
    impressions: '500', clicks: '10', spend: '25.0',
    actions: [], action_values: [],
    account_currency: 'ILS',
    date_start: '2026-05-30', date_stop: '2026-05-30',
  }],
});

// CRIT-B: campaign-level fetch is removed; batch now has only adset + ad entries.
const BATCH_BODY = JSON.stringify([
  { code: 200, body: ADSET_INSIGHTS_BODY },
  { code: 200, body: AD_INSIGHTS_BODY },
]);

function mockFetch(body: string) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(body, {
    status: 200,
    headers: { 'x-business-use-case-usage': '{}' },
  }));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchMetaHotMetricsForStore()', () => {
  it('returns adsets + ads with insights for the hot set (no campaign-level rows per CRIT-B)', async () => {
    const fetchMock = mockFetch(BATCH_BODY);
    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop',
      adAccountId: 'act_111',
      accessToken: 'tok',
      hotCampaignIds: ['C1'],
      hotAdsetIds: ['AS1'],
      hotAdIds: ['AD1'],
      dateStr: '2026-05-30',
      fetcher: fetchMock,
      // CRIT-E: fixture uses account_currency='ILS' so getFx receives 'ILS'.
      getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount * 1.36,
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0]).toMatchObject({
      ad_set_id: 'AS1', campaign_id: 'C1',
      // IMP-A: name fields are preserved on the row payload.
      campaign_name: 'Campaign 1', ad_set_name: 'AdSet 1',
    });
    // CRIT-E: 25.0 ILS × 0.37 ≈ 9.25; would have been 25 × 1.36 = 34 if USD
    // were still hardcoded.
    expect(out.adsets[0].spend_cad).toBeCloseTo(9.25, 4);
    expect(out.ads).toHaveLength(1);
    expect(out.ads[0]).toMatchObject({
      ad_id: 'AD1', ad_set_id: 'AS1', campaign_id: 'C1',
      campaign_name: 'Campaign 1', ad_set_name: 'AdSet 1', ad_name: 'Ad 1',
    });
  });

  it('CRIT-D — uses omni_purchase → purchase priority chain (first match wins, not summed)', async () => {
    // Both omni_purchase and purchase are present; only omni_purchase should
    // be picked. If the chain were summed, conversions would be 7.
    const body = JSON.stringify({
      data: [{
        campaign_id: 'C1', campaign_name: 'C', adset_id: 'AS1', adset_name: 'AS',
        impressions: '100', clicks: '5', spend: '10',
        actions: [
          { action_type: 'omni_purchase', value: '3' },
          { action_type: 'purchase', value: '4' },
          { action_type: 'offsite_conversion.fb_pixel_purchase', value: '9' },
        ],
        action_values: [
          { action_type: 'omni_purchase', value: '150' },
          { action_type: 'purchase', value: '200' },
        ],
        account_currency: 'ILS',
        date_start: '2026-05-30', date_stop: '2026-05-30',
      }],
    });
    const batchBody = JSON.stringify([{ code: 200, body }]);
    const fetchMock = mockFetch(batchBody);
    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: [], hotAdsetIds: ['AS1'], hotAdIds: [],
      dateStr: '2026-05-30', fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount,
    });
    // omni_purchase wins → conversions=3, conversion_value (ILS)=150 → CAD≈55.5
    expect(out.adsets[0].conversions).toBe(3);
    expect(out.adsets[0].conversion_value_cad).toBeCloseTo(55.5, 4);
  });

  it('CRIT-D — falls back to purchase when omni_purchase missing', async () => {
    const body = JSON.stringify({
      data: [{
        campaign_id: 'C1', campaign_name: 'C', adset_id: 'AS1', adset_name: 'AS',
        impressions: '100', clicks: '5', spend: '10',
        actions: [
          { action_type: 'purchase', value: '4' },
          { action_type: 'offsite_conversion.fb_pixel_purchase', value: '9' },
        ],
        action_values: [{ action_type: 'purchase', value: '200' }],
        account_currency: 'ILS',
        date_start: '2026-05-30', date_stop: '2026-05-30',
      }],
    });
    const batchBody = JSON.stringify([{ code: 200, body }]);
    const fetchMock = mockFetch(batchBody);
    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: [], hotAdsetIds: ['AS1'], hotAdIds: [],
      dateStr: '2026-05-30', fetcher: fetchMock,
      getFxCadFor: async (amount) => amount * 0.37,
    });
    expect(out.adsets[0].conversions).toBe(4);
  });

  it('returns empty rows for empty hot sets', async () => {
    const fetchMock = mockFetch(BATCH_BODY);
    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop',
      adAccountId: 'act_111',
      accessToken: 'tok',
      hotCampaignIds: [],
      hotAdsetIds: [],
      hotAdIds: [],
      dateStr: '2026-05-30',
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    expect(out.adsets).toHaveLength(0);
    expect(out.ads).toHaveLength(0);
    // Should NOT have called fetch since all hot sets are empty
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // P1-11 (2026-06-10): FX failure → adapter returns null → the row payload
  // OMITS spend_cad + conversion_value_cad (key-level, not row-level) so the
  // worker's upsert ON CONFLICT preserves the last good value. The non-CAD
  // metrics (impressions/clicks/conversions) still refresh.
  it('P1-11: FX adapter returns null → adset + ad rows omit spend_cad/conversion_value_cad but keep non-CAD metrics', async () => {
    const fetchMock = mockFetch(BATCH_BODY);
    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: ['C1'], hotAdsetIds: ['AS1'], hotAdIds: ['AD1'],
      dateStr: '2026-05-30', fetcher: fetchMock,
      // Frankfurter outage: every non-CAD conversion fails.
      getFxCadFor: async () => null,
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0]).not.toHaveProperty('spend_cad');
    expect(out.adsets[0]).not.toHaveProperty('conversion_value_cad');
    // Non-CAD metrics still refresh this tick.
    expect(out.adsets[0]).toMatchObject({
      campaign_id: 'C1', ad_set_id: 'AS1', impressions: 500, clicks: 10,
    });
    expect(out.ads[0]).not.toHaveProperty('spend_cad');
    expect(out.ads[0]).not.toHaveProperty('conversion_value_cad');
    expect(out.ads[0]).toMatchObject({ ad_id: 'AD1', impressions: 500 });
  });

  // P1-12 (2026-06-10): inner batch-part failure must THROW (worker records
  // transient_error + Inngest retries) instead of silently yielding [] and a
  // false freshness-success.
  it('P1-12: throws when an inner batch part has code !== 200 (error payload in the message)', async () => {
    const errorPart = JSON.stringify({
      error: { message: '(#80004) There have been too many calls', code: 80004 },
    });
    const batchBody = JSON.stringify([
      { code: 400, body: errorPart },
      { code: 200, body: AD_INSIGHTS_BODY },
    ]);
    const fetchMock = mockFetch(batchBody);
    await expect(
      fetchMetaHotMetricsForStore({
        storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
        hotCampaignIds: ['C1'], hotAdsetIds: ['AS1'], hotAdIds: ['AD1'],
        dateStr: '2026-05-30', fetcher: fetchMock,
        getFxCadFor: async (amount) => amount,
      }),
    ).rejects.toThrow(/code=400.*too many calls/);
  });

  // #17 (2026-06-20): a 200 part with a corrupt/unparseable body must THROW
  // (worker catch → transient_error → Inngest retry), not silently return []
  // — which made hot-metrics spend stop refreshing while the panel stayed
  // green. The code already throws on code!==200 + null part; the parse-fail
  // branch was the lone false-success.
  it('#17: throws when a 200 part has an unparseable body (not silently [])', async () => {
    const batchBody = JSON.stringify([
      { code: 200, body: '<html>502 Bad Gateway</html>' },
      { code: 200, body: AD_INSIGHTS_BODY },
    ]);
    const fetchMock = mockFetch(batchBody);
    await expect(
      fetchMetaHotMetricsForStore({
        storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
        hotCampaignIds: ['C1'], hotAdsetIds: ['AS1'], hotAdIds: ['AD1'],
        dateStr: '2026-05-30', fetcher: fetchMock,
        getFxCadFor: async (amount) => amount,
      }),
    ).rejects.toThrow(/unparseable/i);
  });

  it('uses filtering=[IN, hot_ids] in each sub-request URL', async () => {
    const fetchMock = mockFetch(BATCH_BODY);
    await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: ['C1', 'C2'], hotAdsetIds: ['AS1'], hotAdIds: ['AD1'],
      dateStr: '2026-05-30', fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    const body = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(body).toMatch(/filtering/);
    // The body is double-encoded: encodeURIComponent for the filtering JSON,
    // then URLSearchParams.toString() encodes the whole batch JSON again.
    // Decode twice to assert the raw filter ids are present.
    const fullyDecoded = decodeURIComponent(decodeURIComponent(body));
    expect(fullyDecoded).toContain('"AS1"');
  });

  // ── Chunking tests (ID-volume fix) ─────────────────────────────────────────

  /**
   * CHUNK-1: 120 hot ad IDs → 3 chunked ad sub-requests (≤50 IDs each).
   * Each batch sub-request must carry at most 50 IDs in its `filtering`.
   * All 3 parts' rows must be merged into `ads`.
   */
  it('CHUNK-1: 120 hot ad IDs split into 3 sub-requests of ≤50 IDs each, all rows merged', async () => {
    // Build 120 unique ad IDs.
    const hotAdIds = Array.from({ length: 120 }, (_, i) => `AD${i + 1}`);

    // Each chunk returns 1 row — so 3 chunks → 3 ad rows total.
    function makeAdPartBody(adIds: string[]) {
      return JSON.stringify({
        data: adIds.map((id) => ({
          campaign_id: 'C1', campaign_name: 'Campaign 1',
          adset_id: 'AS1', adset_name: 'AdSet 1',
          ad_id: id, ad_name: `Ad ${id}`,
          impressions: '10', clicks: '1', spend: '1.0',
          actions: [], action_values: [], account_currency: 'ILS',
          date_start: '2026-05-30', date_stop: '2026-05-30',
        })),
      });
    }

    // With no adsets and 120 ad IDs → ceil(120/50)=3 ad chunks → 3 sub-requests.
    // All fit in one batch POST (3 ≤ 50). Reply = array of 3 parts.
    const batchResponse = JSON.stringify([
      { code: 200, body: makeAdPartBody(hotAdIds.slice(0, 50)) },
      { code: 200, body: makeAdPartBody(hotAdIds.slice(50, 100)) },
      { code: 200, body: makeAdPartBody(hotAdIds.slice(100, 120)) },
    ]);
    const fetchMock = mockFetch(batchResponse);

    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: [], hotAdsetIds: [], hotAdIds,
      dateStr: '2026-05-30', fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount,
    });

    // 120 rows merged from 3 chunks.
    expect(out.ads).toHaveLength(120);
    expect(out.adsets).toHaveLength(0);

    // Exactly 1 fetch call (all 3 sub-requests fit in one batch POST).
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verify no sub-request in the batch carried more than 50 IDs.
    const sentBody = fetchMock.mock.calls[0]?.[1]?.body as string;
    const parsed = new URLSearchParams(sentBody);
    const batchArr = JSON.parse(parsed.get('batch') ?? '[]') as Array<{ relative_url: string }>;
    expect(batchArr).toHaveLength(3);
    for (const sub of batchArr) {
      const decoded = decodeURIComponent(decodeURIComponent(sub.relative_url));
      const filterMatch = decoded.match(/"value"\s*:\s*(\[[^\]]*\])/);
      expect(filterMatch).not.toBeNull();
      const ids = JSON.parse(filterMatch![1]) as string[];
      expect(ids.length).toBeLessThanOrEqual(50);
    }
  });

  /**
   * CHUNK-2: adset + ad both chunked (60 adset + 60 ad IDs).
   * Expect ceil(60/50)=2 adset sub-requests + ceil(60/50)=2 ad sub-requests = 4 total.
   * All fit in one batch POST. Results grouped by level and merged.
   */
  it('CHUNK-2: 60 adset + 60 ad IDs → 2 adset + 2 ad sub-requests, results merged by level', async () => {
    const hotAdsetIds = Array.from({ length: 60 }, (_, i) => `AS${i + 1}`);
    const hotAdIds = Array.from({ length: 60 }, (_, i) => `AD${i + 1}`);

    function makeAdsetPartBody(adsetIds: string[]) {
      return JSON.stringify({
        data: adsetIds.map((id) => ({
          campaign_id: 'C1', campaign_name: 'Campaign 1',
          adset_id: id, adset_name: `AdSet ${id}`,
          impressions: '10', clicks: '1', spend: '1.0',
          actions: [], action_values: [], account_currency: 'ILS',
          date_start: '2026-05-30', date_stop: '2026-05-30',
        })),
      });
    }
    function makeAdPartBody(adIds: string[]) {
      return JSON.stringify({
        data: adIds.map((id) => ({
          campaign_id: 'C1', campaign_name: 'Campaign 1',
          adset_id: 'AS1', adset_name: 'AdSet 1',
          ad_id: id, ad_name: `Ad ${id}`,
          impressions: '10', clicks: '1', spend: '1.0',
          actions: [], action_values: [], account_currency: 'ILS',
          date_start: '2026-05-30', date_stop: '2026-05-30',
        })),
      });
    }

    // 4 parts: adset-chunk1, adset-chunk2, ad-chunk1, ad-chunk2.
    const batchResponse = JSON.stringify([
      { code: 200, body: makeAdsetPartBody(hotAdsetIds.slice(0, 50)) },
      { code: 200, body: makeAdsetPartBody(hotAdsetIds.slice(50, 60)) },
      { code: 200, body: makeAdPartBody(hotAdIds.slice(0, 50)) },
      { code: 200, body: makeAdPartBody(hotAdIds.slice(50, 60)) },
    ]);
    const fetchMock = mockFetch(batchResponse);

    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: [], hotAdsetIds, hotAdIds,
      dateStr: '2026-05-30', fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount,
    });

    expect(out.adsets).toHaveLength(60);
    expect(out.ads).toHaveLength(60);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verify sub-request grouping: first 2 are adset-level, next 2 are ad-level.
    const sentBody = fetchMock.mock.calls[0]?.[1]?.body as string;
    const parsed = new URLSearchParams(sentBody);
    const batchArr = JSON.parse(parsed.get('batch') ?? '[]') as Array<{ relative_url: string }>;
    expect(batchArr).toHaveLength(4);
    expect(batchArr[0].relative_url).toContain('level=adset');
    expect(batchArr[1].relative_url).toContain('level=adset');
    expect(batchArr[2].relative_url).toContain('level=ad');
    expect(batchArr[3].relative_url).toContain('level=ad');
  });

  /**
   * CHUNK-3: small set (≤50 each) → exactly 1 sub-request per non-empty level.
   * Validates unchanged behavior for stores with few active entities.
   */
  it('CHUNK-3: ≤50 adset + ≤50 ad IDs → exactly 1 sub-request per level (unchanged behavior)', async () => {
    const fetchMock = mockFetch(BATCH_BODY);
    await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: [], hotAdsetIds: ['AS1'], hotAdIds: ['AD1'],
      dateStr: '2026-05-30', fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentBody = fetchMock.mock.calls[0]?.[1]?.body as string;
    const parsed = new URLSearchParams(sentBody);
    const batchArr = JSON.parse(parsed.get('batch') ?? '[]') as Array<{ relative_url: string }>;
    // 1 adset chunk + 1 ad chunk = 2 sub-requests, same as original.
    expect(batchArr).toHaveLength(2);
    expect(batchArr[0].relative_url).toContain('level=adset');
    expect(batchArr[1].relative_url).toContain('level=ad');
  });

  /**
   * CHUNK-4 (regression): empty hot sets → no fetch call, returns empty arrays.
   * This is already tested above; adding here as explicit chunking regression
   * to ensure the chunking refactor doesn't accidentally call fetch.
   */
  it('CHUNK-4: empty hot sets → no fetch call (chunking regression)', async () => {
    const fetchMock = vi.fn();
    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: [], hotAdsetIds: [], hotAdIds: [],
      dateStr: '2026-05-30', fetcher: fetchMock as unknown as typeof fetch,
      getFxCadFor: async () => 0,
    });
    expect(out.adsets).toHaveLength(0);
    expect(out.ads).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * CHUNK-5: a failed sub-request part (code≠200) must throw with level+chunk
   * context in the error message. Ensures errors are not silently swallowed
   * when chunking splits across multiple sub-requests.
   */
  it('CHUNK-5: failed batch part (code≠200) throws with level and chunk context in error message', async () => {
    const hotAdIds = Array.from({ length: 60 }, (_, i) => `AD${i + 1}`);
    const errorPart = JSON.stringify({
      error: { message: '(#100) Invalid parameter', code: 100, error_subcode: 1504018 },
    });

    // 2 ad chunks; second chunk fails.
    const batchResponse = JSON.stringify([
      {
        code: 200, body: JSON.stringify({
          data: [{
            campaign_id: 'C1', campaign_name: 'C', adset_id: 'AS1', adset_name: 'AS',
            ad_id: 'AD1', ad_name: 'A', impressions: '10', clicks: '1', spend: '1.0',
            actions: [], action_values: [], account_currency: 'ILS',
            date_start: '2026-05-30', date_stop: '2026-05-30',
          }],
        }),
      },
      { code: 400, body: errorPart },
    ]);
    const fetchMock = mockFetch(batchResponse);

    await expect(
      fetchMetaHotMetricsForStore({
        storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
        hotCampaignIds: [], hotAdsetIds: [], hotAdIds,
        dateStr: '2026-05-30', fetcher: fetchMock,
        getFxCadFor: async (amount) => amount,
      }),
    ).rejects.toThrow(/ad.*chunk|chunk.*ad|level.*ad|ad.*level/i);
  });

  // ── Gap-closure tests (adversarial review 2026-06-24) ─────────────────────

  /**
   * CHUNK-7: Anti-level-swap — ASYMMETRIC counts + IDENTITY assertions.
   *
   * CHUNK-2 used symmetric 60/60 counts and only asserted array lengths,
   * so a hypothetical bug that routes adset response parts into `ads`
   * (and vice-versa) would still produce two 60-element arrays and both
   * length assertions would pass.
   *
   * This test uses ASYMMETRIC counts (60 adset IDs + 110 ad IDs) and
   * asserts ROW IDENTITY:
   *   • every row in result.adsets has `ad_set_id` and NO `ad_id`
   *   • every row in result.ads has `ad_id`
   *   • counts are 60 and 110 respectively
   *
   * Mutation that would cause failure:
   *   If adset parts were routed to the `adRaw` accumulator and ad parts
   *   to `adsetRaw`, `result.adsets` would contain 110 ad-shaped rows
   *   (which have `ad_id`), and the `not.toHaveProperty('ad_id')` and
   *   `toHaveLength(60)` assertions would both fail.
   */
  it('CHUNK-7: 60 adset + 110 ad IDs — identity assertions detect level-swap mis-routing', async () => {
    const hotAdsetIds = Array.from({ length: 60 }, (_, i) => `AS${i + 1}`);
    const hotAdIds    = Array.from({ length: 110 }, (_, i) => `AD${i + 1}`);

    // 60 adset IDs → ceil(60/50) = 2 adset chunks.
    // 110 ad IDs   → ceil(110/50) = 3 ad chunks.
    // Total = 5 sub-requests → 1 batch POST.
    // Sub-request order: adset-chunk-0, adset-chunk-1, ad-chunk-0, ad-chunk-1, ad-chunk-2.

    function makeAdsetPartBody(ids: string[]) {
      return JSON.stringify({
        data: ids.map((id) => ({
          campaign_id: 'C1', campaign_name: 'Campaign 1',
          adset_id: id, adset_name: `AdSet ${id}`,
          // Deliberately NO ad_id field — adset-shaped rows.
          impressions: '10', clicks: '1', spend: '1.0',
          actions: [], action_values: [], account_currency: 'ILS',
          date_start: '2026-05-30', date_stop: '2026-05-30',
        })),
      });
    }
    function makeAdPartBody(ids: string[]) {
      return JSON.stringify({
        data: ids.map((id) => ({
          campaign_id: 'C1', campaign_name: 'Campaign 1',
          adset_id: 'AS1', adset_name: 'AdSet 1',
          ad_id: id, ad_name: `Ad ${id}`,
          impressions: '10', clicks: '1', spend: '1.0',
          actions: [], action_values: [], account_currency: 'ILS',
          date_start: '2026-05-30', date_stop: '2026-05-30',
        })),
      });
    }

    // Parts in sub-request order: 2 adset chunks, 3 ad chunks.
    const batchResponse = JSON.stringify([
      { code: 200, body: makeAdsetPartBody(hotAdsetIds.slice(0, 50)) },   // adset chunk 0: AS1..AS50
      { code: 200, body: makeAdsetPartBody(hotAdsetIds.slice(50, 60)) },  // adset chunk 1: AS51..AS60
      { code: 200, body: makeAdPartBody(hotAdIds.slice(0, 50)) },         // ad chunk 0: AD1..AD50
      { code: 200, body: makeAdPartBody(hotAdIds.slice(50, 100)) },       // ad chunk 1: AD51..AD100
      { code: 200, body: makeAdPartBody(hotAdIds.slice(100, 110)) },      // ad chunk 2: AD101..AD110
    ]);
    const fetchMock = mockFetch(batchResponse);

    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: [], hotAdsetIds, hotAdIds,
      dateStr: '2026-05-30', fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount,
    });

    // Exact counts — asymmetric so a swap is detectable.
    expect(out.adsets).toHaveLength(60);
    expect(out.ads).toHaveLength(110);

    // Identity: every adset row is adset-shaped (has ad_set_id, no ad_id).
    for (const row of out.adsets) {
      expect(row).toHaveProperty('ad_set_id');
      expect(row).not.toHaveProperty('ad_id');
    }
    // Identity: every ad row is ad-shaped (has ad_id).
    for (const row of out.ads) {
      expect(row).toHaveProperty('ad_id');
    }

    // Spot-check a known adset row and a known ad row for correct content.
    expect(out.adsets.find((r) => r.ad_set_id === 'AS1')).toBeDefined();
    expect(out.adsets.find((r) => r.ad_set_id === 'AS60')).toBeDefined();
    expect(out.ads.find((r) => r.ad_id === 'AD1')).toBeDefined();
    expect(out.ads.find((r) => r.ad_id === 'AD110')).toBeDefined();
  });

  /**
   * CHUNK-8: Chunk boundary — exactly 50 vs 51 hot ad IDs.
   *
   * 50 ad IDs → ceil(50/50) = 1 ad-level sub-request (exactly one chunk).
   * 51 ad IDs → ceil(51/50) = 2 ad-level sub-requests (two chunks).
   *
   * Assertions:
   *   • batch array length (= number of ad sub-requests per POST)
   *   • no single sub-request's `filtering` value array exceeds 50 IDs
   *
   * Mutation that would cause failure:
   *   An off-by-one in the chunk() function that produces chunks of 51
   *   would cause the 50-ID case to still produce 1 sub-request (passing)
   *   but the 51-ID case to also produce 1 sub-request (failing the length=2
   *   assertion). An off-by-one that chunks at 49 would cause the 50-ID
   *   case to produce 2 sub-requests (failing length=1 assertion).
   *   The max-IDs-per-chunk assertion catches any chunk that carries >50 IDs.
   */
  it('CHUNK-8: exactly 50 ad IDs → 1 ad sub-request; 51 ad IDs → 2 ad sub-requests', async () => {
    // Helper: count ad-level sub-requests in the batch body sent by fetchMock.
    function countAdSubRequests(fetchMock: ReturnType<typeof vi.fn>): number {
      const sentBody = fetchMock.mock.calls[0]?.[1]?.body as string;
      const parsed = new URLSearchParams(sentBody);
      const batchArr = JSON.parse(parsed.get('batch') ?? '[]') as Array<{ relative_url: string }>;
      return batchArr.filter((s) => s.relative_url.includes('level=ad')).length;
    }

    // Helper: assert max IDs per ad sub-request.
    function assertMaxIdsPerChunk(fetchMock: ReturnType<typeof vi.fn>): void {
      const sentBody = fetchMock.mock.calls[0]?.[1]?.body as string;
      const parsed = new URLSearchParams(sentBody);
      const batchArr = JSON.parse(parsed.get('batch') ?? '[]') as Array<{ relative_url: string }>;
      for (const sub of batchArr.filter((s) => s.relative_url.includes('level=ad'))) {
        const decoded = decodeURIComponent(decodeURIComponent(sub.relative_url));
        const filterMatch = decoded.match(/"value"\s*:\s*(\[[^\]]*\])/);
        expect(filterMatch).not.toBeNull();
        const ids = JSON.parse(filterMatch![1]) as string[];
        expect(ids.length).toBeLessThanOrEqual(50);
      }
    }

    // ── Case A: exactly 50 ad IDs → 1 ad sub-request ────────────────────────
    {
      const hotAdIds50 = Array.from({ length: 50 }, (_, i) => `AD${i + 1}`);
      const adPartBody50 = JSON.stringify({
        data: hotAdIds50.map((id) => ({
          campaign_id: 'C1', campaign_name: 'Campaign 1',
          adset_id: 'AS1', adset_name: 'AdSet 1',
          ad_id: id, ad_name: `Ad ${id}`,
          impressions: '5', clicks: '1', spend: '0.5',
          actions: [], action_values: [], account_currency: 'ILS',
          date_start: '2026-05-30', date_stop: '2026-05-30',
        })),
      });
      const batchResponse50 = JSON.stringify([{ code: 200, body: adPartBody50 }]);
      const fetchMock50 = mockFetch(batchResponse50);

      const out50 = await fetchMetaHotMetricsForStore({
        storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
        hotCampaignIds: [], hotAdsetIds: [], hotAdIds: hotAdIds50,
        dateStr: '2026-05-30', fetcher: fetchMock50,
        getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount,
      });

      expect(out50.ads).toHaveLength(50);
      expect(countAdSubRequests(fetchMock50)).toBe(1); // exactly 1 chunk
      assertMaxIdsPerChunk(fetchMock50);
    }

    // ── Case B: exactly 51 ad IDs → 2 ad sub-requests ───────────────────────
    {
      const hotAdIds51 = Array.from({ length: 51 }, (_, i) => `AD${i + 1}`);
      function makeAdBody(ids: string[]) {
        return JSON.stringify({
          data: ids.map((id) => ({
            campaign_id: 'C1', campaign_name: 'Campaign 1',
            adset_id: 'AS1', adset_name: 'AdSet 1',
            ad_id: id, ad_name: `Ad ${id}`,
            impressions: '5', clicks: '1', spend: '0.5',
            actions: [], action_values: [], account_currency: 'ILS',
            date_start: '2026-05-30', date_stop: '2026-05-30',
          })),
        });
      }
      // 2 sub-requests in 1 batch POST: chunk-0 (IDs 1-50) + chunk-1 (ID 51).
      const batchResponse51 = JSON.stringify([
        { code: 200, body: makeAdBody(hotAdIds51.slice(0, 50)) },
        { code: 200, body: makeAdBody(hotAdIds51.slice(50)) },
      ]);
      const fetchMock51 = mockFetch(batchResponse51);

      const out51 = await fetchMetaHotMetricsForStore({
        storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
        hotCampaignIds: [], hotAdsetIds: [], hotAdIds: hotAdIds51,
        dateStr: '2026-05-30', fetcher: fetchMock51,
        getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount,
      });

      expect(out51.ads).toHaveLength(51);
      expect(countAdSubRequests(fetchMock51)).toBe(2); // two chunks
      assertMaxIdsPerChunk(fetchMock51);
    }
  });

  /**
   * CHUNK-9: Batch-POST boundary — exactly 50 vs 51 total sub-requests.
   *
   * Each batch POST holds at most MAX_BATCH_SIZE=50 sub-requests.
   *   • 50 total sub-requests → exactly ONE fetch/POST call.
   *   • 51 total sub-requests → exactly TWO fetch/POST calls.
   *
   * Configuration chosen to hit the boundary cleanly (no adset IDs, only
   * ad IDs, because adset=0 means 0 adset chunks):
   *   50 total: 0 adset chunks + 50 ad chunks = 50 × 50 = 2500 ad IDs
   *     → ceil(2500/50)=50 ad chunks = 50 sub-requests → 1 POST.
   *   51 total: 0 adset chunks + 51 ad chunks = 51 × 50 = 2550 ad IDs
   *     → ceil(2550/50)=51 ad chunks = 51 sub-requests → 2 POSTs (50+1).
   *
   * Assertions:
   *   • fetch call count: 1 vs 2
   *   • all rows (one per chunk, 50 vs 51) are merged into result.ads
   *
   * Mutation that would cause failure:
   *   If the batch-split used > MAX_BATCH_SIZE (e.g. 51), the 50-request
   *   case would still be 1 POST but the 51-request case would also be 1
   *   POST (failing fetchMock.toHaveBeenCalledTimes(2)). If it used
   *   < MAX_BATCH_SIZE (e.g. 49), the 50-request case would split into
   *   2 POSTs (failing toHaveBeenCalledTimes(1)).
   */
  it('CHUNK-9: exactly 50 total sub-requests → 1 batch POST; 51 total → 2 batch POSTs', async () => {
    // Build a fixture where every ad chunk (of size 50) returns exactly
    // one sentinel row identified by its chunk index. This lets us verify
    // that all rows across multiple POSTs are merged correctly.
    function makeOneAdRow(chunkIdx: number) {
      const id = `AD_CHUNK${chunkIdx}`;
      return JSON.stringify({
        data: [{
          campaign_id: 'C1', campaign_name: 'Campaign 1',
          adset_id: 'AS1', adset_name: 'AdSet 1',
          ad_id: id, ad_name: `Sentinel Ad chunk${chunkIdx}`,
          impressions: '1', clicks: '0', spend: '0.1',
          actions: [], action_values: [], account_currency: 'ILS',
          date_start: '2026-05-30', date_stop: '2026-05-30',
        }],
      });
    }

    // ── Case A: 2500 ad IDs → 50 chunks → 1 POST ─────────────────────────
    {
      const hotAdIds2500 = Array.from({ length: 2500 }, (_, i) => `AD${i + 1}`);
      // 50 chunks → 1 POST response with 50 parts, one row each.
      const parts50 = Array.from({ length: 50 }, (_, k) => ({
        code: 200,
        body: makeOneAdRow(k),
      }));
      const fetchMock50 = mockFetch(JSON.stringify(parts50));

      const out50 = await fetchMetaHotMetricsForStore({
        storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
        hotCampaignIds: [], hotAdsetIds: [], hotAdIds: hotAdIds2500,
        dateStr: '2026-05-30', fetcher: fetchMock50,
        getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount,
      });

      expect(fetchMock50).toHaveBeenCalledTimes(1); // exactly one batch POST
      expect(out50.ads).toHaveLength(50);           // 50 sentinel rows merged
      expect(out50.adsets).toHaveLength(0);
    }

    // ── Case B: 2550 ad IDs → 51 chunks → 2 POSTs (50 + 1) ──────────────
    {
      const hotAdIds2550 = Array.from({ length: 2550 }, (_, i) => `AD${i + 1}`);
      // 51 chunks → split across 2 batch POSTs: first 50 parts, then 1 part.
      const parts51 = Array.from({ length: 51 }, (_, k) => ({
        code: 200,
        body: makeOneAdRow(k),
      }));
      const post1Body = JSON.stringify(parts51.slice(0, 50));
      const post2Body = JSON.stringify(parts51.slice(50));

      let callCount = 0;
      const fetchMock51 = vi.fn(async () => {
        const body = callCount === 0 ? post1Body : post2Body;
        callCount++;
        return new Response(body, { status: 200 });
      });

      const out51 = await fetchMetaHotMetricsForStore({
        storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
        hotCampaignIds: [], hotAdsetIds: [], hotAdIds: hotAdIds2550,
        dateStr: '2026-05-30', fetcher: fetchMock51 as unknown as typeof fetch,
        getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount,
      });

      expect(fetchMock51).toHaveBeenCalledTimes(2); // two batch POSTs
      expect(out51.ads).toHaveLength(51);            // 51 sentinel rows merged
      expect(out51.adsets).toHaveLength(0);
    }
  });

  /**
   * CHUNK-6: >50 total sub-requests → multiple batch POSTs.
   * 130 adset IDs → ceil(130/50)=3 adset chunks.
   * 130 ad IDs   → ceil(130/50)=3 ad chunks.
   * Total = 6 sub-requests → fits in ONE batch POST (6 ≤ 50).
   *
   * To trigger MULTIPLE batch POSTs we need >50 sub-requests total.
   * That requires (ceil(adsetIds/50) + ceil(adIds/50)) > 50.
   * Simplest: 1300 adset IDs → 26 adset chunks + 1300 ad IDs → 26 ad chunks = 52 > 50.
   * → 2 batch POSTs: first with 50 sub-requests, second with 2.
   */
  it('CHUNK-6: >50 total sub-requests → multiple batch POSTs issued, all rows merged', async () => {
    // 1300 adset IDs → ceil(1300/50)=26 adset chunks.
    // 1300 ad IDs   → ceil(1300/50)=26 ad chunks.
    // Total = 52 sub-requests → 2 batch POSTs (50 + 2).
    const hotAdsetIds = Array.from({ length: 1300 }, (_, i) => `AS${i + 1}`);
    const hotAdIds    = Array.from({ length: 1300 }, (_, i) => `AD${i + 1}`);

    // Each sub-request returns exactly 1 row to keep assertions simple.
    // For a given chunk-index k of the adset type: 1 adset row with id AS<k*50+1>.
    function makeOneAdsetRow(id: string) {
      return {
        campaign_id: 'C1', campaign_name: 'Campaign 1',
        adset_id: id, adset_name: `AdSet ${id}`,
        impressions: '1', clicks: '0', spend: '0.1',
        actions: [], action_values: [], account_currency: 'ILS',
        date_start: '2026-05-30', date_stop: '2026-05-30',
      };
    }
    function makeOneAdRow(id: string) {
      return {
        campaign_id: 'C1', campaign_name: 'Campaign 1',
        adset_id: 'AS1', adset_name: 'AdSet 1',
        ad_id: id, ad_name: `Ad ${id}`,
        impressions: '1', clicks: '0', spend: '0.1',
        actions: [], action_values: [], account_currency: 'ILS',
        date_start: '2026-05-30', date_stop: '2026-05-30',
      };
    }

    // Build 26 adset-chunk parts and 26 ad-chunk parts (one row each).
    const adsetParts = Array.from({ length: 26 }, (_, k) => ({
      code: 200,
      body: JSON.stringify({ data: [makeOneAdsetRow(`AS${k * 50 + 1}`)] }),
    }));
    const adParts = Array.from({ length: 26 }, (_, k) => ({
      code: 200,
      body: JSON.stringify({ data: [makeOneAdRow(`AD${k * 50 + 1}`)] }),
    }));

    // All 52 sub-requests interleaved adset…then ad…
    // Batch POST 1: first 50 sub-requests (adset[0..25] + ad[0..23]).
    // Batch POST 2: remaining 2 (ad[24..25]).
    const allParts = [...adsetParts, ...adParts];
    const post1Response = JSON.stringify(allParts.slice(0, 50));
    const post2Response = JSON.stringify(allParts.slice(50));

    // fetchMock returns different responses per call.
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      const body = callCount === 0 ? post1Response : post2Response;
      callCount++;
      return new Response(body, { status: 200 });
    });

    const out = await fetchMetaHotMetricsForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      hotCampaignIds: [], hotAdsetIds, hotAdIds,
      dateStr: '2026-05-30', fetcher: fetchMock as unknown as typeof fetch,
      getFxCadFor: async (amount, currency) => currency === 'ILS' ? amount * 0.37 : amount,
    });

    // 2 batch POSTs were issued.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 26 adset rows + 26 ad rows merged.
    expect(out.adsets).toHaveLength(26);
    expect(out.ads).toHaveLength(26);
  });
});
