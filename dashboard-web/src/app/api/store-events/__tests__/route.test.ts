import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import * as storeMod from '@/lib/webhooks/store';
import type { StoreEventRow } from '@/lib/webhooks/store';

import { GET } from '../route';

// ---------------------------------------------------------------------------
// Read-route test. We mock the DB boundary (readRecentStoreEvents) so the suite
// stays hermetic — the route's job is shape + filter wiring + soft-fail, which
// is what we assert here.
// ---------------------------------------------------------------------------

const sampleRows: StoreEventRow[] = [
  {
    id: 'a',
    store_id: 'uzoshop',
    type: 'sale',
    amount_cad: 248,
    currency: 'CAD',
    amount_original: 248,
    product_title: 'Hair Serum',
    quantity: 2,
    customer_label: 'A׳ C׳',
    occurred_at: '2026-06-01T10:00:00Z',
    received_at: '2026-06-01T10:00:05Z',
  },
  {
    id: 'b',
    store_id: 'zolplus',
    type: 'refund',
    amount_cad: -59.9,
    currency: 'CAD',
    amount_original: -59.9,
    product_title: 'Salmon Set',
    quantity: 1,
    customer_label: null,
    occurred_at: '2026-06-01T09:00:00Z',
    received_at: '2026-06-01T09:00:02Z',
  },
];

function makeReq(query = ''): Request {
  return new Request(`https://example.com/api/store-events${query}`);
}

let readSpy: MockInstance<typeof storeMod.readRecentStoreEvents>;

beforeEach(() => {
  readSpy = vi.spyOn(storeMod, 'readRecentStoreEvents').mockResolvedValue(sampleRows);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/store-events', () => {
  it('returns { events, serverNow, lastReceivedAt } with the latest rows', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: StoreEventRow[];
      serverNow: string;
      lastReceivedAt: string | null;
    };
    expect(body.events).toEqual(sampleRows);
    // serverNow is a valid ISO timestamp.
    expect(Number.isNaN(Date.parse(body.serverNow))).toBe(false);
    // lastReceivedAt is the newest row's received_at (rows are newest-first).
    expect(body.lastReceivedAt).toBe('2026-06-01T10:00:05Z');
  });

  it('caps the read at 50 newest-first', async () => {
    await GET(makeReq());
    expect(readSpy).toHaveBeenCalledWith({ limit: 50, storeId: undefined });
  });

  it('passes the ?store= filter through to the reader', async () => {
    await GET(makeReq('?store=uzoshop'));
    expect(readSpy).toHaveBeenCalledWith({ limit: 50, storeId: 'uzoshop' });
  });

  it('treats ?store=All as no filter', async () => {
    await GET(makeReq('?store=All'));
    expect(readSpy).toHaveBeenCalledWith({ limit: 50, storeId: undefined });
  });

  it('lastReceivedAt is null when there are no events', async () => {
    readSpy.mockResolvedValue([]);
    const res = await GET(makeReq());
    const body = (await res.json()) as { events: StoreEventRow[]; lastReceivedAt: string | null };
    expect(body.events).toEqual([]);
    expect(body.lastReceivedAt).toBeNull();
  });

  it('soft-fails to an empty feed (HTTP 200) if the reader throws', async () => {
    readSpy.mockRejectedValue(new Error('db down'));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: StoreEventRow[]; lastReceivedAt: string | null };
    expect(body.events).toEqual([]);
    expect(body.lastReceivedAt).toBeNull();
  });
});
