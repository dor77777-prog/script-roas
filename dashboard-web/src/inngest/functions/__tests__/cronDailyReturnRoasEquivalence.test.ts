/**
 * Audit fix 2026-05-24 (AUDIT INN-01, Phase 12.1.1) — locks the equivalence
 * between cronDaily's RunDailyResult.roas and the persisted data_daily.roas.
 *
 * Pre-fix: return value at lines 1121-1126 computed roas from
 * merged.totalSpendCad (which EXCLUDES TikTok). Persisted row at lines
 * 437-440 used totalSpendCadAll = merged.totalSpendCad + ttSpendCad
 * (INCLUDES TikTok). Operator sees one ROAS in the jobs table and a
 * different one on the dashboard for uzoshop (the only TikTok store).
 *
 * Fix: hoist totalSpendCadAll/roas/grossProfit/netProfit/cogs out of the
 * persist-batch closure so the return value uses the same numbers that
 * were actually persisted to disk.
 *
 * Evidence pack: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   inngest_cronDaily.json (INN-01).
 *
 * Test coverage (3 tests):
 *   1. INN-01: result.roas equals persisted data_daily.roas when TikTok
 *      succeeds — main equivalence scenario.
 *   2. INN-01: result.totalSpendCad equals persisted data_daily.total_spend_cad
 *      — pin the same equivalence on totalSpend (not just roas).
 *   3. INN-01: when TikTok FX fails (ttSpendCad === null), result.roas
 *      matches the FX-failed branch (both 0).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — mirrors cronDaily.test.ts pattern but minimized to
// what these 3 INN-01 tests need.
// ---------------------------------------------------------------------------
type UpsertCall = {
  table: string;
  rows: unknown;
  opts: { onConflict?: string };
};

type MockState = {
  upserts: UpsertCall[];
  /** Shopify revenue for the day. Test 1 uses 1234. */
  shopifyRevenueCad: number;
  /** Merged fb+ga CAD total (TikTok NOT included). Test 1 uses 86. */
  mergedTotalSpendCad: number;
  /** TikTok raw spend in source currency (USD). Test 1 uses 40. */
  tiktokSpend: number;
  /** TikTok source currency. Default USD. */
  tiktokCurrency: string;
  /** USD→CAD rate. Test 1 uses 1.35 → ttSpendCad = 40 × 1.35 = 54. */
  fxRate: number;
  /** When true, getFxRate throws → cronDaily sets ttSpendCad=null → omits
   *  TikTok from total_spend_cad / roas / data_daily upsert payload. */
  fxThrows: boolean;
};

const mockState = vi.hoisted<MockState>(() => ({
  upserts: [],
  shopifyRevenueCad: 1234,
  mergedTotalSpendCad: 86,
  tiktokSpend: 40,
  tiktokCurrency: 'USD',
  fxRate: 1.35,
  fxThrows: false,
}));

// ---------------------------------------------------------------------------
// Mocks — must precede SUT import.
// ---------------------------------------------------------------------------

vi.mock('@/lib/fetchers/shopify', () => ({
  fetchShopifyDayRows: vi.fn(async (storeId: string, date: string) => ({
    storeId,
    date,
    storeName: 'uzoshop',
    revenueCad: mockState.shopifyRevenueCad,
    productRows: [],
    customItemRefundCad: 0,
    grossRevenueCad: mockState.shopifyRevenueCad,
    refundDeductionCad: 0,
  })),
  fetchShopifyOrdersAttribution: vi.fn(async () => []),
  fetchShopifyProductsCatalog: vi.fn(async () => []),
}));

vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaAdSetInsights: vi.fn(async () => []),
  fetchMetaSpendForDay: vi.fn(async (storeId: string, date: string) => ({
    storeId,
    date,
    spend: 50,
    currency: 'ILS',
  })),
  fetchMetaAdInsights: vi.fn(async () => []),
  fetchMetaBudgets: vi.fn(async () => ({
    currency: 'ILS',
    campaigns: {},
    adSets: {},
  })),
}));

vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsSpendForDay: vi.fn(async (storeId: string, date: string) => ({
    storeId,
    date,
    spend: 36,
    currency: 'CAD',
  })),
  fetchGoogleAdsAdGroupInsights: vi.fn(async () => []),
  fetchGoogleAdsAdInsights: vi.fn(async () => []),
}));

// TikTok mock — drives ttSpendCad branch in persist-batch.
vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokSpendForDay: vi.fn(async (storeId: string, date: string) => ({
    storeId,
    date,
    spend: mockState.tiktokSpend,
    currency: mockState.tiktokCurrency,
  })),
  fetchTikTokAdInsights: vi.fn(async () => []),
  fetchTikTokAdvertiserInfo: vi.fn(async () => ({
    advertiserId: '7306450983905787906',
    name: 'DOD DIGITAL1128',
    currency: 'USD',
    timezone: 'Etc/GMT-2',
  })),
}));

vi.mock('@/lib/fetchers/manualOverrides', () => ({
  mergeOverridesFromSupabase: vi.fn(async () => ({
    fbSpendCad: 50,
    gaSpendCad: 36,
    totalSpendCad: mockState.mergedTotalSpendCad,
    overridesApplied: { meta: false, google: false },
  })),
}));

// FX mock — getFxRate is called once per (currency, date) in persist-batch
// for the TikTok USD→CAD conversion. Test 3 enables fxThrows to simulate
// Frankfurter outage.
vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn(async () => {
    if (mockState.fxThrows) {
      throw new Error('FX provider 503 — Frankfurter outage');
    }
    return mockState.fxRate;
  }),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      upsert: (rows: unknown, opts: { onConflict?: string } = {}) => {
        mockState.upserts.push({ table, rows, opts });
        return Promise.resolve({ error: null });
      },
    }),
    // Phase 3 (2026-06-02) — runDailyForStore calls
    // admin.rpc('recompute_first_order_flags', ...) at the end of persist;
    // soft-fail stub so it never throws here.
    rpc: () => Promise.resolve({ error: null }),
  }),
}));

// ---- SUT import (after mocks) ---------------------------------------------

import { runDailyForStore } from '../cronDaily';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockStep(): {
  step: { run: (id: string, cb: () => Promise<unknown>) => Promise<unknown> };
  ids: string[];
} {
  const ids: string[] = [];
  const step = {
    run: async (id: string, cb: () => Promise<unknown>) => {
      ids.push(id);
      return await cb();
    },
  };
  return { step, ids };
}

function dataDailyPayload(): Record<string, unknown> {
  // The data_daily upsert payload is a single-row array — extract the
  // first row. cronDaily.ts calls `.upsert([payload], {onConflict})`.
  const call = mockState.upserts.find((c) => c.table === 'data_daily');
  if (!call) throw new Error('no data_daily upsert recorded');
  const rows = Array.isArray(call.rows) ? call.rows : [call.rows];
  return rows[0] as Record<string, unknown>;
}

beforeEach(() => {
  mockState.upserts = [];
  mockState.shopifyRevenueCad = 1234;
  mockState.mergedTotalSpendCad = 86;
  mockState.tiktokSpend = 40;
  mockState.tiktokCurrency = 'USD';
  mockState.fxRate = 1.35;
  mockState.fxThrows = false;
});

// ===========================================================================

describe('cronDaily return-roas / persisted-roas equivalence (INN-01)', () => {
  it('INN-01: result.roas equals persisted data_daily.roas when TikTok succeeds', async () => {
    // Scenario per the audit's regression_test_idea:
    //   tiktokSpend.spend = 40 USD, fxRate = 1.35 → ttSpendCad = 54
    //   merged.totalSpendCad = 86 CAD (fb 50 + ga 36)
    //   shopify.revenueCad = 1234 CAD
    //   Expected persisted: totalSpendCadAll = 86 + 54 = 140
    //                       roas = 1234 / 140 ≈ 8.81
    //   Pre-fix RunDailyResult.roas: 1234 / 86 ≈ 14.35 (excludes TikTok)
    //   Post-fix: result.roas === 8.81 (matches persisted)
    const { step } = makeMockStep();
    const result = await runDailyForStore('uzoshop', '2026-05-20', { step });

    const payload = dataDailyPayload();
    const persistedRoas = payload.roas as number;
    expect(typeof persistedRoas).toBe('number');

    // Sanity: persisted roas matches our hand-computed expectation
    // (1234 / 140 ≈ 8.814285…).
    expect(persistedRoas).toBeCloseTo(1234 / (86 + 40 * 1.35), 9);

    // ===== CORE INN-01 ASSERTION =====
    // The return value's roas MUST equal the persisted roas within
    // FP epsilon (1e-9). Pre-fix this fails because the return uses
    // merged.totalSpendCad (=86) and the persist uses totalSpendCadAll
    // (=140) — the two are computed from different totals.
    expect(
      Math.abs(result.roas - persistedRoas),
      `result.roas (${result.roas}) must equal persisted data_daily.roas (${persistedRoas}) within FP epsilon. ` +
        `If this assertion fails, INN-01 is alive: the operator sees one ROAS in the jobs table and a different one on the dashboard.`,
    ).toBeLessThan(1e-9);
  });

  it('INN-01: result.totalSpendCad equals persisted data_daily.total_spend_cad', async () => {
    // Same scenario as Test 1, but pinned on totalSpend instead of roas.
    // Persisted total_spend_cad = 140 (includes TikTok). Pre-fix
    // result.totalSpendCad = 86 (excludes TikTok). Post-fix both 140.
    const { step } = makeMockStep();
    const result = await runDailyForStore('uzoshop', '2026-05-20', { step });

    const payload = dataDailyPayload();
    const persistedTotal = payload.total_spend_cad as number;
    expect(typeof persistedTotal).toBe('number');

    // Sanity: persisted total matches our hand-computed expectation.
    expect(persistedTotal).toBeCloseTo(86 + 40 * 1.35, 9);

    // ===== CORE ASSERTION =====
    expect(
      Math.abs(result.totalSpendCad - persistedTotal),
      `result.totalSpendCad (${result.totalSpendCad}) must equal persisted data_daily.total_spend_cad (${persistedTotal}) within FP epsilon. ` +
        `Pre-fix the return excluded TikTok; post-fix both include it.`,
    ).toBeLessThan(1e-9);
  });

  it('INN-01: when TikTok FX fails (ttSpendCad === null), result.roas matches the FX-failed branch', async () => {
    // Scenario: TikTok spend > 0 but the FX call throws → cronDaily
    // sets ttSpendCad = null → totalSpendCadAll = null → persisted
    // roas = 0 (the null branch at cronDaily.ts:437-440). The return
    // value MUST mirror that (post-fix). Pre-fix the return value
    // would have computed 1234 / 86 ≈ 14.35 — a non-zero number that
    // disagrees with the persisted 0.
    //
    // Note: in the FX-failed branch the persisted payload also OMITS
    // total_spend_cad / roas / gross_profit_cad / net_profit_cad from
    // the upsert payload (cronDaily.ts:516-540 condition). So the
    // 'persisted roas' isn't a field on the upsert payload — it's the
    // SEMANTIC value (0) the persist logic computed. We assert against
    // that semantic value via the result.
    mockState.fxThrows = true;
    mockState.tiktokSpend = 40; // non-zero so the FX path is exercised

    // Silence the expected FX-failure console.warn from persist-batch.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { step } = makeMockStep();
    const result = await runDailyForStore('uzoshop', '2026-05-20', { step });

    // After fix: when ttSpendCad === null, persistedTotalSpendCad ===
    // null, persistedRoas === 0. The return value mirrors:
    //   - totalSpendCad falls back to merged.totalSpendCad (86) so the
    //     return shape stays non-null (an operator reading the jobs
    //     table still sees a usable number).
    //   - roas === 0 (mirrors the persisted 0).
    //
    // Pin BOTH: roas === 0 and a console.warn fired (proves FX path
    // was exercised, not bypassed).
    expect(result.roas).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    const warnMessages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnMessages.some((m) => /TikTok FX failed/i.test(m))).toBe(true);
  });
});
