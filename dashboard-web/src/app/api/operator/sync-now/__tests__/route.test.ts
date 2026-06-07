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

import { POST } from '@/app/api/operator/sync-now/route';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadActiveStoreIds.mockResolvedValue(['uzoshop', 'zolplus', 'usmile360']);
  mockInngestSend.mockResolvedValue({ ids: ['evt-1', 'evt-2', 'evt-3'] });
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

  it('scope=all sends one event per active store returned by loadActiveStoreIds', async () => {
    mockLoadActiveStoreIds.mockResolvedValue(['uzoshop', 'zolplus', 'usmile360']);
    mockInngestSend.mockResolvedValue({ ids: ['a', 'b', 'c'] });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'all' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    const sentEvents = mockInngestSend.mock.calls[0][0] as Array<{ name: string; data: { storeId: string } }>;
    expect(sentEvents).toHaveLength(3);
    const storeIds = sentEvents.map((e) => e.data.storeId);
    expect(storeIds).toContain('uzoshop');
    expect(storeIds).toContain('zolplus');
    expect(storeIds).toContain('usmile360');
  });

  it('scope=all with a custom DB-backed store list uses the returned ids', async () => {
    mockLoadActiveStoreIds.mockResolvedValue(['store-a', 'store-b']);
    mockInngestSend.mockResolvedValue({ ids: ['x', 'y'] });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'all' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    const sentEvents = mockInngestSend.mock.calls[0][0] as Array<{ name: string; data: { storeId: string } }>;
    expect(sentEvents).toHaveLength(2);
    expect(sentEvents.map((e) => e.data.storeId)).toEqual(['store-a', 'store-b']);
  });

  it('scope=store with a valid storeId is accepted (202)', async () => {
    mockInngestSend.mockResolvedValue({ ids: ['evt-z'] });
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'store', storeId: 'uzoshop' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    expect(mockLoadActiveStoreIds).toHaveBeenCalledOnce();
  });

  it('scope=store with an unknown storeId is rejected (400)', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'store', storeId: 'evil-store' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockInngestSend).not.toHaveBeenCalled();
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
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('invalid scope returns 400', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ scope: 'bad' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
