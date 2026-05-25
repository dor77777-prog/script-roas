// dashboard-web/src/inngest/functions/__tests__/cronLiveStatusRefresh.test.ts
//
// Audit fix 2026-05-23 (HIGH-12 / O4-HI-01 + HIGH-NEW-4): regression tests
// for the refresh-effective-status step's per-ad-set try/catch + Supabase
// error-result check.
//
// Pre-fix behavior (two failure modes pinned here):
//
//   (1) Promise.all rejection fail-fast (HIGH-12 / O4-HI-01)
//       `await Promise.all(updates.map(...))` rejects the whole batch on
//       any single ad-set's update promise rejection. Concretely: a network
//       blip while updating ad-set #2's status throws, aborts the step
//       BEFORE ad-sets #3..N get processed, and Inngest retries the entire
//       step 4× — wasting executions AND blocking all the OTHER ad-sets'
//       status updates for 4 retry rounds.
//
//   (2) Silently-swallowed Supabase {error} (HIGH-NEW-4)
//       Supabase's PostgREST shape returns `{ error: PostgrestError | null }`
//       for non-rejecting failures (RLS denial, schema mismatch, etc.).
//       The previous code never destructured the .update response → those
//       failures resolved cleanly, the step "succeeded", and no operator
//       signal ever surfaced. Stale "active/off" chips persisted with NO
//       dead-letter, NO warn log, NO retry — the bug existed for as long
//       as the RLS misconfiguration did.
//
// Post-fix behavior:
//   - Sequential `for...of` over enrollments per platform.
//   - Each update wrapped in try/catch (rejection path) + explicit
//     `result.error` check (PostgREST error-result path).
//   - Both failure paths console.warn + CONTINUE iterating; no throw
//     escapes the section. Inngest never dead-letters the step due to
//     a single ad-set's failure.
//   - Successful ad-set updates STILL LAND even when peer ad-sets in the
//     same platform group fail.

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
 * Build a Supabase admin mock whose `.update(...).eq(...).eq(...).eq(...)
 * .eq(...).gte(...).lt(...)` chain returns a per-call configurable result.
 *
 * The chain terminates on `.lt(...)` (the final method in cron-live's
 * status-refresh chain). At that point we look up the matchers we've
 * accumulated and decide:
 *   - throw  (rejection-path failure)
 *   - resolve {error: PostgrestError}  (PostgREST error-result path)
 *   - resolve {error: null}            (happy path)
 *
 * `updateOutcomes` is keyed by ad-set ID (since that's the unique-per-call
 * matcher and lines up cleanly with the per-ad-set test scenarios in
 * HIGH-12 + HIGH-NEW-4).
 */
function makeSupabaseAdminMock(
  updateOutcomes: Record<
    string,
    'success' | 'throw' | { error: { message: string } }
  > = {},
) {
  const updateLog: Array<{
    adSetId: string;
    payload: Record<string, unknown>;
    outcome: string;
  }> = [];

  function makeUpdateChain(payload: Record<string, unknown>) {
    let _storeId = '';
    let _platform = '';
    let adSetId = '';

    const eqChain = {
      eq: vi.fn((col: string, val: string) => {
        if (col === 'store_id') _storeId = val;
        else if (col === 'platform') _platform = val;
        else if (col === 'ad_set_id') adSetId = val;
        return eqChain;
      }),
      // Phase 12.5: chain is now `.eq*3 → .lt` (the .gte lookback was
      // removed — every existing row gets the refresh, see cronLive.ts
      // refresh-effective-status step's header comment).
      lt: vi.fn(() => {
        // Terminal — emit the configured outcome for this ad-set.
        const outcome = updateOutcomes[adSetId] ?? 'success';
        updateLog.push({
          adSetId,
          payload,
          outcome: typeof outcome === 'string' ? outcome : 'error-result',
        });
        if (outcome === 'throw') {
          return Promise.reject(
            new Error(`mock-rejection for ${adSetId}`),
          );
        }
        if (typeof outcome === 'object' && outcome.error) {
          return Promise.resolve({ error: outcome.error });
        }
        return Promise.resolve({ error: null });
      }),
    };
    return eqChain;
  }

  const upsertCalls: Array<{ table: string; rows: unknown }> = [];
  const selectMaybeSingle = vi.fn(() =>
    Promise.resolve({ data: null, error: null }),
  );

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
            maybeSingle: selectMaybeSingle,
          })),
        })),
      })),
    };
  }

  const admin = {
    from: vi.fn((table: string) => makeTableBuilder(table)),
  };

  return { admin, updateLog, upsertCalls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Mock the fetchers — minimal happy-path data so the rolling-3-day step
// runs cleanly. Only refresh-effective-status's resilience is exercised.
// ===========================================================================

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
    date: '2026-05-22',
    spend: 100,
    currency: 'ILS',
  });

  vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-22',
    spend: 50,
    currency: 'CAD',
  });

  vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
    storeId: 'uzoshop',
    date: '2026-05-22',
    spend: 0,
    currency: 'USD',
  });

  vi.spyOn(fxFetcher, 'getFxRate').mockResolvedValue(0.36);
}

// ===========================================================================
// refresh-effective-status — the SUT for HIGH-12 + HIGH-NEW-4
// ===========================================================================

describe('cronLive refresh-effective-status — HIGH-12 + HIGH-NEW-4 resilience', () => {
  it('Scenario A: mid-batch rejection does NOT abort siblings; warn logged, step resolves', async () => {
    stubAllFetchers();

    // Three Meta ad-sets enrolled. #2 (mas-B) rejects mid-batch; #1 and #3
    // must still land their UPDATE.
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
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue(
      [],
    );
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const { admin, updateLog } = makeSupabaseAdminMock({
      'mas-A': 'success',
      'mas-B': 'throw',
      'mas-C': 'success',
    });
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../cronLive');
    const { step } = makeStepStub();

    // Critical: must NOT throw.
    await expect(mod.runLiveForStore('uzoshop', { step })).resolves.toBeDefined();

    // All 3 ad-sets attempted (proves no fail-fast).
    const attemptedAdSets = updateLog.map((u) => u.adSetId).sort();
    expect(attemptedAdSets).toContain('mas-A');
    expect(attemptedAdSets).toContain('mas-B');
    expect(attemptedAdSets).toContain('mas-C');

    // #2 must have actually thrown.
    const masBLog = updateLog.find((u) => u.adSetId === 'mas-B');
    expect(masBLog?.outcome).toBe('throw');

    // #1 and #3 must have succeeded.
    const masALog = updateLog.find((u) => u.adSetId === 'mas-A');
    const masCLog = updateLog.find((u) => u.adSetId === 'mas-C');
    expect(masALog?.outcome).toBe('success');
    expect(masCLog?.outcome).toBe('success');

    // Warn was logged for the rejection.
    const warnText = warnSpy.mock.calls.flat().join(' ');
    expect(warnText).toContain('mas-B');
    expect(warnText).toMatch(/threw|UPDATE/);
  });

  it('Scenario B: Supabase {error} result is logged (HIGH-NEW-4) — does not silently swallow', async () => {
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
      },
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue(
      [],
    );
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const { admin, updateLog } = makeSupabaseAdminMock({
      'mas-A': { error: { message: 'rls denied' } },
      'mas-B': 'success',
    });
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../cronLive');
    const { step } = makeStepStub();

    await expect(mod.runLiveForStore('uzoshop', { step })).resolves.toBeDefined();

    // Both ad-sets attempted; mas-A's error-result was observed (post-fix
    // logs it; pre-fix silently swallowed).
    const masALog = updateLog.find((u) => u.adSetId === 'mas-A');
    const masBLog = updateLog.find((u) => u.adSetId === 'mas-B');
    expect(masALog?.outcome).toBe('error-result');
    expect(masBLog?.outcome).toBe('success');

    // Pin: warn surface called with the rls message.
    const warnText = warnSpy.mock.calls.flat().join(' ');
    expect(warnText).toContain('rls denied');
    expect(warnText).toContain('mas-A');
  });

  it('Scenario C: combined — #1 success, #2 throws, #3 returns {error}; step still resolves and #1 landed', async () => {
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
        'mas-1': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'ACTIVE',
          name: null,
        },
        'mas-2': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'PAUSED',
          name: null,
        },
        'mas-3': {
          dailyBudget: 0,
          lifetimeBudget: 0,
          campaignId: 'c1',
          effectiveStatus: 'PAUSED',
          name: null,
        },
      },
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue(
      [],
    );
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const { admin, updateLog } = makeSupabaseAdminMock({
      'mas-1': 'success',
      'mas-2': 'throw',
      'mas-3': { error: { message: 'schema mismatch' } },
    });
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../cronLive');
    const { step } = makeStepStub();

    await expect(mod.runLiveForStore('uzoshop', { step })).resolves.toBeDefined();

    // All three ad-sets were attempted.
    expect(updateLog.length).toBeGreaterThanOrEqual(3);
    const mas1 = updateLog.find((u) => u.adSetId === 'mas-1');
    const mas2 = updateLog.find((u) => u.adSetId === 'mas-2');
    const mas3 = updateLog.find((u) => u.adSetId === 'mas-3');
    expect(mas1?.outcome).toBe('success');
    expect(mas2?.outcome).toBe('throw');
    expect(mas3?.outcome).toBe('error-result');

    // Both failures logged.
    const warnText = warnSpy.mock.calls.flat().join(' ');
    expect(warnText).toContain('mas-2');
    expect(warnText).toContain('mas-3');
    expect(warnText).toContain('schema mismatch');
  });
});
