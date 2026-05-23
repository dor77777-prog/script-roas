// dashboard-web/src/inngest/functions/__tests__/cronLivePastRowBackfill.test.ts
//
// AUDIT C-03 backfill — date-boundary fixture for cron-live's
// refresh-effective-status step's past-row UPDATE loop
// (cronLive.ts:~1060-1132).
//
// Pre-fix surface (per AGENT-B-REPORT.md surface 6 + AUDIT.md C-03):
//   The loop runs `UPDATE campaigns_daily SET effective_status = X
//   WHERE store_id = ... AND platform = ... AND ad_set_id = ...
//   AND date >= lookbackFrom AND date < today`
//   with `lookbackDays = 7` → `lookbackFrom = today - 6 days` in
//   Asia/Jerusalem time. There was NO direct test asserting that the
//   .gte('date', lookbackFrom) and .lt('date', today) calls fire with
//   the expected dates. An off-by-one (e.g. `lookbackDays - 1` math
//   bug, or `<= today` instead of `< today`) would silently corrupt
//   the off-chip "effective_status" truth source on either yesterday's
//   row OR the row N+1 days back.
//
// This file pins:
//   1. Lookback bound: when today is 2026-05-24, lookbackFrom is
//      EXACTLY '2026-05-18' (today - 6).
//   2. Today bound: `.lt('date', today)` is called with the EXACT
//      string '2026-05-24' (today itself is handled by the UPSERT
//      step above the loop — the loop must NOT touch it).
//   3. Off-by-one: the lookback window is [today-6, today-1] inclusive
//      — today-7 is excluded (older), today (== '2026-05-24') is
//      excluded (handled by UPSERT).
//   4. The chain (.update → .eq*3 → .gte → .lt) fires once per
//      enrolled ad-set; we assert call counts + per-call args.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as shopifyFetcher from '@/lib/fetchers/shopify';
import * as metaFetcher from '@/lib/fetchers/meta';
import * as googleAdsFetcher from '@/lib/fetchers/googleAds';
import * as tiktokFetcher from '@/lib/fetchers/tiktok';
import * as fxFetcher from '@/lib/fetchers/fx';
import * as supabaseAdminMod from '@/lib/supabaseAdmin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStepStub() {
  const labels: string[] = [];
  return {
    step: {
      run: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
        labels.push(label);
        return await fn();
      },
    },
    labels,
  };
}

/**
 * Build a Supabase admin mock that captures EVERY .gte() and .lt() call
 * on the UPDATE chain for campaigns_daily — keyed by ad-set so per-ad-set
 * bounds are assertable.
 *
 * Chain shape (cron-live's actual code):
 *   admin.from('campaigns_daily')
 *     .update({ effective_status: status })
 *     .eq('store_id', storeId)
 *     .eq('platform', platform)
 *     .eq('ad_set_id', adSetId)
 *     .gte('date', lookbackFrom)
 *     .lt('date', today)
 */
function makeSupabaseAdminMock() {
  type UpdateCall = {
    payload: Record<string, unknown>;
    storeId: string;
    platform: string;
    adSetId: string;
    gteCol: string;
    gteValue: string;
    ltCol: string;
    ltValue: string;
  };
  const updateCalls: UpdateCall[] = [];
  const upsertCalls: Array<{ table: string; rows: unknown }> = [];

  function makeUpdateChain(payload: Record<string, unknown>) {
    const ctx: Partial<UpdateCall> = { payload };

    const chain = {
      eq: vi.fn((col: string, val: string) => {
        if (col === 'store_id') ctx.storeId = val;
        else if (col === 'platform') ctx.platform = val;
        else if (col === 'ad_set_id') ctx.adSetId = val;
        return chain;
      }),
      gte: vi.fn((col: string, val: string) => {
        ctx.gteCol = col;
        ctx.gteValue = val;
        return {
          lt: vi.fn((ltCol: string, ltVal: string) => {
            ctx.ltCol = ltCol;
            ctx.ltValue = ltVal;
            updateCalls.push(ctx as UpdateCall);
            return Promise.resolve({ error: null });
          }),
        };
      }),
    };
    return chain;
  }

  function makeTableBuilder(table: string) {
    return {
      upsert: vi.fn((rows: unknown) => {
        upsertCalls.push({ table, rows });
        return Promise.resolve({ error: null });
      }),
      update: vi.fn((payload: Record<string, unknown>) =>
        makeUpdateChain(payload),
      ),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({ data: null, error: null }),
            ),
          })),
        })),
      })),
    };
  }

  const admin = {
    from: vi.fn((table: string) => makeTableBuilder(table)),
  };

  return { admin, updateCalls, upsertCalls };
}

function stubAllFetchers() {
  vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockImplementation(
    async (storeId, date) => ({
      storeId,
      date,
      storeName: 'uzoshop',
      revenueCad: 1000,
      productRows: [],
      customItemRefundCad: 0,
      grossRevenueCad: 1000,
      refundDeductionCad: 0,
    }),
  );

  vi.spyOn(shopifyFetcher, 'fetchShopifyOrdersAttribution').mockResolvedValue(
    [],
  );

  vi.spyOn(metaFetcher, 'fetchMetaSpendForDayLight').mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-24',
    spend: 100,
    currency: 'ILS',
  });

  vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-24',
    spend: 50,
    currency: 'CAD',
  });

  vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-24',
    spend: 0,
    currency: 'USD',
  });

  vi.spyOn(fxFetcher, 'getFxRate').mockResolvedValue(0.36);
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Pin "now" to 2026-05-24T12:00:00Z. In Asia/Jerusalem (UTC+3 in
  // May/IDT) this is 2026-05-24 15:00 → calendar day '2026-05-24'.
  // With lookbackDays = 7, lookbackFrom = today - 6 = '2026-05-18'.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// SUT: refresh-effective-status's past-row UPDATE bounds.
// ===========================================================================

describe('cronLive refresh-effective-status — past-row backfill date boundary (AUDIT C-03)', () => {
  it('Test 1: .gte("date", lookbackFrom) uses today − 6 days when lookbackDays=7 (today 2026-05-24 → 2026-05-18)', async () => {
    stubAllFetchers();

    // One Meta ad-set enrolled — minimal enrollment so the UPDATE chain
    // fires exactly once and we can inspect the bounds without ambiguity.
    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {
        c1: {
          dailyBudget: 0,
          lifetimeBudget: 0,
          bidStrategy: null,
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
      adSets: {
        'mas-A': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue([]);
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const { admin, updateCalls } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const mod = await import('../cronLive');
    const { step } = makeStepStub();

    await mod.runLiveForStore('uzoshop', { step });

    // Exactly one past-row UPDATE attempt (one ad-set enrolled).
    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0];

    // Lower bound: .gte('date', '2026-05-18')
    expect(call.gteCol).toBe('date');
    expect(call.gteValue).toBe('2026-05-18');

    // The matcher chain landed on the right ad-set.
    expect(call.storeId).toBe('uzoshop');
    expect(call.platform).toBe('meta');
    expect(call.adSetId).toBe('mas-A');
  });

  it('Test 2: .lt("date", today) uses today exactly — today is handled by the UPSERT, not the UPDATE', async () => {
    stubAllFetchers();

    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {
        c1: {
          dailyBudget: 0,
          lifetimeBudget: 0,
          bidStrategy: null,
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
      adSets: {
        'mas-A': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue([]);
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const { admin, updateCalls } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const mod = await import('../cronLive');
    const { step } = makeStepStub();

    await mod.runLiveForStore('uzoshop', { step });

    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0];

    // Upper bound (exclusive): .lt('date', '2026-05-24').
    expect(call.ltCol).toBe('date');
    expect(call.ltValue).toBe('2026-05-24');
    // Critical off-by-one assertion: '<' on today, NOT '<=' on today.
    // A row at date === today must NOT be matched by the UPDATE bounds.
    // If the bug ever flipped this to lte, today would be included AND
    // the UPSERT step above would then race the UPDATE for the same
    // row (the UPSERT places fresh status; the UPDATE would clobber it
    // with the same value but waste a row — and worse, on a paused
    // ad-set the UPDATE would un-do the OFF status that the UPSERT
    // correctly omitted by filtering activeEnrollments).
    expect(call.ltValue).not.toBe('2026-05-25');
    expect(call.ltValue).not.toBe('2026-05-23');
  });

  it('Test 3: window [today-6, today-1] inclusive — a row at lookbackFrom IS included, a row at today is NOT', async () => {
    // This is a property assertion on string ordering using the SAME
    // semantics Postgres's date range filter applies:
    //   row.date >= lookbackFrom  &&  row.date < today
    // Pin the inclusive vs exclusive boundaries by string compare on the
    // actual values the loop will pass.
    stubAllFetchers();

    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {
        c1: {
          dailyBudget: 0,
          lifetimeBudget: 0,
          bidStrategy: null,
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
      adSets: {
        'mas-A': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue([]);
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const { admin, updateCalls } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const mod = await import('../cronLive');
    const { step } = makeStepStub();

    await mod.runLiveForStore('uzoshop', { step });

    expect(updateCalls).toHaveLength(1);
    const { gteValue, ltValue } = updateCalls[0];
    // The exact values we expect for today = 2026-05-24.
    expect(gteValue).toBe('2026-05-18');
    expect(ltValue).toBe('2026-05-24');

    // INCLUSIVE lower: row at lookbackFrom is in-range.
    expect('2026-05-18' >= gteValue).toBe(true);
    expect('2026-05-18' < ltValue).toBe(true);
    // EXCLUSIVE upper: row at today is OUT.
    expect('2026-05-24' < ltValue).toBe(false);
    // EXCLUSIVE lower-buffer: row at lookbackFrom - 1 is OUT.
    expect('2026-05-17' >= gteValue).toBe(false);
    // INCLUSIVE upper: row at today - 1 is IN.
    expect('2026-05-23' >= gteValue).toBe(true);
    expect('2026-05-23' < ltValue).toBe(true);
  });

  it('Test 4: the UPSERT (today) and UPDATE (past rows) are disjoint — today goes only through UPSERT', async () => {
    // Pin the architectural invariant: TODAY is only written via the
    // UPSERT step (above the loop), and the past-row loop's `.lt(today)`
    // bound guarantees the UPDATE never touches today. A bug that swapped
    // the bound would cause double-writes for today + status race.
    stubAllFetchers();

    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {
        c1: {
          dailyBudget: 0,
          lifetimeBudget: 0,
          bidStrategy: null,
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
      adSets: {
        'mas-A': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue([]);
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const { admin, updateCalls, upsertCalls } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const mod = await import('../cronLive');
    const { step } = makeStepStub();

    await mod.runLiveForStore('uzoshop', { step });

    // UPSERT into campaigns_daily MUST include a row with date === today
    // (the only place today's effective_status is written).
    const campaignsUpserts = upsertCalls.filter((c) => c.table === 'campaigns_daily');
    expect(campaignsUpserts.length).toBeGreaterThan(0);
    const upsertRows = campaignsUpserts.flatMap((c) => c.rows as Array<{ date: string }>);
    expect(upsertRows.some((r) => r.date === '2026-05-24')).toBe(true);

    // UPDATE loop's upper bound stays strictly LESS THAN today — so the
    // loop never touches the row UPSERTed above for today.
    for (const u of updateCalls) {
      expect(u.ltValue).toBe('2026-05-24');
      // Equivalently: row at today.date would NOT match the UPDATE.
      expect('2026-05-24' < u.ltValue).toBe(false);
    }
  });

  it('Test 5: each enrolled ad-set produces its own UPDATE call — bounds are identical per call', async () => {
    // Multiple ad-sets share the same lookbackFrom + today bounds
    // (computed once per step, not per ad-set). Pin that every call sees
    // the same bounds — a regression that recomputed bounds per iteration
    // (introducing per-iteration timing drift) would show up here.
    stubAllFetchers();

    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {
        c1: {
          dailyBudget: 0,
          lifetimeBudget: 0,
          bidStrategy: null,
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
      adSets: {
        'mas-A': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'ACTIVE',
          name: null,
        },
        'mas-B': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'PAUSED',
          name: null,
        },
        'mas-C': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue([
      {
        campaignId: 'gc1',
        campaignName: 'GC',
        adGroupId: 'gag1',
        adGroupName: 'GAG',
        status: 'ENABLED',
      },
    ]);
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map([
        [
          'tag1',
          {
            campaignId: 'tc1',
            campaignName: 'TC',
            adGroupName: 'TAG',
            status: 'ADGROUP_STATUS_DELIVERY_OK',
          },
        ],
      ]),
    );

    const { admin, updateCalls } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const mod = await import('../cronLive');
    const { step } = makeStepStub();

    await mod.runLiveForStore('uzoshop', { step });

    // 3 Meta + 1 Google + 1 TikTok = 5 ad-sets enrolled → 5 UPDATE calls.
    expect(updateCalls).toHaveLength(5);

    // Every call uses the same lower + upper bound.
    for (const c of updateCalls) {
      expect(c.gteValue).toBe('2026-05-18');
      expect(c.ltValue).toBe('2026-05-24');
    }

    // The UPDATE chain attempted each ad-set across all three platforms.
    const adSets = updateCalls.map((c) => `${c.platform}::${c.adSetId}`).sort();
    expect(adSets).toEqual([
      'google::gag1',
      'meta::mas-A',
      'meta::mas-B',
      'meta::mas-C',
      'tiktok::tag1',
    ]);
  });

  it('Test 6: update payload carries the per-ad-set status (so the UPDATE writes the right effective_status)', async () => {
    // Pins that the UPDATE payload's effective_status matches the
    // enrollment's status — a swap (e.g. always sending 'ACTIVE') would
    // corrupt the off-chip.
    stubAllFetchers();

    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {
        c1: {
          dailyBudget: 0,
          lifetimeBudget: 0,
          bidStrategy: null,
          effectiveStatus: 'ACTIVE',
          name: null,
        },
      },
      adSets: {
        'mas-active': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'ACTIVE',
          name: null,
        },
        'mas-paused': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'PAUSED',
          name: null,
        },
      },
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue([]);
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const { admin, updateCalls } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const mod = await import('../cronLive');
    const { step } = makeStepStub();

    await mod.runLiveForStore('uzoshop', { step });

    const activeCall = updateCalls.find((c) => c.adSetId === 'mas-active');
    const pausedCall = updateCalls.find((c) => c.adSetId === 'mas-paused');
    expect(activeCall?.payload.effective_status).toBe('ACTIVE');
    expect(pausedCall?.payload.effective_status).toBe('PAUSED');
  });
});
