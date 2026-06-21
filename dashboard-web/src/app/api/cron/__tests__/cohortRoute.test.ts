// Route test for /api/cron/cohort (Inngest → Vercel Cron migration, Stage 1
// Task 1.3). The route: verify cron secret → IL gate (Monday AND hour 04) →
// run runCohortRefresh inline. We mock verifyCronRequest, israelHour,
// israelWeekday, and runCohortRefresh so the test asserts ONLY routing/gating.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyCronRequestMock = vi.fn<(req: Request) => boolean>();
vi.mock('@/lib/jobs/verifyCron', () => ({
  verifyCronRequest: (req: Request) => verifyCronRequestMock(req),
}));

const israelHourMock = vi.fn<() => number>();
const israelWeekdayMock = vi.fn<() => number>();
vi.mock('@/lib/dateRange', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dateRange')>();
  return {
    ...actual,
    israelHour: () => israelHourMock(),
    israelWeekday: () => israelWeekdayMock(),
  };
});

const runCohortRefreshMock = vi.fn();
vi.mock('@/inngest/functions/cronCohortRefresh', () => ({
  runCohortRefresh: (...args: unknown[]) => runCohortRefreshMock(...args),
}));

import { GET, POST } from '../cohort/route';

function req(): Request {
  return new Request('https://x/api/cron/cohort', { method: 'POST' });
}

beforeEach(() => {
  verifyCronRequestMock.mockReset();
  israelHourMock.mockReset();
  israelWeekdayMock.mockReset();
  runCohortRefreshMock.mockReset();
  runCohortRefreshMock.mockResolvedValue({ refreshed: 2, failures: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET/POST /api/cron/cohort', () => {
  it('returns 401 and does NOT run when the cron secret is invalid', async () => {
    verifyCronRequestMock.mockReturnValue(false);
    israelWeekdayMock.mockReturnValue(1); // Monday
    israelHourMock.mockReturnValue(4);

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(runCohortRefreshMock).not.toHaveBeenCalled();
  });

  it('runs once when secret valid AND it is Monday 04:00 IL', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelWeekdayMock.mockReturnValue(1); // Monday
    israelHourMock.mockReturnValue(4);

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(runCohortRefreshMock).toHaveBeenCalledTimes(1);
  });

  it('skips (200, no run) on the right hour but wrong day', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelWeekdayMock.mockReturnValue(2); // Tuesday
    israelHourMock.mockReturnValue(4);

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('off-window');
    expect(runCohortRefreshMock).not.toHaveBeenCalled();
  });

  it('skips (200, no run) on the right day but off-DST hour', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelWeekdayMock.mockReturnValue(1); // Monday
    israelHourMock.mockReturnValue(5); // the dual-fire that landed on hour 5

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(runCohortRefreshMock).not.toHaveBeenCalled();
  });

  it('also supports GET (Vercel Cron default verb)', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelWeekdayMock.mockReturnValue(1);
    israelHourMock.mockReturnValue(4);

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(runCohortRefreshMock).toHaveBeenCalledTimes(1);
  });
});
