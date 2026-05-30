/**
 * Phase A 2026-05-29 — Task 12: cron-live-heavy pre-flight Meta BUC gate
 * + per-store cron stagger tests.
 *
 * Covers 5 tests:
 *   1. Pre-flight detects high BUC + skips Meta + still runs Google + TikTok.
 *   2. Stale BUC row (older than 15 min) → optimistic proceed (Meta runs).
 *   3. Reactive MetaBudgetHighError mid-fetch routes to budget_skip operation.
 *   4. Stagger factory wires correct cron per store.
 *   5. BUC pct < 80 → proceed normally, no budget_skip recorded.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const STORE = 'uzoshop';
const TODAY = '2026-05-29';

// Module-scoped map used by test 4 to capture cron strings from the factory.
// Must be declared at module scope (not inside a test) so the vi.mock hoisting
// can close over the reference correctly via the `capturedTriggers` name.
const capturedTriggers: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Module mocks — established before any dynamic imports
// ---------------------------------------------------------------------------

vi.mock('@/lib/notifications/metaBucUsage', () => ({
  getMetaBucUsageForStore: vi.fn(),
}));

vi.mock('@/lib/inngest/freshness', () => ({
  recordFreshness: vi.fn(async () => undefined),
}));

vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: vi.fn(async () => ({ alerted: false, throttled: false, dbWritten: true })),
}));

vi.mock('@/lib/notifications/detectAuthError', async (orig) => ({
  ...(await orig<typeof import('@/lib/notifications/detectAuthError')>()),
}));

vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaAdSetInsights: vi.fn().mockResolvedValue([]),
  fetchMetaAdInsights: vi.fn().mockResolvedValue([]),
  fetchMetaBudgets: vi.fn().mockResolvedValue({ currency: 'ILS', campaigns: {}, adSets: {} }),
}));

vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsAdGroupInsights: vi.fn().mockResolvedValue([]),
  fetchGoogleAdsAdInsights: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokAdInsights: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/inngest/persistCampaignsLive', () => ({
  persistCampaignsLive: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn().mockResolvedValue(1),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));

vi.mock('@/lib/getTodayInIsrael', () => ({
  todayInIsrael: () => TODAY,
}));

// Intercept Inngest client so the factory's createFunction calls are captured.
// capturedTriggers is filled at module load time when cronLiveHeavy.ts runs
// the ALL_STORES.map(makeCronLiveHeavy) at the bottom.
vi.mock('@/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn(
      (
        opts: { id: string; triggers: Array<{ cron: string }> },
        _handler: unknown,
      ) => {
        const cron = opts.triggers?.[0]?.cron ?? '';
        capturedTriggers[opts.id] = cron;
        return { id: opts.id };
      },
    ),
  },
}));

// ---------------------------------------------------------------------------
// StepRunner stub — mirrors cronLiveHeavy.test.ts pattern
// ---------------------------------------------------------------------------
function makeStepStub() {
  return {
    step: {
      async run<T>(_id: string, cb: () => Promise<T>): Promise<T> {
        return cb();
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: return a fresh BUC usage object with last_updated_at set to `ageMin`
// minutes ago (default 5 = fresh within the 15-min window).
// ---------------------------------------------------------------------------
function makeBucUsage(maxPct: number, ageMin = 5) {
  const ts = new Date(Date.now() - ageMin * 60_000).toISOString();
  return {
    max_ads_insights_call_pct: maxPct,
    max_ads_insights_cputime_pct: 0,
    max_ads_insights_time_pct: 0,
    max_ads_management_call_pct: 0,
    max_ads_management_cputime_pct: 0,
    max_ads_management_time_pct: 0,
    max_eta_minutes: 0,
    rows: [
      {
        store_id: STORE,
        ad_account_id: 'act_123',
        ads_insights_call_pct: maxPct,
        ads_insights_cputime_pct: 0,
        ads_insights_time_pct: 0,
        ads_management_call_pct: 0,
        ads_management_cputime_pct: 0,
        ads_management_time_pct: 0,
        ads_insights_eta_minutes: 0,
        ads_management_eta_minutes: 0,
        last_updated_at: ts,
        last_url: '',
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cron-live-heavy — pre-flight Meta BUC gate', () => {
  it('1. detects high BUC + skips Meta + still runs Google + TikTok', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    const { recordFreshness } = await import('@/lib/inngest/freshness');
    const { notifyTokenFailure } = await import('@/lib/notifications/tokenFailures');
    const metaMod = await import('@/lib/fetchers/meta');
    const googleMod = await import('@/lib/fetchers/googleAds');
    const tiktokMod = await import('@/lib/fetchers/tiktok');
    const { runHeavyForStore } = await import('../cronLiveHeavy');

    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBucUsage(85), // 85 >= 80 threshold, fresh within 15 min
    );

    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });

    // Meta fetchers must NOT be called when pre-flight gates them out
    expect(metaMod.fetchMetaAdSetInsights).not.toHaveBeenCalled();
    expect(metaMod.fetchMetaAdInsights).not.toHaveBeenCalled();
    expect(metaMod.fetchMetaBudgets).not.toHaveBeenCalled();

    // Google + TikTok fetchers ARE still called (once per date × 2 dates)
    expect(googleMod.fetchGoogleAdsAdGroupInsights).toHaveBeenCalled();
    expect(googleMod.fetchGoogleAdsAdInsights).toHaveBeenCalled();
    expect(tiktokMod.fetchTikTokAdInsights).toHaveBeenCalled();

    // recordFreshness called 3 times with budget_skip status
    // (campaign_metrics, adset_metrics, ad_metrics) — once per scope
    const rFCalls = (recordFreshness as ReturnType<typeof vi.fn>).mock.calls;
    expect(rFCalls.length).toBeGreaterThanOrEqual(3);

    const budgetSkipCalls = rFCalls.filter(
      (c) => (c[0] as { status: string }).status === 'budget_skip',
    );
    expect(budgetSkipCalls.length).toBeGreaterThanOrEqual(3);

    const scopes = budgetSkipCalls.map((c) => (c[0] as { scope: string }).scope);
    expect(scopes).toContain('campaign_metrics');
    expect(scopes).toContain('adset_metrics');
    expect(scopes).toContain('ad_metrics');

    // notifyTokenFailure called with operation='cron_live_heavy_budget_skip'
    expect(notifyTokenFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'meta',
        storeId: STORE,
        operation: 'cron_live_heavy_budget_skip',
      }),
    );
  });

  it('2. stale BUC row (older than 15 min) → optimistic proceed (Meta runs)', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    const { recordFreshness } = await import('@/lib/inngest/freshness');
    const metaMod = await import('@/lib/fetchers/meta');
    const { runHeavyForStore } = await import('../cronLiveHeavy');

    // High pct but 20 min old — beyond the 15-min fresh window
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBucUsage(90, 20),
    );

    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });

    // Meta fetchers ARE called (optimistic proceed)
    expect(metaMod.fetchMetaAdSetInsights).toHaveBeenCalled();
    expect(metaMod.fetchMetaAdInsights).toHaveBeenCalled();
    expect(metaMod.fetchMetaBudgets).toHaveBeenCalled();

    // No budget_skip recordFreshness calls
    const rFCalls = (recordFreshness as ReturnType<typeof vi.fn>).mock.calls;
    const budgetSkipCalls = rFCalls.filter(
      (c) => (c[0] as { status: string }).status === 'budget_skip',
    );
    expect(budgetSkipCalls.length).toBe(0);
  });

  it('3. reactive MetaBudgetHighError mid-fetch routes to budget_skip operation', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    const { notifyTokenFailure } = await import('@/lib/notifications/tokenFailures');
    const metaMod = await import('@/lib/fetchers/meta');
    const { runHeavyForStore } = await import('../cronLiveHeavy');

    // No prior BUC row — pre-flight passes, Meta runs, then throws mid-fetch
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    (metaMod.fetchMetaAdSetInsights as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('META_BUDGET_HIGH: ads_insights_call_pct=92, detected in fetchMeta'),
    );

    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });

    // Operation must route to budget_skip, NOT rate_limit
    expect(notifyTokenFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'meta',
        storeId: STORE,
        operation: 'cron_live_heavy_budget_skip',
      }),
    );

    // Must NOT have been called with rate_limit for this error
    const calls = (notifyTokenFailure as ReturnType<typeof vi.fn>).mock.calls;
    const rateLimitCalls = calls.filter(
      (c) => (c[0] as { operation: string }).operation === 'cron_live_heavy_rate_limit',
    );
    expect(rateLimitCalls.length).toBe(0);
  });

  it('Phase E1 (2026-05-30): cronLiveHeavyFunctions disabled — zero Inngest registrations', async () => {
    // Phase E1 decommissioned cron-live-heavy. The factory loop was
    // removed; the export is now an empty array. runHeavyForStore +
    // makeCronLiveHeavy + persistCampaignsLive source remain in the
    // file for rollback + the other tests in this file (which drive
    // runHeavyForStore directly via dynamic import).
    const { cronLiveHeavyFunctions } = await import('../cronLiveHeavy');
    expect(cronLiveHeavyFunctions.length).toBe(0);
    // capturedTriggers should NOT contain the cron-live-heavy-* entries
    // because the factory loop no longer runs at module load.
    expect(capturedTriggers['cron-live-heavy-uzoshop']).toBeUndefined();
    expect(capturedTriggers['cron-live-heavy-zolplus']).toBeUndefined();
    expect(capturedTriggers['cron-live-heavy-usmile360']).toBeUndefined();
  });

  it('5. BUC pct < 80 → proceed normally, no budget_skip recorded', async () => {
    const { getMetaBucUsageForStore } = await import('@/lib/notifications/metaBucUsage');
    const { recordFreshness } = await import('@/lib/inngest/freshness');
    const metaMod = await import('@/lib/fetchers/meta');
    const { runHeavyForStore } = await import('../cronLiveHeavy');

    // pct = 50 — below the 80% threshold
    (getMetaBucUsageForStore as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBucUsage(50),
    );

    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });

    // Meta fetchers ARE called (normal proceed)
    expect(metaMod.fetchMetaAdSetInsights).toHaveBeenCalled();
    expect(metaMod.fetchMetaAdInsights).toHaveBeenCalled();
    expect(metaMod.fetchMetaBudgets).toHaveBeenCalled();

    // No budget_skip status in recordFreshness calls
    const rFCalls = (recordFreshness as ReturnType<typeof vi.fn>).mock.calls;
    const budgetSkipCalls = rFCalls.filter(
      (c) => (c[0] as { status: string }).status === 'budget_skip',
    );
    expect(budgetSkipCalls.length).toBe(0);
  });
});
