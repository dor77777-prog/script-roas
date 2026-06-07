import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be hoisted so the mock is set up before the module is imported.
const mockLoadActiveStoreIds = vi.hoisted(() => vi.fn<() => Promise<string[]>>());

vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: mockLoadActiveStoreIds,
}));

const mockInngestSend = vi.hoisted(() => vi.fn());
vi.mock('@/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));

// dateValidation is real — no mock needed.

import { POST } from '@/app/api/operator/backfill/route';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadActiveStoreIds.mockResolvedValue(['uzoshop', 'zolplus', 'usmile360']);
  mockInngestSend.mockResolvedValue({ ids: ['evt-backfill-1'] });
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

  it('valid payload with known storeIds returns 202', async () => {
    mockInngestSend.mockResolvedValue({ ids: ['evt-1'] });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2026-05-10', to: '2026-05-12', storeIds: ['uzoshop', 'zolplus'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.storeIds).toEqual(['uzoshop', 'zolplus']);
  });

  it('unknown storeId is rejected with 400', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2026-05-10', to: '2026-05-12', storeIds: ['evil-store'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockInngestSend).not.toHaveBeenCalled();
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
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('DB-backed store is accepted when loadActiveStoreIds returns it', async () => {
    mockLoadActiveStoreIds.mockResolvedValue(['store-a', 'store-b']);
    mockInngestSend.mockResolvedValue({ ids: ['evt-2'] });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ from: '2026-05-10', to: '2026-05-12', storeIds: ['store-a'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
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
