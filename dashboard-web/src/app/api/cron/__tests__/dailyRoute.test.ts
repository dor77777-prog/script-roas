// Route test for /api/cron/daily (Inngest → Vercel Cron + QStash migration,
// Stage 2 Task 2.2). The scheduler route: verify cron secret → gate on Israel
// local hour 0 (00:05 IL; dual-fired in vercel.json at 21:05 + 22:05 UTC) → for
// each active store, publishJob('/api/worker/daily-store', { storeId }).
//
// We mock verifyCronRequest, israelHour, publishJob, and loadActiveStoreIds so
// the test asserts ONLY the auth + IL-gate + fan-out logic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyCronRequestMock = vi.fn<(req: Request) => boolean>();
vi.mock('@/lib/jobs/verifyCron', () => ({
  verifyCronRequest: (req: Request) => verifyCronRequestMock(req),
}));

const israelHourMock = vi.fn<() => number>();
vi.mock('@/lib/dateRange', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dateRange')>();
  return { ...actual, israelHour: () => israelHourMock() };
});

const publishJobMock = vi.fn<(path: string, body: unknown) => Promise<void>>();
vi.mock('@/lib/jobs/qstash', () => ({
  publishJob: (path: string, body: unknown) => publishJobMock(path, body),
}));

const loadActiveStoreIdsMock = vi.fn<() => Promise<string[]>>();
vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: () => loadActiveStoreIdsMock(),
}));

import { GET, POST } from '../daily/route';

function req(): Request {
  return new Request('https://x/api/cron/daily', { method: 'POST' });
}

beforeEach(() => {
  verifyCronRequestMock.mockReset();
  israelHourMock.mockReset();
  publishJobMock.mockReset();
  loadActiveStoreIdsMock.mockReset();
  publishJobMock.mockResolvedValue(undefined);
  loadActiveStoreIdsMock.mockResolvedValue(['uzoshop', 'zolplus', 'usmile360']);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET/POST /api/cron/daily', () => {
  it('returns 401 and publishes nothing when the cron secret is invalid', async () => {
    verifyCronRequestMock.mockReturnValue(false);
    israelHourMock.mockReturnValue(0);

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(publishJobMock).not.toHaveBeenCalled();
  });

  it('publishes one daily-store job per active store at IL hour 0', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(0);

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.published).toBe(3);
    expect(publishJobMock).toHaveBeenCalledTimes(3);
    for (const storeId of ['uzoshop', 'zolplus', 'usmile360']) {
      expect(publishJobMock).toHaveBeenCalledWith('/api/worker/daily-store', { storeId });
    }
  });

  it('publishes NOTHING on the off-DST fire (IL hour not 0)', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(23); // the dual-fire that landed on IL 23

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('off-hour');
    expect(publishJobMock).not.toHaveBeenCalled();
  });

  it('GET works the same as POST (Vercel Cron sends GET)', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(0);

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(publishJobMock).toHaveBeenCalledTimes(3);
  });
});
