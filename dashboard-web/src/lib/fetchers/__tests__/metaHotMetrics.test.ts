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
});
