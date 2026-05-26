// dashboard-web/src/inngest/functions/__tests__/cronLivePastRowBackfill.test.ts
//
// Phase 12.5 (2026-05-24) — off-chip backend root-cause fix.
//
// Previously this file pinned a 7-day lookback (`lookbackDays = 7`,
// `.gte('date', lookbackFrom)`) on the past-row UPDATE loop in
// cronLive's refresh-effective-status step. That bound turned out to
// be the source of the off-chip drift bug: any campaign paused >7 days
// ago kept its historical rows tagged 'ACTIVE' (cron-daily's
// write-time value), so the aggregator's "chronologically-latest
// status in range" pick returned ACTIVE on operator views longer than
// a week and the chip silently disappeared.
//
// The fix removes the lower date bound entirely — the UPDATE now
// covers EVERY existing row for each enrolled ad-set. effective_status
// was always meant to be a "current as of last refresh" snapshot on
// every row, never a per-day historical record, so this matches the
// original design intent (see the architectural comment on
// cronLive.ts's `refresh-effective-status` step).
//
// This file now pins:
//   1. The UPDATE chain calls NO `.gte('date', ...)` — the lower bound
//      was removed.
//   2. The upper bound stays `.lt('date', today)` so today's row is
//      handled by the UPSERT above the loop (no double-write race).
//   3. Per-ad-set call counts + payload still hold.

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
 * Build a Supabase admin mock that captures EVERY `.lt()` call on the
 * UPDATE chain for campaigns_daily, keyed by ad-set. Also flags any
 * `.gte()` call so the test can assert the lower bound is GONE.
 *
 * Chain shape (cron-live's actual code, post-fix):
 *   admin.from('campaigns_daily')
 *     .update({ effective_status: status })
 *     .eq('store_id', storeId)
 *     .eq('platform', platform)
 *     .eq('ad_set_id', adSetId)
 *     .lt('date', today)
 */
function makeSupabaseAdminMock() {
  type UpdateCall = {
    payload: Record<string, unknown>;
    storeId: string;
    platform: string;
    adSetId: string;
    ltCol: string;
    ltValue: string;
    gteCalled: boolean;
  };
  const updateCalls: UpdateCall[] = [];
  const upsertCalls: Array<{ table: string; rows: unknown }> = [];

  function makeUpdateChain(payload: Record<string, unknown>) {
    const ctx: Partial<UpdateCall> = { payload, gteCalled: false };

    const chain = {
      eq: vi.fn((col: string, val: string) => {
        if (col === 'store_id') ctx.storeId = val;
        else if (col === 'platform') ctx.platform = val;
        else if (col === 'ad_set_id') ctx.adSetId = val;
        return chain;
      }),
      // gte SHOULD NOT be called post-fix. We still expose it (in case a
      // regression reintroduces a lower bound) so the call is captured
      // and the assertion can fail loudly instead of silently.
      gte: vi.fn(() => {
        ctx.gteCalled = true;
        return chain;
      }),
      lt: vi.fn((ltCol: string, ltVal: string) => {
        ctx.ltCol = ltCol;
        ctx.ltValue = ltVal;
        updateCalls.push(ctx as UpdateCall);
        return Promise.resolve({ error: null });
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
  impressions: 0,
  });

  vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-24',
    spend: 50,
    currency: 'CAD',
  impressions: 0,
  });

  vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-24',
    spend: 0,
    currency: 'USD',
  impressions: 0,
  });

  vi.spyOn(fxFetcher, 'getFxRate').mockResolvedValue(0.36);
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Pin "now" to 2026-05-24T12:00:00Z. In Asia/Jerusalem (UTC+3 in
  // May/IDT) this is 2026-05-24 15:00 → calendar day '2026-05-24'.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// SUT: refresh-effective-status's past-row UPDATE bounds (post Phase 12.5).
// ===========================================================================

describe('cronLive refresh-effective-status — past-row UPDATE bounds (Phase 12.5)', () => {
  it('Test 1: UPDATE chain does NOT apply a lower date bound — every existing row gets the refresh', async () => {
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

    // The CRITICAL invariant: no `.gte('date', ...)` call on the chain.
    // The pre-fix 7-day lookback would have set this to true.
    expect(call.gteCalled).toBe(false);

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

  it('Test 3: UPSERT (today) and UPDATE (past rows) stay disjoint — today goes only through UPSERT', async () => {
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

  it('Test 4: each enrolled ad-set produces its own UPDATE call — upper bound is identical per call, no lower bound on any', async () => {
    // Multiple ad-sets share the same `today` upper bound (computed once
    // per step, not per ad-set). Pin that every call sees the same upper
    // bound AND that no call introduced a lower bound (regression guard).
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

    // Every call uses the same upper bound and NO lower bound.
    for (const c of updateCalls) {
      expect(c.ltValue).toBe('2026-05-24');
      expect(c.gteCalled).toBe(false);
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

  it('Test 5: update payload carries the per-ad-set status (so the UPDATE writes the right effective_status)', async () => {
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
