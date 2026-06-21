import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be hoisted so the mock is set up before the module is imported.
const mockLoadActiveStoreIds = vi.hoisted(() => vi.fn<() => Promise<string[]>>());

vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: mockLoadActiveStoreIds,
}));

// Inngest → Vercel Cron + QStash migration (Stage 3 Task 3.2): the route now
// publishes ONE QStash job to /api/worker/backfill instead of inngest.send.
const mockPublishJob = vi.hoisted(() => vi.fn<(path: string, body: unknown) => Promise<void>>());
vi.mock('@/lib/jobs/qstash', () => ({
  publishJob: (path: string, body: unknown) => mockPublishJob(path, body),
}));

vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));

// dateValidation is real — no mock needed.

import { POST } from '@/app/api/operator/backfill/route';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadActiveStoreIds.mockResolvedValue(['uzoshop', 'zolplus', 'usmile360']);
  mockPublishJob.mockResolvedValue(undefined);
});

describe('POST /api/operator/backfill', () => {
  it('calls loadActiveStoreIds() to determine the valid store list', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2026-05-10', to: '2026-05-12', storeIds: ['uzoshop'] }),
    });
    await POST(req);
    expect(mockLoadActiveStoreIds).toHaveBeenCalledOnce();
  });

  it('valid payload with known storeIds returns 202 and publishes ONE backfill job', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2026-05-10', to: '2026-05-12', storeIds: ['uzoshop', 'zolplus'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.storeIds).toEqual(['uzoshop', 'zolplus']);
    expect(body.accepted).toBe(1);
    expect(mockPublishJob).toHaveBeenCalledTimes(1);
    expect(mockPublishJob).toHaveBeenCalledWith('/api/worker/backfill', {
      from: '2026-05-10',
      to: '2026-05-12',
      storeIds: ['uzoshop', 'zolplus'],
    });
  });

  it('unknown storeId is rejected with 400', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2026-05-10', to: '2026-05-12', storeIds: ['evil-store'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockPublishJob).not.toHaveBeenCalled();
  });

  it('validates storeIds against loadActiveStoreIds result, not hardcoded list', async () => {
    // DB returns only store-a; uzoshop is NOT in that list.
    mockLoadActiveStoreIds.mockResolvedValue(['store-a']);
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2026-05-10', to: '2026-05-12', storeIds: ['uzoshop'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockPublishJob).not.toHaveBeenCalled();
  });

  it('DB-backed store is accepted when loadActiveStoreIds returns it', async () => {
    mockLoadActiveStoreIds.mockResolvedValue(['store-a', 'store-b']);
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2026-05-10', to: '2026-05-12', storeIds: ['store-a'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    expect(mockPublishJob).toHaveBeenCalledTimes(1);
  });

  it('from before history boundary is rejected (400)', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2025-01-01', to: '2026-05-12', storeIds: ['uzoshop'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('from > to is rejected (400)', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2026-05-12', to: '2026-05-10', storeIds: ['uzoshop'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('empty storeIds is rejected (400)', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2026-05-10', to: '2026-05-12', storeIds: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('invalid date format is rejected (400)', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: 'not-a-date', to: '2026-05-12', storeIds: ['uzoshop'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
