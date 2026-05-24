// dashboard-web/src/inngest/functions/__tests__/cronOauthCanary.test.ts
//
// Phase 13.4 — OAuth canary daily cron. Pings Google Ads at 00:00 IL to
// surface refresh-token expiry the moment it happens, rather than at the
// next failing cron-daily run.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureStepErrorMock = vi.fn();
vi.mock('@/lib/sentry/capture', () => ({
  captureStepError: (...args: unknown[]) => captureStepErrorMock(...args),
}));

const fetchGoogleAdsSpendForDayMock = vi.fn();
vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsSpendForDay: (...args: unknown[]) => fetchGoogleAdsSpendForDayMock(...args),
}));

import { cronOauthCanary } from '../cronOauthCanary';

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

beforeEach(() => {
  captureStepErrorMock.mockClear();
  fetchGoogleAdsSpendForDayMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cronOauthCanary', () => {
  it('Test 1: cronOauthCanary is registered with cron TZ=Asia/Jerusalem 0 0 * * *', () => {
    const opts = (cronOauthCanary as unknown as { opts: { triggers: Array<{ cron: string }>; id: string } }).opts;
    expect(opts.id).toBe('cron-oauth-canary');
    expect(opts.triggers).toEqual([{ cron: 'TZ=Asia/Jerusalem 0 0 * * *' }]);
  });

  it('Test 2: happy path — fetchGoogleAdsSpendForDay succeeds → no Sentry capture, no throw', async () => {
    fetchGoogleAdsSpendForDayMock.mockResolvedValueOnce({
      storeId: 'uzoshop',
      date: '2026-05-24',
      spend: 50,
      currency: 'CAD',
    });
    const { step, ids } = makeMockStep();
    const handler = (cronOauthCanary as unknown as { fn: (ctx: { step: StepStub }) => Promise<unknown> }).fn;
    const result = await handler({ step });
    expect(result).toEqual({ status: 'ok' });
    expect(ids).toEqual(['check-google-uzoshop']);
    expect(captureStepErrorMock).not.toHaveBeenCalled();
    expect(fetchGoogleAdsSpendForDayMock).toHaveBeenCalledTimes(1);
    const [storeIdArg, dateArg] = fetchGoogleAdsSpendForDayMock.mock.calls[0] as [string, string];
    expect(storeIdArg).toBe('uzoshop');
    expect(dateArg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Test 3: failure → captureStepError called with right tags + handler rethrows', async () => {
    fetchGoogleAdsSpendForDayMock.mockRejectedValueOnce(new Error('OAuth token expired'));
    const { step } = makeMockStep();
    const handler = (cronOauthCanary as unknown as { fn: (ctx: { step: StepStub }) => Promise<unknown> }).fn;
    await expect(handler({ step })).rejects.toThrow(/OAuth token expired/);
    expect(captureStepErrorMock).toHaveBeenCalledTimes(1);
    const [opts, err] = captureStepErrorMock.mock.calls[0] as [
      { fnId: string; stepName: string; storeId: string },
      Error,
    ];
    expect(opts.fnId).toBe('cron-oauth-canary');
    expect(opts.stepName).toBe('check-google-uzoshop');
    expect(opts.storeId).toBe('uzoshop');
    expect(err.message).toMatch(/OAuth token expired/);
  });
});
