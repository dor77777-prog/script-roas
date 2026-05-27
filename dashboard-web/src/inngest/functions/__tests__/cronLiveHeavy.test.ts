/**
 * Phase 13.9 (2026-05-27) — cron-live-heavy unit tests.
 *
 * Mirrors `cronLive.test.ts` for the new 30-min cron that fetches Meta +
 * Google + TikTok per-campaign + per-ad insights for [today, yesterday]
 * and UPSERTs into `campaigns_daily` + `ads_daily` via
 * `persistCampaignsLive()`.
 *
 * Covers (6 tests):
 *   1. Success path — both dates persist with non-empty Meta payload.
 *   2. Meta 429 rate-limit — soft-fail, persist still runs with empty
 *      Meta arrays, WhatsApp alert fires via notifyTokenFailure.
 *   3. Meta auth failure (190) — same soft-fail behavior + alert.
 *   4. Generic network error — soft-fail WITHOUT WhatsApp alert (only
 *      auth/rate-limit failures escalate to operator).
 *   5. (P1-7 / A7-F2) fetch and persist use SEPARATE named step.run labels
 *      per (store, date) — ensures Inngest memoizes fetch results across
 *      retries rather than re-fetching fresh platform data each time.
 *   6. (FX-date artifact / P0-3) getFxRate is called with each date's own
 *      date string — yesterday's campaigns use yesterday's FX rate, not
 *      today's. Prevents per-day CAD variance between cron-live-heavy and
 *      cron-daily for the same historical row.
 *
 * NOTE: lives under `src/inngest/functions/__tests__/` — vitest's default
 * glob (`src/lib/**`) doesn't pick this up, so it must be invoked explicitly
 * via `npx vitest run src/inngest/functions/__tests__/cronLiveHeavy.test.ts`.
 * Same caveat as `cronLive.test.ts`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const STORE = 'uzoshop';
const TODAY = '2026-05-27';
const YESTERDAY = '2026-05-26';

vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: vi.fn(async () => ({ alerted: true, throttled: false, dbWritten: true })),
}));

vi.mock('@/lib/inngest/persistCampaignsLive', () => ({
  persistCampaignsLive: vi.fn(async () => {}),
}));

vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaAdSetInsights: vi.fn(async () => []),
  fetchMetaAdInsights: vi.fn(async () => []),
  fetchMetaBudgets: vi.fn(async () => ({ currency: 'ILS', campaigns: {}, adSets: {} })),
}));

vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsAdGroupInsights: vi.fn(async () => []),
  fetchGoogleAdsAdInsights: vi.fn(async () => []),
}));

vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokAdInsights: vi.fn(async () => []),
}));

vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn(async () => 1),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));

vi.mock('@/lib/getTodayInIsrael', () => ({
  todayInIsrael: () => TODAY,
}));

// Inngest step stub — mirrors the one in cronLive.test.ts.
function makeStepStub() {
  return {
    step: {
      async run<T>(_id: string, cb: () => Promise<T>): Promise<T> {
        return cb();
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cron-live-heavy runHeavyForStore', () => {
  it('fetches all three platforms for today + yesterday and calls persistCampaignsLive per (store, date)', async () => {
    const { runHeavyForStore } = await import('../cronLiveHeavy');
    const { persistCampaignsLive } = await import('@/lib/inngest/persistCampaignsLive');
    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });
    // 2 dates × 1 persist call each = 2 calls
    expect(persistCampaignsLive).toHaveBeenCalledTimes(2);
    const calls = (persistCampaignsLive as ReturnType<typeof vi.fn>).mock.calls;
    const dates = calls.map((c) => (c[0] as { dateStr: string }).dateStr).sort();
    expect(dates).toEqual([YESTERDAY, TODAY]);
  });

  it('on Meta rate-limit (429): skips Meta, still calls persistCampaignsLive with empty meta, fires WhatsApp alert', async () => {
    const meta = await import('@/lib/fetchers/meta');
    (meta.fetchMetaAdSetInsights as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Meta account insights uzoshop 2026-05-27 failed (429): { "error": { "code": 17 } }'),
    );
    const { runHeavyForStore } = await import('../cronLiveHeavy');
    const { notifyTokenFailure } = await import('@/lib/notifications/tokenFailures');
    const { persistCampaignsLive } = await import('@/lib/inngest/persistCampaignsLive');
    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });
    expect(notifyTokenFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'meta',
        storeId: STORE,
        operation: expect.stringContaining('rate_limit'),
      }),
    );
    // persist still runs (Google + TikTok rows still flow through; Meta is empty).
    expect(persistCampaignsLive).toHaveBeenCalled();
    const todayCall = (persistCampaignsLive as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as { dateStr: string }).dateStr === TODAY,
    );
    expect(todayCall).toBeTruthy();
    expect((todayCall![0] as { meta: { adsetRows: unknown[] } }).meta.adsetRows).toEqual([]);
  });

  it('on Meta auth failure (NOT rate-limit): fires WhatsApp via tokenFailure with provider=meta and skips Meta', async () => {
    const meta = await import('@/lib/fetchers/meta');
    (meta.fetchMetaAdSetInsights as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Meta insights failed: { "error": { "code": 190, "message": "Access token expired" } }'),
    );
    const { runHeavyForStore } = await import('../cronLiveHeavy');
    const { notifyTokenFailure } = await import('@/lib/notifications/tokenFailures');
    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });
    expect(notifyTokenFailure).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'meta', storeId: STORE }),
    );
  });

  it('does NOT call notifyTokenFailure on non-auth non-rate-limit errors (just logs)', async () => {
    const meta = await import('@/lib/fetchers/meta');
    (meta.fetchMetaAdSetInsights as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('fetch failed: ETIMEDOUT'),
    );
    const { runHeavyForStore } = await import('../cronLiveHeavy');
    const { notifyTokenFailure } = await import('@/lib/notifications/tokenFailures');
    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });
    expect(notifyTokenFailure).not.toHaveBeenCalled();
  });

  it('(P1-7 / A7-F2) fetch and persist use separate named step.run labels per (store, date)', async () => {
    // Post-fix invariant: for each (store, date) pair, there must be a
    // distinct "fetch-{store}-{date}" step label AND a distinct
    // "persist-{store}-{date}" step label. This ensures Inngest memoizes
    // the fetched data across retries (the fetch step result is replayed,
    // not re-fetched), preventing subtle data-drift when a persist step
    // fails mid-way and Inngest retries.
    //
    // Pre-fix: a single "fetch-and-persist-{store}-{date}" step combines
    // fetch + persist, so a retry always re-fetches fresher platform data
    // (non-idempotent).
    const labels: string[] = [];
    const step = {
      async run<T>(id: string, cb: () => Promise<T>): Promise<T> {
        labels.push(id);
        return cb();
      },
    };
    const { runHeavyForStore } = await import('../cronLiveHeavy');
    await runHeavyForStore(STORE, { step });

    // There should be NO combined "fetch-and-persist-*" labels.
    const combined = labels.filter(l => l.startsWith('fetch-and-persist-'));
    expect(combined, `Combined fetch-and-persist steps found: ${combined.join(', ')} — should be split into separate fetch + persist steps`).toHaveLength(0);

    // For each date, expect a dedicated fetch label and a dedicated persist label.
    for (const date of [TODAY, YESTERDAY]) {
      const fetchLabel = `fetch-${STORE}-${date}`;
      const persistLabel = `persist-${STORE}-${date}`;
      expect(labels, `Missing fetch step label "${fetchLabel}"`).toContain(fetchLabel);
      expect(labels, `Missing persist step label "${persistLabel}"`).toContain(persistLabel);

      // fetch must precede persist for the same date (so memoized data flows to persist).
      const fetchIdx = labels.indexOf(fetchLabel);
      const persistIdx = labels.indexOf(persistLabel);
      expect(fetchIdx, `fetch step "${fetchLabel}" must appear before persist step "${persistLabel}"`).toBeLessThan(persistIdx);
    }
  });

  it('(FX-date artifact / P0-3) getFxRate is called with each date\'s own date string, not always today', async () => {
    // Pre-fix: cronLiveHeavy.ts:191 calls getFxRate(currency, 'CAD', today)
    // for BOTH today AND yesterday — yesterday's campaigns_daily row is
    // therefore FX-converted with today's ILS rate rather than yesterday's.
    // This produces a ~$10 CAD per-day discrepancy vs cron-daily's nightly
    // write (which correctly uses yesterday's rate for yesterday's row).
    //
    // Post-fix: the getFx closure must pass the row's own `date` argument
    // rather than the captured `today` constant.
    //
    // Test strategy: mock getFxRate to return different values for today vs
    // yesterday. Verify that when persistCampaignsLive is called for
    // yesterday, the getFx argument passed for a non-CAD currency resolves
    // to YESTERDAY's rate (not today's). We do this by capturing the `getFx`
    // function passed to persistCampaignsLive and calling it with a non-CAD
    // currency, asserting the returned rate corresponds to the date being processed.
    const fxMod = await import('@/lib/fetchers/fx');
    (fxMod.getFxRate as ReturnType<typeof vi.fn>).mockImplementation(
      async (_from: string, _to: string, date: string) => {
        // Return a deterministic rate per date so we can verify which was used.
        return date === TODAY ? 999 : date === YESTERDAY ? 777 : 1;
      },
    );

    const { runHeavyForStore } = await import('../cronLiveHeavy');
    const { persistCampaignsLive } = await import('@/lib/inngest/persistCampaignsLive');

    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });

    // Collect calls grouped by dateStr.
    const calls = (persistCampaignsLive as ReturnType<typeof vi.fn>).mock.calls as Array<
      [{ dateStr: string; getFx: (amount: number, currency: string) => Promise<number | null> }]
    >;
    expect(calls.length).toBe(2);

    for (const [arg] of calls) {
      const { dateStr, getFx } = arg;
      // Ask for an ILS→CAD rate via the getFx closure the handler passed.
      const rate = await getFx(100, 'ILS');
      if (dateStr === TODAY) {
        expect(rate, `getFx for today (${TODAY}) should use today's FX rate (999), got ${rate}`).toBe(999);
      } else if (dateStr === YESTERDAY) {
        expect(rate, `getFx for yesterday (${YESTERDAY}) should use yesterday's FX rate (777), got ${rate} — indicates today's rate was used instead`).toBe(777);
      }
    }
  });
});
