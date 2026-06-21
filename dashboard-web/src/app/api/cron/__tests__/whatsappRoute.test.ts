// Route test for /api/cron/whatsapp (Inngest → Vercel Cron migration, Stage 1
// Task 1.1). The route: read ?slot= → verify cron secret → gate on the slot's
// IL hour (noon→12, evening→18, eod→0) → acquireJobLock (skip if not acquired,
// so a DST-seam double-fire can NEVER double-send) → runWhatsappSlot.
//
// We mock verifyCronRequest, israelHour, the job lock, getTodayInIsraelTz, and
// runWhatsappSlot so the test asserts ONLY routing/gating/locking.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyCronRequestMock = vi.fn<(req: Request) => boolean>();
vi.mock('@/lib/jobs/verifyCron', () => ({
  verifyCronRequest: (req: Request) => verifyCronRequestMock(req),
}));

const israelHourMock = vi.fn<() => number>();
vi.mock('@/lib/dateRange', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dateRange')>();
  return {
    ...actual,
    israelHour: () => israelHourMock(),
    getTodayInIsraelTz: () => '2026-06-21',
  };
});

const acquireJobLockMock = vi.fn<(key: string, ttl?: number) => Promise<boolean>>();
const releaseJobLockMock = vi.fn<(key: string) => Promise<void>>();
vi.mock('@/lib/jobs/lock', () => ({
  acquireJobLock: (key: string, ttl?: number) => acquireJobLockMock(key, ttl),
  releaseJobLock: (key: string) => releaseJobLockMock(key),
}));

const runWhatsappSlotMock = vi.fn();
vi.mock('@/inngest/functions/cronWhatsapp', () => ({
  runWhatsappSlot: (...args: unknown[]) => runWhatsappSlotMock(...args),
}));

import { GET, POST } from '../whatsapp/route';

function req(slot?: string): Request {
  const url = slot
    ? `https://x/api/cron/whatsapp?slot=${slot}`
    : 'https://x/api/cron/whatsapp';
  return new Request(url, { method: 'POST' });
}

beforeEach(() => {
  verifyCronRequestMock.mockReset();
  israelHourMock.mockReset();
  acquireJobLockMock.mockReset();
  releaseJobLockMock.mockReset();
  runWhatsappSlotMock.mockReset();
  acquireJobLockMock.mockResolvedValue(true);
  releaseJobLockMock.mockResolvedValue(undefined);
  runWhatsappSlotMock.mockResolvedValue({ skipped: false, recipientsSucceeded: ['x'] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET/POST /api/cron/whatsapp', () => {
  it('returns 401 and does NOT send when the cron secret is invalid', async () => {
    verifyCronRequestMock.mockReturnValue(false);
    israelHourMock.mockReturnValue(12);

    const res = await POST(req('noon'));
    expect(res.status).toBe(401);
    expect(runWhatsappSlotMock).not.toHaveBeenCalled();
    expect(acquireJobLockMock).not.toHaveBeenCalled();
  });

  it('returns 400 on an unknown slot', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(12);

    const res = await POST(req('lunch'));
    expect(res.status).toBe(400);
    expect(runWhatsappSlotMock).not.toHaveBeenCalled();
  });

  it.each([
    ['noon', 12],
    ['evening', 18],
    ['eod', 0],
  ] as const)(
    'slot=%s sends once when secret valid + IL hour %i + lock acquired',
    async (slot, hour) => {
      verifyCronRequestMock.mockReturnValue(true);
      israelHourMock.mockReturnValue(hour);

      const res = await POST(req(slot));
      expect(res.status).toBe(200);
      expect(acquireJobLockMock).toHaveBeenCalledWith(
        `whatsapp:${slot}:2026-06-21`,
        expect.any(Number),
      );
      expect(runWhatsappSlotMock).toHaveBeenCalledTimes(1);
      expect(runWhatsappSlotMock).toHaveBeenCalledWith(slot);
    },
  );

  it('does NOT send when the lock is already held (double-fire guard)', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(12);
    acquireJobLockMock.mockResolvedValue(false);

    const res = await POST(req('noon'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('locked');
    expect(runWhatsappSlotMock).not.toHaveBeenCalled();
  });

  it('skips (200, no lock, no send) on the off-DST hour for the slot', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(13); // noon dual-fire that landed on IL 13

    const res = await POST(req('noon'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('off-hour');
    expect(acquireJobLockMock).not.toHaveBeenCalled();
    expect(runWhatsappSlotMock).not.toHaveBeenCalled();
  });

  it('also supports GET (Vercel Cron default verb)', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(18);

    const res = await GET(req('evening'));
    expect(res.status).toBe(200);
    expect(runWhatsappSlotMock).toHaveBeenCalledWith('evening');
  });
});
