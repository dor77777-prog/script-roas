import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be hoisted so the mock is set up before the module is imported.
const mockLoadActiveStoreIds = vi.hoisted(() => vi.fn<() => Promise<string[]>>());

vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: mockLoadActiveStoreIds,
}));

// Inngest → Vercel Cron + QStash migration (Stage 3 Task 3.1): the route now
// publishes one QStash job per (store, date) to /api/worker/daily-store instead
// of firing inngest.send('event/sync-now'). We mock publishJob so the test
// asserts ONLY the fan-out shape (path + body) the button produces.
const mockPublishJob = vi.hoisted(() => vi.fn<(path: string, body: unknown) => Promise<void>>());
vi.mock('@/lib/jobs/qstash', () => ({
  publishJob: (path: string, body: unknown) => mockPublishJob(path, body),
}));

vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));

import { POST } from '@/app/api/operator/sync-now/route';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadActiveStoreIds.mockResolvedValue(['uzoshop', 'zolplus', 'usmile360']);
  mockPublishJob.mockResolvedValue(undefined);
});

describe('POST /api/operator/sync-now', () => {
  it('calls loadActiveStoreIds() to determine the store list', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'all' }),
    });
    await POST(req);
    expect(mockLoadActiveStoreIds).toHaveBeenCalledOnce();
  });

  it('scope=all publishes a daily-store job per store × 3 rolling dates (today, yesterday, day-before)', async () => {
    mockLoadActiveStoreIds.mockResolvedValue(['uzoshop', 'zolplus', 'usmile360']);
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'all' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);

    // 3 stores × 3 dates = 9 jobs, all to the daily-store worker.
    expect(mockPublishJob).toHaveBeenCalledTimes(9);
    for (const call of mockPublishJob.mock.calls) {
      expect(call[0]).toBe('/api/worker/daily-store');
    }
    const jobs = mockPublishJob.mock.calls.map((c) => c[1] as { storeId: string; date: string });
    // Each store appears with 3 distinct dates.
    for (const storeId of ['uzoshop', 'zolplus', 'usmile360']) {
      const dates = jobs.filter((j) => j.storeId === storeId).map((j) => j.date);
      expect(dates).toHaveLength(3);
      expect(new Set(dates).size).toBe(3);
    }
    const body = await res.json();
    expect(body.accepted).toBe(9);
  });

  it('scope=all with a custom DB-backed store list uses the returned ids', async () => {
    mockLoadActiveStoreIds.mockResolvedValue(['store-a', 'store-b']);
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'all' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    // 2 stores × 3 dates = 6 jobs.
    expect(mockPublishJob).toHaveBeenCalledTimes(6);
    const storeIds = new Set(
      mockPublishJob.mock.calls.map((c) => (c[1] as { storeId: string }).storeId),
    );
    expect(storeIds).toEqual(new Set(['store-a', 'store-b']));
  });

  it('scope=store with a valid storeId publishes one job for today only', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'store', storeId: 'uzoshop' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    expect(mockLoadActiveStoreIds).toHaveBeenCalledOnce();
    // scope=store refreshes TODAY only (the eventSyncNow default), one job.
    expect(mockPublishJob).toHaveBeenCalledTimes(1);
    expect(mockPublishJob.mock.calls[0][0]).toBe('/api/worker/daily-store');
    const job = mockPublishJob.mock.calls[0][1] as { storeId: string; date: string };
    expect(job.storeId).toBe('uzoshop');
    expect(typeof job.date).toBe('string');
  });

  it('scope=store with an unknown storeId is rejected (400)', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'store', storeId: 'evil-store' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockPublishJob).not.toHaveBeenCalled();
  });

  it('scope=store validates against loadActiveStoreIds result, not hardcoded list', async () => {
    // If the DB returns only ['store-a'], then 'uzoshop' is no longer valid.
    mockLoadActiveStoreIds.mockResolvedValue(['store-a']);
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'store', storeId: 'uzoshop' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockPublishJob).not.toHaveBeenCalled();
  });

  it('invalid scope returns 400', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'bad' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockPublishJob).not.toHaveBeenCalled();
  });
});
