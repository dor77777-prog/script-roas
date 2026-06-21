// Route test for /api/worker/yesterday-store (Inngest → Vercel Cron + QStash
// migration, Stage 2 Task 2.3). The worker route: verify the QStash signature
// → parse { storeId } → acquireJobLock('yesterday:'+storeId) (skip if not
// acquired) → runDailyForStore(storeId, yesterdayJerusalem(), inline-step ctx)
// → releaseJobLock in finally. (Same handler as daily, bound to yesterday.)
//
// We mock verifyQstashRequest, the job lock, and the cronDaily handler/date
// helper so the test asserts ONLY the auth/parse/lock/handler wiring.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyQstashRequestMock =
  vi.fn<(req: Request) => Promise<{ ok: true; raw: string } | { ok: false }>>();
vi.mock('@/lib/jobs/verifyQstash', () => ({
  verifyQstashRequest: (req: Request) => verifyQstashRequestMock(req),
}));

const acquireJobLockMock = vi.fn<(key: string, ttl?: number) => Promise<boolean>>();
const releaseJobLockMock = vi.fn<(key: string) => Promise<void>>();
vi.mock('@/lib/jobs/lock', () => ({
  acquireJobLock: (...args: [string, number?]) => acquireJobLockMock(...args),
  releaseJobLock: (key: string) => releaseJobLockMock(key),
}));

const runDailyForStoreMock = vi.fn();
const yesterdayJerusalemMock = vi.fn<() => string>();
vi.mock('@/inngest/functions/cronDaily', () => ({
  runDailyForStore: (...args: unknown[]) => runDailyForStoreMock(...args),
  yesterdayJerusalem: () => yesterdayJerusalemMock(),
}));

import { POST } from '../yesterday-store/route';

function req(): Request {
  return new Request('https://x/api/worker/yesterday-store', {
    method: 'POST',
    body: '{}',
  });
}

beforeEach(() => {
  verifyQstashRequestMock.mockReset();
  acquireJobLockMock.mockReset();
  releaseJobLockMock.mockReset();
  runDailyForStoreMock.mockReset();
  yesterdayJerusalemMock.mockReset();
  acquireJobLockMock.mockResolvedValue(true);
  releaseJobLockMock.mockResolvedValue(undefined);
  runDailyForStoreMock.mockResolvedValue({ storeId: 'uzoshop' });
  yesterdayJerusalemMock.mockReturnValue('2026-06-20');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/worker/yesterday-store', () => {
  it('returns 401 and does NOT run when the QStash signature is invalid', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: false });

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(acquireJobLockMock).not.toHaveBeenCalled();
    expect(runDailyForStoreMock).not.toHaveBeenCalled();
  });

  it('parses storeId, locks, runs the handler once for yesterday IL, releases', async () => {
    verifyQstashRequestMock.mockResolvedValue({
      ok: true,
      raw: JSON.stringify({ storeId: 'uzoshop' }),
    });

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(acquireJobLockMock).toHaveBeenCalledWith('yesterday:uzoshop');
    expect(runDailyForStoreMock).toHaveBeenCalledTimes(1);
    expect(runDailyForStoreMock.mock.calls[0][0]).toBe('uzoshop');
    expect(runDailyForStoreMock.mock.calls[0][1]).toBe('2026-06-20');
    expect(releaseJobLockMock).toHaveBeenCalledWith('yesterday:uzoshop');
  });

  it('returns 200 skipped:locked and does NOT run when the lock is held', async () => {
    verifyQstashRequestMock.mockResolvedValue({
      ok: true,
      raw: JSON.stringify({ storeId: 'uzoshop' }),
    });
    acquireJobLockMock.mockResolvedValue(false);

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('locked');
    expect(runDailyForStoreMock).not.toHaveBeenCalled();
    expect(releaseJobLockMock).not.toHaveBeenCalled();
  });

  it('releases the lock even if the handler throws', async () => {
    verifyQstashRequestMock.mockResolvedValue({
      ok: true,
      raw: JSON.stringify({ storeId: 'uzoshop' }),
    });
    runDailyForStoreMock.mockRejectedValue(new Error('boom'));

    await expect(POST(req())).rejects.toThrow('boom');
    expect(releaseJobLockMock).toHaveBeenCalledWith('yesterday:uzoshop');
  });

  it('returns 400 when storeId is missing from the body', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: '{}' });

    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(acquireJobLockMock).not.toHaveBeenCalled();
    expect(runDailyForStoreMock).not.toHaveBeenCalled();
  });
});
