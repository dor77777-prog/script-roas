// Route test for /api/worker/backfill (Inngest → Vercel Cron + QStash migration,
// Stage 3 Task 3.2). The worker route: verify the QStash signature → parse
// { from, to, storeIds } from the raw body → run the EXISTING eventBackfill
// handler logic (runEventBackfill) with an inline step ctx.
//
// We mock verifyQstashRequest + runEventBackfill so the test asserts ONLY the
// auth/parse/handler wiring (the handler's own date-range/validation logic is
// covered by the eventBackfill function tests).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyQstashRequestMock =
  vi.fn<(req: Request) => Promise<{ ok: true; raw: string } | { ok: false }>>();
vi.mock('@/lib/jobs/verifyQstash', () => ({
  verifyQstashRequest: (req: Request) => verifyQstashRequestMock(req),
}));

const runEventBackfillMock = vi.fn();
vi.mock('@/inngest/functions/eventBackfill', () => ({
  runEventBackfill: (...args: unknown[]) => runEventBackfillMock(...args),
}));

import { POST } from '../backfill/route';

function req(): Request {
  return new Request('https://x/api/worker/backfill', {
    method: 'POST',
    body: '{}',
  });
}

beforeEach(() => {
  verifyQstashRequestMock.mockReset();
  runEventBackfillMock.mockReset();
  runEventBackfillMock.mockResolvedValue({ totalPairs: 1, successCount: 1, failureCount: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/worker/backfill', () => {
  it('returns 401 and does NOT run when the QStash signature is invalid', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: false });

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(runEventBackfillMock).not.toHaveBeenCalled();
  });

  it('runs the backfill handler with the parsed payload + inline step', async () => {
    verifyQstashRequestMock.mockResolvedValue({
      ok: true,
      raw: JSON.stringify({
        from: '2026-05-10',
        to: '2026-05-12',
        storeIds: ['uzoshop', 'zolplus'],
      }),
    });

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(runEventBackfillMock).toHaveBeenCalledTimes(1);
    const arg = runEventBackfillMock.mock.calls[0][0] as {
      from: string;
      to: string;
      storeIds: string[];
      step: unknown;
    };
    expect(arg.from).toBe('2026-05-10');
    expect(arg.to).toBe('2026-05-12');
    expect(arg.storeIds).toEqual(['uzoshop', 'zolplus']);
    expect(arg.step).toBeDefined();
  });

  it('returns 400 when the body is not valid JSON', async () => {
    verifyQstashRequestMock.mockResolvedValue({ ok: true, raw: 'not-json' });

    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(runEventBackfillMock).not.toHaveBeenCalled();
  });
});
