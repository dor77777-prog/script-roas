// Route test for /api/worker/tiktok (Inngest → Vercel Cron + QStash migration,
// Stage 2 Task 2.4). Mirrors metaRoute.test.ts — verify QStash signature →
// parse { store_id, scope } → acquireJobLock('tiktok:'+store_id+':'+scope) →
// runTikTokWorkerForJob(data) → releaseJobLock in finally.

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

const runTikTokWorkerForJobMock = vi.fn();
vi.mock('@/inngest/functions/tiktokWorker', () => ({
  runTikTokWorkerForJob: (...args: unknown[]) => runTikTokWorkerForJobMock(...args),
}));

import { POST } from '../tiktok/route';

const JOB = { store_id: 'uzoshop', scope: 'status', tick_id: 't1' };

function req(): Request {
  return new Request('https://x/api/worker/tiktok', { method: 'POST', body: '{}' });
}

beforeEach(() => {
  verifyQstashRequestMock.mockReset();
  acquireJobLockMock.mockReset();
  releaseJobLockMock.mockReset();
  runTikTokWorkerForJobMock.mockReset();
  acquireJobLockMock.mockResolvedValue(true);
  releaseJobLockMock.mockResolvedValue(undefined);
  runTikTokWorkerForJobMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/worker/tiktok', () => {
  it('returns 401 and does NOT run when the QStash signature is invalid', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: false });

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(acquireJobLockMock).not.toHaveBeenCalled();
    expect(runTikTokWorkerForJobMock).not.toHaveBeenCalled();
  });

  it('parses the job, acquires the lock, runs the handler once, releases', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: JSON.stringify(JOB) });

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(acquireJobLockMock).toHaveBeenCalledWith('tiktok:uzoshop:status');
    expect(runTikTokWorkerForJobMock).toHaveBeenCalledTimes(1);
    expect(runTikTokWorkerForJobMock.mock.calls[0][0]).toEqual(JOB);
    expect(releaseJobLockMock).toHaveBeenCalledWith('tiktok:uzoshop:status');
  });

  it('returns 200 skipped:locked and does NOT run when the lock is held', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: JSON.stringify(JOB) });
    acquireJobLockMock.mockResolvedValue(false);

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('locked');
    expect(runTikTokWorkerForJobMock).not.toHaveBeenCalled();
    expect(releaseJobLockMock).not.toHaveBeenCalled();
  });

  it('releases the lock even if the handler throws', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: JSON.stringify(JOB) });
    runTikTokWorkerForJobMock.mockRejectedValue(new Error('boom'));

    await expect(POST(req())).rejects.toThrow('boom');
    expect(releaseJobLockMock).toHaveBeenCalledWith('tiktok:uzoshop:status');
  });

  it('returns 400 when store_id is missing from the body', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: JSON.stringify({ scope: 'status' }) });

    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(acquireJobLockMock).not.toHaveBeenCalled();
    expect(runTikTokWorkerForJobMock).not.toHaveBeenCalled();
  });
});
