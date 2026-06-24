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
