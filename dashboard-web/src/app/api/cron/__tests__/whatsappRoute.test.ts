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

const recordHeartbeatMock =
  vi.fn<(...args: [string, string, string?]) => Promise<void>>();
vi.mock('@/lib/jobs/heartbeat', () => ({
  recordHeartbeat: (...args: [string, string, string?]) => recordHeartbeatMock(...args),
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
  recordHeartbeatMock.mockReset();
  acquireJobLockMock.mockResolvedValue(true);
  releaseJobLockMock.mockResolvedValue(undefined);
  runWhatsappSlotMock.mockResolvedValue({ skipped: false, recipientsSucceeded: ['x'] });
  recordHeartbeatMock.mockResolvedValue(undefined);
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

  // --- HEARTBEAT (observability) -------------------------------------------

  it('writes a SUCCESS heartbeat after a slot sends', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(12);

    await POST(req('noon'));
    expect(recordHeartbeatMock).toHaveBeenCalledWith('whatsapp', 'success');
  });

  it('does NOT heartbeat on the off-hour skip (no send happened)', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(13);

    await POST(req('noon'));
    expect(recordHeartbeatMock).not.toHaveBeenCalled();
  });

  it('does NOT heartbeat when the lock is already held (no send happened)', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(12);
    acquireJobLockMock.mockResolvedValue(false);

    await POST(req('noon'));
    expect(recordHeartbeatMock).not.toHaveBeenCalled();
  });

  it('does NOT heartbeat when unauthorized or on an unknown slot', async () => {
    verifyCronRequestMock.mockReturnValue(false);
    israelHourMock.mockReturnValue(12);
    await POST(req('noon'));
    expect(recordHeartbeatMock).not.toHaveBeenCalled();

    verifyCronRequestMock.mockReturnValue(true);
    await POST(req('lunch'));
    expect(recordHeartbeatMock).not.toHaveBeenCalled();
  });

  it('writes a transient_error heartbeat when the send throws', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(12);
    runWhatsappSlotMock.mockRejectedValue(new Error('whatsapp api 500'));

    const res = await POST(req('noon'));
    expect(res.status).toBe(500);
    expect(recordHeartbeatMock).toHaveBeenCalledWith(
      'whatsapp',
      'transient_error',
      expect.stringContaining('whatsapp api 500'),
    );
  });

  it('a heartbeat write failure never breaks the cron (non-fatal)', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    israelHourMock.mockReturnValue(12);
    recordHeartbeatMock.mockRejectedValue(new Error('heartbeat boom'));

    const res = await POST(req('noon'));
    expect(res.status).toBe(200);
  });
});
