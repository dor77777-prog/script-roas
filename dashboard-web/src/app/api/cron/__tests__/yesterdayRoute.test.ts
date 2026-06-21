// Route test for /api/cron/yesterday (Inngest → Vercel Cron + QStash migration,
// Stage 2 Task 2.3). The scheduler route: verify cron secret → for each active
// store, publishJob('/api/worker/yesterday-store', { storeId }). NO IL-time gate
// — the every-2h cadence is DST-agnostic.
//
// We mock verifyCronRequest, publishJob, and loadActiveStoreIds so the test
// asserts ONLY the auth + fan-out logic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyCronRequestMock = vi.fn<(req: Request) => boolean>();
vi.mock('@/lib/jobs/verifyCron', () => ({
  verifyCronRequest: (req: Request) => verifyCronRequestMock(req),
}));

const publishJobMock = vi.fn<(path: string, body: unknown) => Promise<void>>();
vi.mock('@/lib/jobs/qstash', () => ({
  publishJob: (path: string, body: unknown) => publishJobMock(path, body),
}));

const loadActiveStoreIdsMock = vi.fn<() => Promise<string[]>>();
vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: () => loadActiveStoreIdsMock(),
}));

import { GET, POST } from '../yesterday/route';

function req(): Request {
  return new Request('https://x/api/cron/yesterday', { method: 'POST' });
}

beforeEach(() => {
  verifyCronRequestMock.mockReset();
  publishJobMock.mockReset();
  loadActiveStoreIdsMock.mockReset();
  publishJobMock.mockResolvedValue(undefined);
  loadActiveStoreIdsMock.mockResolvedValue(['uzoshop', 'zolplus', 'usmile360']);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET/POST /api/cron/yesterday', () => {
  it('returns 401 and publishes nothing when the cron secret is invalid', async () => {
    verifyCronRequestMock.mockReturnValue(false);

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(publishJobMock).not.toHaveBeenCalled();
  });

  it('publishes one yesterday-store job per active store when the secret is valid', async () => {
    verifyCronRequestMock.mockReturnValue(true);

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.published).toBe(3);
    expect(publishJobMock).toHaveBeenCalledTimes(3);
    for (const storeId of ['uzoshop', 'zolplus', 'usmile360']) {
      expect(publishJobMock).toHaveBeenCalledWith('/api/worker/yesterday-store', { storeId });
    }
  });

  it('GET works the same as POST (Vercel Cron sends GET)', async () => {
    verifyCronRequestMock.mockReturnValue(true);

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(publishJobMock).toHaveBeenCalledTimes(3);
  });
});
