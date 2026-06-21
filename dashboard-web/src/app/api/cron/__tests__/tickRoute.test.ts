// Route test for /api/cron/tick (Inngest → Vercel Cron + QStash migration,
// Stage 2 Task 2.4). The tick scheduler route: verify cron secret → call the
// EXISTING orchestrator planner (runTickOnce) with the real deps but a
// QStash-publishing sendEvent that routes each planned event to the right
// platform worker path. NO IL-time gate — the */10 cadence is DST-agnostic.
//
// We mock verifyCronRequest, publishJob, and runTickOnce. runTickOnce is the
// pure planner (its own unit tests cover the planning logic); here we make it
// invoke the injected sendEvent with a known event list and assert each event
// is published to the correct /api/worker/<platform> path with its data verbatim.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  META_JOB_REQUESTED,
  GOOGLE_JOB_REQUESTED,
  TIKTOK_JOB_REQUESTED,
} from '@/lib/registries/eventNames';

const verifyCronRequestMock = vi.fn<(req: Request) => boolean>();
vi.mock('@/lib/jobs/verifyCron', () => ({
  verifyCronRequest: (req: Request) => verifyCronRequestMock(req),
}));

const publishJobMock = vi.fn<(path: string, body: unknown) => Promise<void>>();
vi.mock('@/lib/jobs/qstash', () => ({
  publishJob: (path: string, body: unknown) => publishJobMock(path, body),
}));

type SendEventFn = (
  events: Array<{ name: string; id: string; data: unknown }>,
) => Promise<{ ids: string[] }>;
const runTickOnceMock =
  vi.fn<(input: { sendEvent: SendEventFn }) => Promise<{ tickId: string; fanOutCount: number }>>();
vi.mock('@/inngest/functions/cronTickOrchestrator', () => ({
  runTickOnce: (input: { sendEvent: SendEventFn }) => runTickOnceMock(input),
  // The route imports this to inject as runTickOnce's `loadMetaBuc` dep. Since
  // runTickOnce is mocked it's never invoked — a no-op stub keeps the import
  // resolvable.
  loadMetaBucStateByStore: vi.fn(async () => ({})),
}));

import { GET, POST } from '../tick/route';

const PLANNED = [
  { name: META_JOB_REQUESTED, id: 'meta:uzoshop:status:t1', data: { store_id: 'uzoshop', scope: 'status' } },
  { name: GOOGLE_JOB_REQUESTED, id: 'google:uzoshop:hot_metrics:t1', data: { store_id: 'uzoshop', scope: 'hot_metrics' } },
  { name: TIKTOK_JOB_REQUESTED, id: 'tiktok:zolplus:status:t1', data: { store_id: 'zolplus', scope: 'status' } },
];

function req(): Request {
  return new Request('https://x/api/cron/tick', { method: 'POST' });
}

beforeEach(() => {
  verifyCronRequestMock.mockReset();
  publishJobMock.mockReset();
  runTickOnceMock.mockReset();
  publishJobMock.mockResolvedValue(undefined);
  // Default: the planner forwards a known event list through the injected
  // sendEvent (exactly what the real runTickOnce does for non-empty plans).
  runTickOnceMock.mockImplementation(async ({ sendEvent }) => {
    await sendEvent(PLANNED);
    return { tickId: 't1', fanOutCount: PLANNED.length };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET/POST /api/cron/tick', () => {
  it('returns 401 and publishes nothing when the cron secret is invalid', async () => {
    verifyCronRequestMock.mockReturnValue(false);

    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(runTickOnceMock).not.toHaveBeenCalled();
    expect(publishJobMock).not.toHaveBeenCalled();
  });

  it('runs the planner and publishes each planned event to its platform worker path', async () => {
    verifyCronRequestMock.mockReturnValue(true);

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(runTickOnceMock).toHaveBeenCalledTimes(1);
    expect(publishJobMock).toHaveBeenCalledTimes(3);
    expect(publishJobMock).toHaveBeenCalledWith('/api/worker/meta', PLANNED[0].data);
    expect(publishJobMock).toHaveBeenCalledWith('/api/worker/google', PLANNED[1].data);
    expect(publishJobMock).toHaveBeenCalledWith('/api/worker/tiktok', PLANNED[2].data);
  });

  it('GET works the same as POST (Vercel Cron sends GET)', async () => {
    verifyCronRequestMock.mockReturnValue(true);

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(publishJobMock).toHaveBeenCalledTimes(3);
  });

  it('publishes nothing when the planner emits no events', async () => {
    verifyCronRequestMock.mockReturnValue(true);
    runTickOnceMock.mockImplementation(async () => ({ tickId: 't1', fanOutCount: 0 }));

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(publishJobMock).not.toHaveBeenCalled();
  });
});
