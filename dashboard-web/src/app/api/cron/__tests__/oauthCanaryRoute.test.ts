// Route test for /api/cron/oauth-canary (Inngest → Vercel Cron migration,
// Stage 1 Task 1.2). The route: verify cron secret → IL-hour gate (00) → run
// runOauthCanary inline. We mock verifyCronRequest, israelHour, and
// runOauthCanary so the test asserts ONLY the routing/gating logic.

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

const runOauthCanaryMock = vi.fn();
vi.mock('@/inngest/functions/cronOauthCanary', () => ({
  runOauthCanary: (...args: unknown[]) => runOauthCanaryMock(...args),
}));

import { GET, POST } from '../oauth-canary/route';

function req(): Request {
  return new Request('https://x/api/cron/oauth-canary', { method: 'POST' });
}

beforeEach(() => {
  verifyCronRequestMock.mockReset();
  israelHourMock.mockReset();
  runOauthCanaryMock.mockReset();
  runOauthCanaryMock.mockResolvedValue({ status: 'ok', checks: 5, passed: 5, failed: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET/POST /api/cron/oauth-canary', () => {
  it('returns 401 and does NOT run when the cron secret is missing/invalid', async () => {
    verifyCronRequestMock.mockReturnValue(false);
    israelHourMock.mockReturnValue(0);

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(runOauthCanaryMock).not.toHaveBeenCalled();
  });

  it('runs the canary exactly once when secret is valid AND IL hour is 0', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(0);

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(runOauthCanaryMock).toHaveBeenCalledTimes(1);
  });

  it('skips (200, no run) when secret valid but IL hour is the off-DST fire', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(23); // dual-fire that maps to the wrong IL hour

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('off-hour');
    expect(runOauthCanaryMock).not.toHaveBeenCalled();
  });

  it('also supports GET (Vercel Cron default verb)', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(0);

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(runOauthCanaryMock).toHaveBeenCalledTimes(1);
  });
});
