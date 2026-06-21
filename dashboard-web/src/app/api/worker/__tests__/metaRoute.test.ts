// Route test for /api/worker/meta (Inngest → Vercel Cron + QStash migration,
// Stage 2 Task 2.4). The platform worker route: verify the QStash signature →
// parse { store_id, scope } → acquireJobLock('meta:'+store_id+':'+scope) (skip
// if not acquired) → runMetaWorkerForJob(data) → releaseJobLock in finally.
//
// We mock verifyQstashRequest, the job lock, and runMetaWorkerForJob so the
// test asserts ONLY the auth/parse/lock/handler wiring (the wired runner's
// business logic is covered by runMetaWorkerJob's own unit tests).

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

const runMetaWorkerForJobMock = vi.fn();
vi.mock('@/inngest/functions/metaWorker', () => ({
  runMetaWorkerForJob: (...args: unknown[]) => runMetaWorkerForJobMock(...args),
}));

import { POST } from '../meta/route';

const JOB = { store_id: 'uzoshop', scope: 'status', tick_id: 't1' };

function req(): Request {
  return new Request('https://x/api/worker/meta', { method: 'POST', body: '{}' });
}

beforeEach(() => {
  verifyQstashRequestMock.mockReset();
  acquireJobLockMock.mockReset();
  releaseJobLockMock.mockReset();
  runMetaWorkerForJobMock.mockReset();
  acquireJobLockMock.mockResolvedValue(true);
  releaseJobLockMock.mockResolvedValue(undefined);
  runMetaWorkerForJobMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/worker/meta', () => {
  it('returns 401 and does NOT run when the QStash signature is invalid', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: false });

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(acquireJobLockMock).not.toHaveBeenCalled();
    expect(runMetaWorkerForJobMock).not.toHaveBeenCalled();
  });

  it('parses the job, acquires the lock, runs the handler once, releases', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: JSON.stringify(JOB) });

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(acquireJobLockMock).toHaveBeenCalledWith('meta:uzoshop:status');
    expect(runMetaWorkerForJobMock).toHaveBeenCalledTimes(1);
    expect(runMetaWorkerForJobMock.mock.calls[0][0]).toEqual(JOB);
    expect(releaseJobLockMock).toHaveBeenCalledWith('meta:uzoshop:status');
  });

  it('returns 200 skipped:locked and does NOT run when the lock is held', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: JSON.stringify(JOB) });
    acquireJobLockMock.mockResolvedValue(false);

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('locked');
    expect(runMetaWorkerForJobMock).not.toHaveBeenCalled();
    expect(releaseJobLockMock).not.toHaveBeenCalled();
  });

  it('releases the lock even if the handler throws', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: JSON.stringify(JOB) });
    runMetaWorkerForJobMock.mockRejectedValue(new Error('boom'));

    await expect(POST(req())).rejects.toThrow('boom');
    expect(releaseJobLockMock).toHaveBeenCalledWith('meta:uzoshop:status');
  });

  it('returns 400 when store_id is missing from the body', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: JSON.stringify({ scope: 'status' }) });

    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(acquireJobLockMock).not.toHaveBeenCalled();
    expect(runMetaWorkerForJobMock).not.toHaveBeenCalled();
  });
});
