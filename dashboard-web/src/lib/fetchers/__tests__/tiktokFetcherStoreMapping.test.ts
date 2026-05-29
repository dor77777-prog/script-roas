/**
 * Phase A.5 — Task 4: TikTok fetcher attaches per-row storeId.
 *
 * Verifies that fetchTikTokAdInsights resolves each row's storeId via
 * loadCampaignStoreMapFromSupabase + resolveStoreForCampaign, with fallback
 * to the function-arg storeId for unmapped campaigns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchTikTokAdInsights, _resetAdvertiserInfoCacheForTesting } from '../tiktok';

vi.mock('@/lib/inngest/campaignStoreMap', () => ({
  loadCampaignStoreMapFromSupabase: vi.fn(),
}));

import { loadCampaignStoreMapFromSupabase } from '@/lib/inngest/campaignStoreMap';

const STORE = 'uzoshop';
const DATE_STR = '2026-05-29';
const ADVERTISER_ID = '999';

type Canned = { body: unknown; status?: number };

function makeFetchMock(responses: Canned[]) {
  const queue = [...responses];
  const fn = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    void init;
    const next = queue.shift();
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (!next) throw new Error(`No more canned responses (url: ${url})`);
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fn };
}

/** Canonical advertiser/info response for advertiser 999 */
function advertiserInfoResponse() {
  return {
    body: {
      code: 0,
      message: 'OK',
      data: {
        list: [
          {
            advertiser_id: ADVERTISER_ID,
            name: 'uzoshop',
            currency: 'USD',
            timezone: 'UTC',
          },
        ],
      },
    },
  };
}

/** Canonical empty adgroup/get response (no statuses) */
function adGroupEmptyResponse() {
  return {
    body: {
      code: 0,
      message: 'OK',
      data: { list: [], page_info: { total_page: 1, page: 1 } },
    },
  };
}

/** Build a report row fixture for a given campaign_id and ad_id */
function reportRow(campaignId: string, adId: string) {
  return {
    metrics: {
      spend: '10.00',
      impressions: '500',
      clicks: '5',
      conversion: '1',
      complete_payment: '1',
      value_per_complete_payment: '20.00',
      campaign_id: campaignId,
      campaign_name: `Campaign ${campaignId}`,
      adgroup_id: `AG-${campaignId}`,
      adgroup_name: `AdGroup ${campaignId}`,
      ad_name: `Ad ${adId}`,
    },
    dimensions: { ad_id: adId },
  };
}

/** Build a report/integrated/get response with given rows */
function reportResponse(rows: ReturnType<typeof reportRow>[]) {
  return {
    body: {
      code: 0,
      message: 'OK',
      data: {
        list: rows,
        page_info: { total_page: 1, page: 1 },
      },
    },
  };
}

describe('TikTok fetcher — per-row storeId (Phase A.5 Task 4)', () => {
  beforeEach(() => {
    _resetAdvertiserInfoCacheForTesting();
    process.env.UZOSHOP_TIKTOK_ACCESS_TOKEN = 'tok';
    process.env.UZOSHOP_TIKTOK_ADVERTISER_ID = ADVERTISER_ID;
    vi.mocked(loadCampaignStoreMapFromSupabase).mockReset();
  });

  afterEach(() => {
    delete process.env.UZOSHOP_TIKTOK_ACCESS_TOKEN;
    delete process.env.UZOSHOP_TIKTOK_ADVERTISER_ID;
    vi.restoreAllMocks();
  });

  it('Test 1: maps each row storeId from the campaign-store-map', async () => {
    vi.mocked(loadCampaignStoreMapFromSupabase).mockResolvedValue({
      [`tiktok::${ADVERTISER_ID}::C1`]: 'usmile360',
      [`tiktok::${ADVERTISER_ID}::C2`]: 'uzoshop-other',
    });

    const { fn } = makeFetchMock([
      advertiserInfoResponse(),
      adGroupEmptyResponse(),
      reportResponse([reportRow('C1', 'AD1'), reportRow('C2', 'AD2')]),
    ]);
    vi.stubGlobal('fetch', fn);

    const rows = await fetchTikTokAdInsights(STORE, DATE_STR);

    expect(rows).toHaveLength(2);
    const r1 = rows.find((r) => r.campaignId === 'C1');
    const r2 = rows.find((r) => r.campaignId === 'C2');
    expect(r1?.storeId).toBe('usmile360');
    expect(r2?.storeId).toBe('uzoshop-other');
  });

  it('Test 2: falls back to function-arg storeId when campaign not in map', async () => {
    vi.mocked(loadCampaignStoreMapFromSupabase).mockResolvedValue({});

    const { fn } = makeFetchMock([
      advertiserInfoResponse(),
      adGroupEmptyResponse(),
      reportResponse([reportRow('C3', 'AD3')]),
    ]);
    vi.stubGlobal('fetch', fn);

    const rows = await fetchTikTokAdInsights(STORE, DATE_STR);

    expect(rows).toHaveLength(1);
    expect(rows[0].storeId).toBe(STORE);
  });

  it('Test 3: mixed mapped + unmapped rows', async () => {
    vi.mocked(loadCampaignStoreMapFromSupabase).mockResolvedValue({
      [`tiktok::${ADVERTISER_ID}::C1`]: 'usmile360',
    });

    const { fn } = makeFetchMock([
      advertiserInfoResponse(),
      adGroupEmptyResponse(),
      reportResponse([reportRow('C1', 'AD1'), reportRow('C2', 'AD2')]),
    ]);
    vi.stubGlobal('fetch', fn);

    const rows = await fetchTikTokAdInsights(STORE, DATE_STR);

    expect(rows).toHaveLength(2);
    const r1 = rows.find((r) => r.campaignId === 'C1');
    const r2 = rows.find((r) => r.campaignId === 'C2');
    expect(r1?.storeId).toBe('usmile360');
    expect(r2?.storeId).toBe(STORE); // fallback to function-arg
  });

  it('Test 4: loads the campaign-store-map exactly once per fetch call', async () => {
    const mockLoad = vi.mocked(loadCampaignStoreMapFromSupabase).mockResolvedValue({});

    const rows5 = [
      reportRow('C1', 'AD1'),
      reportRow('C2', 'AD2'),
      reportRow('C3', 'AD3'),
      reportRow('C4', 'AD4'),
      reportRow('C5', 'AD5'),
    ];

    const { fn } = makeFetchMock([
      advertiserInfoResponse(),
      adGroupEmptyResponse(),
      reportResponse(rows5),
    ]);
    vi.stubGlobal('fetch', fn);

    const rows = await fetchTikTokAdInsights(STORE, DATE_STR);

    expect(rows).toHaveLength(5);
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('Test 5: empty rows array — returns [] without crash', async () => {
    vi.mocked(loadCampaignStoreMapFromSupabase).mockResolvedValue({});

    const { fn } = makeFetchMock([
      advertiserInfoResponse(),
      adGroupEmptyResponse(),
      reportResponse([]),
    ]);
    vi.stubGlobal('fetch', fn);

    const rows = await fetchTikTokAdInsights(STORE, DATE_STR);

    expect(rows).toEqual([]);
  });
});
