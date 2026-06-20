import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMetaStatusForStore } from '@/lib/fetchers/metaStatus';

const BATCH_RESPONSE_BODY = JSON.stringify([
  {
    code: 200,
    body: JSON.stringify({
      data: [{
        id: 'C1', name: 'Hair Serum',
        configured_status: 'ACTIVE', effective_status: 'ACTIVE',
        updated_time: '2026-05-29T14:10:00+0000',
      }],
    }),
  },
  {
    code: 200,
    body: JSON.stringify({
      data: [{
        id: 'AS1', campaign_id: 'C1', name: 'Adset A',
        configured_status: 'ACTIVE', effective_status: 'ACTIVE',
        daily_budget: '5000', updated_time: '2026-05-29T14:10:00+0000',
      }],
    }),
  },
  {
    code: 200,
    body: JSON.stringify({
      data: [{
        id: 'AD1', adset_id: 'AS1', campaign_id: 'C1', name: 'Ad A',
        configured_status: 'ACTIVE', effective_status: 'ACTIVE',
        updated_time: '2026-05-29T14:10:00+0000',
      }],
    }),
  },
]);

function mockFetch(body: string, bucHeader: string) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(body, {
    status: 200,
    headers: { 'x-business-use-case-usage': bucHeader },
  }));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('fetchMetaStatusForStore()', () => {
  it('returns campaigns + adsets + ads normalized to the registry shape', async () => {
    const fetchMock = mockFetch(BATCH_RESPONSE_BODY, '{}');
    const out = await fetchMetaStatusForStore({
      storeId: 'uzoshop',
      adAccountId: 'act_111',
      accessToken: 'tok',
      fetcher: fetchMock,
      getFxCadFor: async (amount, currency) => currency === 'USD' ? amount * 1.36 : amount,
    });

    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'meta',
      campaign_id: 'C1', name: 'Hair Serum',
      configured_status: 'ACTIVE', effective_status: 'ACTIVE',
    });
    expect(out.adsets).toHaveLength(1);
    expect(out.adsets[0]).toMatchObject({ adset_id: 'AS1', campaign_id: 'C1' });
    expect(out.ads).toHaveLength(1);
    expect(out.ads[0]).toMatchObject({ ad_id: 'AD1', adset_id: 'AS1', campaign_id: 'C1' });
  });

  it('parses BUC header into ads_insights_call_pct etc when present', async () => {
    const buc = JSON.stringify({
      '111': [{
        type: 'ads_insights',
        call_count: 50,
        total_cputime: 30,
        total_time: 25,
        estimated_time_to_regain_access: 0,
      }],
    });
    const fetchMock = mockFetch(BATCH_RESPONSE_BODY, buc);
    const out = await fetchMetaStatusForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    expect(out.bucUsage.ads_insights_call_pct).toBe(50);
  });

  it('uses HTTPS POST with batch JSON array of 3 sub-requests', async () => {
    const fetchMock = mockFetch(BATCH_RESPONSE_BODY, '{}');
    await fetchMetaStatusForStore({
      storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
      fetcher: fetchMock,
      getFxCadFor: async () => 0,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\//);
    expect(init?.method).toBe('POST');
    const body = init?.body as string;
    expect(body).toContain('act_111%2Fcampaigns');
    expect(body).toContain('act_111%2Fadsets');
    expect(body).toContain('act_111%2Fads');
  });

  // P1-12 (2026-06-10): an inner batch part with code !== 200 must THROW
  // (worker catch → transient_error → Inngest retry), not silently return []
  // — which made the worker upsert nothing and record freshness='success'.
  it('P1-12: throws when an inner batch part has code !== 200 (error payload in the message)', async () => {
    const errorPart = JSON.stringify({
      error: { message: '(#17) User request limit reached', code: 17 },
    });
    const bodyWithFailedPart = JSON.stringify([
      { code: 500, body: errorPart },
      { code: 200, body: JSON.stringify({ data: [] }) },
      { code: 200, body: JSON.stringify({ data: [] }) },
    ]);
    const fetchMock = mockFetch(bodyWithFailedPart, '{}');
    await expect(
      fetchMetaStatusForStore({
        storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
        fetcher: fetchMock,
        getFxCadFor: async () => 0,
      }),
    ).rejects.toThrow(/code=500.*User request limit reached/);
  });

  it('P1-12: throws when a batch part is null (Meta returns null for timed-out parts)', async () => {
    const bodyWithNullPart = JSON.stringify([
      null,
      { code: 200, body: JSON.stringify({ data: [] }) },
      { code: 200, body: JSON.stringify({ data: [] }) },
    ]);
    const fetchMock = mockFetch(bodyWithNullPart, '{}');
    await expect(
      fetchMetaStatusForStore({
        storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
        fetcher: fetchMock,
        getFxCadFor: async () => 0,
      }),
    ).rejects.toThrow(/batch part missing\/null/);
  });

  // #17 (2026-06-20): a 200 part with a corrupt/unparseable body must THROW
  // (worker catch → transient_error → Inngest retry), not silently return []
  // — which made the worker upsert zero rows yet mark status scopes green,
  // so newly-active adsets silently vanished. The parse-fail branch was the
  // lone false-success path left after P1-12.
  it('#17: throws when a 200 part has an unparseable body (not silently [])', async () => {
    const bodyWithCorruptPart = JSON.stringify([
      { code: 200, body: '<html>502 Bad Gateway</html>' },
      { code: 200, body: JSON.stringify({ data: [] }) },
      { code: 200, body: JSON.stringify({ data: [] }) },
    ]);
    const fetchMock = mockFetch(bodyWithCorruptPart, '{}');
    await expect(
      fetchMetaStatusForStore({
        storeId: 'uzoshop', adAccountId: 'act_111', accessToken: 'tok',
        fetcher: fetchMock,
        getFxCadFor: async () => 0,
      }),
    ).rejects.toThrow(/unparseable/i);
  });
});
