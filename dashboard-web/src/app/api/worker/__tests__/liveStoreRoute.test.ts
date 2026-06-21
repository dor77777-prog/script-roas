// Route test for /api/worker/live-store (Inngest → Vercel Cron + QStash
// migration, Stage 2 Task 2.1). The worker route: verify the QStash signature
// → parse { storeId } → acquireJobLock('live:'+storeId) (skip if not acquired)
// → runLiveForStore(storeId, inline-step ctx) → releaseJobLock in finally.
//
// We mock verifyQstashRequest, the job lock, and runLiveForStore so the test
// asserts ONLY the auth/parse/lock/handler wiring.

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

const runLiveForStoreMock = vi.fn();
vi.mock('@/inngest/functions/cronLive', () => ({
  runLiveForStore: (...args: unknown[]) => runLiveForStoreMock(...args),
}));

import { POST } from '../live-store/route';

function req(): Request {
  return new Request('https://x/api/worker/live-store', {
    method: 'POST',
    body: '{}',
  });
}

beforeEach(() => {
  verifyQstashRequestMock.mockReset();
  acquireJobLockMock.mockReset();
  releaseJobLockMock.mockReset();
  runLiveForStoreMock.mockReset();
  acquireJobLockMock.mockResolvedValue(true);
  releaseJobLockMock.mockResolvedValue(undefined);
  runLiveForStoreMock.mockResolvedValue({ storeId: 'uzoshop' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/worker/live-store', () => {
  it('returns 401 and does NOT run when the QStash signature is invalid', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: false });

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(acquireJobLockMock).not.toHaveBeenCalled();
    expect(runLiveForStoreMock).not.toHaveBeenCalled();
  });

  it('parses storeId, acquires the lock, runs the handler once, releases', async () => {
    verifyQstashRequestMock.mockResolvedValue({
      ok: true,
      raw: JSON.stringify({ storeId: 'uzoshop' }),
    });

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(acquireJobLockMock).toHaveBeenCalledWith('live:uzoshop');
    expect(runLiveForStoreMock).toHaveBeenCalledTimes(1);
    expect(runLiveForStoreMock.mock.calls[0][0]).toBe('uzoshop');
    expect(releaseJobLockMock).toHaveBeenCalledWith('live:uzoshop');
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
    expect(runLiveForStoreMock).not.toHaveBeenCalled();
    expect(releaseJobLockMock).not.toHaveBeenCalled();
  });

  it('releases the lock even if the handler throws', async () => {
    verifyQstashRequestMock.mockResolvedValue({
      ok: true,
      raw: JSON.stringify({ storeId: 'uzoshop' }),
    });
    runLiveForStoreMock.mockRejectedValue(new Error('boom'));

    await expect(POST(req())).rejects.toThrow('boom');
    expect(releaseJobLockMock).toHaveBeenCalledWith('live:uzoshop');
  });

  it('returns 400 when storeId is missing from the body', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: '{}' });

    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(acquireJobLockMock).not.toHaveBeenCalled();
    expect(runLiveForStoreMock).not.toHaveBeenCalled();
  });
});
