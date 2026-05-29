/**
 * Phase A.5 Task 6 — persistCampaignsLive calls agg_tiktok_spend_per_store_for_date
 * at the end of the function (live path, every 30 min via cron-live-heavy stagger).
 *
 * Tests (3):
 *   1. rpc called with ('agg_tiktok_spend_per_store_for_date', { d: dateStr })
 *      when TikTok rows are present.
 *   2. rpc called even when only Meta rows are present (all upserts trigger re-agg
 *      so today's data_daily stays consistent).
 *   3. Soft-fail: RPC returns error → function completes without throwing.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { persistCampaignsLive } from '../persistCampaignsLive';
import type { TikTokAdLiveRow } from '../persistCampaignsLive';

const DATE = '2026-05-29';

type RpcCall = { fn: string; args: unknown };
const rpcCalls: RpcCall[] = [];
const upsertCalls: Array<{ table: string; rows: unknown[] }> = [];
let rpcError: { message: string } | null = null;

function makeAdminMock() {
  return {
    from: (table: string) => ({
      upsert: async (rows: unknown[]) => {
        upsertCalls.push({ table, rows: rows as unknown[] });
        return { error: null };
      },
    }),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return { error: rpcError };
    },
  };
}

beforeEach(() => {
  rpcCalls.length = 0;
  upsertCalls.length = 0;
  rpcError = null;
});

function makeTikTokRow(overrides: Partial<TikTokAdLiveRow> & { storeId: string }): TikTokAdLiveRow {
  return {
    campaignId: 'C1',
    campaignName: 'Campaign 1',
    adSetId: 'AS1',
    adSetName: 'AdSet 1',
    adId: 'AD1',
    adName: 'Ad 1',
    spend: 10,
    impressions: 100,
    clicks: 5,
    conversions: 1,
    conversionValue: 20,
    ...overrides,
  };
}

describe('persistCampaignsLive — calls agg_tiktok_spend_per_store_for_date', () => {
  it('1. rpc called with correct function name + dateStr when TikTok rows present', async () => {
    const admin = makeAdminMock();
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 1,
      meta: {
        adsetRows: [],
        adRows: [],
        budgets: { currency: 'CAD', campaigns: {}, adSets: {} },
      },
      google: { adGroupRows: [], adRows: [] },
      tiktok: {
        adRows: [makeTikTokRow({ storeId: 'uzoshop', campaignId: 'C1', adSetId: 'AS1', adId: 'AD1' })],
      },
    });

    const aggCall = rpcCalls.find((c) => c.fn === 'agg_tiktok_spend_per_store_for_date');
    expect(aggCall).toBeDefined();
    expect(aggCall!.args).toEqual({ d: DATE });
  });

  it('2. rpc called even when only Meta rows are present (keeps data_daily consistent)', async () => {
    const admin = makeAdminMock();
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 1,
      meta: {
        adsetRows: [
          {
            campaignId: 'c1', campaignName: 'C', adSetId: 'a1', adSetName: 'A',
            spend: 50, impressions: 500, clicks: 10, conversions: 2, conversionValue: 100,
            currency: 'CAD',
          },
        ],
        adRows: [],
        budgets: { currency: 'CAD', campaigns: {}, adSets: {} },
      },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });

    const aggCall = rpcCalls.find((c) => c.fn === 'agg_tiktok_spend_per_store_for_date');
    expect(aggCall).toBeDefined();
    expect(aggCall!.args).toEqual({ d: DATE });
  });

  it('3. RPC error is swallowed (soft-fail) — function does not throw', async () => {
    rpcError = { message: 'simulated RPC failure' };
    const admin = makeAdminMock();

    await expect(
      persistCampaignsLive({
        storeId: 'uzoshop',
        dateStr: DATE,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        admin: admin as any,
        getFx: async () => 1,
        meta: {
          adsetRows: [],
          adRows: [],
          budgets: { currency: 'CAD', campaigns: {}, adSets: {} },
        },
        google: { adGroupRows: [], adRows: [] },
        tiktok: {
          adRows: [makeTikTokRow({ storeId: 'uzoshop' })],
        },
      }),
    ).resolves.not.toThrow();

    // The RPC was still called
    const aggCall = rpcCalls.find((c) => c.fn === 'agg_tiktok_spend_per_store_for_date');
    expect(aggCall).toBeDefined();
  });
});
