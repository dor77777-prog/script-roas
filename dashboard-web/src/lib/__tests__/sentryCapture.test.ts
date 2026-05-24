// dashboard-web/src/lib/__tests__/sentryCapture.test.ts
// Phase 13.2 — unit tests for the server-only capture helpers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @sentry/nextjs BEFORE importing the module under test.
const captureExceptionMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

// Mock notifyTokenFailure (server-only).
const notifyTokenFailureMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: (...args: unknown[]) => notifyTokenFailureMock(...args),
}));

import {
  captureCronFetchError,
  captureRouteError,
  captureStepError,
} from '@/lib/sentry/capture';

beforeEach(() => {
  captureExceptionMock.mockClear();
  notifyTokenFailureMock.mockClear();
  notifyTokenFailureMock.mockResolvedValue(undefined);
});

describe('captureRouteError', () => {
  it('captures exception with tags { layer:"api-route", route:<name> } and provided extra', () => {
    const err = new Error('boom');
    captureRouteError('data', err, { range: { from: '2026-05-01', to: '2026-05-30' } });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [calledErr, ctx] = captureExceptionMock.mock.calls[0] as [unknown, { tags?: Record<string, string>; extra?: unknown }];
    expect(calledErr).toBe(err);
    expect(ctx.tags?.layer).toBe('api-route');
    expect(ctx.tags?.route).toBe('data');
    expect(ctx.extra).toEqual({ range: { from: '2026-05-01', to: '2026-05-30' } });
  });
});

describe('captureStepError', () => {
  it('captures with tags { layer:"inngest", fnId, stepName, storeId }', () => {
    const err = new Error('step failed');
    captureStepError({ fnId: 'cron-daily', stepName: 'fetch-meta-day', storeId: 'uzoshop' }, err, { dateStr: '2026-05-15' });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, ctx] = captureExceptionMock.mock.calls[0] as [unknown, { tags?: Record<string, string>; extra?: unknown }];
    expect(ctx.tags).toEqual({
      layer: 'inngest',
      fnId: 'cron-daily',
      stepName: 'fetch-meta-day',
      storeId: 'uzoshop',
    });
    expect(ctx.extra).toEqual({ dateStr: '2026-05-15' });
  });

  it('defaults storeId tag to "n/a" when not provided', () => {
    captureStepError({ fnId: 'cron-whatsapp', stepName: 'send-template' }, new Error('x'));
    const [, ctx] = captureExceptionMock.mock.calls[0] as [unknown, { tags?: Record<string, string> }];
    expect(ctx.tags?.storeId).toBe('n/a');
  });
});

describe('captureCronFetchError (P0-D dedup-throttled alert)', () => {
  it('captures + alerts on first call for a (platform, storeId) pair', async () => {
    const dedup = new Set<string>();
    await captureCronFetchError(
      { storeId: 'uzoshop', platform: 'meta', dedup },
      new Error('meta 503'),
      'try again later',
    );
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(1);
    const [arg] = notifyTokenFailureMock.mock.calls[0] as [{
      provider: string; storeId: string; operation: string; errorMsg: string; advice: string;
    }];
    expect(arg.provider).toBe('meta');
    expect(arg.storeId).toBe('uzoshop');
    expect(arg.operation).toBe('fetch_error');
    expect(arg.errorMsg).toBe('meta 503');
    expect(arg.advice).toBe('try again later');
    expect(dedup.has('meta:uzoshop')).toBe(true);
  });

  it('captures but does NOT re-alert on a second call with the same (platform, storeId)', async () => {
    const dedup = new Set<string>();
    await captureCronFetchError({ storeId: 'uzoshop', platform: 'meta', dedup }, new Error('first'));
    await captureCronFetchError({ storeId: 'uzoshop', platform: 'meta', dedup }, new Error('second'));
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(1);
  });

  it('alerts independently per (platform, storeId) — different storeIds same platform', async () => {
    const dedup = new Set<string>();
    await captureCronFetchError({ storeId: 'uzoshop', platform: 'meta', dedup }, new Error('a'));
    await captureCronFetchError({ storeId: 'zolplus', platform: 'meta', dedup }, new Error('b'));
    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(2);
  });

  it('uses a default advice string when none is provided', async () => {
    const dedup = new Set<string>();
    await captureCronFetchError({ storeId: 'uzoshop', platform: 'google', dedup }, new Error('x'));
    const [arg] = notifyTokenFailureMock.mock.calls[0] as [{ advice: string }];
    expect(arg.advice).toContain('google');
    expect(arg.advice).toMatch(/Sentry/i);
  });

  it('does not throw when notifyTokenFailure rejects (soft-fail by contract)', async () => {
    notifyTokenFailureMock.mockRejectedValueOnce(new Error('whatsapp down'));
    const dedup = new Set<string>();
    await expect(
      captureCronFetchError({ storeId: 'uzoshop', platform: 'meta', dedup }, new Error('x')),
    ).resolves.toBeUndefined();
  });
});
