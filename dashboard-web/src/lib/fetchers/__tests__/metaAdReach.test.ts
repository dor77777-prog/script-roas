// dashboard-web/src/lib/fetchers/__tests__/metaAdReach.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// fetchMetaAdInsights reads creds from env via getMetaToken/getMetaAdAccountId.
// Set the minimum env the uzoshop path needs, then stub global fetch.
let prevToken: string | undefined;
let prevAccountId: string | undefined;

beforeEach(() => {
  prevToken = process.env.UZOSHOP_META_ACCESS_TOKEN;
  prevAccountId = process.env.UZOSHOP_META_AD_ACCOUNT_ID;
  process.env.UZOSHOP_META_ACCESS_TOKEN = 'tok';
  process.env.UZOSHOP_META_AD_ACCOUNT_ID = '123';
});
afterEach(() => {
  if (prevToken === undefined) {
    delete process.env.UZOSHOP_META_ACCESS_TOKEN;
  } else {
    process.env.UZOSHOP_META_ACCESS_TOKEN = prevToken;
  }
  if (prevAccountId === undefined) {
    delete process.env.UZOSHOP_META_AD_ACCOUNT_ID;
  } else {
    process.env.UZOSHOP_META_AD_ACCOUNT_ID = prevAccountId;
  }
  vi.restoreAllMocks();
});

/** Minimal Response-like object that satisfies fetchMeta's header reads. */
function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null, forEach: () => undefined },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('fetchMetaAdInsights — reach', () => {
  it('parses reach from the Meta insights row', async () => {
    const { fetchMetaAdInsights } = await import('@/lib/fetchers/meta');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse({
        data: [
          {
            campaign_id: 'c1', campaign_name: 'C', adset_id: 'as1', adset_name: 'AS',
            ad_id: 'a1', ad_name: 'A', spend: '10', impressions: '1000', clicks: '20',
            reach: '800', actions: [], action_values: [], account_currency: 'ILS',
          },
        ],
      }),
    );
    const rows = await fetchMetaAdInsights('uzoshop', '2026-06-01');
    expect(rows).toHaveLength(1);
    expect(rows[0].reach).toBe(800);
  });

  it('returns null reach when the field is absent from the Meta insights row', async () => {
    const { fetchMetaAdInsights } = await import('@/lib/fetchers/meta');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse({
        data: [
          {
            campaign_id: 'c1', campaign_name: 'C', adset_id: 'as1', adset_name: 'AS',
            ad_id: 'a1', ad_name: 'A', spend: '10', impressions: '1000', clicks: '20',
            actions: [], action_values: [], account_currency: 'ILS',
            // no `reach` key
          },
        ],
      }),
    );
    const rows = await fetchMetaAdInsights('uzoshop', '2026-06-01');
    expect(rows).toHaveLength(1);
    expect(rows[0].reach).toBeNull();
  });
});
