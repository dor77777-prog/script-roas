// dashboard-web/src/inngest/functions/__tests__/cronOauthCanary.test.ts
//
// Phase 13.4 — Google-only canary.
// Phase 14   — expanded to Google×1 + Meta×3 + TikTok×1. A failure in one
// platform must NOT abort sibling checks; each failure must fire
// notifyTokenFailure once.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureStepErrorMock = vi.fn();
vi.mock('@/lib/sentry/capture', () => ({
  captureStepError: (...args: unknown[]) => captureStepErrorMock(...args),
}));

const notifyTokenFailureMock = vi.fn();
vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: (...args: unknown[]) => notifyTokenFailureMock(...args),
}));

const fetchGoogleAdsSpendForDayMock = vi.fn();
vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsSpendForDay: (...args: unknown[]) => fetchGoogleAdsSpendForDayMock(...args),
}));

const fetchMetaSpendForDayLightMock = vi.fn();
vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaSpendForDayLight: (...args: unknown[]) => fetchMetaSpendForDayLightMock(...args),
}));

const fetchTikTokAdvertiserInfoMock = vi.fn();
vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokAdvertiserInfo: (...args: unknown[]) => fetchTikTokAdvertiserInfoMock(...args),
}));

// Phase 4a: the Meta probe list comes from the DB store list. Mock it so the
// canary enumerates a deterministic set instead of hitting Supabase.
const loadActiveStoreIdsMock = vi.fn<() => Promise<string[]>>();
vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: () => loadActiveStoreIdsMock(),
}));

import { runOauthCanary } from '../cronOauthCanary';

type StepStub = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
};

function makeMockStep(): { step: StepStub; ids: string[] } {
  const ids: string[] = [];
  const step: StepStub = {
    run: async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
      ids.push(id);
      return fn();
    },
  };
  return { step, ids };
}

// Default-success values for the three probes so tests can override per case.
const okGoogle = { storeId: 'uzoshop', date: '2026-05-28', spend: 50, currency: 'CAD' };
const okMeta = { storeId: 'uzoshop', date: '2026-05-28', spend: 100, currency: 'ILS' };
const okTikTok = { advertiserId: 'x', currency: 'ILS' };

beforeEach(() => {
  captureStepErrorMock.mockClear();
  notifyTokenFailureMock.mockReset();
  notifyTokenFailureMock.mockResolvedValue({ alerted: true, throttled: false, dbWritten: true });
  fetchGoogleAdsSpendForDayMock.mockReset();
  fetchMetaSpendForDayLightMock.mockReset();
  fetchTikTokAdvertiserInfoMock.mockReset();
  loadActiveStoreIdsMock.mockReset();
  // Default: the canonical 3 active stores (zero behavior change).
  loadActiveStoreIdsMock.mockResolvedValue(['uzoshop', 'zolplus', 'usmile360']);
  // Default: all 5 checks succeed.
  fetchGoogleAdsSpendForDayMock.mockResolvedValue(okGoogle);
  fetchMetaSpendForDayLightMock.mockResolvedValue(okMeta);
  fetchTikTokAdvertiserInfoMock.mockResolvedValue(okTikTok);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// runOauthCanary is the plain handler called inline by /api/cron/oauth-canary
// (Vercel Cron). The cron schedule lives in vercel.json + the route's IL-hour
// gate (covered by oauthCanaryRoute.test.ts); these tests cover the probe logic.
describe('runOauthCanary', () => {
  it('Test 2: happy path — all 5 checks succeed, status ok, correct step names + order', async () => {
    const { step, ids } = makeMockStep();
    const result = await runOauthCanary(step);
    expect(result).toEqual({ status: 'ok', checks: 5, passed: 5, failed: [] });
    expect(ids).toEqual([
      'check-google-uzoshop',
      'check-meta-uzoshop',
      'check-meta-zolplus',
      'check-meta-usmile360',
      'check-tiktok-uzoshop',
    ]);
    expect(captureStepErrorMock).not.toHaveBeenCalled();
    expect(notifyTokenFailureMock).not.toHaveBeenCalled();
    // Lightest probe each: Google = spend-for-day, Meta = spend-for-day-light, TikTok = advertiser-info.
    expect(fetchGoogleAdsSpendForDayMock).toHaveBeenCalledTimes(1);
    expect(fetchMetaSpendForDayLightMock).toHaveBeenCalledTimes(3);
    expect(fetchTikTokAdvertiserInfoMock).toHaveBeenCalledTimes(1);
  });

  it('Test 3: one Meta store fails — other 4 still pass, function returns partial, single notifyTokenFailure', async () => {
    fetchMetaSpendForDayLightMock.mockImplementation((storeId: string) => {
      if (storeId === 'zolplus') return Promise.reject(new Error('Meta token expired'));
      return Promise.resolve(okMeta);
    });
    const { step } = makeMockStep();
    const result = (await runOauthCanary(step)) as { status: string; passed: number; failed: string[] };
    expect(result.status).toBe('partial');
    expect(result.passed).toBe(4);
    expect(result.failed).toEqual(['meta/zolplus']);
    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(1);
    const call = notifyTokenFailureMock.mock.calls[0][0] as { provider: string; storeId: string; operation: string; errorMsg: string };
    expect(call.provider).toBe('meta');
    expect(call.storeId).toBe('zolplus');
    expect(call.operation).toBe('canary');
    expect(call.errorMsg).toMatch(/Meta token expired/);
    expect(captureStepErrorMock).toHaveBeenCalledTimes(1);
  });

  it('Test 4: handler NEVER throws — all 5 fail, returns partial summary with all listed failures', async () => {
    fetchGoogleAdsSpendForDayMock.mockRejectedValue(new Error('google dead'));
    fetchMetaSpendForDayLightMock.mockRejectedValue(new Error('meta dead'));
    fetchTikTokAdvertiserInfoMock.mockRejectedValue(new Error('tiktok dead'));
    const { step } = makeMockStep();
    const result = (await runOauthCanary(step)) as { status: string; passed: number; failed: string[] };
    expect(result.status).toBe('partial');
    expect(result.passed).toBe(0);
    expect(result.failed.sort()).toEqual(
      ['google/uzoshop', 'meta/uzoshop', 'meta/zolplus', 'meta/usmile360', 'tiktok/uzoshop'].sort(),
    );
    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(5);
    expect(captureStepErrorMock).toHaveBeenCalledTimes(5);
  });

  it('Test 5 (Phase 4a): Meta probes follow the DB store list; Google+TikTok stay uzoshop-only', async () => {
    // DB returns a DIFFERENT set than the hardcoded 3 → fail-if-reverted.
    loadActiveStoreIdsMock.mockResolvedValue(['alpha', 'beta']);
    const { step, ids } = makeMockStep();
    const result = (await runOauthCanary(step)) as { status: string; checks: number; passed: number };

    expect(loadActiveStoreIdsMock).toHaveBeenCalledTimes(1);
    // 1 Google + 2 Meta (alpha, beta) + 1 TikTok = 4 checks.
    expect(result.checks).toBe(4);
    expect(result.status).toBe('ok');
    // Meta steps enumerate the DB list; Google + TikTok stay uzoshop-only.
    expect(ids).toEqual([
      'check-google-uzoshop',
      'check-meta-alpha',
      'check-meta-beta',
      'check-tiktok-uzoshop',
    ]);
    // Meta probe was called once per DB store with the right store id.
    expect(fetchMetaSpendForDayLightMock).toHaveBeenCalledTimes(2);
    expect(fetchMetaSpendForDayLightMock.mock.calls.map((c) => c[0])).toEqual(['alpha', 'beta']);
    // Google + TikTok unchanged: hardcoded uzoshop, one call each.
    expect(fetchGoogleAdsSpendForDayMock).toHaveBeenCalledTimes(1);
    expect(fetchGoogleAdsSpendForDayMock.mock.calls[0][0]).toBe('uzoshop');
    expect(fetchTikTokAdvertiserInfoMock).toHaveBeenCalledTimes(1);
    expect(fetchTikTokAdvertiserInfoMock.mock.calls[0][0]).toBe('uzoshop');
  });
});
