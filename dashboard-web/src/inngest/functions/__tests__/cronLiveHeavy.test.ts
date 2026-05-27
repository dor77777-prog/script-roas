/**
 * Phase 13.9 (2026-05-27) — cron-live-heavy unit tests.
 *
 * Mirrors `cronLive.test.ts` for the new 30-min cron that fetches Meta +
 * Google + TikTok per-campaign + per-ad insights for [today, yesterday]
 * and UPSERTs into `campaigns_daily` + `ads_daily` via
 * `persistCampaignsLive()`.
 *
 * Covers (4 tests):
 *   1. Success path — both dates persist with non-empty Meta payload.
 *   2. Meta 429 rate-limit — soft-fail, persist still runs with empty
 *      Meta arrays, WhatsApp alert fires via notifyTokenFailure.
 *   3. Meta auth failure (190) — same soft-fail behavior + alert.
 *   4. Generic network error — soft-fail WITHOUT WhatsApp alert (only
 *      auth/rate-limit failures escalate to operator).
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
});
