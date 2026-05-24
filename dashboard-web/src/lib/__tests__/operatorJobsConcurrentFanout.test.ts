import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * AUDIT regression (Phase 12.3 / 2026-05-24) — API-23:
 * /api/operator/jobs sequential Inngest REST fan-out.
 *
 *   Original bug (API-23):
 *     route.ts:149-169 used `for (const ev of events) await fetch(...)` —
 *     sequential. For a 50-event window with ~200ms latency per Inngest
 *     /v1/events/{id}/runs call, the operator's "live jobs" view took
 *     ~10s p50 to render. With a 15s SWR poll, the cache often missed
 *     the rebuild and the panel felt laggy.
 *
 *   12.3 fix:
 *     Replace the for-loop with `Promise.allSettled(events.map(...))` so
 *     the 50 calls fire concurrently. Wall-clock drops from sum(latency)
 *     to max(latency). Per-event 401/non-ok isolation preserved.
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/
 *     api_operator_jobs.json (API-23 lines 7-16)
 */

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_KEY = process.env.INNGEST_SIGNING_KEY;
const PER_EVENT_LATENCY_MS = 100;
const EVENT_COUNT = 10;

function makeDelayedFetch(failingEventId?: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const urlStr = typeof input === 'string' ? input : input.toString();

    if (urlStr.includes('/v1/events?')) {
      // /v1/events list — instant return.
      const events = Array.from({ length: EVENT_COUNT }, (_, i) => ({
        internal_id: `ev${String(i + 1).padStart(2, '0')}`,
        name: `cron.tick.${i + 1}`,
        received_at: new Date(Date.now() - i * 1000).toISOString(),
      }));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: events }),
        text: async () => JSON.stringify({ data: events }),
      } as unknown as Response;
    }

    if (urlStr.includes('/v1/events/') && urlStr.endsWith('/runs')) {
      // /v1/events/{id}/runs — delayed return (mocked latency).
      // Extract the eventId from the URL path.
      const idMatch = urlStr.match(/\/v1\/events\/([^/]+)\/runs/);
      const eventId = idMatch?.[1] ?? 'unknown';
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          if (failingEventId && eventId === failingEventId) {
            resolve({
              ok: false,
              status: 401,
              text: async () => 'unauthorized',
              json: async () => ({}),
            } as unknown as Response);
            return;
          }
          resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  run_id: `run-${eventId}`,
                  run_started_at: new Date().toISOString(),
                  ended_at: new Date().toISOString(),
                  status: 'Completed',
                  function_id: 'fn-tick',
                  event_id: eventId,
                },
              ],
            }),
            text: async () => '',
          } as unknown as Response);
        }, PER_EVENT_LATENCY_MS);
      });
    }

    return {
      ok: false,
      status: 404,
      text: async () => 'not found',
      json: async () => ({}),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('/api/operator/jobs parallel fan-out (Phase 12.3 / API-23)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.INNGEST_SIGNING_KEY = 'test-signing-key';
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_KEY === undefined) delete process.env.INNGEST_SIGNING_KEY;
    else process.env.INNGEST_SIGNING_KEY = ORIGINAL_KEY;
  });

  it('Test 1 (perf): 10-event mock with 100ms per-call latency completes in <500ms (vs ~1000ms sequential)', async () => {
    global.fetch = makeDelayedFetch();
    const { GET } = await import('@/app/api/operator/jobs/route');
    const req = new Request('http://localhost/api/operator/jobs');
    const start = Date.now();
    const res = await GET(req);
    const elapsed = Date.now() - start;
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs.length).toBe(EVENT_COUNT);
    // Pre-fix sequential: 10 × 100ms ≈ 1000ms. Post-fix parallel: ~100ms
    // (max of one call). Buffer to 500ms to absorb test-runner overhead.
    expect(elapsed).toBeLessThan(500);
  });

  it('Test 2 (graceful 401 isolation): when one per-event fetch returns 401, others still populate runs', async () => {
    const failingId = 'ev03';
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    global.fetch = makeDelayedFetch(failingId);
    const { GET } = await import('@/app/api/operator/jobs/route');
    const req = new Request('http://localhost/api/operator/jobs');
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    // 9 of 10 events succeed.
    expect(body.runs.length).toBe(EVENT_COUNT - 1);
    // Failed event ev03 should not be present in runs.
    expect(body.runs.find((r: { event_id: string }) => r.event_id === failingId)).toBeUndefined();
    // console.error called at least once for the failed event.
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
