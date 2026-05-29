// dashboard-web/src/lib/fetchers/__tests__/metaHotMetrics.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMetaHotMetricsForStore } from '@/lib/fetchers/metaHotMetrics';

const ADSET_INSIGHTS_BODY = JSON.stringify({
  data: [{
    campaign_id: 'C1', adset_id: 'AS1', impressions: '500', clicks: '10',
    spend: '25.0', actions: [], action_values: [],
    date_start: '2026-05-30', date_stop: '2026-05-30',
  }],
});

const AD_INSIGHTS_BODY = JSON.stringify({
  data: [{
    campaign_id: 'C1', adset_id: 'AS1', ad_id: 'AD1',
    impressions: '500', clicks: '10', spend: '25.0',
    actions: [], action_values: [],
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
      getFxCadFor: async (amount, currency) => currency === 'USD' ? amount * 1.36 : amount,
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0]).toMatchObject({ ad_set_id: 'AS1', campaign_id: 'C1' });
    expect(out.ads).toHaveLength(1);
    expect(out.ads[0]).toMatchObject({ ad_id: 'AD1', ad_set_id: 'AS1', campaign_id: 'C1' });
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
